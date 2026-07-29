from __future__ import annotations

import csv
import io
import json
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parent
ZIP_PATH = ROOT / "raw" / "sec_fsds" / "2026q1.zip"
MANIFEST_PATH = ROOT / "sp500_companyfacts_manifest.json"
FORMS = {"10-Q", "10-K", "10-Q/A", "10-K/A"}


def text_rows(archive: zipfile.ZipFile, name: str) -> Iterable[dict[str, str]]:
    with archive.open(name) as binary:
        text = io.TextIOWrapper(binary, encoding="utf-8", newline="")
        yield from csv.DictReader(text, delimiter="\t")


def selected_submissions(
    archive: zipfile.ZipFile, ciks: set[str]
) -> dict[str, dict[str, str]]:
    selected: dict[str, dict[str, str]] = {}
    for row in text_rows(archive, "sub.txt"):
        cik = f"{int(row['cik']):010d}"
        if cik not in ciks or row["form"] not in FORMS:
            continue
        current = selected.get(cik)
        rank = (row["filed"], row["adsh"])
        current_rank = (
            (current["filed"], current["adsh"]) if current else ("", "")
        )
        if current is None or rank > current_rank:
            selected[cik] = row
    return selected


def extract() -> dict[str, Any]:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    issuer_by_cik = {
        issuer["financial_cik"]: issuer for issuer in manifest["issuers"]
    }
    with zipfile.ZipFile(ZIP_PATH) as archive:
        submissions = selected_submissions(archive, set(issuer_by_cik))
        accession_to_cik = {
            row["adsh"]: cik for cik, row in submissions.items()
        }
        presentation: dict[str, list[dict[str, str]]] = defaultdict(list)
        needed_tags: dict[str, set[tuple[str, str]]] = defaultdict(set)
        for row in text_rows(archive, "pre.txt"):
            if (
                row["adsh"] not in accession_to_cik
                or row["stmt"] != "BS"
                or row["inpth"] != "0"
            ):
                continue
            presentation[row["adsh"]].append(row)
            needed_tags[row["adsh"]].add((row["tag"], row["version"]))

        facts: dict[
            tuple[str, str, str, str], list[dict[str, str]]
        ] = defaultdict(list)
        for row in text_rows(archive, "num.txt"):
            accession = row["adsh"]
            if (
                accession not in accession_to_cik
                or row["qtrs"] != "0"
                or row["uom"] != "USD"
                or row["coreg"]
                or not row["value"]
                or (row["tag"], row["version"])
                not in needed_tags[accession]
            ):
                continue
            facts[
                (
                    accession,
                    row["tag"],
                    row["version"],
                    row["ddate"],
                )
            ].append(row)

    issuers = []
    for cik, submission in submissions.items():
        accession = submission["adsh"]
        period = submission["period"]
        lines = []
        for row in sorted(
            presentation[accession], key=lambda item: int(item["line"])
        ):
            values = facts.get(
                (accession, row["tag"], row["version"], period), []
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
                            "segments": value["segments"],
                            "footnote": value["footnote"],
                        }
                        for value in values
                    ],
                }
            )
        issuer = issuer_by_cik[cik]
        issuers.append(
            {
                "symbols": issuer["symbols"],
                "name": issuer["names"][0],
                "sector": issuer["sector"],
                "cik": cik,
                "accession": accession,
                "form": submission["form"],
                "filed": submission["filed"],
                "period": period,
                "instance": submission["instance"],
                "balance_sheet_lines": lines,
            }
        )
    missing_ciks = sorted(set(issuer_by_cik) - set(submissions))
    return {
        "source": str(ZIP_PATH),
        "dataset_filing_window": "2026 Q1",
        "population_issuers": len(issuer_by_cik),
        "matched_latest_submissions": len(submissions),
        "missing_ciks": missing_ciks,
        "issuers": sorted(issuers, key=lambda row: row["symbols"][0]),
    }


def main() -> None:
    result = extract()
    (ROOT / "fsds_balance_sheets_2026q1.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "population_issuers": result["population_issuers"],
                "matched_latest_submissions": result[
                    "matched_latest_submissions"
                ],
                "missing_cik_count": len(result["missing_ciks"]),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
