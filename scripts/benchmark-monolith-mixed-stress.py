#!/usr/bin/env python3
"""Run mixed monolith stress checks as one regression artifact.

This wrapper composes the existing live observer sync benchmark, read-only
JSON-RPC/process benchmark, and low-value transaction submission benchmark.
It intentionally avoids reimplementing those checks; the value here is running
them together and producing a single pass/warn/fail summary for release gates.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_REPORT_ROOT = Path("/private/tmp/teleno-monolith-mixed-stress")
DEFAULT_LOCAL_RPC = "http://127.0.0.1:18122/"
DEFAULT_PUBLIC_RPC = "https://testnet.koinosfoundation.org/jsonrpc"
DEFAULT_PID_FILE = Path("/Users/pgarcgo/.kcli/teleno-testnet-producer/live-testnet-sync.pid")
DEFAULT_SYNC_SOURCE_BASEDIR = Path("/Volumes/external/teleno-testnet-producer/basedir")
DEFAULT_PRODUCER = "1Kjfrv3qxWvb3afwUdFevZHS1WdT4ginPi"
DEFAULT_RECIPIENT = "1FFpnG9ev9ZsZ91uDWF19ro7zaKodcBtzX"
DEFAULT_PASSWORD_FILE = Path.home() / ".kcli/teleno-testnet-producer/producer-control-wallet/wallet-password.txt"
DEFAULT_WALLET_FILE = Path.home() / ".kcli/wallet.json"
DEFAULT_PUBLIC_TESTNET_PEER = (
    "/dns4/testnet.koinosfoundation.org/tcp/8888/p2p/"
    "QmYV414G6xRzkSUytntEsBsCSjXrVGubfYJn4vpeER2s2W"
)

SENSITIVE_REPLACEMENTS = [
    (re.compile(r"\b[5KL][1-9A-HJ-NP-Za-km-z]{50,52}\b"), "[REDACTED_WIF]"),
    (re.compile(r"\b\d{7,12}:[A-Za-z0-9_-]{25,}\b"), "[REDACTED_TELEGRAM_TOKEN]"),
    (
        re.compile(r"(?i)((?:api|bot|telegram)[_ -]?token|password|secret|private[_ -]?key)\s*[:=]\s*\S+"),
        r"\1=[REDACTED]",
    ),
]


@dataclass
class ChildRun:
    name: str
    command: list[str]
    result_dir: Path
    log_path: Path
    process: subprocess.Popen[bytes] | None = None
    started_at: str = ""
    finished_at: str = ""
    elapsed_seconds: float = 0.0
    returncode: int | None = None
    timed_out: bool = False
    result: dict[str, Any] | None = None
    status: str = "unknown"


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def safe_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def redact(text: str) -> str:
    result = text
    for pattern, replacement in SENSITIVE_REPLACEMENTS:
        result = pattern.sub(replacement, result)
    return result


def normalize_rpc_url(url: str) -> str:
    if url.startswith("http://") or url.startswith("https://"):
        return url
    return f"http://{url}/"


def read_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def log_tail(path: Path, max_lines: int = 40) -> list[str]:
    try:
        lines = path.read_text(errors="replace").splitlines()
    except OSError:
        return []
    return [redact(line) for line in lines[-max_lines:]]


def git_value(args: list[str]) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT_DIR, text=True, capture_output=True, check=False)
    if result.returncode != 0:
        return ""
    return result.stdout.strip().splitlines()[0] if result.stdout.strip() else ""


def make_child_runs(args: argparse.Namespace, report_dir: Path) -> list[ChildRun]:
    runs: list[ChildRun] = []

    if not args.skip_sync:
        sync_dir = report_dir / "sync"
        runs.append(
            ChildRun(
                name="sync",
                result_dir=sync_dir,
                log_path=report_dir / "sync.child.log",
                command=[
                    sys.executable,
                    str(ROOT_DIR / "scripts/benchmark-monolith-sync.py"),
                    "--duration-seconds",
                    str(args.duration_seconds),
                    "--sample-interval-seconds",
                    str(args.sample_interval_seconds),
                    "--startup-timeout-seconds",
                    str(args.sync_startup_timeout_seconds),
                    "--jsonrpc-port",
                    str(args.sync_jsonrpc_port),
                    "--source-basedir",
                    str(args.sync_source_basedir),
                    "--peer",
                    args.sync_peer,
                    "--report-dir",
                    str(sync_dir),
                ],
            )
        )

    if not args.skip_rpc:
        rpc_dir = report_dir / "rpc"
        rpc_cmd = [
            sys.executable,
            str(ROOT_DIR / "scripts/benchmark-monolith.py"),
            "--rpc-url",
            normalize_rpc_url(args.local_rpc),
            "--pid-file",
            str(args.pid_file),
            "--duration-seconds",
            str(args.duration_seconds),
            "--interval-seconds",
            str(args.rpc_interval_seconds),
            "--latency-requests",
            str(args.latency_requests),
            "--warmup-requests",
            str(args.warmup_requests),
            "--result-dir",
            str(rpc_dir),
        ]
        for method in args.rpc_method:
            rpc_cmd.extend(["--method", method])
        runs.append(ChildRun(name="rpc", command=rpc_cmd, result_dir=rpc_dir, log_path=report_dir / "rpc.child.log"))

    if not args.skip_submit:
        submit_dir = report_dir / "submit"
        submit_cmd = [
            "node",
            str(ROOT_DIR / "scripts/benchmark-transaction-submission.js"),
            "--local-rpc",
            normalize_rpc_url(args.local_rpc),
            "--public-rpc",
            args.public_rpc,
            "--wallet-file",
            str(args.wallet_file),
            "--password-file",
            str(args.password_file),
            "--kcli-bin",
            args.kcli_bin,
            "--producer-address",
            args.producer_address,
            "--recipient-address",
            args.recipient_address,
            "--amount",
            args.amount,
            "--tx-count",
            str(args.tx_count),
            "--max-total-koin",
            args.max_total_koin,
            "--confirm-timeout-ms",
            str(args.confirm_timeout_ms),
            "--poll-interval-ms",
            str(args.poll_interval_ms),
            "--head-convergence-retries",
            str(args.head_convergence_retries),
            "--head-convergence-delay-ms",
            str(args.head_convergence_delay_ms),
            "--result-dir",
            str(submit_dir),
            "--submit" if args.submit_transfers else "--dry-run",
        ]
        runs.append(ChildRun(name="submit", command=submit_cmd, result_dir=submit_dir, log_path=report_dir / "submit.child.log"))

    return runs


def start_child(child: ChildRun) -> None:
    child.result_dir.mkdir(parents=True, exist_ok=True)
    child.started_at = utc_now()
    started = time.perf_counter()
    log_handle = child.log_path.open("ab", buffering=0)
    try:
        child.process = subprocess.Popen(child.command, cwd=ROOT_DIR, stdout=log_handle, stderr=subprocess.STDOUT)
    finally:
        log_handle.close()
    child.elapsed_seconds = started


def terminate_child(child: ChildRun) -> None:
    if child.process is None or child.process.poll() is not None:
        return
    child.process.send_signal(signal.SIGTERM)
    try:
        child.process.wait(timeout=20)
    except subprocess.TimeoutExpired:
        child.process.kill()
        child.process.wait(timeout=20)


def wait_child(child: ChildRun, timeout_seconds: float) -> None:
    if child.process is None:
        return
    started = child.elapsed_seconds
    try:
        child.returncode = child.process.wait(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        child.timed_out = True
        terminate_child(child)
        child.returncode = child.process.returncode
    child.finished_at = utc_now()
    child.elapsed_seconds = round(time.perf_counter() - started, 3)
    child.result = read_json(child.result_dir / "result.json")
    child.status = str(child.result.get("status")) if child.result else "missing-result"
    if child.timed_out:
        child.status = "timeout"


def wait_for_children(children: list[ChildRun], timeout_seconds: float) -> None:
    deadline = time.time() + timeout_seconds
    for child in children:
        remaining = max(deadline - time.time(), 1.0)
        wait_child(child, remaining)
    for child in children:
        terminate_child(child)


def child_summary(child: ChildRun) -> dict[str, Any]:
    result_json = child.result_dir / "result.json"
    result_md = child.result_dir / "result.md"
    return {
        "name": child.name,
        "status": child.status,
        "returncode": child.returncode,
        "timed_out": child.timed_out,
        "started_at": child.started_at,
        "finished_at": child.finished_at,
        "elapsed_seconds": child.elapsed_seconds,
        "command": [redact(part) for part in child.command],
        "result_dir": str(child.result_dir),
        "result_json": str(result_json) if result_json.exists() else "",
        "result_md": str(result_md) if result_md.exists() else "",
        "child_log": str(child.log_path),
        "child_log_tail": log_tail(child.log_path),
        "highlights": child_highlights(child),
    }


def child_highlights(child: ChildRun) -> dict[str, Any]:
    result = child.result or {}
    if child.name == "sync":
        local = result.get("local_head_progress", {})
        rows = result.get("log_summary", {}).get("rows", {}) if isinstance(result.get("log_summary"), dict) else {}
        return {
            "height_delta": local.get("height_delta"),
            "average_blocks_per_second": local.get("average_blocks_per_second"),
            "last_height": local.get("last_height"),
            "log_rows": rows,
        }
    if child.name == "rpc":
        rpc = result.get("rpc", {})
        return {
            "head_progress": result.get("head_progress"),
            "process": result.get("process"),
            "rpc": {method: data.get("latency_ms", {}) for method, data in rpc.items() if isinstance(data, dict)},
        }
    if child.name == "submit":
        return {
            "submitted": result.get("submitted"),
            "tx_count": result.get("tx_count"),
            "amount_koin": result.get("amount_koin"),
            "total_koin": result.get("total_koin"),
            "included_block_counts": result.get("included_block_counts"),
            "missing_transactions": len(result.get("inclusion", {}).get("missing", []))
            if isinstance(result.get("inclusion"), dict)
            else None,
            "transaction_latency_ms": result.get("transaction_latency_ms"),
        }
    return {}


def build_summary(args: argparse.Namespace, report_dir: Path, children: list[ChildRun], started_at: str) -> dict[str, Any]:
    failed = [
        child.name
        for child in children
        if child.returncode not in (0, None) or child.status in {"fail", "timeout", "missing-result"}
    ]
    warned = [child.name for child in children if child.status == "warn"]
    status = "pass"
    if failed:
        status = "fail"
    elif warned:
        status = "warn"

    return {
        "kind": "teleno-monolith-mixed-stress",
        "status": status,
        "started_at": started_at,
        "finished_at": utc_now(),
        "repo_root": str(ROOT_DIR),
        "git_branch": git_value(["branch", "--show-current"]),
        "git_commit": git_value(["rev-parse", "--short", "HEAD"]),
        "report_dir": str(report_dir),
        "local_rpc": normalize_rpc_url(args.local_rpc),
        "public_rpc": args.public_rpc,
        "duration_seconds": args.duration_seconds,
        "sample_interval_seconds": args.sample_interval_seconds,
        "submit_transfers": args.submit_transfers,
        "tx_count": args.tx_count if not args.skip_submit else 0,
        "amount_koin": args.amount if not args.skip_submit else "",
        "failed_children": failed,
        "warned_children": warned,
        "children": [child_summary(child) for child in children],
    }


def write_outputs(summary: dict[str, Any], report_dir: Path) -> None:
    json_path = report_dir / "summary.json"
    md_path = report_dir / "summary.md"
    summary["summary_json"] = str(json_path)
    summary["summary_md"] = str(md_path)
    json_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")

    lines = [
        "# Monolith Mixed Stress Benchmark",
        "",
        f"- Status: `{summary['status']}`",
        f"- Started: `{summary['started_at']}`",
        f"- Finished: `{summary['finished_at']}`",
        f"- Git commit: `{summary['git_commit']}`",
        f"- Local RPC: `{summary['local_rpc']}`",
        f"- Public RPC: `{summary['public_rpc']}`",
        f"- Duration seconds: `{summary['duration_seconds']}`",
        f"- Submit transfers: `{summary['submit_transfers']}`",
        f"- Report directory: `{summary['report_dir']}`",
        "",
        "## Child Checks",
        "",
        "| Check | Status | Return code | Highlights | Report |",
        "|---|---|---:|---|---|",
    ]
    for child in summary["children"]:
        highlights = json.dumps(child.get("highlights", {}), sort_keys=True)
        report = child.get("result_md") or child.get("result_json") or child.get("child_log")
        lines.append(
            f"| {child['name']} | `{child['status']}` | `{child['returncode']}` | `{highlights}` | `{report}` |"
        )
    lines.extend(["", f"JSON summary: `{json_path}`", ""])
    md_path.write_text("\n".join(lines))
    json_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report-dir", type=Path, default=None)
    parser.add_argument("--duration-seconds", type=float, default=float(os.getenv("MIXED_DURATION_SECONDS", "300")))
    parser.add_argument("--sample-interval-seconds", type=float, default=float(os.getenv("MIXED_SAMPLE_INTERVAL_SECONDS", "5")))
    parser.add_argument("--child-timeout-extra-seconds", type=float, default=180)
    parser.add_argument("--local-rpc", default=os.getenv("LOCAL_RPC", DEFAULT_LOCAL_RPC))
    parser.add_argument("--public-rpc", default=os.getenv("PUBLIC_RPC", DEFAULT_PUBLIC_RPC))
    parser.add_argument("--pid-file", type=Path, default=Path(os.getenv("PID_FILE", str(DEFAULT_PID_FILE))))

    parser.add_argument("--skip-sync", action="store_true")
    parser.add_argument("--sync-jsonrpc-port", type=int, default=int(os.getenv("MIXED_SYNC_JSONRPC_PORT", "28600")))
    parser.add_argument("--sync-startup-timeout-seconds", type=float, default=60)
    parser.add_argument("--sync-source-basedir", type=Path, default=DEFAULT_SYNC_SOURCE_BASEDIR)
    parser.add_argument("--sync-peer", default=os.getenv("SYNC_P2P_PEER", DEFAULT_PUBLIC_TESTNET_PEER))

    parser.add_argument("--skip-rpc", action="store_true")
    parser.add_argument("--rpc-interval-seconds", type=float, default=1)
    parser.add_argument("--latency-requests", type=int, default=300)
    parser.add_argument("--warmup-requests", type=int, default=10)
    parser.add_argument(
        "--rpc-method",
        action="append",
        default=["chain.get_head_info", "block_store.get_highest_block", "mempool.get_pending_transactions"],
    )

    parser.add_argument("--skip-submit", action="store_true")
    parser.add_argument("--submit-transfers", action="store_true")
    parser.add_argument("--tx-count", type=int, default=5)
    parser.add_argument("--amount", default="0.001")
    parser.add_argument("--max-total-koin", default="0.02")
    parser.add_argument("--confirm-timeout-ms", type=int, default=180000)
    parser.add_argument("--poll-interval-ms", type=int, default=1000)
    parser.add_argument("--head-convergence-retries", type=int, default=20)
    parser.add_argument("--head-convergence-delay-ms", type=int, default=1000)
    parser.add_argument("--wallet-file", type=Path, default=Path(os.getenv("KCLI_WALLET_FILE", str(DEFAULT_WALLET_FILE))))
    parser.add_argument(
        "--password-file",
        type=Path,
        default=Path(os.getenv("KCLI_PASSWORD_FILE", str(DEFAULT_PASSWORD_FILE))),
    )
    parser.add_argument("--kcli-bin", default=os.getenv("KCLI_BIN", "kcli"))
    parser.add_argument("--producer-address", default=os.getenv("PRODUCER_ADDRESS", DEFAULT_PRODUCER))
    parser.add_argument("--recipient-address", default=os.getenv("RECIPIENT_ADDRESS", DEFAULT_RECIPIENT))

    args = parser.parse_args(argv)
    if args.duration_seconds <= 0:
        parser.error("--duration-seconds must be positive")
    if args.sample_interval_seconds <= 0:
        parser.error("--sample-interval-seconds must be positive")
    if args.child_timeout_extra_seconds <= 0:
        parser.error("--child-timeout-extra-seconds must be positive")
    if not (args.skip_sync or args.skip_rpc or args.skip_submit):
        pass
    elif args.skip_sync and args.skip_rpc and args.skip_submit:
        parser.error("at least one child check must be enabled")
    if args.tx_count <= 0:
        parser.error("--tx-count must be positive")
    if args.latency_requests <= 0:
        parser.error("--latency-requests must be positive")
    if args.warmup_requests < 0:
        parser.error("--warmup-requests must be non-negative")
    if args.report_dir is None:
        args.report_dir = DEFAULT_REPORT_ROOT / safe_timestamp()
    return args


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    report_dir = args.report_dir
    report_dir.mkdir(parents=True, exist_ok=True)
    started_at = utc_now()
    children = make_child_runs(args, report_dir)

    for child in children:
        start_child(child)

    timeout_seconds = (
        args.duration_seconds
        + args.child_timeout_extra_seconds
        + (args.confirm_timeout_ms / 1000.0 if not args.skip_submit else 0.0)
    )
    wait_for_children(children, timeout_seconds)

    summary = build_summary(args, report_dir, children, started_at)
    write_outputs(summary, report_dir)
    print(
        json.dumps(
            {
                "status": summary["status"],
                "summary_json": summary["summary_json"],
                "summary_md": summary["summary_md"],
                "failed_children": summary["failed_children"],
                "warned_children": summary["warned_children"],
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0 if summary["status"] in {"pass", "warn"} else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
