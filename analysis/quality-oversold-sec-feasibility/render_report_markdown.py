from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent


def display(value: Any, column: dict[str, Any]) -> str:
    if value is None:
        return "—"
    if column.get("format") == "percent":
        return f"{float(value):.1%}"
    if column.get("format") == "number":
        if isinstance(value, float) and not value.is_integer():
            return f"{value:,.4f}"
        return f"{value:,}"
    return str(value).replace("|", "\\|").replace("\n", " ")


def markdown_table(
    table: dict[str, Any], rows: list[dict[str, Any]]
) -> str:
    columns = table["columns"]
    labels = [column["label"] for column in columns]
    lines = [
        f"### {table['title']}",
        "",
        f"*{table['subtitle']}*" if table.get("subtitle") else "",
        "",
        "| " + " | ".join(labels) + " |",
        "|" + "|".join("---" for _ in labels) + "|",
    ]
    for row in rows:
        lines.append(
            "| "
            + " | ".join(
                display(row.get(column["field"]), column)
                for column in columns
            )
            + " |"
        )
    return "\n".join(line for line in lines if line != "" or lines)


def render(artifact: dict[str, Any]) -> str:
    manifest = artifact["manifest"]
    datasets = artifact["snapshot"]["datasets"]
    charts = {chart["id"]: chart for chart in manifest["charts"]}
    tables = {table["id"]: table for table in manifest["tables"]}
    parts = [f"# {manifest['title']}"]
    for block in manifest["blocks"]:
        block_type = block["type"]
        if block_type == "markdown":
            body = block["body"].strip()
            if body.startswith("# ") and body[2:] == manifest["title"]:
                continue
            parts.append(body)
        elif block_type == "chart":
            chart = charts[block["chartId"]]
            parts.append(
                "\n".join(
                    [
                        f"### {chart['title']}",
                        "",
                        f"*{chart.get('subtitle', '')}*",
                        "",
                        (
                            f"> 차트 데이터: `{chart['dataset']}` "
                            f"({len(datasets[chart['dataset']])}행)"
                        ),
                    ]
                ).strip()
            )
        elif block_type == "table":
            table = tables[block["tableId"]]
            rows = list(datasets[table["dataset"]])
            sort = table.get("defaultSort")
            if sort:
                rows.sort(
                    key=lambda row: row.get(sort["field"]),
                    reverse=sort.get("direction") == "desc",
                )
            parts.append(markdown_table(table, rows))
    return "\n\n".join(parts) + "\n"


def main() -> None:
    artifact = json.loads((ROOT / "artifact.json").read_text(encoding="utf-8"))
    (ROOT / "report.md").write_text(render(artifact), encoding="utf-8")


if __name__ == "__main__":
    main()
