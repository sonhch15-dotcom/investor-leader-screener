from __future__ import annotations

import gzip
import json
import re
import warnings
from decimal import Decimal
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning


ROOT = Path(__file__).resolve().parent
DEBT_CONCEPT_GROUPS = {
    "short_term": [
        "us-gaap:ShortTermBorrowings",
        "us-gaap:DebtCurrent",
    ],
    "current_long_term": [
        "us-gaap:LongTermDebtAndCapitalLeaseObligationsCurrent",
        "us-gaap:LongTermDebtAndFinanceLeaseObligationsCurrent",
        "us-gaap:LongTermDebtCurrent",
    ],
    "noncurrent_long_term": [
        "us-gaap:LongTermDebtAndCapitalLeaseObligations",
        "us-gaap:LongTermDebtAndFinanceLeaseObligationsNoncurrent",
        "us-gaap:LongTermDebtNoncurrent",
    ],
}
PRODUCT_AXIS = "srt:ProductOrServiceAxis"
CAT_DEBT_MEMBERS = {
    "cat:FinancialProductsMember",
    "cat:MachineryPowerEnergyMember",
    "cat:MachineryEnergyTransportationMember",
}


def parse_number(fact: Any) -> int | None:
    if str(fact.get("xsi:nil", "")).lower() == "true":
        return None
    text = fact.get_text("", strip=True)
    normalized = (
        text.replace(",", "")
        .replace("$", "")
        .replace("\u2212", "-")
        .replace("\u2013", "-")
        .strip()
    )
    if normalized in {"", "-", "—"}:
        return 0
    negative = normalized.startswith("(") and normalized.endswith(")")
    if negative:
        normalized = normalized[1:-1]
    try:
        value = Decimal(normalized)
    except Exception as error:
        raise ValueError(f"Cannot parse inline XBRL number: {text!r}") from error
    scale = int(fact.get("scale", "0"))
    value *= Decimal(10) ** scale
    if negative or fact.get("sign") == "-":
        value = -value
    return int(value)


def context_map(soup: BeautifulSoup) -> dict[str, dict[str, Any]]:
    contexts = {}
    for context in soup.find_all(
        lambda tag: getattr(tag, "name", None)
        in {"xbrli:context", "context"}
    ):
        instant = context.find(
            lambda tag: getattr(tag, "name", None)
            in {"xbrli:instant", "instant"}
        )
        dimensions = {}
        for member in context.find_all(
            lambda tag: getattr(tag, "name", None)
            in {"xbrldi:explicitmember", "explicitmember"}
        ):
            dimensions[member.get("dimension")] = member.get_text(strip=True)
        contexts[context["id"]] = {
            "instant": instant.get_text(strip=True) if instant else None,
            "dimensions": dimensions,
        }
    return contexts


def inline_facts(
    soup: BeautifulSoup,
    contexts: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    facts = []
    seen: dict[tuple[str, str], int] = {}
    relevant_concepts = set().union(
        *(set(concepts) for concepts in DEBT_CONCEPT_GROUPS.values())
    )
    for fact in soup.find_all(
        lambda tag: getattr(tag, "name", None)
        in {"ix:nonfraction", "nonfraction"}
    ):
        concept = fact.get("name")
        context_ref = fact.get("contextref")
        if concept not in relevant_concepts or context_ref not in contexts:
            continue
        value = parse_number(fact)
        if value is None:
            continue
        key = (concept, context_ref)
        if key in seen:
            if seen[key] != value:
                raise RuntimeError(
                    f"Conflicting duplicate fact: {concept} {context_ref}"
                )
            continue
        seen[key] = value
        facts.append(
            {
                "concept": concept,
                "context_ref": context_ref,
                "value": value,
                **contexts[context_ref],
            }
        )
    return facts


def cat_debt_from_filing(filing: dict[str, Any]) -> dict[str, Any]:
    with gzip.open(filing["path"], "rb") as handle:
        raw = handle.read()
    warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)
    soup = BeautifulSoup(raw, "lxml")
    contexts = context_map(soup)
    facts = inline_facts(soup, contexts)
    report_date = filing["report_date"]

    selected = []
    group_totals = {}
    for group, concepts in DEBT_CONCEPT_GROUPS.items():
        group_facts = []
        for concept in concepts:
            group_facts = [
                fact
                for fact in facts
                if fact["concept"] == concept
                and fact["instant"] == report_date
                and set(fact["dimensions"]) == {PRODUCT_AXIS}
                and fact["dimensions"][PRODUCT_AXIS] in CAT_DEBT_MEMBERS
            ]
            if group_facts:
                break
        if not group_facts:
            raise RuntimeError(
                f"CAT {report_date}: no product-axis facts for {group}"
            )
        group_totals[group] = sum(fact["value"] for fact in group_facts)
        selected.extend(
            {
                **fact,
                "group": group,
            }
            for fact in group_facts
        )

    total_debt = sum(group_totals.values())
    filing_text = soup.get_text(" ", strip=True)
    narrative_matches = sorted(
        {
            int(Decimal(match.replace(",", "")) * Decimal(1_000_000_000))
            for match in re.findall(
                r"Total debt as of .*? was \$([0-9,.]+) billion",
                filing_text,
                flags=re.IGNORECASE,
            )
        }
    )
    narrative_gap = (
        min(abs(total_debt - candidate) for candidate in narrative_matches)
        if narrative_matches
        else None
    )
    return {
        "symbol": filing["symbol"],
        "report_date": report_date,
        "filed": filing["filed"],
        "accession": filing["accession"],
        "form": filing["form"],
        "url": filing["url"],
        "group_totals": group_totals,
        "total_debt": total_debt,
        "narrative_total_debt_candidates": narrative_matches,
        "narrative_gap": narrative_gap,
        "matches_narrative": (
            narrative_gap <= 1_000_000 if narrative_gap is not None else None
        ),
        "sources": selected,
    }


def main() -> None:
    manifest = json.loads(
        (ROOT / "inline_filings_manifest.json").read_text(encoding="utf-8")
    )
    rows = [
        cat_debt_from_filing(filing)
        for filing in manifest["filings"]
        if filing["symbol"] == "CAT"
    ]
    payload = {
        "as_of": manifest["as_of"],
        "definition": (
            "short-term interest-bearing borrowings + current long-term debt + "
            "noncurrent interest-bearing debt; CAT tags include finance leases"
        ),
        "periods": rows,
        "coverage": {
            "available": len(rows),
            "expected": len(
                [
                    filing
                    for filing in manifest["filings"]
                    if filing["symbol"] == "CAT"
                ]
            ),
            "narrative_matches": sum(
                row["matches_narrative"] is True for row in rows
            ),
            "narrative_available": sum(
                row["matches_narrative"] is not None for row in rows
            ),
        },
    }
    (ROOT / "inline_fallback_results.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(payload["coverage"], ensure_ascii=True, indent=2))
    for row in rows:
        print(
            row["report_date"],
            row["total_debt"],
            row["narrative_total_debt_candidates"],
            row["matches_narrative"],
        )


if __name__ == "__main__":
    main()
