from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
YFINANCE_RESULTS = (
    ROOT.parent
    / "quality-oversold-yfinance-feasibility"
    / "results.json"
)
FIELDS = [
    ("revenue", "매출"),
    ("net_income", "순이익"),
    ("operating_cash_flow", "OCF"),
    ("equity", "자기자본"),
    ("total_debt", "총부채"),
    ("gross_profit", "매출총이익"),
]


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def number(value: float | None, digits: int = 3) -> str:
    return "-" if value is None else f"{value:.{digits}f}"


def debt_crosscheck(
    sec: dict[str, Any], yfinance: dict[str, Any]
) -> list[dict[str, Any]]:
    yf_rows = {
        row["symbol"]: row for row in yfinance["records"] if row["role"] == "core"
    }
    rows = []
    for company in sec["companies"]:
        yf_row = yf_rows[company["symbol"]]
        sec_ratio = company["latest_debt_to_equity"]
        yf_ratio = yf_row["current_metrics"]["debt_to_equity_latest_computed"]
        relative_gap = (
            abs(sec_ratio - yf_ratio) / abs(yf_ratio)
            if sec_ratio is not None and yf_ratio
            else None
        )
        rows.append(
            {
                "symbol": company["symbol"],
                "sec_quarter_end": company["expected_quarter_ends"][0],
                "yfinance_statement_date": yf_row["fields"]["total_debt_q"][
                    "values"
                ][0]["date"][:10],
                "sec_provisional_de": sec_ratio,
                "yfinance_de": yf_ratio,
                "relative_gap_pct": (
                    relative_gap * 100 if relative_gap is not None else None
                ),
                "sec_debt_quarters": company["fields"]["total_debt"][
                    "quarters_available"
                ],
                "mapping_status": company["debt_mapping_status"],
            }
        )
    return rows


