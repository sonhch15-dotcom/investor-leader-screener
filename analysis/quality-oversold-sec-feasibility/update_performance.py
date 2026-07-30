from __future__ import annotations

import argparse
import hashlib
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from statistics import fmean
from typing import Any, Callable

import pandas as pd
import yfinance as yf

from daily_scan import extract_histories


ROOT = Path(__file__).resolve().parent
LEDGER_DIR = ROOT / "ledger"
PERFORMANCE_PATH = LEDGER_DIR / "performance.md"
DISCLAIMER = "검증된 성과 우위 없음 · 조사 후보 목록"
BENCHMARK_TICKER = "SPY"
HOLDING_PERIODS = (63, 126, 252)
MIN_COHORTS_FOR_INTERPRETATION = 20
DOWNLOAD_ATTEMPTS = 3


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def display_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return str(path.resolve())


def write_new_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def write_text_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.tmp")
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(path)


def load_snapshots(ledger_dir: Path) -> list[tuple[Path, dict[str, Any]]]:
    rows = []
    for path in sorted((ledger_dir / "signals").glob("????-??-??.json")):
        payload = read_json(path)
        if payload.get("disclaimer") != DISCLAIMER:
            raise RuntimeError(f"Snapshot disclaimer missing: {path}")
        rows.append((path, payload))
    return rows


def load_outcomes(
    ledger_dir: Path,
) -> dict[int, dict[str, dict[str, Any]]]:
    outcomes = {period: {} for period in HOLDING_PERIODS}
    for period in HOLDING_PERIODS:
        directory = ledger_dir / "outcomes" / str(period)
        for path in sorted(directory.glob("????-??-??.json")):
            payload = read_json(path)
            if payload.get("status") != "COMPLETE":
                raise RuntimeError(
                    f"Non-complete immutable outcome: {path}"
                )
            outcomes[period][payload["signal_date"]] = payload
    return outcomes


def price_frame(frame: pd.DataFrame | None) -> pd.DataFrame:
    required = {"Open", "Close", "Adj Close"}
    if frame is None or not required.issubset(frame.columns):
        return pd.DataFrame()
    values = frame.loc[:, ["Open", "Close", "Adj Close"]].apply(
        pd.to_numeric,
        errors="coerce",
    )
    values.index = pd.Index(
        [
            value.date() if hasattr(value, "date") else value
            for value in values.index
        ]
    )
    values = values[~values.index.duplicated(keep="last")].sort_index()
    valid = (
        (values["Open"] > 0)
        & (values["Close"] > 0)
        & (values["Adj Close"] > 0)
    )
    return values.loc[valid].copy()


def adjusted_close_series(
    frame: pd.DataFrame | None,
) -> pd.Series:
    if frame is None or "Adj Close" not in frame.columns:
        return pd.Series(dtype="float64")
    values = pd.to_numeric(
        frame["Adj Close"],
        errors="coerce",
    ).dropna()
    values.index = pd.Index(
        [
            value.date() if hasattr(value, "date") else value
            for value in values.index
        ]
    )
    values = values[~values.index.duplicated(keep="last")].sort_index()
    return values[values > 0]


def adjusted_close_at(
    frame: pd.DataFrame | None,
    session: date,
) -> float | None:
    values = adjusted_close_series(frame)
    if session not in values.index:
        return None
    return float(values.loc[session])


def price_at(
    frame: pd.DataFrame | None,
    session: date,
) -> dict[str, float] | None:
    prices = price_frame(frame)
    if session not in prices.index:
        return None
    row = prices.loc[session]
    factor = float(row["Adj Close"] / row["Close"])
    return {
        "raw_open": float(row["Open"]),
        "raw_close": float(row["Close"]),
        "adjusted_close": float(row["Adj Close"]),
        "adjustment_factor": factor,
        "adjusted_open": float(row["Open"] * factor),
    }


