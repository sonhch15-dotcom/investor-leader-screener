from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable

from analyze_total_liabilities_equity_fsds import (
    resolve_issuer,
    source_complete,
)
from fetch_sec_fsds_archives import quarter_range


FORMS = {"10-Q", "10-K", "10-Q/A", "10-K/A"}
RESOLVED_STATUSES = {"ratio_available", "nonpositive_equity_auto_fail"}
MAX_FINANCIAL_PERIOD_AGE_DAYS = 250
MAX_TICKER_MAPPING_AGE_DAYS = 250
MIN_OVERALL_COVERAGE = 0.90
MIN_SECTOR_COVERAGE = 0.80
REQUIRED_PROVENANCE_RATE = 1.00


@dataclass(frozen=True)
class Filing:
    cik: str
    accession: str
    filed: date
    period: date
    form: str
    instance_ticker: str | None
    balance_sheet_lines: list[dict[str, Any]]

    @property
    def rank(self) -> tuple[date, str]:
        return self.filed, self.accession


def parse_sec_date(value: str) -> date:
    return datetime.strptime(value, "%Y%m%d").date()


def text_rows(
    archive: zipfile.ZipFile, name: str
) -> Iterable[dict[str, str]]:
    with archive.open(name) as binary:
        text = io.TextIOWrapper(binary, encoding="utf-8", newline="")
        yield from csv.DictReader(text, delimiter="\t")


def ticker_key(value: str) -> str:
    return "".join(character for character in value.upper() if character.isalpha())


