import argparse
import logging
import os
import sys

from crate.config import load_config
from crate.scanner import LibraryScanner
from crate.fixer import LibraryFixer
from crate.daemon import run_daemon
from crate.report import print_report, save_report


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return max(1, int(raw))
    except ValueError:
        return default


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    parser = argparse.ArgumentParser(description="Crate Librarian")
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

    worker_cmd = sub.add_parser("worker", help="Run Dramatiq workers + scheduler/watcher")
    worker_cmd.add_argument("--processes", type=int, default=_env_int("CRATE_WORKER_PROCESSES", 2), help="Number of Dramatiq worker processes")
    worker_cmd.add_argument(
        "--queues",
        default=os.environ.get("CRATE_WORKER_QUEUES", "fast,heavy,default"),
        help="Comma-separated Dramatiq queues to consume",
    )
    worker_cmd.add_argument("--no-service-loop", action="store_true", help="Disable scheduler/watcher/zombie cleanup loop")
    worker_cmd.add_argument("--no-daemons", action="store_true", help="Disable analysis/bliss background daemons")
    worker_cmd.add_argument("--no-projector", action="store_true", help="Disable snapshot projector loop")
    worker_cmd.add_argument("--no-telegram", action="store_true", help="Disable Telegram bot loop")
    worker_cmd.add_argument("--legacy", action="store_true", help="Use legacy orchestrator (pre-Dramatiq)")

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
        uvicorn.run(
            "crate.api:create_app",
            factory=True,
            host=args.host,
            port=args.port,
            log_level="info",
            workers=_env_int("CRATE_API_WORKERS", 1),
        )

    elif args.command == "worker":
        if args.legacy:
            from crate.orchestrator import Orchestrator
            orch = Orchestrator(config)
            orch.run()
        else:
            config["worker_processes"] = args.processes
            config["worker_queues"] = args.queues
            config["worker_service_loop"] = not args.no_service_loop
            config["worker_analysis_daemons"] = not args.no_daemons
            config["worker_projector"] = not args.no_projector
            config["worker_telegram"] = not args.no_telegram
            from crate.worker import run_worker
            run_worker(config)


if __name__ == "__main__":
    main()
