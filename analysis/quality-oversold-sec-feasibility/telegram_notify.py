from __future__ import annotations

import argparse
import json
import os
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parent
DAILY_RESULTS_DIR = ROOT / "results" / "daily"
WATCHLIST_PATH = ROOT / "data" / "watchlist.json"
DISCLAIMER = "검증된 성과 우위 없음 · 조사 후보 목록"
TELEGRAM_MESSAGE_LIMIT = 4096
DISPLAY_SIGNAL_LIMIT = 10


def latest_daily_result() -> Path:
    paths = sorted(DAILY_RESULTS_DIR.glob("????-??-??.json"))
    if not paths:
        raise RuntimeError("No daily scan result available")
    return paths[-1]


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def format_signal(row: dict[str, Any]) -> str:
    return (
        f"{row['symbol']} ({row['sector']})\n"
        f"  고점 대비 -{row['drawdown_pct']:.1f}% · "
        f"RSI {row['rsi_14_wilder']:.1f} · "
        f"{row['decline_cause']} · {row['trend']}\n"
        f"  ROE {row['roe'] * 100:.1f}% · "
        "총부채비율 "
        f"{row['total_liabilities_to_equity']:.2f} · "
        "섹터중앙값 대비 "
        f"{row['drawdown_to_sector_median_ratio']:.3f}배"
    )


def build_message(
    daily: dict[str, Any],
    watchlist: dict[str, Any],
    *,
    result_filename: str,
    monthly_snapshot: bool = False,
) -> str:
    if daily.get("disclaimer") != DISCLAIMER:
        raise RuntimeError("Daily result disclaimer missing")
    if watchlist.get("disclaimer") != DISCLAIMER:
        raise RuntimeError("Watchlist disclaimer missing")

    title = "[품질 과매도 스크리너]"
    if monthly_snapshot:
        title += " [월간 스냅샷]"
    lines = [
        f"{title} {daily['market_data_date']}",
        DISCLAIMER,
        "",
        f"신호 {len(daily['signals'])}종목",
    ]

    shown = sorted(
        daily["signals"],
        key=lambda row: row["symbol"],
    )[:DISPLAY_SIGNAL_LIMIT]
    if shown:
        for row in shown:
            lines.extend(["", format_signal(row)])
    else:
        lines.extend(["", "오늘 조건을 모두 충족한 종목이 없습니다."])

    if len(daily["signals"]) > DISPLAY_SIGNAL_LIMIT:
        lines.extend(
            [
                "",
                (
                    f"종목코드순 첫 {DISPLAY_SIGNAL_LIMIT}개만 표시. "
                    f"전체: {result_filename}"
                ),
            ]
        )

    quality_funnel = watchlist["funnel"]
    price_funnel = daily["funnel"]
    financial_quarter = watchlist["financial_data_freshness"][
        "sec_fsds_latest_filing_quarter"
    ]
    lines.extend(
        [
            "",
            (
                f"감시목록 {price_funnel['watchlist_securities']}종목 중 "
                f"{price_funnel['final_signals']}종목 신호"
            ),
            (
                "퍼널: "
                f"{quality_funnel['unique_issuers']} "
                f"→ 섹터제외후 {quality_funnel['sector_included_issuers']} "
                f"→ 데이터완전 {quality_funnel['data_complete_issuers']} "
                f"→ 품질 {quality_funnel['quality_gate_pass_issuers']} "
                f"→ 적신호후 {quality_funnel['red_flag_pass_issuers']} "
                f"→ 낙폭 {price_funnel['drawdown_condition_pass']} "
                f"→ RSI {price_funnel['final_signals']}"
            ),
            f"재무 기준: {financial_quarter}",
            f"전체 결과: {result_filename}",
        ]
    )
    message = "\n".join(lines)
    if len(message) > TELEGRAM_MESSAGE_LIMIT:
        raise RuntimeError(
            "Telegram message exceeds 4,096 characters after "
            "the 10-signal display cap"
        )
    return message


def send_telegram(
    *,
    bot_token: str,
    chat_id: str,
    message: str,
    opener: Callable[..., Any] = urllib.request.urlopen,
) -> bool:
    endpoint = (
        f"https://api.telegram.org/bot{bot_token}/sendMessage"
    )
    body = urllib.parse.urlencode(
        {"chat_id": chat_id, "text": message}
    ).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with opener(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if not payload.get("ok"):
            print("[telegram] send failed: API_RESPONSE_NOT_OK")
            return False
        print("[telegram] send succeeded")
        return True
    except Exception as exception:
        print(
            "[telegram] send failed: "
            f"{type(exception).__name__}"
        )
        return False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="일일 품질 과매도 결과를 텔레그램으로 발송"
    )
    parser.add_argument("--daily-result", type=Path)
    parser.add_argument(
        "--watchlist",
        type=Path,
        default=WATCHLIST_PATH,
    )
    parser.add_argument(
        "--monthly-snapshot",
        action="store_true",
    )
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    daily_path = args.daily_result or latest_daily_result()
    message = build_message(
        load_json(daily_path),
        load_json(args.watchlist),
        result_filename=daily_path.relative_to(ROOT).as_posix(),
        monthly_snapshot=args.monthly_snapshot,
    )
    if args.dry_run:
        print(message)
        return 0

    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not bot_token or not chat_id:
        print(
            "[telegram] send skipped: "
            "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing"
        )
        return 0
    send_telegram(
        bot_token=bot_token,
        chat_id=chat_id,
        message=message,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
