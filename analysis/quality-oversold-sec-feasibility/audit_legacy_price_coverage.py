from __future__ import annotations

import argparse
import csv
import hashlib
import json
import time
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pandas as pd
import yfinance as yf


MIN_EPISODE_SESSION_COVERAGE = 0.95
MIN_ANNUAL_EPISODE_PASS_RATE = 1.00
MIN_ANNUAL_SESSION_COVERAGE = 0.95
TERMINAL_SESSION_LOOKBACK = 10
INDICATOR_WARMUP_SESSIONS = 252
PRICE_LOOKBACK_DAYS = 400
PRICE_TAIL_DAYS = 40


def yahoo_symbol(symbol: str) -> str:
    return symbol.replace(".", "-")


def cache_name(symbol: str) -> str:
    digest = hashlib.sha256(symbol.encode("utf-8")).hexdigest()[:10]
    safe = "".join(
        character if character.isalnum() else "_"
        for character in symbol
    )
    return f"{safe}_{digest}.csv"


def download_close_dates(
    symbol: str,
    start: date,
    end: date,
    cache_dir: Path,
) -> tuple[pd.Series, str | None]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / cache_name(symbol)
    if path.exists():
        frame = pd.read_csv(path, parse_dates=["Date"])
        series = pd.Series(
            frame["Close"].to_numpy(),
            index=pd.DatetimeIndex(frame["Date"]).tz_localize(None),
            name="Close",
        )
        return series.dropna(), None

    try:
        frame = yf.download(
            yahoo_symbol(symbol),
            start=start.isoformat(),
            end=(end + timedelta(days=1)).isoformat(),
            auto_adjust=False,
            actions=False,
            progress=False,
            threads=False,
            timeout=30,
        )
    except Exception as error:  # yfinance exposes heterogeneous errors
        return pd.Series(dtype=float, name="Close"), type(error).__name__

    if frame.empty or "Close" not in frame:
        return pd.Series(dtype=float, name="Close"), "EMPTY_DOWNLOAD"
    close = frame["Close"]
    if isinstance(close, pd.DataFrame):
        close = close.iloc[:, 0]
    close.index = pd.DatetimeIndex(close.index).tz_localize(None)
    close = close.dropna().sort_index()
    pd.DataFrame(
        {"Date": close.index.strftime("%Y-%m-%d"), "Close": close.values}
    ).to_csv(path, index=False)
    return close, None if not close.empty else "EMPTY_DOWNLOAD"


def dates_between(
    dates: pd.DatetimeIndex, start: date, end: date
) -> pd.DatetimeIndex:
    start_ts = pd.Timestamp(start)
    end_ts = pd.Timestamp(end)
    return dates[(dates >= start_ts) & (dates <= end_ts)]


def coverage_for_range(
    expected: pd.DatetimeIndex,
    observed: pd.DatetimeIndex,
    start: date,
    end: date,
) -> dict[str, Any]:
    expected_range = dates_between(expected, start, end)
    observed_range = dates_between(observed, start, end)
    observed_expected = expected_range.intersection(observed_range)
    expected_count = len(expected_range)
    observed_count = len(observed_expected)
    terminal_expected = expected_range[-TERMINAL_SESSION_LOOKBACK:]
    terminal_present = bool(
        len(terminal_expected.intersection(observed_range))
    )
    short = expected_count < 5
    if short:
        passes = observed_count >= 1 and terminal_present
        coverage = 1.0 if expected_count == 0 and observed_count else (
            observed_count / expected_count if expected_count else 0.0
        )
    else:
        coverage = observed_count / expected_count
        passes = (
            coverage >= MIN_EPISODE_SESSION_COVERAGE
            and terminal_present
        )
    return {
        "expected_sessions": expected_count,
        "observed_sessions": observed_count,
        "session_coverage": coverage,
        "terminal_price_present": terminal_present,
        "short_episode_probe": short,
        "passes": passes,
    }


