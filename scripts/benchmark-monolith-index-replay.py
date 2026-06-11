#!/usr/bin/env python3
"""Benchmark monolith chain replay/indexing from a local block-store subset.

The live P2P sync benchmark measures peer/network constrained catch-up. This
benchmark prepares a bounded block_store-only dataset from an existing restored
monolith basedir, then starts a fresh node and times the chain indexer replay
path over that dataset. The source basedir is opened read-only by behavior: this
script only queries it through JSON-RPC and writes into a temporary target
basedir.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import request
from urllib.error import HTTPError, URLError


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_BIN = ROOT_DIR / "node/teleno-node/build/koinos_node"
DEFAULT_SOURCE_BASEDIR = Path("/Volumes/external/teleno-monolith-restore/basedir")
DEFAULT_REPORT_ROOT = Path("/Volumes/external/teleno-monolith-index-replay-benchmark")

INDEX_DONE_RE = re.compile(r"Finished indexing\s+(\d+)\s+blocks,\s+took\s+([0-9.eE+-]+)\s+seconds")
INDEX_TARGET_RE = re.compile(r"Indexing to target block - Height:\s+(\d+)")
WARNING_RE = re.compile(r"<warning|\bwarning\b", re.IGNORECASE)
ERROR_RE = re.compile(r"<error|\berror\b", re.IGNORECASE)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def safe_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def normalize_rpc_url(url: str) -> str:
    if url.startswith("http://") or url.startswith("https://"):
        return url
    return f"http://{url}/"


def rpc_call(url: str, method: str, params: dict[str, Any] | None = None, timeout: float = 15) -> dict[str, Any]:
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}).encode()
    req = request.Request(
        normalize_rpc_url(url),
        data=payload,
        headers={"content-type": "application/json", "user-agent": "teleno-index-replay-benchmark/1.0"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=timeout) as response:
            parsed = json.loads(response.read().decode())
    except HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"{method} HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"{method} failed: {exc.reason}") from exc
    if "error" in parsed:
        raise RuntimeError(f"{method} error: {json.dumps(parsed['error'], sort_keys=True)}")
    if "result" not in parsed:
        raise RuntimeError(f"{method} missing result: {json.dumps(parsed, sort_keys=True)}")
    return parsed["result"]


def extract_height(topology: dict[str, Any]) -> int:
    value = topology.get("height")
    if value is None:
        return 0
    return int(value)


def port_is_free(port: int) -> bool:
    result = subprocess.run(
        ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN"],
        text=True,
        capture_output=True,
        check=False,
    )
    return result.returncode != 0


def process_exists(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def terminate_process(proc: subprocess.Popen[bytes], timeout: int = 20) -> None:
    if proc.poll() is not None:
        return
    proc.send_signal(signal.SIGTERM)
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=timeout)


def sample_process(pid: int) -> dict[str, Any]:
    result = subprocess.run(
        ["ps", "-o", "rss=", "-o", "pcpu=", "-p", str(pid)],
        text=True,
        capture_output=True,
        check=False,
    )
    parts = result.stdout.split()
    if result.returncode != 0 or len(parts) < 2:
        return {"ok": False, "error": (result.stderr or result.stdout).strip()}
    try:
        return {"ok": True, "rss_mb": round(int(float(parts[0])) / 1024, 3), "cpu_percent": round(float(parts[1]), 3)}
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}


def summarize(values: list[float]) -> dict[str, Any]:
    if not values:
        return {"count": 0}
    ordered = sorted(values)

    def pct(percent: float) -> float:
        if len(ordered) == 1:
            return ordered[0]
        rank = (len(ordered) - 1) * percent / 100.0
        lower = int(rank)
        upper = min(lower + 1, len(ordered) - 1)
        weight = rank - lower
        return ordered[lower] * (1 - weight) + ordered[upper] * weight

    return {
        "count": len(values),
        "min": round(min(values), 3),
        "mean": round(sum(values) / len(values), 3),
        "p50": round(pct(50), 3),
        "p95": round(pct(95), 3),
        "p99": round(pct(99), 3),
        "max": round(max(values), 3),
    }


def dir_size_bytes(path: Path) -> int:
    if not path.exists():
        return 0
    result = subprocess.run(["du", "-sk", str(path)], text=True, capture_output=True, check=False)
    if result.returncode != 0:
        return 0
    return int(result.stdout.split()[0]) * 1024


def git_value(args: list[str]) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT_DIR, text=True, capture_output=True, check=False)
    if result.returncode != 0:
        return ""
    return result.stdout.strip().splitlines()[0] if result.stdout.strip() else ""


def write_config(basedir: Path, jsonrpc_port: int, chain_jobs: int, rocksdb_jobs: int) -> Path:
    path = basedir / "config.yml"
    path.write_text(
        "\n".join(
            [
                "global:",
                "  instance-id: index-replay-benchmark",
                "  log-level: info",
                "  log-color: false",
                "  log-datetime: true",
                "  fork-algorithm: pob",
                "chain:",
                f"  jobs: {chain_jobs}",
                "  verify-blocks: false",
                "jsonrpc:",
                f"  listen: 127.0.0.1:{jsonrpc_port}",
                "  jobs: 2",
                "p2p:",
                "  listen: /ip4/127.0.0.1/tcp/0",
                "  jobs: 1",
                "grpc:",
                "  jobs: 1",
                "rocksdb:",
                "  block-cache-mb: 256",
                f"  max-background-jobs: {rocksdb_jobs}",
                "  db-write-buffer-size: 268435456",
                "features:",
                "  chain: true",
                "  block_store: true",
                "  jsonrpc: true",
                "  mempool: false",
                "  p2p: false",
                "  grpc: false",
                "  block_producer: false",
                "  contract_meta_store: false",
                "  transaction_store: false",
                "  account_history: false",
                "",
            ]
        )
    )
    return path


def prepare_basedir(source_basedir: Path, target_basedir: Path, jsonrpc_port: int, chain_jobs: int, rocksdb_jobs: int) -> Path:
    if target_basedir.exists():
        shutil.rmtree(target_basedir)
    (target_basedir / "chain").mkdir(parents=True, exist_ok=True)
    (target_basedir / "jsonrpc/descriptors").mkdir(parents=True, exist_ok=True)

    genesis = source_basedir / "chain/genesis_data.json"
    descriptors = source_basedir / "jsonrpc/descriptors/koinos_descriptors.pb"
    if not genesis.exists():
        raise FileNotFoundError(f"missing source genesis: {genesis}")
    if not descriptors.exists():
        raise FileNotFoundError(f"missing source descriptors: {descriptors}")
    shutil.copy2(genesis, target_basedir / "chain/genesis_data.json")
    shutil.copy2(genesis, target_basedir / "genesis_data.json")
    shutil.copy2(descriptors, target_basedir / "jsonrpc/descriptors/koinos_descriptors.pb")
    return write_config(target_basedir, jsonrpc_port, chain_jobs, rocksdb_jobs)


def launch_node(bin_path: Path, basedir: Path, config: Path | None, port: int, log_path: Path, extra_args: list[str] | None = None) -> subprocess.Popen[bytes]:
    log_handle = log_path.open("ab", buffering=0)
    cmd = [
        str(bin_path),
        "--basedir",
        str(basedir),
        "--jsonrpc-listen",
        f"127.0.0.1:{port}",
    ]
    if config is not None:
        cmd.extend(["--config", str(config)])
    if extra_args:
        cmd.extend(extra_args)
    proc = subprocess.Popen(cmd, cwd=ROOT_DIR, stdout=log_handle, stderr=subprocess.STDOUT)
    log_handle.close()
    return proc


def wait_for_rpc(url: str, proc: subprocess.Popen[bytes], timeout: float) -> None:
    deadline = time.time() + timeout
    last_error = ""
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"koinos_node exited before JSON-RPC readiness with code {proc.returncode}")
        try:
            rpc_call(url, "block_store.get_highest_block", {}, timeout=5)
            return
        except Exception as exc:  # noqa: BLE001
            last_error = str(exc)
            time.sleep(0.25)
    raise RuntimeError(f"JSON-RPC not ready before timeout: {last_error}")


def copy_subset(args: argparse.Namespace, source_url: str, target_url: str) -> dict[str, Any]:
    highest = rpc_call(source_url, "block_store.get_highest_block", {}, timeout=args.rpc_timeout)
    source_topology = highest.get("topology", {})
    source_height = extract_height(source_topology)
    if source_height < args.block_count:
        raise RuntimeError(f"source block store height {source_height} is below requested count {args.block_count}")
    head_block_id = source_topology.get("id")
    if not head_block_id:
        raise RuntimeError(f"source highest block has no id: {source_topology}")

    copied = 0
    batches: list[dict[str, Any]] = []
    started = time.perf_counter()
    for start in range(1, args.block_count + 1, args.batch_size):
        count = min(args.batch_size, args.block_count - start + 1)
        batch_started = time.perf_counter()
        result = rpc_call(
            source_url,
            "block_store.get_blocks_by_height",
            {
                "head_block_id": head_block_id,
                "ancestor_start_height": str(start),
                "num_blocks": count,
                "return_block": True,
                "return_receipt": args.include_receipts,
            },
            timeout=args.rpc_timeout,
        )
        items = result.get("block_items", [])
        if len(items) != count:
            raise RuntimeError(f"expected {count} block items at height {start}, got {len(items)}")
        for item in items:
            params: dict[str, Any] = {"block_to_add": item["block"]}
            if args.include_receipts and "receipt" in item:
                params["receipt_to_add"] = item["receipt"]
            rpc_call(target_url, "block_store.add_block", params, timeout=args.rpc_timeout)
            copied += 1
        elapsed = time.perf_counter() - batch_started
        batches.append(
            {
                "start_height": start,
                "count": count,
                "elapsed_seconds": round(elapsed, 3),
                "blocks_per_second": round(count / elapsed, 3) if elapsed > 0 else None,
            }
        )

    elapsed_total = time.perf_counter() - started
    target_highest = rpc_call(target_url, "block_store.get_highest_block", {}, timeout=args.rpc_timeout)
    return {
        "source_height": source_height,
        "source_topology": source_topology,
        "copied_blocks": copied,
        "copy_elapsed_seconds": round(elapsed_total, 3),
        "copy_blocks_per_second": round(copied / elapsed_total, 3) if elapsed_total > 0 else None,
        "target_topology": target_highest.get("topology", {}),
        "batches": batches,
    }


def parse_replay_log(log_path: Path) -> dict[str, Any]:
    try:
        lines = log_path.read_text(errors="replace").splitlines()
    except OSError as exc:
        return {"status": "missing", "error": str(exc)}
    done = None
    target_height = None
    warning_rows = 0
    error_rows = 0
    for line in lines:
        if WARNING_RE.search(line):
            warning_rows += 1
        if ERROR_RE.search(line):
            error_rows += 1
        target_match = INDEX_TARGET_RE.search(line)
        if target_match:
            target_height = int(target_match.group(1))
        done_match = INDEX_DONE_RE.search(line)
        if done_match:
            blocks = int(done_match.group(1))
            seconds = float(done_match.group(2))
            done = {
                "indexed_blocks": blocks,
                "index_seconds": round(seconds, 6),
                "blocks_per_second": round(blocks / seconds, 3) if seconds > 0 else None,
            }
    return {
        "status": "ok" if done else "not_finished",
        "target_height": target_height,
        "finished": done,
        "warning_rows": warning_rows,
        "error_rows": error_rows,
    }


def wait_for_indexing(
    proc: subprocess.Popen[bytes],
    log_path: Path,
    timeout: float,
    sample_interval: float,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    deadline = time.time() + timeout
    samples: list[dict[str, Any]] = []
    while time.time() < deadline:
        if proc.poll() is not None:
            parsed = parse_replay_log(log_path)
            if parsed["status"] == "ok":
                return parsed, samples
            raise RuntimeError(f"replay node exited early with code {proc.returncode}: {parsed}")

        parsed = parse_replay_log(log_path)
        samples.append({"timestamp": utc_now(), "process": sample_process(proc.pid), "log": parsed})
        if parsed["status"] == "ok":
            return parsed, samples
        time.sleep(sample_interval)

    raise RuntimeError(f"indexing did not finish within {timeout}s: {parse_replay_log(log_path)}")


def build_result(
    args: argparse.Namespace,
    report_dir: Path,
    target_basedir: Path,
    copy_summary: dict[str, Any],
    replay_summary: dict[str, Any],
    replay_samples: list[dict[str, Any]],
    final_head: dict[str, Any],
) -> dict[str, Any]:
    finished = replay_summary.get("finished") or {}
    bps = finished.get("blocks_per_second")
    status = "pass"
    if replay_summary.get("status") != "ok" or extract_height(final_head.get("head_topology", {})) < args.block_count:
        status = "fail"
    elif bps is not None and bps < args.target_blocks_per_second:
        status = "warn"
    elif int(replay_summary.get("error_rows", 0)) > 0:
        status = "warn"

    rss = []
    cpu = []
    for sample in replay_samples:
        proc = sample.get("process", {})
        if isinstance(proc, dict) and proc.get("ok"):
            rss.append(float(proc["rss_mb"]))
            cpu.append(float(proc["cpu_percent"]))

    return {
        "kind": "teleno-monolith-index-replay-benchmark",
        "status": status,
        "started_at": args.started_at,
        "finished_at": utc_now(),
        "repo_root": str(ROOT_DIR),
        "git_branch": git_value(["branch", "--show-current"]),
        "git_commit": git_value(["rev-parse", "--short", "HEAD"]),
        "source_basedir": str(args.source_basedir),
        "target_basedir": str(target_basedir),
        "report_dir": str(report_dir),
        "block_count": args.block_count,
        "batch_size": args.batch_size,
        "include_receipts": args.include_receipts,
        "verify_blocks": False,
        "target_blocks_per_second": args.target_blocks_per_second,
        "copy_summary": copy_summary,
        "replay_summary": replay_summary,
        "final_head": final_head,
        "process_summary": {"rss_mb": summarize(rss), "cpu_percent": summarize(cpu)},
        "samples": replay_samples,
    }


def write_outputs(result: dict[str, Any], report_dir: Path) -> None:
    json_path = report_dir / "result.json"
    md_path = report_dir / "result.md"
    result["result_json"] = str(json_path)
    result["result_md"] = str(md_path)
    json_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")

    replay = result["replay_summary"].get("finished") or {}
    lines = [
        "# Monolith Index Replay Benchmark",
        "",
        f"- Status: `{result['status']}`",
        f"- Started: `{result['started_at']}`",
        f"- Finished: `{result['finished_at']}`",
        f"- Git commit: `{result['git_commit']}`",
        f"- Source basedir: `{result['source_basedir']}`",
        f"- Target basedir: `{result['target_basedir']}`",
        f"- Block count: `{result['block_count']}`",
        f"- Include receipts: `{result['include_receipts']}`",
        f"- Verify blocks: `{result['verify_blocks']}`",
        f"- Target blocks/sec: `{result['target_blocks_per_second']}`",
        "",
        "## Replay",
        "",
        f"- Indexed blocks: `{replay.get('indexed_blocks')}`",
        f"- Index seconds: `{replay.get('index_seconds')}`",
        f"- Blocks/sec: `{replay.get('blocks_per_second')}`",
        f"- Warning rows: `{result['replay_summary'].get('warning_rows')}`",
        f"- Error rows: `{result['replay_summary'].get('error_rows')}`",
        f"- Final head: `{result['final_head'].get('head_topology', {})}`",
        "",
        "## Preparation",
        "",
        f"- Copied blocks: `{result['copy_summary'].get('copied_blocks')}`",
        f"- Copy seconds: `{result['copy_summary'].get('copy_elapsed_seconds')}`",
        f"- Copy blocks/sec: `{result['copy_summary'].get('copy_blocks_per_second')}`",
        "",
        "## Process",
        "",
        f"- RSS MB: `{json.dumps(result['process_summary']['rss_mb'], sort_keys=True)}`",
        f"- CPU %: `{json.dumps(result['process_summary']['cpu_percent'], sort_keys=True)}`",
        "",
        f"JSON result: `{json_path}`",
        "",
    ]
    md_path.write_text("\n".join(lines))
    json_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bin", type=Path, default=DEFAULT_BIN)
    parser.add_argument("--source-basedir", type=Path, default=DEFAULT_SOURCE_BASEDIR)
    parser.add_argument("--report-dir", type=Path, default=None)
    parser.add_argument("--block-count", type=int, default=10000)
    parser.add_argument("--batch-size", type=int, default=250)
    parser.add_argument("--source-jsonrpc-port", type=int, default=28700)
    parser.add_argument("--prep-jsonrpc-port", type=int, default=28701)
    parser.add_argument("--replay-jsonrpc-port", type=int, default=28702)
    parser.add_argument("--startup-timeout-seconds", type=float, default=120)
    parser.add_argument("--replay-timeout-seconds", type=float, default=600)
    parser.add_argument("--sample-interval-seconds", type=float, default=1)
    parser.add_argument("--rpc-timeout", type=float, default=30)
    parser.add_argument("--chain-jobs", type=int, default=2)
    parser.add_argument("--rocksdb-jobs", type=int, default=4)
    parser.add_argument("--target-blocks-per-second", type=float, default=10000)
    parser.add_argument(
        "--include-receipts",
        action="store_true",
        help="also copy block receipts into the target block store; chain replay only requires blocks",
    )
    args = parser.parse_args(argv)
    if args.report_dir is None:
        args.report_dir = DEFAULT_REPORT_ROOT / safe_timestamp()
    if args.block_count <= 0:
        parser.error("--block-count must be positive")
    if args.batch_size <= 0 or args.batch_size > 1000:
        parser.error("--batch-size must be between 1 and 1000")
    if args.chain_jobs <= 0:
        parser.error("--chain-jobs must be positive")
    if args.rocksdb_jobs <= 0:
        parser.error("--rocksdb-jobs must be positive")
    args.started_at = utc_now()
    return args


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    if not args.bin.exists() or not os.access(args.bin, os.X_OK):
        print(f"error: koinos_node is not executable: {args.bin}", file=sys.stderr)
        return 2
    if not args.source_basedir.exists():
        print(f"error: source basedir does not exist: {args.source_basedir}", file=sys.stderr)
        return 2
    for port in (args.source_jsonrpc_port, args.prep_jsonrpc_port, args.replay_jsonrpc_port):
        if not port_is_free(port):
            print(f"error: port already in use: {port}", file=sys.stderr)
            return 2

    report_dir = args.report_dir
    target_basedir = report_dir / "basedir"
    report_dir.mkdir(parents=True, exist_ok=True)

    source_log = report_dir / "source-node.log"
    prep_log = report_dir / "prep-node.log"
    replay_log = report_dir / "replay-node.log"
    config = prepare_basedir(args.source_basedir, target_basedir, args.prep_jsonrpc_port, args.chain_jobs, args.rocksdb_jobs)

    source_proc: subprocess.Popen[bytes] | None = None
    prep_proc: subprocess.Popen[bytes] | None = None
    replay_proc: subprocess.Popen[bytes] | None = None
    try:
        source_proc = launch_node(
            args.bin,
            args.source_basedir,
            None,
            args.source_jsonrpc_port,
            source_log,
            ["--disable", "chain", "p2p", "grpc", "block_producer", "account_history"],
        )
        wait_for_rpc(f"http://127.0.0.1:{args.source_jsonrpc_port}/", source_proc, args.startup_timeout_seconds)

        prep_proc = launch_node(args.bin, target_basedir, config, args.prep_jsonrpc_port, prep_log)
        wait_for_rpc(f"http://127.0.0.1:{args.prep_jsonrpc_port}/", prep_proc, args.startup_timeout_seconds)

        copy_summary = copy_subset(
            args,
            f"http://127.0.0.1:{args.source_jsonrpc_port}/",
            f"http://127.0.0.1:{args.prep_jsonrpc_port}/",
        )
        terminate_process(prep_proc)
        prep_proc = None

        replay_config = write_config(target_basedir, args.replay_jsonrpc_port, args.chain_jobs, args.rocksdb_jobs)
        replay_proc = launch_node(args.bin, target_basedir, replay_config, args.replay_jsonrpc_port, replay_log)
        replay_summary, replay_samples = wait_for_indexing(
            replay_proc,
            replay_log,
            args.replay_timeout_seconds,
            args.sample_interval_seconds,
        )
        final_head = rpc_call(f"http://127.0.0.1:{args.replay_jsonrpc_port}/", "chain.get_head_info", {}, timeout=args.rpc_timeout)
        result = build_result(args, report_dir, target_basedir, copy_summary, replay_summary, replay_samples, final_head)
        write_outputs(result, report_dir)
        print(
            json.dumps(
                {
                    "status": result["status"],
                    "result_json": result["result_json"],
                    "result_md": result["result_md"],
                    "indexed_blocks": replay_summary.get("finished", {}).get("indexed_blocks"),
                    "blocks_per_second": replay_summary.get("finished", {}).get("blocks_per_second"),
                },
                indent=2,
                sort_keys=True,
            )
        )
        return 0 if result["status"] in {"pass", "warn"} else 1
    except Exception as exc:  # noqa: BLE001
        error_result = {
            "kind": "teleno-monolith-index-replay-benchmark",
            "status": "fail",
            "started_at": args.started_at,
            "finished_at": utc_now(),
            "git_branch": git_value(["branch", "--show-current"]),
            "git_commit": git_value(["rev-parse", "--short", "HEAD"]),
            "error": str(exc),
            "source_log": str(source_log),
            "prep_log": str(prep_log),
            "replay_log": str(replay_log),
            "report_dir": str(report_dir),
        }
        write_outputs(error_result | {"copy_summary": {}, "replay_summary": {}, "final_head": {}, "process_summary": {"rss_mb": {}, "cpu_percent": {}}, "samples": [], "source_basedir": str(args.source_basedir), "target_basedir": str(target_basedir), "block_count": args.block_count, "include_receipts": args.include_receipts, "verify_blocks": False, "target_blocks_per_second": args.target_blocks_per_second}, report_dir)
        print(f"error: {exc}", file=sys.stderr)
        return 1
    finally:
        for proc in (replay_proc, prep_proc, source_proc):
            if proc is not None:
                terminate_process(proc)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
