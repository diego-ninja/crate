import argparse
import logging
import sys

from musicdock.config import load_config
from musicdock.scanner import LibraryScanner
from musicdock.fixer import LibraryFixer
from musicdock.daemon import run_daemon
from musicdock.report import print_report, save_report


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    parser = argparse.ArgumentParser(description="MusicDock Librarian")
    sub = parser.add_subparsers(dest="command")

    scan_cmd = sub.add_parser("scan", help="Scan library for issues")
    scan_cmd.add_argument("--only", help="Run specific scanner", choices=[
        "nested", "duplicates", "incomplete", "mergeable", "naming"
    ])

    fix_cmd = sub.add_parser("fix", help="Fix issues found in scan")
    fix_cmd.add_argument("--dry-run", action="store_true", default=True,
                         help="Show what would be done (default)")
    fix_cmd.add_argument("--apply", action="store_true",
                         help="Actually apply fixes")
    fix_cmd.add_argument("--only", help="Fix specific issue type", choices=[
        "nested", "duplicates", "incomplete", "mergeable", "naming"
    ])

    sub.add_parser("daemon", help="Run as daemon (watchdog + scheduled scans)")
    sub.add_parser("report", help="Generate library health report")

    web_cmd = sub.add_parser("web", help="Run web interface (FastAPI + Uvicorn)")
    web_cmd.add_argument("--port", type=int, default=8585)
    web_cmd.add_argument("--host", default="0.0.0.0")

    api_cmd = sub.add_parser("api", help="Run API server only (no templates)")
    api_cmd.add_argument("--port", type=int, default=8585)
    api_cmd.add_argument("--host", default="0.0.0.0")

    worker_cmd = sub.add_parser("worker", help="Run background task worker")

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)

    config = load_config()

    if args.command == "scan":
        scanner = LibraryScanner(config)
        issues = scanner.scan(only=args.only)
        print_report(issues)
        save_report(issues, config)

    elif args.command == "fix":
        scanner = LibraryScanner(config)
        issues = scanner.scan(only=args.only)
        fixer = LibraryFixer(config)
        dry_run = not args.apply
        fixer.fix(issues, dry_run=dry_run)

    elif args.command == "daemon":
        run_daemon(config)

    elif args.command == "report":
        scanner = LibraryScanner(config)
        issues = scanner.scan()
        print_report(issues)
        save_report(issues, config)

    elif args.command in ("web", "api"):
        import uvicorn
        from musicdock.api import create_app
        app = create_app()
        uvicorn.run(app, host=args.host, port=args.port, log_level="info")

    elif args.command == "worker":
        from musicdock.worker import run_worker
        run_worker(config)


if __name__ == "__main__":
    main()