def download_price_histories(
    tickers: list[str],
    *,
    start: date,
    end: date,
    downloader: Callable[..., pd.DataFrame] = yf.download,
) -> tuple[dict[str, pd.DataFrame], list[str]]:
    histories: dict[str, pd.DataFrame] = {}
    remaining = list(dict.fromkeys(tickers))
    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
        if not remaining:
            break
        print(
            f"[performance prices] attempt {attempt}/{DOWNLOAD_ATTEMPTS}: "
            f"{len(remaining)} tickers",
            flush=True,
        )
        try:
            downloaded = downloader(
                remaining,
                start=start.isoformat(),
                end=(end + timedelta(days=1)).isoformat(),
                interval="1d",
                auto_adjust=False,
                actions=False,
                group_by="ticker",
                threads=True,
                progress=False,
                timeout=30,
                multi_level_index=True,
            )
        except Exception as exception:
            print(
                "[performance prices] download error: "
                f"{type(exception).__name__}: {exception}",
                flush=True,
            )
            downloaded = pd.DataFrame()
        received = extract_histories(downloaded, remaining)
        histories.update(received)
        remaining = [
            ticker for ticker in remaining if ticker not in received
        ]
    return histories, remaining


def signal_ticker(signal: dict[str, Any]) -> str:
    return signal.get("yahoo_ticker") or signal["symbol"]


def build_entry_payload(
    snapshot_path: Path,
    snapshot: dict[str, Any],
    histories: dict[str, pd.DataFrame],
    *,
    as_of: date,
    generated_at_utc: str,
) -> dict[str, Any] | None:
    signal_date = date.fromisoformat(snapshot["signal_date"])
    spy_sessions = adjusted_close_series(
        histories.get(BENCHMARK_TICKER)
    )
    if spy_sessions.empty:
        raise RuntimeError("SPY price history unavailable")
    entry_dates = [
        value
        for value in spy_sessions.index
        if signal_date < value <= as_of
    ]
    if not entry_dates:
        return None
    entry_date = entry_dates[0]
    spy_entry = price_at(histories[BENCHMARK_TICKER], entry_date)
    if spy_entry is None:
        raise RuntimeError("SPY entry price unavailable")

    signals = []
    incidents = []
    for signal in snapshot["signals"]:
        ticker = signal_ticker(signal)
        values = price_at(histories.get(ticker), entry_date)
        row = {
            "symbol": signal["symbol"],
            "yahoo_ticker": ticker,
            "next_trading_day": entry_date.isoformat(),
        }
        if values is None:
            reason = (
                "ENTRY_PRICE_MISSING_POSSIBLE_TICKER_CHANGE_OR_DATA_ERROR"
            )
            row.update(
                {
                    "status": "DATA_INCIDENT_REVIEW_REQUIRED",
                    "reason": reason,
                }
            )
            incidents.append(
                {
                    "symbol": signal["symbol"],
                    "yahoo_ticker": ticker,
                    "reason": reason,
                }
            )
        else:
            row.update(
                {
                    "status": "COMPLETE",
                    "next_trading_day_raw_open": values["raw_open"],
                    "next_trading_day_raw_close": values["raw_close"],
                    "next_trading_day_adjusted_close": values[
                        "adjusted_close"
                    ],
                    "adjustment_factor_at_entry_recording": values[
                        "adjustment_factor"
                    ],
                    "next_trading_day_adjusted_open": values[
                        "adjusted_open"
                    ],
                }
            )
        signals.append(row)

    if incidents:
        status = "DATA_INCIDENT_REVIEW_REQUIRED"
    elif signals:
        status = "COMPLETE"
    else:
        status = "COMPLETE_NO_SIGNALS"
    return {
        "disclaimer": DISCLAIMER,
        "schema_version": 1,
        "entry_kind": "NEXT_TRADING_DAY_OPEN",
        "status": status,
        "signal_date": snapshot["signal_date"],
        "entry_date": entry_date.isoformat(),
        "generated_at_utc": generated_at_utc,
        "price_source": "Yahoo Finance via yfinance",
        "price_basis": (
            "Raw Open is immutable execution-price evidence; adjusted "
            "Open is Open multiplied by same-session Adj Close / Close"
        ),
        "source_snapshot": {
            "path": display_path(snapshot_path),
            "sha256": sha256(snapshot_path),
        },
        "spy": {
            "ticker": BENCHMARK_TICKER,
            "status": "COMPLETE",
            "next_trading_day": entry_date.isoformat(),
            "next_trading_day_raw_open": spy_entry["raw_open"],
            "next_trading_day_raw_close": spy_entry["raw_close"],
            "next_trading_day_adjusted_close": spy_entry[
                "adjusted_close"
            ],
            "adjustment_factor_at_entry_recording": spy_entry[
                "adjustment_factor"
            ],
            "next_trading_day_adjusted_open": spy_entry[
                "adjusted_open"
            ],
        },
        "signals": signals,
        "incidents": incidents,
    }


