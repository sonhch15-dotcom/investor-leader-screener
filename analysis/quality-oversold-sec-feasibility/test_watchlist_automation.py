from __future__ import annotations

import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from requests import HTTPError
from fetch_sec_fsds_archives import download
from watchlist_automation import filing_archive_quarters


class ForbiddenResponse:
    status_code = 403

    def __enter__(self) -> "ForbiddenResponse":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def raise_for_status(self) -> None:
        raise HTTPError("forbidden")


class WatchlistAutomationTest(unittest.TestCase):
    def test_unpublished_archive_fails_without_stale_fallback(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with patch(
                "fetch_sec_fsds_archives.requests.get",
                return_value=ForbiddenResponse(),
            ):
                with self.assertRaisesRegex(
                    RuntimeError,
                    (
                        "archive unavailable; no stale-quarter "
                        "fallback applied: 2026q2"
                    ),
                ):
                    download("2026q2", Path(directory))

    def test_uses_latest_completed_filing_quarter(self) -> None:
        self.assertEqual(
            filing_archive_quarters(date(2026, 8, 15)),
            {
                "current_archive": "2026q2",
                "current_label": "2026 Q2",
                "prior_archive": "2025q2",
                "prior_label": "2025 Q2",
            },
        )

    def test_year_boundary_uses_prior_fourth_quarter(self) -> None:
        self.assertEqual(
            filing_archive_quarters(date(2027, 2, 15)),
            {
                "current_archive": "2026q4",
                "current_label": "2026 Q4",
                "prior_archive": "2025q4",
                "prior_label": "2025 Q4",
            },
        )


if __name__ == "__main__":
    unittest.main()