def audit(
    universe: dict[str, Any],
    cache_dir: Path,
    pause_seconds: float,
) -> dict[str, Any]:
    episodes = [row for row in universe["episodes"] if row["legacy"]]
    if not episodes:
        raise ValueError("No legacy episodes")
    start = min(
        date.fromisoformat(row["episode_start"]) for row in episodes
    ) - timedelta(days=PRICE_LOOKBACK_DAYS)
    end = max(
        date.fromisoformat(row["episode_end"]) for row in episodes
    ) + timedelta(days=PRICE_TAIL_DAYS)

    spy, spy_error = download_close_dates("SPY", start, end, cache_dir)
    if spy_error or spy.empty:
        raise RuntimeError(f"SPY calendar unavailable: {spy_error}")
    expected_dates = pd.DatetimeIndex(spy.index)

    by_symbol: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for episode in episodes:
        by_symbol[episode["symbol"]].append(episode)

    results = []
    for index, (symbol, symbol_episodes) in enumerate(sorted(by_symbol.items())):
        symbol_start = min(
            date.fromisoformat(row["episode_start"])
            for row in symbol_episodes
        ) - timedelta(days=PRICE_LOOKBACK_DAYS)
        symbol_end = max(
            date.fromisoformat(row["episode_end"])
            for row in symbol_episodes
        ) + timedelta(days=PRICE_TAIL_DAYS)
        close, error = download_close_dates(
            symbol, symbol_start, symbol_end, cache_dir
        )
        observed_dates = pd.DatetimeIndex(close.index)
        for episode in symbol_episodes:
            episode_start = date.fromisoformat(episode["episode_start"])
            episode_end = date.fromisoformat(episode["episode_end"])
            measured = coverage_for_range(
                expected_dates,
                observed_dates,
                episode_start,
                episode_end,
            )
            warmup = dates_between(
                observed_dates,
                episode_start - timedelta(days=PRICE_LOOKBACK_DAYS),
                episode_start - timedelta(days=1),
            )
            results.append(
                {
                    **episode,
                    "yahoo_symbol": yahoo_symbol(symbol),
                    "download_error": error or "",
                    "raw_history_available": not close.empty,
                    "first_price_date": (
                        observed_dates.min().date().isoformat()
                        if len(observed_dates)
                        else ""
                    ),
                    "last_price_date": (
                        observed_dates.max().date().isoformat()
                        if len(observed_dates)
                        else ""
                    ),
                    "warmup_sessions": len(warmup),
                    "indicator_warmup_ready": (
                        len(warmup) >= INDICATOR_WARMUP_SESSIONS
                    ),
                    **measured,
                }
            )
        if index + 1 < len(by_symbol):
            time.sleep(pause_seconds)

    annual_rows = []
    for segment in ("QUALITY_UNIVERSE", "ALL_SP500"):
        segment_results = [
            row
            for row in results
            if segment == "ALL_SP500"
            or row["included_in_quality_universe"]
        ]
        years = sorted(
            {
                year
                for row in segment_results
                for year in range(
                    int(row["first_observed_month"][:4]),
                    int(row["last_observed_month"][:4]) + 1,
                )
            }
        )
        for year in years:
            year_start = date(year, 1, 1)
            year_end = date(year, 12, 31)
            members = []
            for row in segment_results:
                start_date = max(
                    date.fromisoformat(row["episode_start"]), year_start
                )
                end_date = min(
                    date.fromisoformat(row["episode_end"]), year_end
                )
                if start_date > end_date:
                    continue
                close, _ = download_close_dates(
                    row["symbol"],
                    date.fromisoformat(row["episode_start"])
                    - timedelta(days=PRICE_LOOKBACK_DAYS),
                    date.fromisoformat(row["episode_end"])
                    + timedelta(days=PRICE_TAIL_DAYS),
                    cache_dir,
                )
                measured = coverage_for_range(
                    expected_dates,
                    pd.DatetimeIndex(close.index),
                    start_date,
                    end_date,
                )
                members.append(measured)
            expected_sessions = sum(
                row["expected_sessions"] for row in members
            )
            observed_sessions = sum(
                row["observed_sessions"] for row in members
            )
            episode_pass_rate = (
                sum(row["passes"] for row in members) / len(members)
                if members
                else 1.0
            )
            session_coverage = (
                observed_sessions / expected_sessions
                if expected_sessions
                else 0.0
            )
            annual_rows.append(
                {
                    "segment": segment,
                    "year": year,
                    "legacy_episodes": len(members),
                    "passing_episodes": sum(
                        row["passes"] for row in members
                    ),
                    "episode_pass_rate": episode_pass_rate,
                    "expected_sessions": expected_sessions,
                    "observed_sessions": observed_sessions,
                    "session_coverage": session_coverage,
                    "year_passes": (
                        episode_pass_rate
                        >= MIN_ANNUAL_EPISODE_PASS_RATE
                        and session_coverage
                        >= MIN_ANNUAL_SESSION_COVERAGE
                    ),
                }
            )

    quality_annual = [
        row for row in annual_rows if row["segment"] == "QUALITY_UNIVERSE"
    ]
    passes = all(row["year_passes"] for row in quality_annual)
    return {
        "preregistration": "PREREGISTRATION.v0.8.md",
        "data_scope": "legacy_price_availability_no_returns",
        "price_source": "yfinance Yahoo daily Close",
        "calendar_source": "SPY daily price dates",
        "audit_start_month": universe["audit_start_month"],
        "audit_end_month": universe["audit_end_month"],
        "minimum_episode_session_coverage": (
            MIN_EPISODE_SESSION_COVERAGE
        ),
        "minimum_annual_episode_pass_rate": (
            MIN_ANNUAL_EPISODE_PASS_RATE
        ),
        "minimum_annual_session_coverage": (
            MIN_ANNUAL_SESSION_COVERAGE
        ),
        "status": (
            "SUCCESS_GRADE_PRICE_AVAILABILITY"
            if passes
            else "EXPLORATORY_ONLY_PRICE_COVERAGE"
        ),
        "prices_accessed": True,
        "returns_calculated": False,
        "price_levels_reported": False,
        "legacy_episode_count": len(results),
        "quality_legacy_episode_count": sum(
            row["included_in_quality_universe"] for row in results
        ),
        "episode_status_counts": {
            "passed": sum(row["passes"] for row in results),
            "failed": sum(not row["passes"] for row in results),
            "zero_history": sum(
                not row["raw_history_available"] for row in results
            ),
        },
        "annual": annual_rows,
        "episodes": results,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--universe-json", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument("--output-json", type=Path, required=True)
    parser.add_argument("--annual-csv", type=Path, required=True)
    parser.add_argument("--episodes-csv", type=Path, required=True)
    parser.add_argument("--pause-seconds", type=float, default=0.1)
    args = parser.parse_args()

    universe = json.loads(args.universe_json.read_text(encoding="utf-8"))
    result = audit(universe, args.cache_dir, args.pause_seconds)
    args.output_json.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    for path, rows in (
        (args.annual_csv, result["annual"]),
        (args.episodes_csv, result["episodes"]),
    ):
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)


if __name__ == "__main__":
    main()