def ensure_entry(
    snapshot_path: Path,
    snapshot: dict[str, Any],
    histories: dict[str, pd.DataFrame],
    *,
    ledger_dir: Path,
    as_of: date,
    generated_at_utc: str,
) -> tuple[dict[str, Any] | None, Path | None, bool]:
    path = (
        ledger_dir / "entries" / f"{snapshot['signal_date']}.json"
    )
    if path.exists():
        return read_json(path), path, False
    payload = build_entry_payload(
        snapshot_path,
        snapshot,
        histories,
        as_of=as_of,
        generated_at_utc=generated_at_utc,
    )
    if payload is None:
        return None, None, False
    write_new_json(path, payload)
    return payload, path, True


def missing_price_incident(
    frame: pd.DataFrame | None,
    *,
    exit_date: date,
) -> str:
    closes = adjusted_close_series(frame)
    if closes.empty:
        return (
            "PRICE_HISTORY_UNAVAILABLE_POSSIBLE_DELISTING_ACQUISITION_"
            "OR_TICKER_CHANGE"
        )
    if max(closes.index) < exit_date:
        return (
            "PRICE_SERIES_ENDED_BEFORE_HORIZON_POSSIBLE_DELISTING_"
            "ACQUISITION_OR_TICKER_CHANGE"
        )
    return "EXIT_SESSION_PRICE_MISSING_REVIEW_REQUIRED"


def rebased_entry_open(
    *,
    ledger_raw_open: float,
    frame: pd.DataFrame | None,
    entry_date: date,
) -> float | None:
    values = price_at(frame, entry_date)
    if values is None:
        return None
    return ledger_raw_open * values["adjustment_factor"]


