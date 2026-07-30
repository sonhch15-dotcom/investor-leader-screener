from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
DAILY_RESULTS_DIR = ROOT / "results" / "daily"
WATCHLIST_PATH = ROOT / "data" / "watchlist.json"
LEDGER_DIR = ROOT / "ledger"
DISCLAIMER = "검증된 성과 우위 없음 · 조사 후보 목록"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def display_path(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path.resolve())


def latest_daily_result() -> Path:
    paths = sorted(DAILY_RESULTS_DIR.glob("????-??-??.json"))
    if not paths:
        raise RuntimeError("No daily scan result available")
    return paths[-1]


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def build_snapshot(
    daily: dict[str, Any],
    watchlist: dict[str, Any],
    *,
    daily_path: Path,
    watchlist_path: Path,
    generated_at_utc: str,
) -> dict[str, Any]:
    if daily.get("disclaimer") != DISCLAIMER:
        raise RuntimeError("Daily result disclaimer missing")
    if watchlist.get("disclaimer") != DISCLAIMER:
        raise RuntimeError("Watchlist disclaimer missing")
    if not daily["market_calendar"][
        "is_first_trading_day_of_month"
    ]:
        raise RuntimeError("Snapshot date is not the first trading day")
    if daily["market_data_date"] != daily["market_calendar"][
        "market_date"
    ]:
        raise RuntimeError("Daily market date does not reconcile")

    signals = []
    for row in daily["signals"]:
        signals.append(
            {
                **row,
                "entry_price_assumption": {
                    "signal_date_adjusted_close": row[
                        "adjusted_close"
                    ],
                    "next_trading_day": None,
                    "next_trading_day_raw_open": None,
                    "next_trading_day_adjusted_open": None,
                    "status": "PENDING_NEXT_TRADING_DAY_OPEN",
                },
            }
        )

    return {
        "disclaimer": DISCLAIMER,
        "schema_version": 1,
        "snapshot_kind": "MONTHLY_FORWARD_SIGNAL_SNAPSHOT",
        "snapshot_status": "IMMUTABLE_SIGNAL_DATA_ENTRY_OPEN_PENDING",
        "signal_date": daily["market_data_date"],
        "generated_at_utc": generated_at_utc,
        "cohort_eligible": True,
        "performance_claim": "NONE_UNVALIDATED",
        "immutability_policy": (
            "This file is never overwritten. Corrections and next-day "
            "entry prices are appended as separate files."
        ),
        "source_files": {
            "daily_scan": {
                "path": display_path(daily_path),
                "sha256": sha256(daily_path),
                "generated_at_utc": daily["generated_at_utc"],
            },
            "quality_watchlist": {
                "path": display_path(watchlist_path),
                "sha256": sha256(watchlist_path),
                "generated_at_utc": watchlist["generated_at_utc"],
                "as_of_date": watchlist["as_of_date"],
            },
        },
        "financial_data_freshness": watchlist[
            "financial_data_freshness"
        ],
        "funnels": {
            "quality_watchlist": watchlist["funnel"],
            "daily_price_trigger": daily["funnel"],
        },
        "watchlist_drawdown_breadth": daily[
            "watchlist_drawdown_breadth"
        ],
        "signal_tag_distribution": daily[
            "signal_tag_distribution"
        ],
        "market_context": daily["market_context"],
        "sector_drawdown_medians_pct": daily[
            "sector_drawdown_medians_pct"
        ],
        "sector_drawdown_distributions_pct": daily[
            "sector_drawdown_distributions_pct"
        ],
        "sector_median_sample_counts": daily[
            "sector_median_sample_counts"
        ],
        "signal_count": len(signals),
        "signals": signals,
        "spy_entry_price_assumption": {
            "signal_date_adjusted_close": daily["market_context"][
                "spy"
            ]["adjusted_close"],
            "next_trading_day": None,
            "next_trading_day_raw_open": None,
            "next_trading_day_adjusted_open": None,
            "status": "PENDING_NEXT_TRADING_DAY_OPEN",
        },
    }


def create_snapshot(
    *,
    daily_path: Path,
    watchlist_path: Path = WATCHLIST_PATH,
    ledger_dir: Path = LEDGER_DIR,
    now: datetime | None = None,
) -> Path | None:
    daily = load_json(daily_path)
    if not daily["market_calendar"][
        "is_first_trading_day_of_month"
    ]:
        print(
            json.dumps(
                {
                    "disclaimer": DISCLAIMER,
                    "status": "NOT_DUE",
                    "market_date": daily["market_data_date"],
                    "reason": "NOT_FIRST_TRADING_DAY_OF_MONTH",
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return None
    watchlist = load_json(watchlist_path)
    timestamp = now or datetime.now(timezone.utc)
    snapshot = build_snapshot(
        daily,
        watchlist,
        daily_path=daily_path,
        watchlist_path=watchlist_path,
        generated_at_utc=timestamp.isoformat(),
    )
    output = (
        ledger_dir
        / "signals"
        / f"{snapshot['signal_date']}.json"
    )
    if output.exists():
        raise FileExistsError(
            f"Snapshot already exists and cannot be overwritten: {output}"
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f"{output.name}.tmp")
    temporary.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.rename(output)
    print(
        json.dumps(
            {
                "disclaimer": DISCLAIMER,
                "status": "CREATED",
                "output": str(output),
                "signal_count": snapshot["signal_count"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return output


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="매월 첫 거래일 전향 신호 스냅샷 생성"
    )
    parser.add_argument(
        "--daily-result",
        type=Path,
        default=None,
    )
    parser.add_argument(
        "--watchlist",
        type=Path,
        default=WATCHLIST_PATH,
    )
    parser.add_argument(
        "--ledger-dir",
        type=Path,
        default=LEDGER_DIR,
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    print(DISCLAIMER, flush=True)
    create_snapshot(
        daily_path=args.daily_result or latest_daily_result(),
        watchlist_path=args.watchlist,
        ledger_dir=args.ledger_dir,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
