from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from telegram_notify import (
    DISCLAIMER,
    TELEGRAM_MESSAGE_LIMIT,
    build_message,
    display_result_path,
    load_local_env,
    send_telegram,
    zero_signal_test_payload,
)


def watchlist_payload() -> dict:
    return {
        "disclaimer": DISCLAIMER,
        "generated_at_utc": "2026-07-29T04:05:26+00:00",
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
    def test_zero_signal_payload_does_not_mutate_source(self) -> None:
        source = daily_payload([signal("AAA")])

        transformed = zero_signal_test_payload(source)

        self.assertEqual(len(source["signals"]), 1)
        self.assertEqual(source["funnel"]["final_signals"], 1)
        self.assertEqual(transformed["signals"], [])
        self.assertEqual(transformed["funnel"]["final_signals"], 0)
        self.assertEqual(
            transformed["funnel"][
                "rsi_condition_pass_after_drawdown"
            ],
            0,
        )

    def test_relative_result_path_is_resolved_from_working_directory(
        self,
    ) -> None:
        path = Path("results/daily/2026-07-29.json")

        self.assertEqual(
            display_result_path(path),
            "results/daily/2026-07-29.json",
        )

    def test_local_env_loads_without_overriding_injected_values(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            env_file.write_text(
                "TELEGRAM_BOT_TOKEN=local-token\n"
                "TELEGRAM_CHAT_ID=-12345\n",
                encoding="utf-8",
            )
            environ = {"TELEGRAM_BOT_TOKEN": "actions-secret"}

            load_local_env(env_file, environ)

            self.assertEqual(
                environ["TELEGRAM_BOT_TOKEN"],
                "actions-secret",
            )
            self.assertEqual(
                environ["TELEGRAM_CHAT_ID"],
                "-12345",
            )

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
        self.assertNotIn("감시목록 갱신 필요", message)

    def test_stale_watchlist_warning_starts_at_100_days(self) -> None:
        watchlist = watchlist_payload()
        watchlist["generated_at_utc"] = (
            "2026-04-20T00:00:00+00:00"
        )

        message = build_message(
            daily_payload([]),
            watchlist,
            result_filename="results/daily/2026-07-29.json",
        )

        self.assertEqual(message.splitlines()[1], DISCLAIMER)
        self.assertIn(
            "⚠ 감시목록 갱신 필요 (마지막 갱신: 2026-04-20)",
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