def instance_ticker(instance: str) -> str | None:
    match = re.match(r"[A-Za-z._-]+", Path(instance).stem)
    if not match:
        return None
    key = ticker_key(match.group(0))
    return key or None


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_snapshots(
    paths: list[Path],
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    snapshots: dict[str, dict[str, Any]] = {}
    sources = []
    for path in paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        sources.append({"path": str(path), "sha256": sha256(path)})
        for snapshot in payload["snapshots"]:
            month = snapshot["month"]
            if month in snapshots:
                raise ValueError(f"Duplicate snapshot month: {month}")
            snapshots[month] = snapshot
    ordered = [snapshots[month] for month in sorted(snapshots)]
    for previous, current in zip(ordered, ordered[1:]):
        previous_date = date.fromisoformat(previous["month_end"])
        current_date = date.fromisoformat(current["month_end"])
        expected_month = (
            previous_date.year + (previous_date.month == 12),
            1 if previous_date.month == 12 else previous_date.month + 1,
        )
        if (current_date.year, current_date.month) != expected_month:
            raise ValueError(
                f"Snapshot gap between {previous['month']} and "
                f"{current['month']}"
            )
    return ordered, sources


def extract_quarter_filings(
    archive_path: Path,
    target_ciks: set[str],
    target_tickers: set[str],
) -> list[Filing]:
    with zipfile.ZipFile(archive_path) as archive:
        submissions: dict[str, dict[str, str]] = {}
        for row in text_rows(archive, "sub.txt"):
            if (
                row["form"] not in FORMS
                or not row.get("period")
                or not row.get("filed")
            ):
                continue
            cik = f"{int(row['cik']):010d}"
            prefix = instance_ticker(row.get("instance", ""))
            if cik not in target_ciks and prefix not in target_tickers:
                continue
            submissions[row["adsh"]] = {
                **row,
                "normalized_cik": cik,
                "instance_ticker": prefix or "",
            }

        presentation: dict[str, list[dict[str, str]]] = defaultdict(list)
        needed: dict[str, set[tuple[str, str]]] = defaultdict(set)
        for row in text_rows(archive, "pre.txt"):
            if (
                row["adsh"] not in submissions
                or row["stmt"] != "BS"
                or row.get("inpth", "0") != "0"
            ):
                continue
            presentation[row["adsh"]].append(row)
            needed[row["adsh"]].add((row["tag"], row["version"]))

        facts: dict[
            tuple[str, str, str], list[dict[str, str]]
        ] = defaultdict(list)
        for row in text_rows(archive, "num.txt"):
            submission = submissions.get(row["adsh"])
            if (
                submission is None
                or row["qtrs"] != "0"
                or row["uom"] != "USD"
                or row.get("coreg", "")
                or not row.get("value")
                or row["ddate"] != submission["period"]
                or (row["tag"], row["version"])
                not in needed[row["adsh"]]
            ):
                continue
            facts[(row["adsh"], row["tag"], row["version"])].append(row)

    filings = []
    for accession, submission in submissions.items():
        lines = []
        for row in sorted(
            presentation[accession], key=lambda item: int(item["line"])
        ):
            values = facts.get(
                (accession, row["tag"], row["version"]), []
            )
            if not values:
                continue
            lines.append(
                {
                    "line": int(row["line"]),
                    "tag": row["tag"],
                    "version": row["version"],
                    "label": row["plabel"],
                    "values": [
                        {
                            "value": float(value["value"]),
                            "segments": value.get("segments", ""),
                            "footnote": value.get("footnote", ""),
                        }
                        for value in values
                    ],
                }
            )
        filings.append(
            Filing(
                cik=submission["normalized_cik"],
                accession=accession,
                filed=parse_sec_date(submission["filed"]),
                period=parse_sec_date(submission["period"]),
                form=submission["form"],
                instance_ticker=(
                    submission["instance_ticker"] or None
                ),
                balance_sheet_lines=lines,
            )
        )
    return sorted(filings, key=lambda filing: filing.rank)


def mapping_for_company(
    company: dict[str, Any],
    month_end: date,
    ticker_filings: dict[str, dict[str, date]],
) -> tuple[str | None, str, list[str]]:
    if company.get("cik"):
        return company["cik"], "wikipedia_numeric_cik", [company["cik"]]
    prefix = ticker_key(company["symbol"])
    candidates = sorted(
        cik
        for cik, filed in ticker_filings.get(prefix, {}).items()
        if 0 <= (month_end - filed).days <= MAX_TICKER_MAPPING_AGE_DAYS
    )
    if len(candidates) == 1:
        return candidates[0], "unique_sec_instance_ticker", candidates
    if candidates:
        return None, "ambiguous_sec_instance_ticker", candidates
    return None, "missing_sec_instance_ticker", []


def issuer_population(
    snapshot: dict[str, Any],
    month_end: date,
    ticker_filings: dict[str, dict[str, date]],
) -> list[dict[str, Any]]:
    mapped = []
    for company in snapshot["constituents"]:
        if not company["included_in_quality_universe"]:
            continue
        cik, method, candidates = mapping_for_company(
            company, month_end, ticker_filings
        )
        mapped.append(
            {
                **company,
                "mapped_cik": cik,
                "mapping_method": method,
                "mapping_candidates": candidates,
            }
        )

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in mapped:
        key = (
            f"cik:{row['mapped_cik']}"
            if row["mapped_cik"]
            else f"symbol:{row['symbol']}"
        )
        grouped[key].append(row)

    population = []
    for rows in grouped.values():
        sectors = {row["sector"] for row in rows}
        first = rows[0]
        population.append(
            {
                "symbols": ",".join(sorted(row["symbol"] for row in rows)),
                "names": " | ".join(
                    sorted({row["name"] for row in rows})
                ),
                "sector": first["sector"],
                "sector_conflict": len(sectors) != 1,
                "mapped_cik": first["mapped_cik"],
                "mapping_method": first["mapping_method"],
                "mapping_candidates": first["mapping_candidates"],
            }
        )
    return population


def resolve_population_row(
    company: dict[str, Any],
    month_end: date,
    latest_by_cik: dict[str, Filing],
) -> dict[str, Any]:
    cik = company["mapped_cik"]
    filing = latest_by_cik.get(cik) if cik else None
    if company["sector_conflict"]:
        resolution = {"status": "cik_sector_conflict"}
    elif cik is None:
        resolution = {"status": "cik_mapping_unresolved"}
    elif filing is None:
        resolution = {"status": "missing_latest_submission"}
    elif filing.period > month_end:
        resolution = {"status": "future_financial_period_invalid"}
    elif (month_end - filing.period).days > MAX_FINANCIAL_PERIOD_AGE_DAYS:
        resolution = {"status": "stale_financial_period"}
    else:
        resolution = resolve_issuer(
            {
                "balance_sheet_lines": filing.balance_sheet_lines,
            }
        )

    status = resolution["status"]
    resolved = status in RESOLVED_STATUSES
    provenance_complete = bool(
        resolved
        and filing
        and filing.accession
        and filing.filed
        and filing.period
        and source_complete(resolution.get("liabilities"))
        and source_complete(resolution.get("equity"))
    )
    return {
        **company,
        "status": status,
        "resolved": resolved,
        "provenance_complete": provenance_complete,
        "ratio": resolution.get("ratio"),
        "financial_period_end": filing.period.isoformat() if filing else "",
        "filed": filing.filed.isoformat() if filing else "",
        "accession": filing.accession if filing else "",
        "form": filing.form if filing else "",
    }


def summarize_month(
    snapshot: dict[str, Any],
    latest_by_cik: dict[str, Filing],
    ticker_filings: dict[str, dict[str, date]],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    month_end = date.fromisoformat(snapshot["month_end"])
    population = issuer_population(snapshot, month_end, ticker_filings)
    rows = [
        resolve_population_row(company, month_end, latest_by_cik)
        for company in population
    ]
    sector_rows = []
    for sector in sorted({row["sector"] for row in rows}):
        members = [row for row in rows if row["sector"] == sector]
        resolved = sum(row["resolved"] for row in members)
        sector_rows.append(
            {
                "sector": sector,
                "population": len(members),
                "resolved": resolved,
                "coverage": resolved / len(members),
            }
        )
    resolved_count = sum(row["resolved"] for row in rows)
    provenance_count = sum(
        row["provenance_complete"] for row in rows if row["resolved"]
    )
    overall = resolved_count / len(rows)
    minimum_sector = min(row["coverage"] for row in sector_rows)
    provenance_rate = (
        provenance_count / resolved_count if resolved_count else 0.0
    )
    eligible = (
        overall >= MIN_OVERALL_COVERAGE
        and minimum_sector >= MIN_SECTOR_COVERAGE
        and provenance_rate == REQUIRED_PROVENANCE_RATE
    )
    summary = {
        "month": snapshot["month"],
        "month_end": snapshot["month_end"],
        "population": len(rows),
        "resolved": resolved_count,
        "overall_coverage": overall,
        "minimum_sector_coverage": minimum_sector,
        "provenance_rate": provenance_rate,
        "coverage_eligible": eligible,
        "status_counts": dict(Counter(row["status"] for row in rows)),
        "mapping_method_counts": dict(
            Counter(row["mapping_method"] for row in rows)
        ),
        "by_sector": sector_rows,
    }
    for row in rows:
        row["month"] = snapshot["month"]
        row["month_end"] = snapshot["month_end"]
    return summary, rows


def build_coverage(
    snapshots: list[dict[str, Any]],
    fsds_dir: Path,
    start_quarter: str,
    end_quarter: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, str]]]:
    target_ciks = {
        row["cik"]
        for snapshot in snapshots
        for row in snapshot["constituents"]
        if row.get("cik")
    }
    target_tickers = {
        ticker_key(row["symbol"])
        for snapshot in snapshots
        for row in snapshot["constituents"]
    }
    snapshots_by_quarter: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for snapshot in snapshots:
        month_end = date.fromisoformat(snapshot["month_end"])
        quarter = (month_end.month - 1) // 3 + 1
        snapshots_by_quarter[f"{month_end.year:04d}q{quarter}"].append(
            snapshot
        )

    latest_by_cik: dict[str, Filing] = {}
    ticker_filings: dict[str, dict[str, date]] = defaultdict(dict)
    summaries = []
    all_rows = []
    archives = []
    for quarter in quarter_range(start_quarter, end_quarter):
        archive_path = fsds_dir / f"{quarter}.zip"
        if not archive_path.exists():
            raise FileNotFoundError(archive_path)
        archives.append(
            {"path": str(archive_path), "sha256": sha256(archive_path)}
        )
        filings = extract_quarter_filings(
            archive_path, target_ciks, target_tickers
        )
        pending = list(filings)
        index = 0
        for snapshot in snapshots_by_quarter.get(quarter, []):
            month_end = date.fromisoformat(snapshot["month_end"])
            while index < len(pending) and pending[index].filed <= month_end:
                filing = pending[index]
                current = latest_by_cik.get(filing.cik)
                if current is None or filing.rank > current.rank:
                    latest_by_cik[filing.cik] = filing
                if filing.instance_ticker:
                    previous = ticker_filings[
                        filing.instance_ticker
                    ].get(filing.cik)
                    if previous is None or filing.filed > previous:
                        ticker_filings[filing.instance_ticker][
                            filing.cik
                        ] = filing.filed
                index += 1
            summary, rows = summarize_month(
                snapshot, latest_by_cik, ticker_filings
            )
            summaries.append(summary)
            all_rows.extend(rows)
            print(
                json.dumps(
                    {
                        "month": summary["month"],
                        "overall": round(summary["overall_coverage"], 4),
                        "minimum_sector": round(
                            summary["minimum_sector_coverage"], 4
                        ),
                        "provenance": round(
                            summary["provenance_rate"], 4
                        ),
                        "eligible": summary["coverage_eligible"],
                    }
                ),
                flush=True,
            )
    expected_months = {snapshot["month"] for snapshot in snapshots}
    actual_months = {summary["month"] for summary in summaries}
    if expected_months != actual_months:
        missing = sorted(expected_months - actual_months)
        raise ValueError(f"Snapshots outside archive range: {missing}")
    return summaries, all_rows, archives