def write_debt_csv(rows: list[dict[str, Any]]) -> None:
    with (ROOT / "debt_crosscheck.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def coverage_table(sec: dict[str, Any]) -> list[str]:
    lines = [
        "| 종목 | 매출 | 순이익 | OCF | 자기자본 | 총부채 | 매출총이익 | 6개 전부 |",
        "|---|---:|---:|---:|---:|---:|---:|:---:|",
    ]
    for company in sec["companies"]:
        counts = [
            str(company["fields"][field]["quarters_available"])
            for field, _ in FIELDS
        ]
        lines.append(
            "| "
            + " | ".join(
                [
                    company["symbol"],
                    *counts,
                    "예" if company["all_six_fields_have_8_quarters"] else "아니오",
                ]
            )
            + " |"
        )
    totals = sec["companies_with_8_quarters_by_field"]
    lines.append(
        "| **8분기 확보 종목 수** | "
        + " | ".join(
            [
                f"**{totals[field]}/10**"
                for field, _ in FIELDS
            ]
        )
        + f" | **{sec['companies_with_all_six_fields_8_quarters']}/10** |"
    )
    return lines


def gross_profit_table(sec: dict[str, Any]) -> list[str]:
    lines = [
        "| 종목 | 8분기 | 처리 |",
        "|---|---:|---|",
    ]
    for company in sec["companies"]:
        lines.append(
            f"| {company['symbol']} | "
            f"{company['fields']['gross_profit']['quarters_available']} | "
            f"{company['gross_profit_mapping_note']} |"
        )
    return lines


def debt_table(rows: list[dict[str, Any]]) -> list[str]:
    lines = [
        "| 종목 | SEC 임시 D/E | yfinance D/E | 차이 | SEC 8분기 |",
        "|---|---:|---:|---:|---:|",
    ]
    for row in rows:
        gap = (
            "-"
            if row["relative_gap_pct"] is None
            else f"{row['relative_gap_pct']:.1f}%"
        )
        lines.append(
            f"| {row['symbol']} | "
            f"{number(row['sec_provisional_de'])} | "
            f"{number(row['yfinance_de'])} | {gap} | "
            f"{row['sec_debt_quarters']} |"
        )
    return lines


def main() -> None:
    sec = load_json(ROOT / "results.json")
    yfinance = load_json(YFINANCE_RESULTS)
    debt_rows = debt_crosscheck(sec, yfinance)
    write_debt_csv(debt_rows)

    total_sources = sum(
        company["provenance"]["source_fact_count"]
        for company in sec["companies"]
    )
    total_filed = sum(
        company["provenance"]["filed_present"]
        for company in sec["companies"]
    )
    total_accessions = sum(
        company["provenance"]["accession_present"]
        for company in sec["companies"]
    )
    total_selected_amended = sum(
        company["provenance"]["amended_source_fact_count"]
        for company in sec["companies"]
    )

    lines = [
        "# 품질 우량주 과매도 스크리너 — SEC 10종목 데이터 스파이크",
        "",
        f"- 기준일: {sec['as_of']}",
        "- 대상: AAPL, MSFT, GOOGL, HD, JNJ, PG, COST, CAT, XOM, LIN",
        "- 범위: 현재 스크리너에 필요한 최근 8개 분기의 6개 재무 필드",
        "- 가격·배당 데이터는 이번 스파이크 범위 밖이며 앞선 yfinance 검증 결과를 유지",
        "",
        "## 결론",
        "",
        "**yfinance 가격 + SEC 재무라는 혼합 구조는 맞다. 다만 SEC "
        "Companyfacts만으로는 현재 기획을 그대로 구현할 수 없다.**",
        "",
        "매출·순이익·영업현금흐름·자기자본은 10종목 모두 8분기를 "
        "복원했다. 반면 총부채는 기계적 커버리지조차 7/10, 매출총이익은 "
        "회계적으로 동등한 값만 인정하면 7/10이다. 6개 필드가 모두 8분기인 "
        "종목은 5/10이지만, 이 숫자도 총부채 정의 검증 전의 기계적 결과다.",
        "",
        "따라서 다음 구현은 세 층이어야 한다.",
        "",
        "1. yfinance: 가격, 수정주가, 배당, RSI, 낙폭",
        "2. SEC Companyfacts: 표준 taxonomy로 충분한 재무 필드와 공시 provenance",
        "3. 원문 inline XBRL/issuer mapping: custom tag, CIK 승계, 표준 태그 누락 fallback",
        "",
        "동등한 회계 개념을 원문에서도 복원할 수 없으면 0이나 대체 지표를 "
        "넣지 않고 `데이터 부족`으로 분류해야 한다.",
        "",
        "SEC 문서상 Companyfacts 계열 API는 **비사용자 정의 taxonomy**이면서 "
        "전체 법인에 적용되는 사실만 집계한다. 기업 custom taxonomy는 원문 "
        "공시에 존재해도 Companyfacts에서 빠질 수 있다. "
        "[SEC EDGAR API 문서](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)",
        "",
        "## 8분기 커버리지",
        "",
        "아래 숫자는 각 종목의 최근 8개 매출 분기 종료일에 맞춘 값이다. "
        "결측값은 0으로 채우지 않았다.",
        "",
        *coverage_table(sec),
        "",
        "분기 손익·현금흐름은 직접 3개월 사실을 우선하고, 없으면 같은 "
        "누적기간의 YTD 차이로 복원했다. 예를 들어 4분기는 연간값에서 "
        "9개월 누적값을 차감한다. 두 원천 중 늦은 공시일을 해당 파생값의 "
        "이용 가능일로 삼았다.",
        "",
        "## 공시일과 접수번호",
        "",
        f"선택된 원천 사실 {total_sources}개 중 filed date는 "
        f"{total_filed}/{total_sources}, 접수번호는 "
        f"{total_accessions}/{total_sources}로 모두 존재했다. 각 분기 값의 "
        "원천 태그·공시일·접수번호·form은 `results.json`의 "
        "`quarter_points.sources`에 보존했다.",
        "",
        "현재 스파이크는 기준일 이전에 공시된 동일 구간 사실 중 가장 늦게 "
        "접수된 버전을 골랐다. 백테스트에서는 이를 일반화해 "
        "`filed <= 신호일`인 버전만 허용해야 한다.",
        "",
        "## 태그 차이",
        "",
        "- 매출: 2개 표준 태그. GOOGL은 최근 8분기 안에서도 "
        "`RevenueFromContractWithCustomerExcludingAssessedTax`에서 "
        "`Revenues`로 전환",
        "- 순이익: `NetIncomeLoss`, `ProfitLoss` 2개",
        "- 자기자본: 지배기업 기준과 비지배지분 포함 기준 2개",
        "- 총부채: 선택된 매핑에만 8개 태그가 필요",
        "- 매출총이익: 직접 태그와 매출-원가 파생을 합쳐 5개 태그가 필요",
        "",
        "즉 단순한 전역 alias 목록만으로는 부족하고, 태그 의미·기간·법인 "
        "계보를 함께 검증하는 매핑 레이어가 필요하다.",
        "",
        "## 매출총이익 판정",
        "",
        *gross_profit_table(sec),
        "",
        "CAT은 총매출에 Financial Products 매출이 포함되지만 표준 "
        "`CostOfRevenue`는 동일 범위를 대표하지 않아 단순 차감을 거부했다. "
        "XOM은 원유 구입비·생산비·감가상각 등을 별도 표시하고 gross profit "
        "라인이 없으며, LIN은 cost of sales를 감가상각·상각비 제외 기준으로 "
        "공시한다. 이들을 억지로 한 수치로 만들면 전략 조건이 바뀐다. "
        "[CAT 10-Q](https://www.sec.gov/Archives/edgar/data/18230/000001823026000021/cat-20260331.htm), "
        "[XOM 10-Q](https://www.sec.gov/Archives/edgar/data/34088/000003408826000067/xom-20260331.htm), "
        "[LIN 10-Q](https://www.sec.gov/Archives/edgar/data/1707925/000162828026029165/lin-20260331.htm)",
        "",
        "## 총부채는 정의를 먼저 고정해야 함",
        "",
        "SEC 표준 태그를 조합한 임시 D/E와 앞선 yfinance `Total Debt / "
        "Equity`를 대조했다. 일치 여부를 ground truth로 보지는 않았지만, "
        "차이가 크다는 사실은 `총부채`의 포함 범위가 아직 미정임을 보여준다.",
        "",
        *debt_table(debt_rows),
        "",
        "AAPL·JNJ·XOM·LIN은 정확히 일치했지만 GOOGL·HD·COST는 차이가 "
        "컸고, MSFT·CAT은 결측을 0으로 두지 않으면 최근 분기 식이 완성되지 "
        "않았다. 권장 고정 정의는 다음과 같다.",
        "",
        "> 총부채 = 단기 이자부 차입금 + 유동성 장기부채 + 비유동 "
        "이자부 차입금 + 금융리스 부채. 운용리스 부채는 제외한다.",
        "",
        "이 정의에 동의하면 issuer별 태그 합산식을 원문 재무상태표와 "
        "대조하는 테스트를 작성한다. yfinance 값에 맞추기 위해 항목을 "
        "넣고 빼지는 않는다.",
        "",
        "## 수정공시 처리",
        "",
        "10종목 submissions에서 10-K/A는 COST의 2016년 1건, 10-Q/A는 "
        "0건이었다. 최근 8분기 선택 사실 중 수정공시 원천은 0건이다. "
        "COST 수정공시는 계약상 구매의무 표를 고친 것이며 다른 영역에는 "
        "영향이 없다고 명시했다. "
        "[COST 2016 10-K/A](https://www.sec.gov/Archives/edgar/data/909832/000090983216000034/cost10ka82816.htm)",
        "",
        "처리 규칙은 다음으로 고정할 수 있다.",
        "",
        "- 원본과 수정본을 모두 보존하고 접수번호로 구분",
        "- 현재 스크리너는 실행일 이전 최신 버전 사용",
        "- 백테스트는 신호일 이전에 접수된 버전만 사용",
        "- 수정본은 접수일 이후에만 효력이 생기며, 수정되지 않은 재무 "
        "사실을 일괄 덮어쓰지 않음",
        "",
        "## CIK 승계 예외",
        "",
        "현재 SEC 티커 표의 XOM은 2026년 7월 새 CIK `0002115436`으로 "
        "연결되며 이 CIK에는 과거 US-GAAP 이력이 없다. SEC 8-K는 2026년 "
        "7월 1일 법인 재편과 1:1 주식 교환, 새 법인의 successor registrant "
        "지위를 명시한다. 따라서 이번 스파이크는 선행 CIK `0000034088`의 "
        "재무 이력을 연결했다. "
        "[XOM successor 8-K](https://www.sec.gov/Archives/edgar/data/2115436/000119312526291990/d71068d8k12b.htm)",
        "",
        "현재 티커-CIK 표 하나만 쓰면 이런 종목의 이력이 조용히 사라진다. "
        "현재 스크리너와 백테스트 모두 효력일이 있는 CIK 계보표가 필요하다.",
        "",
        "## 다음 단계 제안",
        "",
        "1. 위 총부채 정의를 확정",
        "2. CAT을 대표 사례로 원문 inline XBRL custom tag fallback을 좁게 구현",
        "3. 10종목의 총부채 합산식과 원문 재무상태표를 대조",
        "4. gross profit을 회계적으로 복원할 수 없는 종목은 `데이터 부족`으로 제외",
        "5. 이 결과를 검토받은 뒤에만 품질 게이트·적신호 필터 구현",
        "",
        "5년 historical PER은 삭제하지 않고 핵심 스크리너 이후 단계로 "
        "미룬다. Utilities 제외 근거는 높은 D/E 자체가 아니라 업종 구조와 "
        "부채 비교 가능성 문제로 기록한다.",
        "",
        "## 재현",
        "",
        "```powershell",
        "& '.\\leader-stock-screener\\.venv\\Scripts\\python.exe' "
        "'.\\analysis\\quality-oversold-sec-feasibility\\fetch_sec.py' "
        "--output-dir '.\\analysis\\quality-oversold-sec-feasibility'",
        "& '.\\leader-stock-screener\\.venv\\Scripts\\python.exe' "
        "'.\\analysis\\quality-oversold-sec-feasibility\\analyze_sec.py'",
        "& '.\\leader-stock-screener\\.venv\\Scripts\\python.exe' "
        "-m unittest discover -s "
        "'.\\analysis\\quality-oversold-sec-feasibility' -p 'test_*.py' -v",
        "& '.\\leader-stock-screener\\.venv\\Scripts\\python.exe' "
        "'.\\analysis\\quality-oversold-sec-feasibility\\build_report.py'",
        "```",
        "",
        "수집 속도는 초당 최대 4회로 제한했다. SEC의 현재 안내는 전체 "
        "사용자당 초당 10회 이하이다. "
        "[SEC Developer Resources](https://www.sec.gov/about/developer-resources)",
    ]
    (ROOT / "report.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8"
    )
    print(ROOT / "report.md")


if __name__ == "__main__":
    main()
