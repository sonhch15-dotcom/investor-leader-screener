from __future__ import annotations

import csv
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parent


def source(source_id: str, label: str, path: str, href: str | None = None):
    result = {"id": source_id, "label": label, "path": path}
    if href:
        result["href"] = href
    return result


def main() -> None:
    artifact_path = ROOT / "artifact.json"
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    result = json.loads(
        (ROOT / "total_liabilities_equity_fsds_results.json").read_text(
            encoding="utf-8"
        )
    )
    fallback = json.loads(
        (ROOT / "fsds_instance_fallback_results.json").read_text(
            encoding="utf-8"
        )
    )
    manifest = artifact["manifest"]
    snapshot = artifact["snapshot"]
    now = datetime.now(ZoneInfo("Asia/Seoul")).isoformat(timespec="seconds")

    manifest["title"] = "S&P 500 품질 스크리너 재무 안정 지표 검증"
    manifest["description"] = (
        "연결 총부채 ÷ 비지배지분 포함 자기자본의 커버리지와 현재 진단 분포"
    )
    manifest["generatedAt"] = now
    snapshot["generatedAt"] = now

    debt_chart = next(
        chart
        for chart in manifest["charts"]
        if chart["id"] == "debt-coverage-chart"
    )
    debt_chart.update(
        {
            "title": "재무 안정 지표별 판정 가능 비율",
            "subtitle": (
                "Financials·Real Estate·Utilities 제외 362개 발행사; "
                "자기자본 0 이하는 자동 미통과로 판정 가능에 포함"
            ),
            "question": (
                "연결 총부채 비율이 사전등록한 전체 90% 커버리지 "
                "최소선을 충족했는가?"
            ),
            "rationale": (
                "철회한 이자부 D/E, 새 총부채비율, 사전 최소선을 같은 "
                "분모에서 비교한다."
            ),
            "encodings": {
                "x": {
                    "field": "method",
                    "type": "nominal",
                    "label": "지표 또는 기준",
                },
                "y": {
                    "field": "coverage",
                    "type": "quantitative",
                    "format": "percent",
                    "label": "판정 가능 비율",
                },
                "tooltip": [
                    {
                        "field": "resolved_issuers",
                        "type": "quantitative",
                        "label": "판정 가능 발행사",
                    },
                    {
                        "field": "population",
                        "type": "quantitative",
                        "label": "모집단",
                    },
                ],
            },
        }
    )

    charts_by_id = {chart["id"]: chart for chart in manifest["charts"]}
    distribution_chart = charts_by_id.get(
        "total-liabilities-distribution-chart"
    )
    if distribution_chart is None:
        distribution_chart = {
            "id": "total-liabilities-distribution-chart",
            "showDescription": True,
            "intent": "distribution",
            "type": "bar",
            "dataset": "total_liabilities_histogram",
            "sourceId": "total-liabilities-histogram-query",
            "valueFormat": "number",
            "layout": "full",
            "maxRows": 8,
        }
        manifest["charts"].append(distribution_chart)
    distribution_chart.update(
        {
            "title": "현재 연결 총부채비율 분포",
            "subtitle": (
                "SEC FSDS 2026 Q1, 양수 자기자본 320개 발행사; "
                "현재 분포는 임계값 산정에 사용하지 않음"
            ),
            "question": (
                "새 지표의 현재 횡단면은 어디에 집중되고 얼마나 긴 "
                "오른쪽 꼬리를 가지는가?"
            ),
            "rationale": (
                "임계값을 제안하지 않고 분포의 집중 구간과 극단 꼬리를 "
                "보여준다."
            ),
            "encodings": {
                "x": {
                    "field": "bin",
                    "type": "nominal",
                    "label": "총부채 ÷ 총자기자본 구간",
                },
                "y": {
                    "field": "issuer_count",
                    "type": "quantitative",
                    "format": "number",
                    "label": "발행사 수",
                },
                "tooltip": [
                    {
                        "field": "share",
                        "type": "quantitative",
                        "format": "percent",
                        "label": "양수 자기자본 표본 비중",
                    },
                    {
                        "field": "sample_size",
                        "type": "quantitative",
                        "label": "표본 수",
                    },
                ],
            },
        }
    )

    sector_table = next(
        table
        for table in manifest["tables"]
        if table["id"] == "debt-sector-coverage-table"
    )
    sector_table.update(
        {
            "title": "섹터별 연결 총부채비율 판정 가능 비율",
            "subtitle": (
                "SEC FSDS 2026 Q1; 모든 포함 섹터가 사전 최소선 80% 통과"
            ),
            "dataset": "debt_sector_coverage",
            "sourceId": "total-liabilities-sector-query",
        }
    )

    tables_by_id = {table["id"]: table for table in manifest["tables"]}
    quantile_table = tables_by_id.get("total-liabilities-quantiles-table")
    if quantile_table is None:
        quantile_table = {
            "id": "total-liabilities-quantiles-table",
            "layout": "full",
            "density": "spacious",
        }
        manifest["tables"].append(quantile_table)
    quantile_table.update(
        {
            "title": "현재 연결 총부채비율 분위수",
            "subtitle": (
                "양수 자기자본 320개 발행사; P90 5.94는 진단값이며 "
                "백테스트 임계값이 아님"
            ),
            "showDescription": True,
            "dataset": "total_liabilities_quantiles",
            "defaultSort": {"field": "order", "direction": "asc"},
            "sourceId": "total-liabilities-quantiles-query",
            "columns": [
                {
                    "field": "order",
                    "label": "순서",
                    "format": "number",
                },
                {
                    "field": "statistic",
                    "label": "통계량",
                    "type": "text",
                },
                {
                    "field": "ratio",
                    "label": "총부채 ÷ 총자기자본",
                    "format": "number",
                },
                {
                    "field": "interpretation",
                    "label": "용도",
                    "type": "text",
                },
            ],
        }
    )

    nonpositive_table = tables_by_id.get(
        "nonpositive-equity-exclusions-table"
    )
    if nonpositive_table is None:
        nonpositive_table = {
            "id": "nonpositive-equity-exclusions-table",
            "layout": "full",
            "density": "dense",
        }
        manifest["tables"].append(nonpositive_table)
    nonpositive_table.update(
        {
            "title": "자기자본 0 이하 자동 미통과 발행사",
            "subtitle": (
                "SEC FSDS 2026 Q1 현재 스냅샷 22개; 과거 고정 제외 "
                "목록이 아니라 각 신호일에 재판정"
            ),
            "showDescription": True,
            "dataset": "nonpositive_equity_exclusions",
            "defaultSort": {"field": "symbols", "direction": "asc"},
            "sourceId": "nonpositive-equity-query",
            "columns": [
                {"field": "symbols", "label": "종목", "type": "text"},
                {"field": "name", "label": "회사", "type": "text"},
                {"field": "sector", "label": "섹터", "type": "text"},
                {
                    "field": "equity",
                    "label": "연결 자기자본(USD)",
                    "format": "number",
                },
                {
                    "field": "financial_period_end",
                    "label": "재무기간 말",
                    "type": "text",
                },
                {"field": "filed", "label": "공시일", "type": "text"},
                {
                    "field": "accession",
                    "label": "접수번호",
                    "type": "text",
                },
            ],
        }
    )

    source_by_id = {item["id"]: item for item in manifest["sources"]}
    source_by_id.update(
        {
            "total-liabilities-results": source(
                "total-liabilities-results",
                "연결 총부채비율 FSDS 횡단면 결과",
                "total_liabilities_equity_fsds_results.json",
                "https://www.sec.gov/data-research/sec-markets-data/financial-statement-data-sets",
            ),
            "total-liabilities-cross-section": source(
                "total-liabilities-cross-section",
                "연결 총부채비율 발행사별 횡단면",
                "total_liabilities_equity_fsds_cross_section.csv",
            ),
            "total-liabilities-sector-query": source(
                "total-liabilities-sector-query",
                "연결 총부채비율 섹터 커버리지 SQL",
                "report_total_liabilities_sector_coverage.sql",
            ),
            "total-liabilities-histogram-query": source(
                "total-liabilities-histogram-query",
                "연결 총부채비율 진단 분포 SQL",
                "report_total_liabilities_histogram.sql",
            ),
            "total-liabilities-quantiles-query": source(
                "total-liabilities-quantiles-query",
                "연결 총부채비율 분위수 SQL",
                "report_total_liabilities_quantiles.sql",
            ),
            "preregistration-v04": source(
                "preregistration-v04",
                "연결 총부채비율 사전등록 v0.4",
                "PREREGISTRATION.v0.4.md",
            ),
            "preregistration-v041": source(
                "preregistration-v041",
                "공식 presentation 매핑 사전등록 v0.4.1",
                "PREREGISTRATION.v0.4.1.md",
            ),
            "preregistration-v05": source(
                "preregistration-v05",
                "P50 임계값 및 음수 자기자본 한계 사전등록 v0.5",
                "PREREGISTRATION.v0.5.md",
            ),
            "nonpositive-equity-list": source(
                "nonpositive-equity-list",
                "자기자본 0 이하 자동 미통과 발행사",
                "nonpositive_equity_auto_fail_2026q1.csv",
            ),
            "nonpositive-equity-query": source(
                "nonpositive-equity-query",
                "자기자본 0 이하 자동 미통과 SQL",
                "report_nonpositive_equity_exclusions.sql",
            ),
            "companyfacts-liabilities-pilot": source(
                "companyfacts-liabilities-pilot",
                "Companyfacts 단독 매핑 예비 결과",
                "total_liabilities_equity_results.json",
            ),
        }
    )
    manifest["sources"] = list(source_by_id.values())
    artifact["sources"] = list(source_by_id.values())

    blocks = manifest["blocks"]
    block_by_id = {block["id"]: block for block in blocks}
    block_by_id["title"]["body"] = (
        "# S&P 500 품질 스크리너 재무 안정 지표 검증"
    )
    block_by_id["technical-summary"].update(
        {
            "sourceId": "total-liabilities-results",
            "body": (
                "## 기술 요약: 총부채비율은 커버리지를 통과했지만 "
                "임계값은 아직 없다\n\n"
                "연결 총부채 ÷ 비지배지분 포함 연결 자기자본은 "
                "342/362(94.5%)에서 판정 가능했고, 8개 포함 섹터가 "
                "모두 80% 최소선을 통과했다. 사용 수치의 공시일·"
                "접수번호 존재율도 100%다.\n\n"
                "양수 자기자본 320개의 현재 분포는 중앙값 1.39, "
                "진단용 P90 5.94였다. 이 값은 2026년 분포의 기술통계일 "
                "뿐이며 백테스트나 실전 임계값으로 사용하지 않는다. "
                "P90은 품질 선별이 아니라 이상치 제거에 가까워 폐기했다. "
                "절대 임계값은 최초 백테스트 신호일 직전 60개 월말의 "
                "point-in-time 분포에서 P50을 한 번 계산해 고정한다."
            ),
        }
    )
    block_by_id["debt-coverage-heading"].update(
        {
            "sourceId": "total-liabilities-results",
            "body": (
                "## 정확도를 양보한 총부채비율은 94.5% 커버리지를 확보했다\n\n"
                "이자부 D/E는 공식 XBRL fallback 후에도 36.7%에 "
                "그쳤다. 새 지표는 매입채무·미지급금·충당부채와 "
                "운용리스까지 포함해 업종 간 비교 정확도가 낮아지는 "
                "대신, 사전등록 전체 최소선 90%를 4.5%p 웃돌았다."
            ),
        }
    )
    block_by_id["debt-coverage-interpretation"].update(
        {
            "sourceId": "total-liabilities-results",
            "body": (
                "**판정.** 새 정의는 v1 품질 게이트의 재무 안정 지표 "
                "후보로 유지할 수 있다. 다만 20개 미해결 기업을 "
                "임의로 채우지 않으며, 양수 자기자본 기업만 분위수 "
                "분포에 포함한다. 자기자본 0 이하 22개는 비율 계산 "
                "대신 품질 게이트 자동 미통과로 처리한다."
            ),
        }
    )
    block_by_id["debt-sector-heading"].update(
        {
            "sourceId": "total-liabilities-results",
            "body": (
                "## 최저 커버리지 Materials도 88.5%로 섹터 최소선을 통과했다\n\n"
                "섹터별 판정 가능 비율은 88.5%~100%다. Materials "
                "23/26, Health Care 54/59, Industrials 75/81로 "
                "상대적으로 낮지만 모두 사전등록 80% 이상이다. "
                "추가 섹터 제외나 종목별 예외는 필요하지 않다."
            ),
        }
    )

    new_blocks = [
        {
            "id": "total-liabilities-distribution-heading",
            "type": "markdown",
            "layout": "full",
            "sourceId": "total-liabilities-results",
            "body": (
                "## 현재 분포는 1~2배에 집중되지만 오른쪽 꼬리가 매우 길다\n\n"
                "320개 중 111개가 1~2배 구간에 있고 215개(67.2%)가 "
                "2배 미만이다. 반면 20배 이상도 8개이며 최대값은 "
                "159.37배다. 극단값은 주로 부채가 비정상적으로 큰 "
                "것보다 자기자본이 매우 작은 기업에서 발생한다."
            ),
        },
        {
            "id": "total-liabilities-distribution-visual",
            "type": "chart",
            "layout": "full",
            "chartId": "total-liabilities-distribution-chart",
        },
        {
            "id": "total-liabilities-distribution-interpretation",
            "type": "markdown",
            "layout": "full",
            "sourceId": "total-liabilities-results",
            "body": (
                "**해석 주의.** 현재 P90 5.94를 임계값으로 고정하면 "
                "2018년 같은 과거 신호에 2026년 레버리지 분포 정보를 "
                "주입하게 된다. 따라서 이 표와 차트는 구현 검증과 "
                "분포 형태 확인에만 사용한다. v0.5는 사전 보정분포의 "
                "P50 이하만 통과시키지만, 최초 신호일과 60개월 "
                "보정기간이 확정될 때까지 코드의 임계값은 계속 "
                "`None`으로 둔다."
            ),
        },
        {
            "id": "total-liabilities-quantiles-evidence",
            "type": "table",
            "layout": "full",
            "tableId": "total-liabilities-quantiles-table",
        },
    ]
    existing_ids = {block["id"] for block in blocks}
    if not any(
        block_id in existing_ids
        for block_id in {
            "total-liabilities-distribution-heading",
            "total-liabilities-distribution-visual",
            "total-liabilities-distribution-interpretation",
            "total-liabilities-quantiles-evidence",
        }
    ):
        insertion_index = next(
            index
            for index, block in enumerate(blocks)
            if block["id"] == "debt-sector-evidence"
        ) + 1
        blocks[insertion_index:insertion_index] = new_blocks

    nonpositive_blocks = [
        {
            "id": "nonpositive-equity-heading",
            "type": "markdown",
            "layout": "full",
            "sourceId": "nonpositive-equity-list",
            "body": (
                "## 음수 자기자본 22개는 일관되게 제외하되 위음성 "
                "비용을 공개한다\n\n"
                "MCD·SBUX를 포함한 22개는 현재 연결 자기자본이 0 "
                "이하여서 총부채비율을 정의할 수 없다. 종목별 대체 "
                "지표를 허용하지 않고 재무 안정 게이트 자동 미통과를 "
                "유지한다. 다만 누적 자사주 매입과 자본환원 때문에 "
                "현금창출력이 좋은 기업도 제외될 수 있으므로, 이는 "
                "재무 부실과 동일한 의미가 아닌 알려진 위음성이다."
            ),
        },
        {
            "id": "nonpositive-equity-evidence",
            "type": "table",
            "layout": "full",
            "tableId": "nonpositive-equity-exclusions-table",
        },
        {
            "id": "nonpositive-equity-interpretation",
            "type": "markdown",
            "layout": "full",
            "sourceId": "preregistration-v05",
            "body": (
                "**감사 규칙.** 이 22개는 현재 스냅샷이지 과거 전체의 "
                "고정 제외 목록이 아니다. 각 신호일에 당시 공시자료로 "
                "다시 판정하고 종목·자기자본·재무기간 말·공시일·"
                "접수번호와 `NONPOSITIVE_EQUITY_AUTO_FAIL` 사유를 "
                "로그에 남긴다. 원인을 자동으로 자사주 매입이라고 "
                "분류하지 않는다."
            ),
        },
    ]
    existing_ids = {block["id"] for block in blocks}
    if not any(
        block_id in existing_ids
        for block_id in {
            "nonpositive-equity-heading",
            "nonpositive-equity-evidence",
            "nonpositive-equity-interpretation",
        }
    ):
        insertion_index = next(
            index
            for index, block in enumerate(blocks)
            if block["id"] == "total-liabilities-quantiles-evidence"
        ) + 1
        blocks[insertion_index:insertion_index] = nonpositive_blocks

    block_by_id = {block["id"]: block for block in blocks}
    block_by_id["scope-definitions"].update(
        {
            "sourceId": "preregistration-v041",
            "body": (
                "## 지표와 범위\n\n"
                "`총부채비율 = 연결 총부채 ÷ 비지배지분 포함 연결 "
                "자기자본`이다. 연결 총부채에는 이자부 차입금뿐 아니라 "
                "영업·회계상 모든 부채가 포함된다.\n\n"
                "모집단은 Financials, Real Estate, Utilities를 제외하고 "
                "동일 CIK의 복수 주식종류를 합친 S&P 500 발행사 "
                "362개다. 현재 점검은 SEC FSDS 2026 Q1을 사용하며 "
                "재무기간 말은 2025년 11월 30일~2026년 2월 28일, "
                "공시일은 2026년 1월 7일~3월 31일이다."
            ),
        }
    )
    block_by_id["methodology"].update(
        {
            "sourceId": "preregistration-v041",
            "body": (
                "## 방법: 공식 재무상태표 총계와 presentation을 함께 사용했다\n\n"
                "1. `Liabilities`, 비지배지분 포함 총자기자본, "
                "`LiabilitiesAndStockholdersEquity` 중 두 개 이상을 "
                "동일 접수번호·보고기간에서 확인했다.\n"
                "2. 직접 총자기자본이 없으면 `StockholdersEquity + "
                "MinorityInterest`를 사용했다.\n"
                "3. 비지배지분이 없는 발행사는 공식 라벨이 `Total`이고 "
                "재무상태표의 마지막 자기자본 총계로 제시된 entity-wide "
                "`StockholdersEquity`만 허용했다.\n"
                "4. 세 총계가 모두 있으면 `T = L + E`의 0.5% "
                "일치 검사를 적용했다.\n"
                "5. 차원별 구성요소, custom 태그, 결측 0 대입과 "
                "종목별 예외는 사용하지 않았다.\n\n"
                "Companyfacts 단독 예비 매핑은 차원 문맥 손실 때문에 "
                "84.0%에 그쳤다. 이 값은 최종 커버리지로 쓰지 않고 "
                "SEC FSDS의 entity-wide 사실과 공식 표시 순서로 "
                "재검증했다."
            ),
        }
    )
    block_by_id["limitations"].update(
        {
            "sourceId": "preregistration-v05",
            "body": (
                "## 한계와 강건성 점검\n\n"
                "- **업종 특성 혼입:** 총부채에는 운전자본과 충당부채가 "
                "포함되어 차입 위험만 측정하지 않는다.\n"
                "- **회계등식 불일치:** 13개는 총계 간 0.5% 불일치로 "
                "제외했다. 임계값을 늘려 복원하지 않았다.\n"
                "- **미해결:** 필수 총계 부족 4개와 최신 제출자료 미연결 "
                "3개를 포함해 총 20개가 판정 불가다.\n"
                "- **긴 오른쪽 꼬리:** 최대 159.37배는 자기자본이 작은 "
                "기업에서 발생한다. 현재 P90은 실전 기준이 아니다.\n"
                "- **음수 자기자본 위음성:** 22개 자동 미통과에는 "
                "누적 자사주 매입 등 재무 부실이 아닌 원인이 섞일 수 "
                "있다. 종목별 예외 대신 제외 로그를 보존한다.\n"
                "- **시점:** 현재 분포는 SEC FSDS 2026 Q1 스냅샷이며 "
                "7월 말 실시간 재무상태를 뜻하지 않는다."
            ),
        }
    )
    block_by_id["next-steps"].update(
        {
            "sourceId": "preregistration-v05",
            "body": (
                "## 다음 단계\n\n"
                "1. 최초 백테스트 신호일을 수익률 계산 전에 확정한다.\n"
                "2. 그 직전 60개 연속 월말의 과거 구성 종목과 당시 "
                "공시 사실을 복원한다.\n"
                "3. 60개 월말 모두 전체 90%, 섹터별 80%, provenance "
                "100%를 통과하는지 먼저 확인한다.\n"
                "4. 통과할 때만 유효 발행사-월 분포의 P50을 한 번 "
                "계산해 절대 임계값으로 고정한다.\n"
                "5. 임계값과 백테스트 성공 기준을 최종 사전등록한 뒤에만 "
                "수익률을 계산한다."
            ),
        }
    )
    block_by_id["further-questions"].update(
        {
            "sourceId": "preregistration-v05",
            "body": (
                "## 남은 확정 질문\n\n"
                "60개월 사전 보정기간을 정하려면 **최초 백테스트 "
                "신호일**을 확정해야 한다. 예를 들어 2016년 1월을 "
                "시작점으로 택하면 2011년 1월~2015년 12월이 보정기간이 "
                "된다. 이 날짜는 과거 커버리지나 수익률을 열기 전에 "
                "확정해야 한다."
            ),
        }
    )

    rows = [row for row in result["rows"] if row["ratio"] is not None]
    bins = [
        (0.0, 0.5, "0–0.5"),
        (0.5, 1.0, "0.5–1"),
        (1.0, 2.0, "1–2"),
        (2.0, 3.0, "2–3"),
        (3.0, 5.0, "3–5"),
        (5.0, 10.0, "5–10"),
        (10.0, 20.0, "10–20"),
        (20.0, float("inf"), "20+"),
    ]
    histogram = []
    for order, (lower, upper, label) in enumerate(bins, start=1):
        count = sum(lower <= row["ratio"] < upper for row in rows)
        histogram.append(
            {
                "order": order,
                "bin": label,
                "issuer_count": count,
                "share": count / len(rows),
                "sample_size": len(rows),
                "lower_bound": lower,
                "upper_bound": None if upper == float("inf") else upper,
            }
        )
    distribution = result["distribution"]
    quantiles = [
        (1, "P25", distribution["p25"], "현재 분포 진단"),
        (2, "중앙값", distribution["median"], "현재 분포 진단"),
        (3, "P75", distribution["p75"], "현재 분포 진단"),
        (
            4,
            "P90",
            distribution["p90_diagnostic_only"],
            "진단값·임계값 아님",
        ),
        (5, "P95", distribution["p95"], "현재 분포 진단"),
        (6, "최대", distribution["max"], "극단값 점검"),
    ]

    snapshot["datasets"]["headline_metrics"] = [
        {
            "total_liabilities_coverage": result["coverage"]["overall"],
            "coverage_target": 0.90,
            "positive_equity_ratios": distribution["count"],
            "current_p90_diagnostic": distribution[
                "p90_diagnostic_only"
            ],
            "calibration_quantile": 0.50,
            "backtest_threshold": None,
        }
    ]
    snapshot["datasets"]["debt_coverage_comparison"] = [
        {
            "method": "이자부 D/E",
            "resolved_issuers": fallback["coverage"]["resolved"],
            "population": result["population"],
            "coverage": round(fallback["coverage"]["overall"], 10),
        },
        {
            "method": "연결 총부채비율",
            "resolved_issuers": result["coverage"]["resolved"],
            "population": result["population"],
            "coverage": round(result["coverage"]["overall"], 10),
        },
        {
            "method": "사전등록 최소선",
            "resolved_issuers": round(result["population"] * 0.90),
            "population": result["population"],
            "coverage": 0.90,
        },
    ]
    snapshot["datasets"]["debt_sector_coverage"] = [
        {
            "sector": row["sector"],
            "population": row["population"],
            "resolved": row["resolved"],
            "coverage": round(row["coverage"], 10),
            "minimum": row["minimum"],
            "status": "통과" if row["passes"] else "미달",
        }
        for row in sorted(
            result["coverage"]["by_sector"],
            key=lambda item: item["coverage"],
        )
    ]
    snapshot["datasets"]["total_liabilities_histogram"] = histogram
    snapshot["datasets"]["total_liabilities_quantiles"] = [
        {
            "order": order,
            "statistic": statistic,
            "ratio": round(value, 4),
            "interpretation": interpretation,
        }
        for order, statistic, value, interpretation in quantiles
    ]
    snapshot["datasets"]["nonpositive_equity_exclusions"] = [
        {
            "symbols": row["symbols"],
            "name": row["name"],
            "sector": row["sector"],
            "equity": row["equity"],
            "financial_period_end": row["financial_period_end"],
            "filed": row["filed"],
            "accession": row["accession"],
            "exclusion_reason": "NONPOSITIVE_EQUITY_AUTO_FAIL",
        }
        for row in sorted(
            (
                row
                for row in result["rows"]
                if row["status"] == "nonpositive_equity_auto_fail"
            ),
            key=lambda item: item["symbols"],
        )
    ]

    with (ROOT / "debt_coverage_comparison.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as handle:
        fields = [
            "method",
            "resolved_issuers",
            "population",
            "coverage",
        ]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(snapshot["datasets"]["debt_coverage_comparison"])

    artifact_path.write_text(
        json.dumps(artifact, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
