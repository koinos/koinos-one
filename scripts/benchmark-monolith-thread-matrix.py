#!/usr/bin/env python3
"""Run a small thread-pool tuning matrix for monolith live sync.

Each matrix row delegates to benchmark-monolith-sync.py with a temporary
observer basedir. The default variants intentionally keep cpp-libp2p on one
effective IO runner and vary JSON-RPC session capacity plus RocksDB background
jobs around that constraint.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]
SYNC_BENCH = ROOT_DIR / "scripts/benchmark-monolith-sync.py"
DEFAULT_REPORT_ROOT = Path("/private/tmp/knodel-monolith-thread-matrix")

DEFAULT_VARIANTS: dict[str, dict[str, int]] = {
    "baseline": {
        "chain_jobs": 2,
        "jsonrpc_jobs": 4,
        "grpc_jobs": 2,
        "p2p_jobs": 4,
        "rocksdb_max_background_jobs": 4,
    },
    "bounded": {
        "chain_jobs": 2,
        "jsonrpc_jobs": 2,
        "grpc_jobs": 1,
        "p2p_jobs": 1,
        "rocksdb_max_background_jobs": 2,
    },
    "db-heavy": {
        "chain_jobs": 2,
        "jsonrpc_jobs": 2,
        "grpc_jobs": 1,
        "p2p_jobs": 1,
        "rocksdb_max_background_jobs": 6,
    },
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def safe_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def parse_variant(value: str) -> tuple[str, dict[str, int]]:
    if ":" not in value:
        if value not in DEFAULT_VARIANTS:
            known = ", ".join(sorted(DEFAULT_VARIANTS))
            raise argparse.ArgumentTypeError(f"unknown variant {value!r}; known variants: {known}")
        return value, dict(DEFAULT_VARIANTS[value])

    name, raw_settings = value.split(":", 1)
    if not name:
        raise argparse.ArgumentTypeError("variant name cannot be empty")

    settings: dict[str, int] = {
        "chain_jobs": 2,
        "jsonrpc_jobs": 2,
        "grpc_jobs": 1,
        "p2p_jobs": 1,
        "rocksdb_max_background_jobs": 4,
    }
    key_map = {
        "chain": "chain_jobs",
        "chain_jobs": "chain_jobs",
        "jsonrpc": "jsonrpc_jobs",
        "jsonrpc_jobs": "jsonrpc_jobs",
        "grpc": "grpc_jobs",
        "grpc_jobs": "grpc_jobs",
        "p2p": "p2p_jobs",
        "p2p_jobs": "p2p_jobs",
        "rocksdb": "rocksdb_max_background_jobs",
        "rocksdb_jobs": "rocksdb_max_background_jobs",
        "rocksdb_max_background_jobs": "rocksdb_max_background_jobs",
    }
    for part in raw_settings.split(","):
        if not part:
            continue
        if "=" not in part:
            raise argparse.ArgumentTypeError(f"invalid variant setting {part!r}; expected key=value")
        key, raw_value = part.split("=", 1)
        mapped = key_map.get(key.strip())
        if not mapped:
            raise argparse.ArgumentTypeError(f"unknown variant setting {key!r}")
        try:
            number = int(raw_value)
        except ValueError as exc:
            raise argparse.ArgumentTypeError(f"invalid integer for {key!r}: {raw_value!r}") from exc
        if number <= 0:
            raise argparse.ArgumentTypeError(f"{key!r} must be positive")
        settings[mapped] = number
    return name, settings


def extract_summary(result: dict[str, Any]) -> dict[str, Any]:
    progress = result.get("local_head_progress", {})
    process = result.get("process_summary", {})
    log_rows = result.get("log_summary", {}).get("rows", {})
    return {
        "status": result.get("status"),
        "height_delta": progress.get("height_delta"),
        "average_blocks_per_second": progress.get("average_blocks_per_second"),
        "window_p95_blocks_per_second": progress.get("window_blocks_per_second", {}).get("p95"),
        "cpu_p95_percent": process.get("cpu_percent", {}).get("p95"),
        "rss_p95_mb": process.get("rss_mb", {}).get("p95"),
        "warnings": log_rows.get("warning"),
        "score_threshold": log_rows.get("score_threshold"),
        "checkpoint_mismatch": log_rows.get("checkpoint_mismatch"),
        "block_application_failed": log_rows.get("block_application_failed"),
        "runtime_topology": result.get("log_summary", {}).get("runtime_topology"),
        "rocksdb_tuning": result.get("log_summary", {}).get("rocksdb_tuning"),
    }


def write_outputs(summary: dict[str, Any], report_dir: Path) -> None:
    json_path = report_dir / "summary.json"
    md_path = report_dir / "summary.md"
    json_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")

    lines = [
        "# Monolith Thread Matrix Benchmark",
        "",
        f"- Status: `{summary['status']}`",
        f"- Started: `{summary['started_at']}`",
        f"- Finished: `{summary['finished_at']}`",
        f"- Duration per variant: `{summary['duration_seconds']} s`",
        "",
        "| Variant | Status | Height delta | Avg blocks/s | Window p95 blocks/s | CPU p95 % | RSS p95 MB | Warnings | Severe rows |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in summary["variants"]:
        result = row["result_summary"]
        severe_rows = sum(
            int(result.get(key) or 0)
            for key in ("score_threshold", "checkpoint_mismatch", "block_application_failed")
        )
        lines.append(
            "| {name} | {status} | {height} | {avg} | {p95} | {cpu} | {rss} | {warnings} | {severe} |".format(
                name=row["name"],
                status=result.get("status"),
                height=result.get("height_delta"),
                avg=result.get("average_blocks_per_second"),
                p95=result.get("window_p95_blocks_per_second"),
                cpu=result.get("cpu_p95_percent"),
                rss=result.get("rss_p95_mb"),
                warnings=result.get("warnings"),
                severe=severe_rows,
            )
        )
    lines.extend(["", "## Evidence", ""])
    for row in summary["variants"]:
        lines.append(f"- `{row['name']}`: `{row.get('result_json')}`")
    lines.extend(["", f"- JSON: `{json_path}`", ""])
    md_path.write_text("\n".join(lines))

    summary["summary_json"] = str(json_path)
    summary["summary_md"] = str(md_path)
    json_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report-dir", type=Path, default=DEFAULT_REPORT_ROOT / safe_timestamp())
    parser.add_argument("--duration-seconds", type=float, default=30.0)
    parser.add_argument("--sample-interval-seconds", type=float, default=5.0)
    parser.add_argument("--jsonrpc-port-base", type=int, default=28300)
    parser.add_argument("--variant", action="append", type=parse_variant)
    parser.add_argument("--bin", type=Path)
    parser.add_argument("--source-basedir", type=Path)
    parser.add_argument("--peer")
    parser.add_argument("--remote-rpc-url")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    variants = args.variant or [(name, dict(settings)) for name, settings in DEFAULT_VARIANTS.items()]
    args.report_dir.mkdir(parents=True, exist_ok=True)
    started_at = utc_now()
    rows: list[dict[str, Any]] = []

    for index, (name, settings) in enumerate(variants):
        variant_dir = args.report_dir / name
        command = [
            sys.executable,
            str(SYNC_BENCH),
            "--report-dir",
            str(variant_dir),
            "--jsonrpc-port",
            str(args.jsonrpc_port_base + index),
            "--duration-seconds",
            str(args.duration_seconds),
            "--sample-interval-seconds",
            str(args.sample_interval_seconds),
            "--chain-jobs",
            str(settings["chain_jobs"]),
            "--jsonrpc-jobs",
            str(settings["jsonrpc_jobs"]),
            "--grpc-jobs",
            str(settings["grpc_jobs"]),
            "--p2p-jobs",
            str(settings["p2p_jobs"]),
            "--rocksdb-max-background-jobs",
            str(settings["rocksdb_max_background_jobs"]),
        ]
        if args.bin:
            command.extend(["--bin", str(args.bin)])
        if args.source_basedir:
            command.extend(["--source-basedir", str(args.source_basedir)])
        if args.peer:
            command.extend(["--peer", args.peer])
        if args.remote_rpc_url:
            command.extend(["--remote-rpc-url", args.remote_rpc_url])

        completed = subprocess.run(command, text=True, capture_output=True, check=False)
        result_json = variant_dir / "result.json"
        result: dict[str, Any] = {}
        if result_json.exists():
            result = json.loads(result_json.read_text())

        rows.append(
            {
                "name": name,
                "settings": settings,
                "command": command,
                "returncode": completed.returncode,
                "stdout": completed.stdout.strip(),
                "stderr": completed.stderr.strip(),
                "result_json": str(result_json) if result_json.exists() else None,
                "result_md": str(variant_dir / "result.md") if (variant_dir / "result.md").exists() else None,
                "result_summary": extract_summary(result) if result else {"status": "missing_result"},
            }
        )

    status = "pass"
    if any(row["returncode"] != 0 or row["result_summary"].get("status") == "fail" for row in rows):
        status = "fail"
    elif any(row["result_summary"].get("status") == "warn" for row in rows):
        status = "warn"

    summary = {
        "kind": "knodel-monolith-thread-matrix-benchmark",
        "status": status,
        "started_at": started_at,
        "finished_at": utc_now(),
        "repo_root": str(ROOT_DIR),
        "duration_seconds": args.duration_seconds,
        "sample_interval_seconds": args.sample_interval_seconds,
        "report_dir": str(args.report_dir),
        "variants": rows,
    }
    write_outputs(summary, args.report_dir)
    print(
        json.dumps(
            {
                "status": status,
                "summary_json": summary["summary_json"],
                "summary_md": summary["summary_md"],
                "variants": [
                    {
                        "name": row["name"],
                        "status": row["result_summary"].get("status"),
                        "average_blocks_per_second": row["result_summary"].get("average_blocks_per_second"),
                        "cpu_p95_percent": row["result_summary"].get("cpu_p95_percent"),
                    }
                    for row in rows
                ],
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0 if status in {"pass", "warn"} else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
