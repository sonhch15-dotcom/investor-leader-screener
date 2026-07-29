from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent


def execute(
    connection: sqlite3.Connection, sql_name: str
) -> list[dict[str, Any]]:
    sql = (ROOT / sql_name).read_text(encoding="utf-8")
    cursor = connection.execute(sql)
    columns = [item[0] for item in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def main() -> None:
    artifact = json.loads((ROOT / "artifact.json").read_text(encoding="utf-8"))
    liabilities = json.loads(
        (ROOT / "total_liabilities_equity_fsds_results.json").read_text(
            encoding="utf-8"
        )
    )
    fallback = json.loads(
        (ROOT / "fsds_instance_fallback_results.json").read_text(
            encoding="utf-8"
        )
    )
    gross = json.loads(
        (ROOT / "sp500_gross_profit_results.json").read_text(encoding="utf-8")
    )
    connection = sqlite3.connect(":memory:")

    population = liabilities["population"]
    distribution = liabilities["distribution"]

    connection.execute(
        "CREATE TABLE debt_coverage_inputs "
        "(display_order INTEGER, method TEXT, resolved_issuers INTEGER, "
        "population INTEGER, coverage REAL)"
    )
    connection.executemany(
        "INSERT INTO debt_coverage_inputs VALUES (?, ?, ?, ?, ?)",
        [
            (
                1,
                "이자부 D/E",
                fallback["coverage"]["resolved"],
                population,
                fallback["coverage"]["overall"],
            ),
            (
                2,
                "연결 총부채비율",
                liabilities["coverage"]["resolved"],
                population,
                liabilities["coverage"]["overall"],
            ),
            (
                3,
                "사전등록 최소선",
                round(population * 0.90),
                population,
                0.90,
            ),
        ],
    )

    connection.execute(
        "CREATE TABLE total_liabilities_sector_inputs "
        "(sector TEXT, population INTEGER, resolved INTEGER, "
        "coverage REAL, minimum REAL, passes INTEGER)"
    )
    connection.executemany(
        "INSERT INTO total_liabilities_sector_inputs VALUES (?, ?, ?, ?, ?, ?)",
        [
            (
                row["sector"],
                row["population"],
                row["resolved"],
                row["coverage"],
                row["minimum"],
                int(row["passes"]),
            )
            for row in liabilities["coverage"]["by_sector"]
        ],
    )

    ratio_rows = [
        row for row in liabilities["rows"] if row["ratio"] is not None
    ]
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
    connection.execute(
        "CREATE TABLE total_liabilities_histogram_inputs "
        "(display_order INTEGER, bin TEXT, issuer_count INTEGER, "
        "share REAL, sample_size INTEGER, lower_bound REAL, upper_bound REAL)"
    )
    connection.executemany(
        "INSERT INTO total_liabilities_histogram_inputs "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
            (
                order,
                label,
                count,
                count / len(ratio_rows),
                len(ratio_rows),
                lower,
                None if upper == float("inf") else upper,
            )
            for order, (lower, upper, label) in enumerate(bins, start=1)
            for count in [
                sum(lower <= row["ratio"] < upper for row in ratio_rows)
            ]
        ],
    )

    connection.execute(
        "CREATE TABLE total_liabilities_quantile_inputs "
        "(display_order INTEGER, statistic TEXT, ratio REAL, "
        "interpretation TEXT)"
    )
    connection.executemany(
        "INSERT INTO total_liabilities_quantile_inputs VALUES (?, ?, ?, ?)",
        [
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
        ],
    )

    connection.execute(
        "CREATE TABLE total_liabilities_rows "
        "(symbols TEXT, name TEXT, sector TEXT, equity REAL, "
        "financial_period_end TEXT, filed TEXT, accession TEXT, status TEXT)"
    )
    connection.executemany(
        "INSERT INTO total_liabilities_rows VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                row["symbols"],
                row["name"],
                row["sector"],
                row["equity"],
                row["financial_period_end"],
                row["filed"],
                row["accession"],
                row["status"],
            )
            for row in liabilities["rows"]
        ],
    )

    connection.execute(
        "CREATE TABLE gross_sector_inputs "
        "(sector TEXT, issuers INTEGER, direct_8_of_8 INTEGER, "
        "direct_coverage REAL, "
        "upper_bound_coverage_before_scope_validation REAL)"
    )
    connection.executemany(
        "INSERT INTO gross_sector_inputs VALUES (?, ?, ?, ?, ?)",
        [
            (
                row["sector"],
                row["issuers"],
                row["direct_8_of_8"],
                row["direct_coverage"],
                row["upper_bound_coverage_before_scope_validation"],
            )
            for row in gross["by_sector"]
        ],
    )

    expected = artifact["snapshot"]["datasets"]
    actual = {
        "headline_metrics": [
            {
                "total_liabilities_coverage": liabilities["coverage"][
                    "overall"
                ],
                "coverage_target": 0.90,
                "positive_equity_ratios": distribution["count"],
                "current_p90_diagnostic": distribution[
                    "p90_diagnostic_only"
                ],
                "calibration_quantile": 0.50,
                "backtest_threshold": None,
            }
        ],
        "debt_coverage_comparison": execute(
            connection, "report_debt_coverage.sql"
        ),
        "debt_sector_coverage": execute(
            connection, "report_total_liabilities_sector_coverage.sql"
        ),
        "total_liabilities_histogram": execute(
            connection, "report_total_liabilities_histogram.sql"
        ),
        "total_liabilities_quantiles": execute(
            connection, "report_total_liabilities_quantiles.sql"
        ),
        "nonpositive_equity_exclusions": execute(
            connection, "report_nonpositive_equity_exclusions.sql"
        ),
        "gross_sector_coverage": execute(
            connection, "report_gross_sector_coverage.sql"
        ),
        "gross_rule": execute(connection, "report_gross_rule.sql"),
    }
    for dataset, rows in actual.items():
        if rows != expected[dataset]:
            raise AssertionError(
                f"{dataset} does not match artifact snapshot:\n"
                f"actual={rows}\nexpected={expected[dataset]}"
            )
    print(f"validated_report_datasets={len(actual)}")


if __name__ == "__main__":
    main()
