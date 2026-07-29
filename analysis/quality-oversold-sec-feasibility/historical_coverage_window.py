from __future__ import annotations

import argparse
import csv
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


MIN_OVERALL_COVERAGE = 0.90
MIN_SECTOR_COVERAGE = 0.80
REQUIRED_PROVENANCE_RATE = 1.00
CALIBRATION_MONTHS = 60
DATA_SCOPE = "coverage_only_no_prices_no_returns"


@dataclass(frozen=True, order=True)
class YearMonth:
    year: int
    month: int

    @classmethod
    def parse(cls, value: str) -> "YearMonth":
        parts = value.split("-")
        if len(parts) != 2:
            raise ValueError(f"Invalid month: {value}")
        year, month = (int(part) for part in parts)
        if not 1 <= month <= 12:
            raise ValueError(f"Invalid month: {value}")
        return cls(year, month)

    def next(self) -> "YearMonth":
        if self.month == 12:
            return YearMonth(self.year + 1, 1)
        return YearMonth(self.year, self.month + 1)

    def __str__(self) -> str:
        return f"{self.year:04d}-{self.month:02d}"


@dataclass(frozen=True)
class CoverageRow:
    month: YearMonth
    overall_coverage: float
    minimum_sector_coverage: float
    provenance_rate: float

    @property
    def eligible(self) -> bool:
        return (
            self.overall_coverage >= MIN_OVERALL_COVERAGE
            and self.minimum_sector_coverage >= MIN_SECTOR_COVERAGE
            and self.provenance_rate == REQUIRED_PROVENANCE_RATE
        )


def parse_rate(value: str, field: str, month: str) -> float:
    rate = float(value)
    if not 0.0 <= rate <= 1.0:
        raise ValueError(f"{field} outside [0, 1] for {month}: {rate}")
    return rate


def read_coverage_rows(path: Path) -> list[CoverageRow]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {
            "month",
            "overall_coverage",
            "minimum_sector_coverage",
            "provenance_rate",
        }
        missing = required - set(reader.fieldnames or ())
        if missing:
            raise ValueError(
                f"Coverage CSV missing columns: {sorted(missing)}"
            )
        rows = [
            CoverageRow(
                month=YearMonth.parse(row["month"]),
                overall_coverage=parse_rate(
                    row["overall_coverage"],
                    "overall_coverage",
                    row["month"],
                ),
                minimum_sector_coverage=parse_rate(
                    row["minimum_sector_coverage"],
                    "minimum_sector_coverage",
                    row["month"],
                ),
                provenance_rate=parse_rate(
                    row["provenance_rate"],
                    "provenance_rate",
                    row["month"],
                ),
            )
            for row in reader
        ]
    months = [row.month for row in rows]
    if len(months) != len(set(months)):
        raise ValueError("Coverage CSV contains duplicate months")
    return sorted(rows, key=lambda row: row.month)


def select_first_signal_window(
    rows: Iterable[CoverageRow],
    calibration_months: int = CALIBRATION_MONTHS,
) -> dict[str, str | int | bool | None]:
    if calibration_months <= 0:
        raise ValueError("calibration_months must be positive")

    ordered = sorted(rows, key=lambda row: row.month)
    if not ordered:
        raise ValueError("Coverage input is empty")

    streak: list[CoverageRow] = []
    previous_month: YearMonth | None = None
    for row in ordered:
        calendar_contiguous = (
            previous_month is not None
            and previous_month.next() == row.month
        )
        if not calendar_contiguous:
            streak = []
        if row.eligible:
            streak.append(row)
        else:
            streak = []
        previous_month = row.month

        if len(streak) == calibration_months:
            calibration_start = streak[0].month
            calibration_end = streak[-1].month
            return {
                "status": "VALID_BACKTEST_START",
                "calibration_months": calibration_months,
                "calibration_start_month": str(calibration_start),
                "calibration_end_month": str(calibration_end),
                "first_signal_month": str(calibration_end.next()),
                "prices_accessed": False,
                "returns_calculated": False,
            }

    return {
        "status": "NO_VALID_BACKTEST_START",
        "calibration_months": calibration_months,
        "calibration_start_month": None,
        "calibration_end_month": None,
        "first_signal_month": None,
        "prices_accessed": False,
        "returns_calculated": False,
    }


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Select the earliest backtest signal month from coverage-only "
            "monthly inputs. This program never reads prices or returns."
        )
    )
    parser.add_argument("--coverage-csv", type=Path, required=True)
    parser.add_argument("--output-json", type=Path, required=True)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    rows = read_coverage_rows(args.coverage_csv)
    result = select_first_signal_window(rows)
    result.update(
        {
            "data_scope": DATA_SCOPE,
            "coverage_input": str(args.coverage_csv),
            "coverage_input_sha256": sha256(args.coverage_csv),
            "scan_start_month": str(rows[0].month),
            "scan_end_month": str(rows[-1].month),
            "minimum_overall_coverage": MIN_OVERALL_COVERAGE,
            "minimum_sector_coverage": MIN_SECTOR_COVERAGE,
            "required_provenance_rate": REQUIRED_PROVENANCE_RATE,
        }
    )
    args.output_json.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
