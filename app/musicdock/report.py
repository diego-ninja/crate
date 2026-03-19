import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from rich.console import Console
from rich.table import Table

from musicdock.models import Issue, IssueType, Severity

log = logging.getLogger(__name__)
console = Console()

SEVERITY_COLORS = {
    Severity.CRITICAL: "bold red",
    Severity.HIGH: "red",
    Severity.MEDIUM: "yellow",
    Severity.LOW: "dim",
}

TYPE_LABELS = {
    IssueType.NESTED_LIBRARY: "Nested Library",
    IssueType.DUPLICATE_ALBUM: "Duplicate",
    IssueType.INCOMPLETE_ALBUM: "Incomplete",
    IssueType.MERGEABLE_ALBUM: "Mergeable",
    IssueType.BAD_NAMING: "Naming",
}


def print_report(issues: list[Issue]):
    if not issues:
        console.print("[bold green]No issues found![/bold green]")
        return

    # Summary
    console.print(f"\n[bold]Library Health Report[/bold] — {len(issues)} issues found\n")

    by_type = {}
    for issue in issues:
        by_type.setdefault(issue.type, []).append(issue)

    summary = Table(title="Summary")
    summary.add_column("Type", style="cyan")
    summary.add_column("Count", justify="right")
    for t, items in by_type.items():
        summary.add_row(TYPE_LABELS.get(t, t.value), str(len(items)))
    console.print(summary)

    # Details
    for issue_type, items in by_type.items():
        console.print(f"\n[bold cyan]── {TYPE_LABELS.get(issue_type, issue_type.value)} ──[/bold cyan]")

        table = Table(show_header=True, show_lines=True, expand=True)
        table.add_column("Sev", width=4)
        table.add_column("Conf", width=4, justify="right")
        table.add_column("Description")
        table.add_column("Suggestion")

        for item in sorted(items, key=lambda x: (-x.confidence, x.description)):
            sev_style = SEVERITY_COLORS.get(item.severity, "")
            table.add_row(
                f"[{sev_style}]{item.severity.value[:4]}[/{sev_style}]",
                f"{item.confidence}%",
                item.description,
                item.suggestion,
            )

        console.print(table)


def save_report(issues: list[Issue], config: dict):
    output_dir = Path(config.get("reports", {}).get("output_dir", "/data/reports"))
    output_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    report_path = output_dir / f"report_{timestamp}.json"

    data = {
        "timestamp": timestamp,
        "total_issues": len(issues),
        "issues": [
            {
                "type": i.type.value,
                "severity": i.severity.value,
                "confidence": i.confidence,
                "description": i.description,
                "suggestion": i.suggestion,
                "paths": [str(p) for p in i.paths],
                "details": i.details,
            }
            for i in issues
        ],
    }

    report_path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    log.info("Report saved to %s", report_path)

    # Keep only last 10 reports
    reports = sorted(output_dir.glob("report_*.json"), reverse=True)
    for old in reports[10:]:
        old.unlink()
