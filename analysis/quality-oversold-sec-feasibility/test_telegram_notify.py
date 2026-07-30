from __future__ import annotations

import unittest

from telegram_notify import (
    DISCLAIMER,
    TELEGRAM_MESSAGE_LIMIT,
    build_message,
    send_telegram,
)


def watchlist_payload() -> dict:
    return {
        "disclaimer": DISCLAIMER,
        "funnel": {
            "unique_issuers": 500,
            "sector_included_issuers": 362,
            "data_complete_issuers": 242,
            "quality_gate_pass_issuers": 37,
            "red_flag_pass_issuers": 31,
        },
        "financial_data_freshness": {
            "sec_fsds_latest_filing_quarter": "2026 Q1",
        },
    }


def signal(symbol: str) -> dict:
    return {
        "symbol": symbol,
        "sector": "Information Technology",
        "drawdown_pct": 20.0,
        "rsi_14_wilder": 30.0,
        "decline_cause": "시장동반",
        "trend": "추세이탈",
        "roe": 0.25,
        "total_liabilities_to_equity": 1.0,
        "drawdown_to_sector_median_ratio": 1.2,
    }


def daily_payload(signals: list[dict]) -> dict:
    return {
        "disclaimer": DISCLAIMER,
        "market_data_date": "2026-07-29",
        "signals": signals,
        "funnel": {
            "watchlist_securities": 31,
            "drawdown_condition_pass": 15,
            "final_signals": len(signals),
        },
    }


class FakeResponse:
    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self) -> bytes:
        return b'{"ok": true}'


class TelegramMessageTest(unittest.TestCase):
    def test_disclaimer_is_always_second_line(self) -> None:
        message = build_message(
            daily_payload([]),
            watchlist_payload(),
            result_filename="results/daily/2026-07-29.json",
        )

        self.assertEqual(message.splitlines()[1], DISCLAIMER)
        self.assertIn("신호 0종목", message)
        self.assertIn(
            "오늘 조건을 모두 충족한 종목이 없습니다.",
            message,
        )

    def test_monthly_title_and_signal_limit(self) -> None:
        message = build_message(
            daily_payload(
                [signal(f"TICKER{index:02d}") for index in range(12)]
            ),
            watchlist_payload(),
            result_filename="results/daily/2026-07-29.json",
            monthly_snapshot=True,
        )

        self.assertTrue(
            message.startswith(
                "[품질 과매도 스크리너] [월간 스냅샷]"
            )
        )
        self.assertEqual(message.count("섹터중앙값 대비"), 10)
        self.assertIn("첫 10개만 표시", message)
        self.assertLessEqual(len(message), TELEGRAM_MESSAGE_LIMIT)

    def test_sender_returns_false_without_leaking_exception(self) -> None:
        def failing_opener(*args: object, **kwargs: object) -> None:
            raise RuntimeError("network failed")

        self.assertFalse(
            send_telegram(
                bot_token="not-a-real-token",
                chat_id="123",
                message="test",
                opener=failing_opener,
            )
        )

    def test_sender_accepts_success_response(self) -> None:
        self.assertTrue(
            send_telegram(
                bot_token="not-a-real-token",
                chat_id="123",
                message="test",
                opener=lambda *args, **kwargs: FakeResponse(),
            )
        )


if __name__ == "__main__":
    unittest.main()