def evaluate_track(
    snapshot_path: Path,
    snapshot: dict[str, Any],
    entry_path: Path | None,
    entry: dict[str, Any] | None,
    histories: dict[str, pd.DataFrame],
    *,
    holding_period: int,
    as_of: date,
    generated_at_utc: str,
) -> dict[str, Any]:
    base = {
        "signal_date": snapshot["signal_date"],
        "holding_period_trading_days": holding_period,
        "signal_count": snapshot["signal_count"],
    }
    if not snapshot["signals"]:
        return {**base, "status": "NO_SIGNALS"}
    if entry is None or entry_path is None:
        return {**base, "status": "ENTRY_PENDING"}
    if entry["status"] != "COMPLETE":
        return {
            **base,
            "status": "DATA_INCIDENT_REVIEW_REQUIRED",
            "incidents": entry["incidents"],
        }

    entry_date = date.fromisoformat(entry["entry_date"])
    spy_prices = adjusted_close_series(
        histories.get(BENCHMARK_TICKER)
    )
    sessions = [
        value
        for value in spy_prices.index
        if entry_date <= value <= as_of
    ]
    if len(sessions) < holding_period:
        return {
            **base,
            "status": "RIGHT_CENSORED",
            "entry_date": entry["entry_date"],
            "available_trading_sessions": len(sessions),
        }
    exit_date = sessions[holding_period - 1]

    spy_entry_open = rebased_entry_open(
        ledger_raw_open=entry["spy"]["next_trading_day_raw_open"],
        frame=histories.get(BENCHMARK_TICKER),
        entry_date=entry_date,
    )
    spy_exit = adjusted_close_at(
        histories.get(BENCHMARK_TICKER),
        exit_date,
    )
    if spy_entry_open is None or spy_exit is None:
        raise RuntimeError("SPY complete-horizon price unavailable")
    spy_return = spy_exit / spy_entry_open - 1

    entry_by_symbol = {
        row["symbol"]: row for row in entry["signals"]
    }
    securities = []
    incidents = []
    for signal in snapshot["signals"]:
        symbol = signal["symbol"]
        ticker = signal_ticker(signal)
        entry_row = entry_by_symbol[symbol]
        frame = histories.get(ticker)
        adjusted_entry_open = rebased_entry_open(
            ledger_raw_open=entry_row["next_trading_day_raw_open"],
            frame=frame,
            entry_date=entry_date,
        )
        exit_adjusted_close = adjusted_close_at(frame, exit_date)
        if adjusted_entry_open is None or exit_adjusted_close is None:
            reason = missing_price_incident(
                frame,
                exit_date=exit_date,
            )
            incident = {
                "symbol": symbol,
                "yahoo_ticker": ticker,
                "reason": reason,
                "entry_date": entry_date.isoformat(),
                "required_exit_date": exit_date.isoformat(),
            }
            incidents.append(incident)
            securities.append(
                {
                    "symbol": symbol,
                    "yahoo_ticker": ticker,
                    "status": "DATA_INCIDENT_REVIEW_REQUIRED",
                    "reason": reason,
                }
            )
            continue
        security_return = (
            exit_adjusted_close / adjusted_entry_open - 1
        )
        securities.append(
            {
                "symbol": symbol,
                "yahoo_ticker": ticker,
                "status": "COMPLETE",
                "entry_adjusted_open_rebased": adjusted_entry_open,
                "exit_adjusted_close": exit_adjusted_close,
                "total_return": security_return,
            }
        )

    if incidents:
        return {
            **base,
            "status": "DATA_INCIDENT_REVIEW_REQUIRED",
            "entry_date": entry_date.isoformat(),
            "exit_date": exit_date.isoformat(),
            "incidents": incidents,
            "securities": securities,
        }

    cohort_return = fmean(
        row["total_return"] for row in securities
    )
    return {
        "disclaimer": DISCLAIMER,
        "schema_version": 1,
        "outcome_kind": "FORWARD_COHORT_HORIZON_RETURN",
        **base,
        "status": "COMPLETE",
        "generated_at_utc": generated_at_utc,
        "evaluation_as_of": as_of.isoformat(),
        "entry_date": entry_date.isoformat(),
        "exit_date": exit_date.isoformat(),
        "price_source": "Yahoo Finance via yfinance",
        "return_basis": (
            "Dividend-inclusive adjusted prices; next-session raw Open "
            "rebased with evaluation-series adjustment factor"
        ),
        "weighting": "EQUAL_WEIGHT_WITHIN_MONTHLY_COHORT",
        "source_snapshot": {
            "path": display_path(snapshot_path),
            "sha256": sha256(snapshot_path),
        },
        "source_entry": {
            "path": display_path(entry_path),
            "sha256": sha256(entry_path),
        },
        "securities": securities,
        "cohort_total_return": cohort_return,
        "spy_total_return": spy_return,
        "excess_return_vs_spy": cohort_return - spy_return,
    }