def write_outputs(
    summaries: list[dict[str, Any]],
    rows: list[dict[str, Any]],
    sources: list[dict[str, str]],
    archives: list[dict[str, str]],
    coverage_csv: Path,
    rows_csv: Path,
    detail_json: Path,
) -> None:
    with coverage_csv.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "month",
                "overall_coverage",
                "minimum_sector_coverage",
                "provenance_rate",
            ],
        )
        writer.writeheader()
        for summary in summaries:
            writer.writerow(
                {
                    key: summary[key]
                    for key in writer.fieldnames
                }
            )

    row_fields = [
        "month",
        "month_end",
        "symbols",
        "names",
        "sector",
        "mapped_cik",
        "mapping_method",
        "status",
        "resolved",
        "provenance_complete",
        "ratio",
        "financial_period_end",
        "filed",
        "accession",
        "form",
    ]
    with rows_csv.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=row_fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in row_fields})

    detail_json.write_text(
        json.dumps(
            {
                "preregistration": "PREREGISTRATION.v0.7.md",
                "data_scope": "coverage_only_no_prices_no_returns",
                "prices_accessed": False,
                "returns_calculated": False,
                "rules": {
                    "max_financial_period_age_days": (
                        MAX_FINANCIAL_PERIOD_AGE_DAYS
                    ),
                    "max_ticker_mapping_age_days": (
                        MAX_TICKER_MAPPING_AGE_DAYS
                    ),
                    "minimum_overall_coverage": MIN_OVERALL_COVERAGE,
                    "minimum_sector_coverage": MIN_SECTOR_COVERAGE,
                    "required_provenance_rate": REQUIRED_PROVENANCE_RATE,
                },
                "snapshot_sources": sources,
                "fsds_archives": archives,
                "months": summaries,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--snapshot-json", type=Path, action="append", required=True
    )
    parser.add_argument("--fsds-dir", type=Path, required=True)
    parser.add_argument("--start-quarter", required=True)
    parser.add_argument("--end-quarter", required=True)
    parser.add_argument("--coverage-csv", type=Path, required=True)
    parser.add_argument("--rows-csv", type=Path, required=True)
    parser.add_argument("--detail-json", type=Path, required=True)
    args = parser.parse_args()

    snapshots, sources = load_snapshots(args.snapshot_json)
    summaries, rows, archives = build_coverage(
        snapshots,
        args.fsds_dir,
        args.start_quarter,
        args.end_quarter,
    )
    write_outputs(
        summaries,
        rows,
        sources,
        archives,
        args.coverage_csv,
        args.rows_csv,
        args.detail_json,
    )


if __name__ == "__main__":
    main()

