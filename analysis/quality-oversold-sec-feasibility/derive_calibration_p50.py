from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def linear_quantile(values: list[float], probability: float) -> float:
    if not values:
        raise ValueError("No ratio observations")
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1.0 - weight) + ordered[upper] * weight


def derive(rows_csv: Path, window_json: Path) -> dict[str, object]:
    window = json.loads(window_json.read_text(encoding="utf-8"))
    if window["status"] != "VALID_BACKTEST_START":
        raise ValueError("Cannot derive P50 without a valid 60-month window")
    start = window["calibration_start_month"]
    end = window["calibration_end_month"]
    values = []
    counts_by_month: dict[str, int] = {}
    with rows_csv.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            month = row["month"]
            if not start <= month <= end:
                continue
            if row["status"] != "ratio_available" or not row["ratio"]:
                continue
            values.append(float(row["ratio"]))
            counts_by_month[month] = counts_by_month.get(month, 0) + 1
    expected_months = int(window["calibration_months"])
    if len(counts_by_month) != expected_months:
        raise ValueError(
            f"Expected ratios in {expected_months} months, found "
            f"{len(counts_by_month)}"
        )
    return {
        "preregistration": "PREREGISTRATION.v0.7.md",
        "data_scope": "coverage_only_no_prices_no_returns",
        "prices_accessed": False,
        "returns_calculated": False,
        "calibration_start_month": start,
        "calibration_end_month": end,
        "first_signal_month": window["first_signal_month"],
        "quantile_method": "linear_interpolation",
        "quantile_probability": 0.50,
        "ratio_observations": len(values),
        "months_with_ratio_observations": len(counts_by_month),
        "minimum_monthly_ratio_observations": min(counts_by_month.values()),
        "maximum_monthly_ratio_observations": max(counts_by_month.values()),
        "max_total_liabilities_to_equity": linear_quantile(values, 0.50),
        "rows_input": str(rows_csv),
        "rows_input_sha256": sha256(rows_csv),
        "window_input": str(window_json),
        "window_input_sha256": sha256(window_json),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows-csv", type=Path, required=True)
    parser.add_argument("--window-json", type=Path, required=True)
    parser.add_argument("--output-json", type=Path, required=True)
    args = parser.parse_args()
    result = derive(args.rows_csv, args.window_json)
    args.output_json.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()

