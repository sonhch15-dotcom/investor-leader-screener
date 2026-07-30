from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

import pandas as pd
import yfinance as yf


ROOT = Path(__file__).resolve().parent
CONSTITUENTS_PATH = ROOT / "data" / "sp500_constituents.json"
WATCHLIST_PATH = ROOT / "data" / "watchlist.json"
RESULTS_DIR = ROOT / "results" / "daily"

DISCLAIMER = "검증된 성과 우위 없음 · 조사 후보 목록"
INDEX_TICKER = "^GSPC"
BENCHMARK_TICKER = "SPY"
LOOKBACK_TRADING_DAYS = 252
MOVING_AVERAGE_DAYS = 200
RSI_PERIOD = 14
DRAWDOWN_MIN_PCT = 15.0
DRAWDOWN_MAX_PCT = 40.0
RSI_THRESHOLD = 35.0
SECTOR_DRAWDOWN_MULTIPLIER = 1.3
DOWNLOAD_ATTEMPTS = 3


def write_new_json(path: Path, payload: dict[str, Any]) -> None:
    if path.exists():
        raise FileExistsError(
            f"Daily result already exists and cannot be overwritten: {path}"
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.tmp")
    if temporary.exists():
        raise FileExistsError(
            f"Temporary daily result already exists: {temporary}"
        )
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.rename(path)


def distribution_summary(values: list[float]) -> dict[str, Any]:
    series = pd.Series(values, dtype="float64").dropna()
    if series.empty:
        raise ValueError("Cannot summarize an empty distribution")
    return {
        "sample_count": int(series.count()),
        "q1_pct": float(series.quantile(0.25)),
        "median_pct": float(series.median()),
        "q3_pct": float(series.quantile(0.75)),
    }


def normalize_history(frame: pd.DataFrame) -> pd.DataFrame:
    normalized = frame.copy()
    normalized.index = pd.Index(
        [
            value.date() if hasattr(value, "date") else value
            for value in normalized.index
        ]
    )
    normalized = normalized[~normalized.index.duplicated(keep="last")]
    return normalized.sort_index()


def extract_histories(
    frame: pd.DataFrame,
    tickers: list[str],
) -> dict[str, pd.DataFrame]:
    histories = {}
    if frame.empty:
        return histories
    if isinstance(frame.columns, pd.MultiIndex):
        level_zero = set(map(str, frame.columns.get_level_values(0)))
        level_one = set(map(str, frame.columns.get_level_values(1)))
        for ticker in tickers:
            if ticker in level_zero:
                selected = frame[ticker]
            elif ticker in level_one:
                selected = frame.xs(ticker, axis=1, level=1)
            else:
                continue
            selected = normalize_history(selected.dropna(how="all"))
            if not selected.empty:
                histories[ticker] = selected
        return histories
    if len(tickers) == 1:
        selected = normalize_history(frame.dropna(how="all"))
        if not selected.empty:
            histories[tickers[0]] = selected
    return histories


def download_histories(
    tickers: list[str],
    as_of: date,
    *,
    downloader: Callable[..., pd.DataFrame] = yf.download,
) -> tuple[dict[str, pd.DataFrame], list[str]]:
    histories: dict[str, pd.DataFrame] = {}
    remaining = list(dict.fromkeys(tickers))
    start = as_of - timedelta(days=450)
    end = as_of + timedelta(days=1)
    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
        if not remaining:
            break
        print(
            f"[prices] attempt {attempt}/{DOWNLOAD_ATTEMPTS}: "
            f"{len(remaining)} tickers",
            flush=True,
        )
        try:
            downloaded = downloader(
                remaining,
                start=start.isoformat(),
                end=end.isoformat(),
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
                f"[prices] download error: {type(exception).__name__}: "
                f"{exception}",
                flush=True,
            )
            downloaded = pd.DataFrame()
        received = extract_histories(downloaded, remaining)
        histories.update(received)
        remaining = [
            ticker for ticker in remaining if ticker not in received
        ]
    return histories, remaining


def adjusted_close_series(frame: pd.DataFrame) -> pd.Series:
    if "Adj Close" not in frame:
        return pd.Series(dtype="float64")
    values = pd.to_numeric(frame["Adj Close"], errors="coerce").dropna()
    values.index = pd.Index(
        [
            value.date() if hasattr(value, "date") else value
            for value in values.index
        ]
    )
    values = values[~values.index.duplicated(keep="last")].sort_index()
    return values[values > 0]


def adjusted_price_frame(frame: pd.DataFrame) -> pd.DataFrame:
    required = {"Close", "Adj Close", "High"}
    if not required.issubset(frame.columns):
        return pd.DataFrame()
    values = frame.loc[:, ["Close", "Adj Close", "High"]].apply(
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
        (values["Close"] > 0)
        & (values["Adj Close"] > 0)
        & (values["High"] > 0)
    )
    values = values.loc[valid].copy()
    values["Adjusted High"] = (
        values["High"] * values["Adj Close"] / values["Close"]
    )
    return values


def wilder_rsi(values: pd.Series, period: int = RSI_PERIOD) -> float | None:
    series = pd.to_numeric(values, errors="coerce").dropna()
    if len(series) < period + 1:
        return None
    changes = series.diff().dropna()
    gains = changes.clip(lower=0)
    losses = -changes.clip(upper=0)
    average_gain = float(gains.iloc[:period].mean())
    average_loss = float(losses.iloc[:period].mean())
    for index in range(period, len(changes)):
        average_gain = (
            average_gain * (period - 1) + float(gains.iloc[index])
        ) / period
        average_loss = (
            average_loss * (period - 1) + float(losses.iloc[index])
        ) / period
    if average_gain == 0 and average_loss == 0:
        return 50.0
    if average_loss == 0:
        return 100.0
    relative_strength = average_gain / average_loss
    return 100 - 100 / (1 + relative_strength)


def evaluate_price(
    frame: pd.DataFrame | None,
    market_date: date,
) -> dict[str, Any]:
    if frame is None:
        return {
            "status": "DATA_INSUFFICIENT",
            "reason": "PRICE_HISTORY_UNAVAILABLE",
        }
    prices = adjusted_price_frame(frame)
    prices = prices[prices.index <= market_date]
    if market_date not in prices.index:
        return {
            "status": "DATA_INSUFFICIENT",
            "reason": "MARKET_DATE_PRICE_MISSING",
        }
    if len(prices) < LOOKBACK_TRADING_DAYS:
        return {
            "status": "DATA_INSUFFICIENT",
            "reason": "ADJUSTED_PRICE_252D_MISSING",
            "available_trading_days": len(prices),
        }
    window = prices.tail(LOOKBACK_TRADING_DAYS)
    adjusted_close = window["Adj Close"]
    current = float(adjusted_close.iloc[-1])
    high = float(window["Adjusted High"].max())
    moving_average = float(
        adjusted_close.tail(MOVING_AVERAGE_DAYS).mean()
    )
    rsi = wilder_rsi(adjusted_close, RSI_PERIOD)
    if high <= 0 or rsi is None:
        return {
            "status": "DATA_INSUFFICIENT",
            "reason": "PRICE_INDICATOR_CALCULATION_FAILED",
        }
    drawdown_pct = (1 - current / high) * 100
    return {
        "status": "AVAILABLE",
        "market_date": market_date.isoformat(),
        "adjusted_close": current,
        "high_52_week_adjusted": high,
        "drawdown_pct": drawdown_pct,
        "rsi_14_wilder": rsi,
        "moving_average_200_adjusted_close": moving_average,
        "trend": (
            "추세유지" if current >= moving_average else "추세이탈"
        ),
        "available_trading_days": len(prices),
        "indicator_window_trading_days": LOOKBACK_TRADING_DAYS,
    }


def latest_market_date(
    index_frame: pd.DataFrame | None,
    as_of: date,
) -> date:
    if index_frame is None:
        raise RuntimeError("S&P 500 index price history unavailable")
    closes = adjusted_close_series(index_frame)
    dates = [value for value in closes.index if value <= as_of]
    if not dates:
        raise RuntimeError("No completed S&P 500 market date")
    return max(dates)


def market_session_status(
    index_frame: pd.DataFrame | None,
    as_of: date,
) -> dict[str, Any]:
    latest = latest_market_date(index_frame, as_of)
    return {
        "requested_date": as_of.isoformat(),
        "latest_available_market_date": latest.isoformat(),
        "is_requested_date_available": latest == as_of,
    }


def build_scan(
    *,
    as_of: date,
    constituents_payload: dict[str, Any],
    watchlist_payload: dict[str, Any],
    histories: dict[str, pd.DataFrame],
    missing_downloads: list[str],
) -> dict[str, Any]:
    constituents = constituents_payload["constituents"]
    watchlist = watchlist_payload["watchlist"]
    market_date = latest_market_date(histories.get(INDEX_TICKER), as_of)

    universe_prices = {}
    sector_drawdowns: dict[str, list[float]] = defaultdict(list)
    universe_insufficient = []
    for security in constituents:
        price = evaluate_price(
            histories.get(security["yahoo_ticker"]),
            market_date,
        )
        universe_prices[security["yahoo_ticker"]] = price
        if price["status"] == "AVAILABLE":
            sector_drawdowns[security["sector"]].append(
                price["drawdown_pct"]
            )
        else:
            universe_insufficient.append(
                {
                    "symbol": security["symbol"],
                    "yahoo_ticker": security["yahoo_ticker"],
                    "sector": security["sector"],
                    "reason": price["reason"],
                    "available_trading_days": price.get(
                        "available_trading_days"
                    ),
                }
            )
    sector_distributions = {
        sector: distribution_summary(values)
        for sector, values in sector_drawdowns.items()
        if values
    }
    sector_medians = {
        sector: values["median_pct"]
        for sector, values in sector_distributions.items()
    }
    all_constituent_drawdowns = [
        drawdown
        for values in sector_drawdowns.values()
        for drawdown in values
    ]
    sp500_constituent_distribution = distribution_summary(
        all_constituent_drawdowns
    )
    sp500_constituent_median = sp500_constituent_distribution[
        "median_pct"
    ]

    rows = []
    insufficient_reasons = Counter()
    for security in watchlist:
        price = universe_prices.get(
            security["yahoo_ticker"],
            {
                "status": "DATA_INSUFFICIENT",
                "reason": "CONSTITUENT_PRICE_RESULT_MISSING",
            },
        )
        if price["status"] != "AVAILABLE":
            insufficient_reasons[price["reason"]] += 1
            rows.append(
                {
                    "symbol": security["symbol"],
                    "name": security["name"],
                    "sector": security["sector"],
                    "status": "DATA_INSUFFICIENT",
                    "reason": price["reason"],
                }
            )
            continue
        sector_median = sector_medians.get(security["sector"])
        if sector_median is None:
            insufficient_reasons[
                "SECTOR_DRAWDOWN_MEDIAN_UNAVAILABLE"
            ] += 1
            rows.append(
                {
                    "symbol": security["symbol"],
                    "name": security["name"],
                    "sector": security["sector"],
                    "status": "DATA_INSUFFICIENT",
                    "reason": "SECTOR_DRAWDOWN_MEDIAN_UNAVAILABLE",
                }
            )
            continue
        drawdown_pass = (
            DRAWDOWN_MIN_PCT
            <= price["drawdown_pct"]
            <= DRAWDOWN_MAX_PCT
        )
        rsi_pass = (
            drawdown_pass
            and price["rsi_14_wilder"] <= RSI_THRESHOLD
        )
        drawdown_to_sector_median_ratio = (
            price["drawdown_pct"] / sector_median
            if sector_median > 0
            else None
        )
        cause = (
            "시장동반"
            if price["drawdown_pct"]
            <= sector_median * SECTOR_DRAWDOWN_MULTIPLIER
            else "개별하락"
        )
        rows.append(
            {
                "symbol": security["symbol"],
                "name": security["name"],
                "sector": security["sector"],
                **price,
                "status": "SIGNAL" if rsi_pass else "NO_SIGNAL",
                "sector_drawdown_median_pct": sector_median,
                "sp500_constituent_drawdown_median_pct": (
                    sp500_constituent_median
                ),
                "sector_comparison_multiplier": (
                    SECTOR_DRAWDOWN_MULTIPLIER
                ),
                "drawdown_to_sector_median_ratio": (
                    drawdown_to_sector_median_ratio
                ),
                "decline_cause": cause,
                "drawdown_condition_pass": drawdown_pass,
                "rsi_condition_pass": rsi_pass,
                "roe": security["roe"],
                "total_liabilities_to_equity": security[
                    "total_liabilities_to_equity"
                ],
                "financial_periods": security["financial_periods"],
                "quality_tags": security["tags"],
            }
        )
    rows.sort(key=lambda row: row["symbol"])
    available_rows = [
        row for row in rows if row["status"] != "DATA_INSUFFICIENT"
    ]
    drawdown_pass_rows = [
        row
        for row in available_rows
        if row["drawdown_condition_pass"]
    ]
    signals = [row for row in rows if row["status"] == "SIGNAL"]
    index_price = evaluate_price(
        histories.get(INDEX_TICKER),
        market_date,
    )
    if index_price["status"] != "AVAILABLE":
        raise RuntimeError("S&P 500 index indicator unavailable")
    benchmark_price = evaluate_price(
        histories.get(BENCHMARK_TICKER),
        market_date,
    )
    if benchmark_price["status"] != "AVAILABLE":
        raise RuntimeError("SPY benchmark indicator unavailable")
    index_dates = adjusted_close_series(histories[INDEX_TICKER]).index
    same_month_dates = [
        value
        for value in index_dates
        if value.year == market_date.year
        and value.month == market_date.month
        and value <= market_date
    ]
    is_first_trading_day = market_date == min(same_month_dates)
    signal_trends = Counter(row["trend"] for row in signals)
    signal_causes = Counter(row["decline_cause"] for row in signals)
    breadth_share = (
        len(drawdown_pass_rows) / len(watchlist) if watchlist else None
    )

    return {
        "disclaimer": DISCLAIMER,
        "strategy_status": "FORWARD_TEST_ONLY_UNVALIDATED",
        "artifact_role": (
            "DAILY_BACKGROUND_MARKET_CONTEXT_NOT_PERFORMANCE_COHORT"
        ),
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "requested_as_of_date": as_of.isoformat(),
        "market_data_date": market_date.isoformat(),
        "price_source": "Yahoo Finance via yfinance",
        "quality_watchlist_source": {
            "path": str(WATCHLIST_PATH.relative_to(ROOT)),
            "as_of_date": watchlist_payload["as_of_date"],
            "generated_at_utc": watchlist_payload["generated_at_utc"],
            "financial_data_freshness": watchlist_payload[
                "financial_data_freshness"
            ],
        },
        "price_basis": (
            "Adjusted Close for current price, RSI, and 200-day "
            "moving average; adjusted intraday High for 52-week high"
        ),
        "thresholds": {
            "drawdown_min_pct": DRAWDOWN_MIN_PCT,
            "drawdown_max_pct": DRAWDOWN_MAX_PCT,
            "rsi_period": RSI_PERIOD,
            "rsi_threshold": RSI_THRESHOLD,
            "sector_drawdown_multiplier": (
                SECTOR_DRAWDOWN_MULTIPLIER
            ),
            "moving_average_days": MOVING_AVERAGE_DAYS,
            "high_window_trading_days": LOOKBACK_TRADING_DAYS,
            "threshold_policy": (
                "preregistered; not adjusted for signal count"
            ),
        },
        "market_context": {
            "sp500_index": {
                "ticker": INDEX_TICKER,
                "drawdown_pct": index_price["drawdown_pct"],
                "adjusted_close": index_price["adjusted_close"],
                "high_52_week_adjusted": index_price[
                    "high_52_week_adjusted"
                ],
            },
            "spy": {
                "ticker": BENCHMARK_TICKER,
                "adjusted_close": benchmark_price["adjusted_close"],
                "drawdown_pct": benchmark_price["drawdown_pct"],
            },
            "sp500_constituent_drawdown_median_pct": (
                sp500_constituent_median
            ),
            "sp500_constituent_drawdown_distribution_pct": (
                sp500_constituent_distribution
            ),
        },
        "market_calendar": {
            "market_date": market_date.isoformat(),
            "is_first_trading_day_of_month": is_first_trading_day,
        },
        "funnel": {
            "sp500_constituent_securities": len(constituents),
            "sp500_price_complete_securities": sum(
                price["status"] == "AVAILABLE"
                for price in universe_prices.values()
            ),
            "watchlist_securities": len(watchlist),
            "watchlist_price_complete": len(available_rows),
            "drawdown_condition_pass": len(drawdown_pass_rows),
            "rsi_condition_pass_after_drawdown": len(signals),
            "final_signals": len(signals),
            "data_insufficient": len(rows) - len(available_rows),
        },
        "watchlist_drawdown_breadth": {
            "drawdown_condition_pass": len(drawdown_pass_rows),
            "watchlist_securities": len(watchlist),
            "share": breadth_share,
        },
        "signal_tag_distribution": {
            "trend": dict(sorted(signal_trends.items())),
            "decline_cause": dict(sorted(signal_causes.items())),
        },
        "reason_counts": {
            "data_insufficient": dict(sorted(insufficient_reasons.items())),
            "sp500_universe_price_data_insufficient": dict(
                sorted(
                    Counter(
                        row["reason"] for row in universe_insufficient
                    ).items()
                )
            ),
            "download_missing": sorted(missing_downloads),
        },
        "sector_drawdown_medians_pct": dict(
            sorted(sector_medians.items())
        ),
        "sector_drawdown_distributions_pct": dict(
            sorted(sector_distributions.items())
        ),
        "sector_median_sample_counts": {
            sector: len(values)
            for sector, values in sorted(sector_drawdowns.items())
        },
        "sp500_universe_price_data_insufficient": (
            universe_insufficient
        ),
        "signals": signals,
        "watchlist_scan": rows,
    }


def validate_scan(payload: dict[str, Any]) -> None:
    if payload["disclaimer"] != DISCLAIMER:
        raise RuntimeError("Missing mandatory performance disclaimer")
    funnel = payload["funnel"]
    if (
        funnel["watchlist_price_complete"]
        + funnel["data_insufficient"]
        != funnel["watchlist_securities"]
    ):
        raise RuntimeError("Daily price funnel does not reconcile")
    if funnel["final_signals"] != len(payload["signals"]):
        raise RuntimeError("Daily signal funnel does not reconcile")
    if (
        funnel["sp500_price_complete_securities"]
        + len(payload["sp500_universe_price_data_insufficient"])
        != funnel["sp500_constituent_securities"]
    ):
        raise RuntimeError("S&P 500 price coverage does not reconcile")
    symbols = [row["symbol"] for row in payload["watchlist_scan"]]
    if len(symbols) != len(set(symbols)):
        raise RuntimeError("Duplicate daily scan symbols")
    for row in payload["signals"]:
        if not (
            row["drawdown_condition_pass"]
            and row["rsi_condition_pass"]
        ):
            raise RuntimeError(
                f"Signal conditions do not reconcile: {row['symbol']}"
            )
        if row.get("sector_drawdown_median_pct") is None or row.get(
            "sp500_constituent_drawdown_median_pct"
        ) is None:
            raise RuntimeError(
                f"Signal median evidence missing: {row['symbol']}"
            )
        if row.get("drawdown_to_sector_median_ratio") is None:
            raise RuntimeError(
                f"Signal sector-median ratio missing: {row['symbol']}"
            )
    sector_distributions = payload[
        "sector_drawdown_distributions_pct"
    ]
    if sum(
        values["sample_count"]
        for values in sector_distributions.values()
    ) != funnel["sp500_price_complete_securities"]:
        raise RuntimeError("Sector distribution samples do not reconcile")
    market_distribution = payload["market_context"][
        "sp500_constituent_drawdown_distribution_pct"
    ]
    if (
        market_distribution["sample_count"]
        != funnel["sp500_price_complete_securities"]
    ):
        raise RuntimeError("Market distribution samples do not reconcile")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="품질 감시목록의 일일 과매도 가격 조건 확인"
    )
    parser.add_argument(
        "--as-of",
        type=date.fromisoformat,
        default=date.today(),
    )
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    print(DISCLAIMER, flush=True)
    constituents = json.loads(
        CONSTITUENTS_PATH.read_text(encoding="utf-8")
    )
    watchlist = json.loads(WATCHLIST_PATH.read_text(encoding="utf-8"))
    if constituents.get("disclaimer") != DISCLAIMER:
        raise RuntimeError("Constituent disclaimer missing")
    if watchlist.get("disclaimer") != DISCLAIMER:
        raise RuntimeError("Watchlist disclaimer missing")
    index_histories, index_missing = download_histories(
        [INDEX_TICKER],
        args.as_of,
    )
    if index_missing:
        raise RuntimeError("S&P 500 index price history unavailable")
    session = market_session_status(
        index_histories.get(INDEX_TICKER),
        args.as_of,
    )
    if not session["is_requested_date_available"]:
        print(
            json.dumps(
                {
                    "disclaimer": DISCLAIMER,
                    "status": "MARKET_CLOSED",
                    "log": "[휴장]",
                    **session,
                    "files_written": False,
                    "telegram_sent": False,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    tickers = sorted(
        {
            row["yahoo_ticker"]
            for row in constituents["constituents"]
        }
        | {BENCHMARK_TICKER}
    )
    histories, missing = download_histories(tickers, args.as_of)
    histories.update(index_histories)
    payload = build_scan(
        as_of=args.as_of,
        constituents_payload=constituents,
        watchlist_payload=watchlist,
        histories=histories,
        missing_downloads=missing,
    )
    validate_scan(payload)
    output = args.output or (
        RESULTS_DIR / f"{payload['market_data_date']}.json"
    )
    write_new_json(output, payload)
    print(
        json.dumps(
            {
                "disclaimer": DISCLAIMER,
                "output": str(output),
                "market_data_date": payload["market_data_date"],
                "market_context": payload["market_context"],
                "funnel": payload["funnel"],
                "signals": payload["signals"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