def aggregate_outcomes(
    outcomes: list[dict[str, Any]],
) -> dict[str, float | int]:
    return {
        "cohort_count": len(outcomes),
        "mean_cohort_total_return": fmean(
            row["cohort_total_return"] for row in outcomes
        ),
        "mean_spy_total_return": fmean(
            row["spy_total_return"] for row in outcomes
        ),
        "mean_excess_return_vs_spy": fmean(
            row["excess_return_vs_spy"] for row in outcomes
        ),
    }


def percent(value: float) -> str:
    return f"{value * 100:.2f}%"


def render_performance(
    outcomes: dict[int, dict[str, dict[str, Any]]],
    runtime_rows: list[dict[str, Any]],
    *,
    as_of: date,
) -> str:
    lines = [
        "# 품질 과매도 스크리너 전향 성과",
        "",
        f"> {DISCLAIMER}",
        "",
        "백테스트는 데이터 관문 실패로 검증 무효다. 이 전향 추적은 "
        "성과 우위를 주장하지 않는다.",
        "",
        f"- 데이터 기준일: {as_of.isoformat()}",
        "- 진입: 신호 다음 거래일 시가",
        "- 종료: 진입일을 1일째로 센 63/126/252번째 거래일 종가",
        "- 수익률: 배당 포함 조정주가",
        "- 가중: 종목 간 동일가중 후 월별 코호트 간 동일가중",
        "",
    ]
    for period in HOLDING_PERIODS:
        completed = list(outcomes[period].values())
        lines.extend([f"## {period}거래일", ""])
        if len(completed) < MIN_COHORTS_FOR_INTERPRETATION:
            lines.append(
                "표본 부족"
                f"({len(completed)}/{MIN_COHORTS_FOR_INTERPRETATION})"
            )
        else:
            aggregate = aggregate_outcomes(completed)
            lines.extend(
                [
                    f"- 완결 코호트: {aggregate['cohort_count']}개",
                    (
                        "- 전략 평균 총수익률: "
                        f"{percent(aggregate['mean_cohort_total_return'])}"
                    ),
                    (
                        "- SPY 평균 총수익률: "
                        f"{percent(aggregate['mean_spy_total_return'])}"
                    ),
                    (
                        "- SPY 대비 평균 초과수익: "
                        f"{percent(aggregate['mean_excess_return_vs_spy'])}"
                    ),
                ]
            )
        lines.append("")

    incidents = [
        {
            "signal_date": row["signal_date"],
            "holding_period": row["holding_period_trading_days"],
            **incident,
        }
        for row in runtime_rows
        if row["status"] == "DATA_INCIDENT_REVIEW_REQUIRED"
        for incident in row.get("incidents", [])
    ]
    lines.extend(["## 처리 상태", ""])
    for status in ("ENTRY_PENDING", "RIGHT_CENSORED", "NO_SIGNALS"):
        count = sum(row["status"] == status for row in runtime_rows)
        lines.append(f"- {status}: {count}")
    lines.append(
        f"- DATA_INCIDENT_REVIEW_REQUIRED: {len(incidents)}"
    )
    if incidents:
        lines.extend(
            [
                "",
                "| 신호일 | 보유기간 | 종목 | 사고 사유 |",
                "|---|---:|---|---|",
            ]
        )
        for row in incidents:
            lines.append(
                f"| {row['signal_date']} | "
                f"{row['holding_period']} | "
                f"{row.get('symbol', '-')} | "
                f"{row['reason']} |"
            )
    lines.extend(
        [
            "",
            "사고 상태는 수익률 분모에서 제외하며, 상장폐지·인수·"
            "티커 변경 또는 데이터 오류를 확인한 뒤 별도 correction을 "
            "추가한다. 원본 신호·진입·성과 파일은 덮어쓰지 않는다.",
            "",
        ]
    )
    return "\n".join(lines)


def required_tickers(
    snapshots: list[tuple[Path, dict[str, Any]]],
) -> list[str]:
    tickers = [BENCHMARK_TICKER]
    for _, snapshot in snapshots:
        tickers.extend(
            signal_ticker(signal) for signal in snapshot["signals"]
        )
    return list(dict.fromkeys(tickers))


