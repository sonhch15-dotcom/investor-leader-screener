from __future__ import annotations

import argparse
import json
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any


AUDIT_START_MONTH = "2015-10"


@dataclass(frozen=True, order=True)
class YearMonth:
    year: int
    month: int

    @classmethod
    def parse(cls, value: str) -> "YearMonth":
        year, month = (int(part) for part in value.split("-"))
        return cls(year, month)

    def next(self) -> "YearMonth":
        if self.month == 12:
            return YearMonth(self.year + 1, 1)
        return YearMonth(self.year, self.month + 1)

    def __str__(self) -> str:
        return f"{self.year:04d}-{self.month:02d}"


def load_snapshots(paths: list[Path]) -> list[dict[str, Any]]:
    by_month = {}
    for path in paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        for snapshot in payload["snapshots"]:
            if snapshot["month"] in by_month:
                raise ValueError(f"Duplicate month: {snapshot['month']}")
            by_month[snapshot["month"]] = snapshot
    return [by_month[month] for month in sorted(by_month)]


def build_episodes(
    snapshots: list[dict[str, Any]],
    start_month: str = AUDIT_START_MONTH,
) -> dict[str, Any]:
    snapshots = [
        snapshot
        for snapshot in snapshots
        if snapshot["month"] >= start_month
    ]
    if not snapshots:
        raise ValueError("No snapshots in audit range")

    observations: dict[
        tuple[str, str, bool], list[dict[str, Any]]
    ] = defaultdict(list)
    for snapshot in snapshots:
        for row in snapshot["constituents"]:
            if not row.get("cik"):
                continue
            key = (
                row["symbol"],
                row["cik"],
                bool(row["included_in_quality_universe"]),
            )
            observations[key].append(
                {
                    "month": snapshot["month"],
                    "month_end": snapshot["month_end"],
                    "name": row["name"],
                    "sector": row["sector"],
                }
            )

    current = snapshots[-1]
    current_pairs = {
        (row["symbol"], row["cik"])
        for row in current["constituents"]
        if row.get("cik")
    }
    current_symbols_by_cik: dict[str, set[str]] = defaultdict(set)
    current_ciks_by_symbol: dict[str, set[str]] = defaultdict(set)
    for symbol, cik in current_pairs:
        current_symbols_by_cik[cik].add(symbol)
        current_ciks_by_symbol[symbol].add(cik)

    episodes = []
    for (symbol, cik, included), rows in sorted(observations.items()):
        rows.sort(key=lambda row: row["month"])
        segments: list[list[dict[str, Any]]] = []
        for row in rows:
            if (
                not segments
                or YearMonth.parse(segments[-1][-1]["month"]).next()
                != YearMonth.parse(row["month"])
            ):
                segments.append([])
            segments[-1].append(row)
        for index, segment in enumerate(segments, start=1):
            pair_is_current = (symbol, cik) in current_pairs
            if pair_is_current:
                legacy_class = "CURRENT_SECURITY"
            elif current_symbols_by_cik.get(cik):
                legacy_class = "TICKER_OR_SHARE_CLASS_CHANGED"
            elif current_ciks_by_symbol.get(symbol):
                legacy_class = "ENTITY_CHANGED_OR_SYMBOL_REUSED"
            else:
                legacy_class = "NO_LONGER_CURRENT_CONSTITUENT_SECURITY"
            episodes.append(
                {
                    "episode_id": (
                        f"{symbol}|{cik}|{int(included)}|"
                        f"{segment[0]['month']}|{index}"
                    ),
                    "symbol": symbol,
                    "cik": cik,
                    "name": segment[-1]["name"],
                    "sector": segment[-1]["sector"],
                    "included_in_quality_universe": included,
                    "first_observed_month": segment[0]["month"],
                    "last_observed_month": segment[-1]["month"],
                    "episode_start": segment[0]["month_end"],
                    "episode_end": segment[-1]["month_end"],
                    "months_observed": len(segment),
                    "legacy": not pair_is_current,
                    "legacy_class": legacy_class,
                    "current_symbols_for_cik": sorted(
                        current_symbols_by_cik.get(cik, set())
                    ),
                    "current_ciks_for_symbol": sorted(
                        current_ciks_by_symbol.get(symbol, set())
                    ),
                }
            )

    return {
        "preregistration": "PREREGISTRATION.v0.8.md",
        "audit_start_month": snapshots[0]["month"],
        "audit_end_month": snapshots[-1]["month"],
        "current_snapshot_month": current["month"],
        "prices_accessed": False,
        "returns_calculated": False,
        "episode_count": len(episodes),
        "legacy_episode_count": sum(row["legacy"] for row in episodes),
        "quality_legacy_episode_count": sum(
            row["legacy"] and row["included_in_quality_universe"]
            for row in episodes
        ),
        "episodes": episodes,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--snapshot-json", type=Path, action="append", required=True
    )
    parser.add_argument("--output-json", type=Path, required=True)
    args = parser.parse_args()
    result = build_episodes(load_snapshots(args.snapshot_json))
    args.output_json.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
