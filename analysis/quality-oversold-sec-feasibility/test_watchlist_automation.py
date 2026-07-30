from __future__ import annotations

import unittest
from datetime import date

from watchlist_automation import filing_archive_quarters


class WatchlistAutomationTest(unittest.TestCase):
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