def update_performance(
    *,
    ledger_dir: Path,
    performance_path: Path,
    as_of: date,
    histories: dict[str, pd.DataFrame] | None = None,
    now: datetime | None = None,
    downloader: Callable[..., pd.DataFrame] = yf.download,
) -> dict[str, Any]:
    timestamp = now or datetime.now(timezone.utc)
    generated_at_utc = timestamp.isoformat()
    snapshots = [
        (path, snapshot)
        for path, snapshot in load_snapshots(ledger_dir)
        if date.fromisoformat(snapshot["signal_date"]) <= as_of
    ]
    outcomes = load_outcomes(ledger_dir)
    outcomes = {
        period: {
            signal_date: payload
            for signal_date, payload in period_outcomes.items()
            if date.fromisoformat(payload["exit_date"]) <= as_of
        }
        for period, period_outcomes in outcomes.items()
    }

    if histories is None and snapshots:
        start = min(
            date.fromisoformat(snapshot["signal_date"])
            for _, snapshot in snapshots
        )
        histories, missing = download_price_histories(
            required_tickers(snapshots),
            start=start,
            end=as_of,
            downloader=downloader,
        )
        if BENCHMARK_TICKER in missing:
            raise RuntimeError("SPY price download failed")
        if missing:
            print(
                "[performance prices] unresolved tickers after retries: "
                + ", ".join(missing),
                flush=True,
            )
    histories = histories or {}

    created_entries = []
    created_outcomes = []
    runtime_rows = []
    for snapshot_path, snapshot in snapshots:
        entry, entry_path, entry_created = ensure_entry(
            snapshot_path,
            snapshot,
            histories,
            ledger_dir=ledger_dir,
            as_of=as_of,
            generated_at_utc=generated_at_utc,
        )
        if entry_created and entry_path is not None:
            created_entries.append(entry_path)
        for period in HOLDING_PERIODS:
            existing = outcomes[period].get(snapshot["signal_date"])
            if existing is not None:
                continue
            row = evaluate_track(
                snapshot_path,
                snapshot,
                entry_path,
                entry,
                histories,
                holding_period=period,
                as_of=as_of,
                generated_at_utc=generated_at_utc,
            )
            runtime_rows.append(row)
            if row["status"] != "COMPLETE":
                continue
            output = (
                ledger_dir
                / "outcomes"
                / str(period)
                / f"{snapshot['signal_date']}.json"
            )
            write_new_json(output, row)
            outcomes[period][snapshot["signal_date"]] = row
            created_outcomes.append(output)

    report = render_performance(
        outcomes,
        runtime_rows,
        as_of=as_of,
    )
    write_text_atomic(performance_path, report)
    return {
        "disclaimer": DISCLAIMER,
        "as_of": as_of.isoformat(),
        "snapshot_count": len(snapshots),
        "created_entries": [str(path) for path in created_entries],
        "created_outcomes": [str(path) for path in created_outcomes],
        "completed_cohorts": {
            str(period): len(outcomes[period])
            for period in HOLDING_PERIODS
        },
        "runtime_status_counts": {
            status: sum(
                row["status"] == status for row in runtime_rows
            )
            for status in sorted(
                {row["status"] for row in runtime_rows}
            )
        },
        "performance_report": str(performance_path),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="전향 코호트 진입가와 성과 원장 갱신"
    )
    parser.add_argument(
        "--as-of",
        type=date.fromisoformat,
        default=date.today(),
    )
    parser.add_argument(
        "--ledger-dir",
        type=Path,
        default=LEDGER_DIR,
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=PERFORMANCE_PATH,
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    print(DISCLAIMER, flush=True)
    result = update_performance(
        ledger_dir=args.ledger_dir,
        performance_path=args.output,
        as_of=args.as_of,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
