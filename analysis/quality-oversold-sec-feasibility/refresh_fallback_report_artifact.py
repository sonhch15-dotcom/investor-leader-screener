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
    fallback = json.loads(
        (ROOT / "fsds_instance_fallback_results.json").read_text(
            encoding="utf-8"
        )
    )
    manifest = artifact["manifest"]
    snapshot = artifact["snapshot"]
    now = datetime.now(ZoneInfo("Asia/Seoul")).isoformat(timespec="seconds")

    manifest["title"] = "S&P 500 품질 스크리너 SEC 데이터 fallback 검증"
    manifest["description"] = (
        "이자부 D/E 엄격 커버리지 정정과 공식 XBRL instance fallback 결과"
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
            "title": "이자부 D/E 판정 가능 비율과 사전 최소선",
            "subtitle": (
                "Financials·Real Estate·Utilities 제외 362개 발행사; "
                "음수·0 자기자본은 자동 미통과로 판정 가능에 포함"
            ),
            "question": (
                "엄격 계산식 정정 후 공식 XBRL instance fallback이 "
                "사전등록 커버리지 최소선을 충족했는가?"
            ),
            "rationale": (
                "정정된 기준선, 전체 원문 fallback 결과, 사전 최소선을 "
                "같은 분모에서 비교한다."
            ),
            "encodings": {
                "x": {
                    "field": "method",
                    "type": "nominal",
                    "label": "단계",
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

    old_table = next(
        table
        for table in manifest["tables"]
        if table["id"]
        in {"debt-quantile-table", "debt-sector-coverage-table"}
    )
    old_table.update(
        {
            "id": "debt-sector-coverage-table",
            "title": "섹터별 이자부 D/E 판정 가능 비율",
            "subtitle": (
                "공식 XBRL instance fallback 후; 모든 포함 섹터의 "
                "사전 최소선은 80%"
            ),
            "dataset": "debt_sector_coverage",
            "defaultSort": {
                "field": "coverage",
                "direction": "asc",
            },
            "sourceId": "debt-sector-coverage-query",
            "columns": [
                {"field": "sector", "label": "GICS 섹터", "type": "text"},
                {
                    "field": "population",
                    "label": "발행사",
                    "format": "number",
                },
                {
                    "field": "resolved",
                    "label": "판정 가능",
                    "format": "number",
                },
                {
                    "field": "coverage",
                    "label": "판정 가능 비율",
                    "format": "percent",
                },
                {
                    "field": "minimum",
                    "label": "최소선",
                    "format": "percent",
                },
                {
                    "field": "status",
                    "label": "판정",
                    "type": "text",
                },
            ],
        }
    )

    source_by_id = {item["id"]: item for item in manifest["sources"]}
    source_by_id.update(
        {
            "fsds-instance-fallback": source(
                "fsds-instance-fallback",
                "공식 XBRL instance fallback 전체 결과",
                "fsds_instance_fallback_results.json",
                "https://www.sec.gov/edgar/sec-api-documentation",
            ),
            "debt-sector-coverage": source(
                "debt-sector-coverage",
                "fallback 후 섹터별 커버리지",
                "fsds_instance_fallback_sector_coverage.csv",
            ),
            "debt-sector-coverage-query": source(
                "debt-sector-coverage-query",
                "섹터별 커버리지 표 SQL",
                "report_debt_sector_coverage.sql",
            ),
            "audit-correction": source(
                "audit-correction",
                "엄격 커버리지 계산 정정 기록",
                "DATA_AUDIT_CORRECTION.md",
            ),
            "preregistration-v03": source(
                "preregistration-v03",
                "fallback 행동 규칙 사전등록 v0.3",
                "PREREGISTRATION.v0.3.md",
            ),
        }
    )
    source_by_id.pop("debt-quantiles-query", None)
    manifest["sources"] = list(source_by_id.values())
    artifact["sources"] = list(source_by_id.values())

    block_by_id = {block["id"]: block for block in manifest["blocks"]}
    debt_sector_heading = (
        block_by_id.get("debt-quantile-heading")
        or block_by_id["debt-sector-heading"]
    )
    debt_sector_evidence = (
        block_by_id.get("debt-quantile-evidence")
        or block_by_id["debt-sector-evidence"]
    )
    block_by_id["title"]["body"] = (
        "# S&P 500 품질 스크리너 SEC 데이터 fallback 검증"
    )
    block_by_id["technical-summary"].update(
        {
            "sourceId": "fsds-instance-fallback",
            "body": (
                "## 결론: 이자부 D/E 정의는 교체해야 한다\n\n"
                "엄격 계산식을 재감사하자 기존 52.5% 판정 가능 비율은 "
                "결측 구성요소를 0처럼 취급한 오류로 과대계상된 값이었다. "
                "정정 기준선은 98/362(27.1%)다. 공식 XBRL instance "
                "261개를 추가 분석해 35개를 복원했지만 최종 판정 가능 "
                "비율은 133/362(36.7%)에 그쳤다. 전체 90%와 섹터별 "
                "80% 최소선을 모두 통과하지 못했다.\n\n"
                "사전등록 v0.3에 따라 임계값과 커버리지 최소선은 조정하지 "
                "않고, P90도 계산하지 않았다. 다음 단계는 모든 종목에 "
                "동일하게 적용되는 대체 부채 지표 정의를 수익률을 보기 "
                "전에 새 버전으로 등록하는 것이다."
            ),
        }
    )
    block_by_id["debt-coverage-heading"].update(
        {
            "sourceId": "audit-correction",
            "body": (
                "## 재감사에서 기존 엄격 커버리지 52.5%가 무효가 됐다\n\n"
                "기존 로직은 유동 장기부채와 비유동 부채만 있고 "
                "단기차입금이 없는 경우, 또는 금융리스만 있고 일반 "
                "차입금이 확인되지 않는 경우도 엄격 완결로 인정했다. "
                "수정 로직은 필요한 모든 구성요소가 명시된 경우만 "
                "인정한다. 이에 따라 엄격 완결은 163개에서 71개로 "
                "줄었고, 자기자본 0 이하 27개를 합친 정정 기준선은 "
                "98개가 됐다."
            ),
        }
    )
    block_by_id["debt-coverage-interpretation"].update(
        {
            "sourceId": "fsds-instance-fallback",
            "body": (
                "**판정.** 전체 원문 fallback은 엄격 완결 기업을 "
                "35개 추가했지만 전체 판정 가능 비율은 36.7%다. "
                "이는 사전 최소선 90%보다 53.3%p 낮다. 출처·공시일·"
                "접수번호 존재율은 100%였으므로 실패 원인은 provenance가 "
                "아니라 부채 구성요소 공시의 비표준성과 결측이다."
            ),
        }
    )
    debt_sector_heading.update(
        {
            "id": "debt-sector-heading",
            "sourceId": "debt-sector-coverage",
            "body": (
                "## 8개 포함 섹터가 모두 80% 최소선에 미달했다\n\n"
                "가장 높은 Materials도 65.4%였고, Information "
                "Technology는 18.9%로 가장 낮았다. 특정 섹터만의 "
                "문제가 아니므로 종목별 예외나 일부 섹터 제외로 "
                "이자부 D/E 정의를 연명할 근거가 없다."
            ),
        }
    )
    debt_sector_evidence.update(
        {
            "id": "debt-sector-evidence",
            "tableId": "debt-sector-coverage-table",
        }
    )
    block_by_id["scope-definitions"].update(
        {
            "sourceId": "preregistration-v03",
            "body": (
                "## 범위와 데이터 최신성\n\n"
                "모집단은 Financials, Real Estate, Utilities를 제외한 "
                "S&P 500 발행사 362개다. 공식 XBRL instance fallback은 "
                "정정 기준에서 미해결이던 261개 문서를 대상으로 했다.\n\n"
                "품질 판정 원천의 최신 접수 분기는 **SEC FSDS 2026 Q1**"
                "이다. 사용된 재무기간 말은 **2025-11-30~2026-02-28**, "
                "공시일은 **2026-01-07~2026-03-31** 범위다. 향후 "
                "스크리너 리포트에는 이 최신 분기와 종목별 재무기간 말·"
                "공시일·접수번호를 항상 표시한다."
            ),
        }
    )
    block_by_id["methodology"].update(
        {
            "sourceId": "fsds-instance-fallback",
            "body": (
                "## 방법: 엄격 계산식을 고친 뒤 전체 공식 instance를 확인했다\n\n"
                "1. 결측 구성요소를 0으로 간주하던 엄격 계산식 오류를 "
                "fallback 결과 열람 전에 수정했다.\n"
                "2. SEC 2026 Q1 최신 제출자료의 공식 XBRL instance "
                "261개를 내려받아 실제 발행사 회계기간 말 기준으로 "
                "entity-wide US-GAAP 사실을 추출했다.\n"
                "3. 이자부 차입금과 금융리스의 필요한 구성요소가 모두 "
                "명시된 공식만 엄격 완결로 인정했다.\n"
                "4. 52개 발행사에서 custom 또는 dimensioned 금융리스 "
                "후보를 찾았지만, 기업별 예외와 사후 태그 휴리스틱을 "
                "금지한 v0.3에 따라 계산에는 사용하지 않았다.\n"
                "5. 음수·0 자기자본은 D/E 계산 불가이자 품질 게이트 "
                "자동 미통과로 판정 가능 집단에 포함했다.\n"
                "6. 모든 판정 가능 수치의 공시일·접수번호 provenance를 "
                "검사했고 100%를 확인했다."
            ),
        }
    )
    block_by_id["limitations"].update(
        {
            "sourceId": "fsds-instance-fallback",
            "body": (
                "## 한계\n\n"
                "- **이자부 D/E 철회:** 현재 정의는 커버리지 전제를 "
                "충족하지 못해 임계값을 만들 수 없다.\n"
                "- **custom 태그 미사용:** 후보 52개를 확인했지만 "
                "의미를 종목별로 판독해 채우는 것은 사전등록된 자동 "
                "규칙이 아니므로 사용하지 않았다.\n"
                "- **현재 시점 시차:** 공식 분기 데이터셋은 2026 Q1 "
                "접수분까지이며, 현재 날짜와 시차가 있다.\n"
                "- **매출총이익률:** 직접 `GrossProfit` 8분기 커버리지는 "
                "섹터별 차이가 크므로 평가 불가를 적신호 미발동과 분리한 "
                "3상태 규칙을 유지한다.\n"
                "- **CIK 승계:** XOM처럼 공식 8-K 근거가 있는 계보만 "
                "등록하며 티커 유사성으로 자동 연결하지 않는다."
            ),
        }
    )
    block_by_id["next-steps"].update(
        {
            "sourceId": "preregistration-v03",
            "body": (
                "## 다음 단계\n\n"
                "1. 이자부 D/E를 v1 품질 게이트 후보에서 철회한다.\n"
                "2. 대안인 `Liabilities ÷ Equity`를 모든 종목에 동일하게 "
                "적용할 수 있도록 분자·분모·비지배지분·음수 자기자본·"
                "동일 보고기간 규칙을 먼저 정의한다.\n"
                "3. 새 정의의 커버리지 최소선과 임계값 계산식을 수익률 "
                "열람 전에 `PREREGISTRATION` 새 버전으로 등록한다.\n"
                "4. 그 후에만 횡단면 분포와 커버리지를 계산한다. 기존 "
                "2.0·2.40·2.60은 재사용하지 않는다.\n"
                "5. 매출총이익률 적신호의 3상태 규칙과 품질 게이트 "
                "결측 미통과 원칙은 그대로 유지한다."
            ),
        }
    )
    block_by_id["further-questions"].update(
        {
            "sourceId": "preregistration-v03",
            "body": (
                "## 다음 확정 질문\n\n"
                "대체 지표 `Liabilities ÷ Equity`의 분모를 "
                "`StockholdersEquityIncludingPortionAttributableTo"
                "NoncontrollingInterest`로 통일할지, 해당 태그가 없을 때 "
                "비지배지분 부재가 명시된 경우에만 `StockholdersEquity`를 "
                "허용할지 확정해야 한다. 이 선택을 등록한 뒤 대체 지표 "
                "분포를 열어야 한다."
            ),
        }
    )

    snapshot["datasets"]["headline_metrics"] = [
        {
            "corrected_resolved_coverage": 98 / 362,
            "fallback_resolved_coverage": 133 / 362,
            "coverage_target": 0.90,
            "provenance_rate": 1.0,
        }
    ]
    snapshot["datasets"]["debt_coverage_comparison"] = [
        {
            "method": "정정 기준선",
            "resolved_issuers": 98,
            "population": 362,
            "coverage": round(98 / 362, 10),
        },
        {
            "method": "전체 XBRL fallback",
            "resolved_issuers": 133,
            "population": 362,
            "coverage": round(133 / 362, 10),
        },
        {
            "method": "사전등록 최소선",
            "resolved_issuers": 326,
            "population": 362,
            "coverage": 0.90,
        },
    ]
    snapshot["datasets"].pop("debt_quantiles", None)
    snapshot["datasets"]["debt_sector_coverage"] = [
        {
            "sector": row["sector"],
            "population": row["population"],
            "resolved": row["resolved"],
            "coverage": round(row["coverage"], 10),
            "minimum": row["minimum"],
            "status": "미달" if not row["passes"] else "통과",
        }
        for row in sorted(
            fallback["coverage"]["by_sector"],
            key=lambda item: item["coverage"],
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
