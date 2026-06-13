#!/usr/bin/env python3
"""Benchmark monolith live P2P sync/catch-up throughput.

This launches a temporary non-producing observer from height 0, connects it to
the configured public testnet peer, samples local/remote head progress and
process usage, then terminates the observer. It is intentionally separate from
the read-only JSON-RPC benchmark because live sync speed is peer and network
dependent.
"""

from __future__ import annotations

import argparse
import json
import math
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
DEFAULT_BIN = ROOT_DIR / "node/teleno-node/build/teleno_node"
DEFAULT_SOURCE_BASEDIR = Path("/Volumes/external/teleno-testnet-producer/basedir")
DEFAULT_REPORT_ROOT = Path("/private/tmp/teleno-monolith-sync-benchmark")
DEFAULT_PUBLIC_TESTNET_PEER = (
    "/dns4/testnet.koinosfoundation.org/tcp/8888/p2p/"
    "QmYV414G6xRzkSUytntEsBsCSjXrVGubfYJn4vpeER2s2W"
)
DEFAULT_REMOTE_RPC_URL = "https://testnet.koinosfoundation.org/jsonrpc"

ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
SYNC_RE = re.compile(r"\[p2p\] Syncing from .*?applied (\d+) blocks \(height (\d+)/(\d+)")
LOG_TS_RE = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?)")
RUNTIME_TOPOLOGY_RE = re.compile(r"\[runtime\] Thread topology: (.*)")
ROCKSDB_TUNING_RE = re.compile(r"\[db\] RocksDB tuning: (.*)")


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def safe_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def normalize_rpc_url(url: str) -> str:
    if url.startswith("http://") or url.startswith("https://"):
        return url
    return f"http://{url}/"


def rpc_call(url: str, method: str, params: dict[str, Any] | None = None, timeout: int = 15) -> tuple[dict[str, Any], float]:
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}).encode()
    req = request.Request(
        normalize_rpc_url(url),
        data=body,
        headers={"content-type": "application/json", "user-agent": "teleno-monolith-sync-benchmark/1.0"},
        method="POST",
    )
    started = time.perf_counter()
    try:
        with request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
    except HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"{method} HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"{method} failed: {exc.reason}") from exc
    elapsed_ms = (time.perf_counter() - started) * 1000
    parsed = json.loads(raw.decode())
    if "error" in parsed:
        raise RuntimeError(f"{method} error: {json.dumps(parsed['error'], sort_keys=True)}")
    return parsed.get("result", {}), elapsed_ms


def extract_height(result: dict[str, Any]) -> int | None:
    candidates: list[Any] = [
        result.get("head_topology", {}).get("height") if isinstance(result.get("head_topology"), dict) else None,
        result.get("head_info", {}).get("head_topology", {}).get("height")
        if isinstance(result.get("head_info"), dict)
        else None,
        result.get("topology", {}).get("height") if isinstance(result.get("topology"), dict) else None,
        result.get("height"),
    ]
    for candidate in candidates:
        if candidate is None:
            continue
        try:
            return int(candidate)
        except (TypeError, ValueError):
            continue
    return None


def percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (len(ordered) - 1) * (pct / 100.0)
    lower = math.floor(rank)
    upper = math.ceil(rank)
    if lower == upper:
        return ordered[int(rank)]
    weight = rank - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def summarize(values: list[float]) -> dict[str, Any]:
    if not values:
        return {"count": 0}
    return {
        "count": len(values),
        "min": round(min(values), 3),
        "mean": round(sum(values) / len(values), 3),
        "p50": round(percentile(values, 50) or 0, 3),
        "p95": round(percentile(values, 95) or 0, 3),
        "p99": round(percentile(values, 99) or 0, 3),
        "max": round(max(values), 3),
    }


def process_exists(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def sample_process(pid: int) -> dict[str, Any]:
    result = subprocess.run(
        ["ps", "-o", "rss=", "-o", "pcpu=", "-p", str(pid)],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        return {"ok": False, "error": (result.stderr or result.stdout).strip()}
    parts = result.stdout.split()
    if len(parts) < 2:
        return {"ok": False, "error": f"unexpected ps output: {result.stdout.strip()}"}
    try:
        return {
            "ok": True,
            "rss_mb": round(int(float(parts[0])) / 1024, 3),
            "cpu_percent": round(float(parts[1]), 3),
        }
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}


def port_is_free(port: int) -> bool:
    result = subprocess.run(
        ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN"],
        text=True,
        capture_output=True,
        check=False,
    )
    return result.returncode != 0


def write_config(args: argparse.Namespace, basedir: Path) -> Path:
    config_path = basedir / "config.yml"
    verify_blocks = "true" if args.verify_blocks else "false"
    config_path.write_text(
        "\n".join(
            [
                "global:",
                f"  instance-id: sync-benchmark-{safe_timestamp()}",
                "  log-level: info",
                "  log-color: false",
                "  log-datetime: true",
                "  fork-algorithm: pob",
                "chain:",
                f"  jobs: {args.chain_jobs}",
                f"  verify-blocks: {verify_blocks}",
                "p2p:",
                f"  listen: {args.p2p_listen}",
                f"  jobs: {args.p2p_jobs}",
                f"  seed-reconnect-interval-seconds: {args.seed_reconnect_interval_seconds}",
                "  peer-log-interval-seconds: 60",
                "  peer:",
                f"    - {args.peer}",
                "jsonrpc:",
                f"  listen: 127.0.0.1:{args.jsonrpc_port}",
                f"  jobs: {args.jsonrpc_jobs}",
                "grpc:",
                f"  jobs: {args.grpc_jobs}",
                "rocksdb:",
                f"  block-cache-mb: {args.rocksdb_block_cache_mb}",
                f"  max-background-jobs: {args.rocksdb_max_background_jobs}",
                f"  db-write-buffer-size: {args.rocksdb_db_write_buffer_size}",
                "features:",
                "  chain: true",
                "  mempool: true",
                "  block_store: true",
                "  p2p: true",
                "  jsonrpc: true",
                "  grpc: false",
                "  block_producer: false",
                "  contract_meta_store: true",
                "  transaction_store: true",
                "  account_history: false",
                "",
            ]
        )
    )
    return config_path


def prepare_basedir(args: argparse.Namespace, basedir: Path) -> Path:
    source = args.source_basedir
    genesis = source / "chain/genesis_data.json"
    descriptors = source / "jsonrpc/descriptors/koinos_descriptors.pb"
    if not genesis.exists():
        raise FileNotFoundError(f"missing testnet genesis: {genesis}")
    if not descriptors.exists():
        raise FileNotFoundError(f"missing testnet descriptors: {descriptors}")

    (basedir / "chain").mkdir(parents=True, exist_ok=True)
    (basedir / "jsonrpc/descriptors").mkdir(parents=True, exist_ok=True)
    shutil.copy2(genesis, basedir / "genesis_data.json")
    shutil.copy2(genesis, basedir / "chain/genesis_data.json")
    shutil.copy2(descriptors, basedir / "jsonrpc/descriptors/koinos_descriptors.pb")
    return write_config(args, basedir)


def launch_node(args: argparse.Namespace, basedir: Path, config_path: Path, log_path: Path) -> tuple[subprocess.Popen[bytes], float]:
    log_handle = log_path.open("ab", buffering=0)
    cmd = [
        str(args.bin),
        "--basedir",
        str(basedir),
        "--config",
        str(config_path),
        "--jsonrpc-listen",
        f"127.0.0.1:{args.jsonrpc_port}",
    ]
    started = time.perf_counter()
    proc = subprocess.Popen(cmd, stdout=log_handle, stderr=subprocess.STDOUT)
    log_handle.close()

    deadline = time.time() + args.startup_timeout_seconds
    last_error = ""
    rpc_url = f"http://127.0.0.1:{args.jsonrpc_port}/"
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"teleno_node exited during startup with code {proc.returncode}; log={log_path}")
        try:
            rpc_call(rpc_url, "chain.get_head_info", timeout=args.rpc_timeout)
            return proc, (time.perf_counter() - started) * 1000
        except Exception as exc:  # noqa: BLE001
            last_error = str(exc)
            time.sleep(args.startup_poll_interval)

    terminate_process(proc)
    raise RuntimeError(f"JSON-RPC did not become ready before timeout; last_error={last_error}; log={log_path}")


def terminate_process(proc: subprocess.Popen[bytes], timeout: int = 20) -> None:
    if proc.poll() is not None:
        return
    proc.send_signal(signal.SIGTERM)
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=timeout)


def sample_heads(args: argparse.Namespace, pid: int) -> list[dict[str, Any]]:
    rpc_url = f"http://127.0.0.1:{args.jsonrpc_port}/"
    samples: list[dict[str, Any]] = []
    started = time.perf_counter()
    deadline = started + args.duration_seconds

    while True:
        now = time.perf_counter()
        sample: dict[str, Any] = {"timestamp": utc_now(), "elapsed_seconds": round(now - started, 3)}

        try:
            result, latency = rpc_call(rpc_url, "chain.get_head_info", timeout=args.rpc_timeout)
            sample["local_head_height"] = extract_height(result)
            sample["local_head_rpc_latency_ms"] = round(latency, 3)
        except Exception as exc:  # noqa: BLE001
            sample["local_head_error"] = str(exc)

        try:
            result, latency = rpc_call(rpc_url, "block_store.get_highest_block", timeout=args.rpc_timeout)
            sample["local_block_store_height"] = extract_height(result)
            sample["local_block_store_rpc_latency_ms"] = round(latency, 3)
        except Exception as exc:  # noqa: BLE001
            sample["local_block_store_error"] = str(exc)

        if args.remote_rpc_url:
            try:
                result, latency = rpc_call(args.remote_rpc_url, "chain.get_head_info", timeout=args.remote_rpc_timeout)
                sample["remote_head_height"] = extract_height(result)
                sample["remote_head_rpc_latency_ms"] = round(latency, 3)
            except Exception as exc:  # noqa: BLE001
                sample["remote_head_error"] = str(exc)

        if process_exists(pid):
            sample["process"] = sample_process(pid)
        else:
            sample["process"] = {"ok": False, "error": "process exited"}

        samples.append(sample)
        if now >= deadline or not process_exists(pid):
            break
        remaining = deadline - time.perf_counter()
        if remaining <= 0:
            continue
        time.sleep(min(args.sample_interval_seconds, remaining))

    return samples


def summarize_height(samples: list[dict[str, Any]], key: str) -> dict[str, Any]:
    points: list[tuple[float, int]] = []
    for sample in samples:
        height = sample.get(key)
        if height is None:
            continue
        try:
            points.append((float(sample["elapsed_seconds"]), int(height)))
        except (TypeError, ValueError):
            continue
    if len(points) < 2:
        return {"status": "insufficient_samples", "sample_count": len(points)}
    first_elapsed, first_height = points[0]
    last_elapsed, last_height = points[-1]
    elapsed = max(last_elapsed - first_elapsed, 0.0)
    delta = last_height - first_height
    windows: list[float] = []
    for (prev_elapsed, prev_height), (next_elapsed, next_height) in zip(points, points[1:]):
        window_elapsed = next_elapsed - prev_elapsed
        window_delta = next_height - prev_height
        if window_elapsed > 0 and window_delta >= 0:
            windows.append(window_delta / window_elapsed)
    return {
        "status": "ok" if delta > 0 else "no_progress",
        "sample_count": len(points),
        "first_height": first_height,
        "last_height": last_height,
        "height_delta": delta,
        "elapsed_seconds": round(elapsed, 3),
        "average_blocks_per_second": round(delta / elapsed, 3) if elapsed > 0 else None,
        "window_blocks_per_second": summarize(windows),
    }


def summarize_process(samples: list[dict[str, Any]]) -> dict[str, Any]:
    rss: list[float] = []
    cpu: list[float] = []
    errors: list[str] = []
    for sample in samples:
        process = sample.get("process")
        if not isinstance(process, dict):
            continue
        if process.get("ok"):
            rss.append(float(process["rss_mb"]))
            cpu.append(float(process["cpu_percent"]))
        elif process.get("error"):
            errors.append(str(process["error"]))
    return {
        "rss_mb": summarize(rss),
        "cpu_percent": summarize(cpu),
        "errors": errors[:20],
        "error_count": len(errors),
    }


def parse_log_timestamp(line: str) -> datetime | None:
    match = LOG_TS_RE.search(line)
    if not match:
        return None
    value = match.group(1)
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def summarize_log(log_path: Path) -> dict[str, Any]:
    if not log_path.exists():
        return {"status": "missing", "path": str(log_path)}

    rows = {
        "peer_connected": 0,
        "peer_disconnected": 0,
        "connected_snapshots": 0,
        "handshake": 0,
        "sync": 0,
        "score_threshold": 0,
        "checkpoint_mismatch": 0,
        "block_application_failed": 0,
        "future_gossip_ignored": 0,
        "warning": 0,
        "error": 0,
    }
    sync_points: list[tuple[datetime, int, int, int]] = []
    runtime_topology: str | None = None
    rocksdb_tuning: str | None = None

    for raw in log_path.read_text(errors="replace").splitlines():
        line = ANSI_RE.sub("", raw)
        lower = line.lower()
        if runtime_topology is None:
            match = RUNTIME_TOPOLOGY_RE.search(line)
            if match:
                runtime_topology = match.group(1)
        if rocksdb_tuning is None:
            match = ROCKSDB_TUNING_RE.search(line)
            if match:
                rocksdb_tuning = match.group(1)
        if "peer connected:" in lower:
            rows["peer_connected"] += 1
        if "peer disconnected:" in lower or "disconnecting stale peer" in lower:
            rows["peer_disconnected"] += 1
        if "[p2p] connected peers:" in lower:
            rows["connected_snapshots"] += 1
        if "handshake complete" in lower:
            rows["handshake"] += 1
        if "score threshold" in lower:
            rows["score_threshold"] += 1
        if "checkpoint mismatch" in lower or "sync block previous mismatch" in lower:
            rows["checkpoint_mismatch"] += 1
        if "block application failed" in lower:
            rows["block_application_failed"] += 1
        if "ignoring future gossiped block" in lower:
            rows["future_gossip_ignored"] += 1
        if "<warning" in lower:
            rows["warning"] += 1
        if "<error" in lower:
            rows["error"] += 1

        match = SYNC_RE.search(line)
        if match:
            rows["sync"] += 1
            ts = parse_log_timestamp(line)
            if ts:
                sync_points.append((ts, int(match.group(1)), int(match.group(2)), int(match.group(3))))

    log_rate: dict[str, Any] = {"status": "insufficient_data", "points": len(sync_points)}
    if len(sync_points) >= 2:
        first = sync_points[0]
        last = sync_points[-1]
        elapsed = max((last[0] - first[0]).total_seconds(), 0.0)
        height_delta = last[2] - first[2]
        log_rate = {
            "status": "ok" if elapsed > 0 and height_delta >= 0 else "invalid",
            "points": len(sync_points),
            "first_height": first[2],
            "last_height": last[2],
            "height_delta": height_delta,
            "elapsed_seconds": round(elapsed, 3),
            "blocks_per_second": round(height_delta / elapsed, 3) if elapsed > 0 and height_delta >= 0 else None,
            "total_applied_blocks_in_rows": sum(point[1] for point in sync_points),
            "last_peer_head_height": last[3],
        }

    return {
        "status": "ok",
        "path": str(log_path),
        "rows": rows,
        "sync_rate": log_rate,
        "runtime_topology": runtime_topology,
        "rocksdb_tuning": rocksdb_tuning,
    }


def thread_settings(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "chain_jobs": args.chain_jobs,
        "jsonrpc_jobs": args.jsonrpc_jobs,
        "grpc_jobs": args.grpc_jobs,
        "p2p_jobs_requested": args.p2p_jobs,
        "p2p_effective_io_threads": 1,
        "p2p_sync_threads": "per-peer",
        "rocksdb_block_cache_mb": args.rocksdb_block_cache_mb,
        "rocksdb_max_background_jobs": args.rocksdb_max_background_jobs,
        "rocksdb_db_write_buffer_size": args.rocksdb_db_write_buffer_size,
    }


def write_outputs(result: dict[str, Any], report_dir: Path) -> None:
    json_path = report_dir / "result.json"
    md_path = report_dir / "result.md"
    samples_path = report_dir / "samples.jsonl"

    json_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    with samples_path.open("w") as handle:
        for sample in result["samples"]:
            handle.write(json.dumps(sample, sort_keys=True) + "\n")

    local = result["local_head_progress"]
    log_rows = result["log_summary"].get("rows", {})
    lines = [
        "# Monolith Live P2P Sync Benchmark",
        "",
        f"- Status: `{result['status']}`",
        f"- Started: `{result['started_at']}`",
        f"- Duration seconds: `{result['duration_seconds']}`",
        f"- Startup to JSON-RPC: `{round(result['startup_ms'], 3)} ms`",
        f"- Source basedir: `{result['source_basedir']}`",
        f"- Benchmark basedir: `{result['basedir']}`",
        f"- Peer: `{result['peer']}`",
        f"- Verify blocks: `{result['verify_blocks']}`",
        f"- Thread settings: `{json.dumps(result['thread_settings'], sort_keys=True)}`",
        "",
        "## Local Head Progress",
        "",
        f"- First height: `{local.get('first_height')}`",
        f"- Last height: `{local.get('last_height')}`",
        f"- Height delta: `{local.get('height_delta')}`",
        f"- Average blocks/sec: `{local.get('average_blocks_per_second')}`",
        f"- Window blocks/sec: `{json.dumps(local.get('window_blocks_per_second', {}), sort_keys=True)}`",
        "",
        "## Process",
        "",
        f"- RSS MB: `{json.dumps(result['process_summary']['rss_mb'], sort_keys=True)}`",
        f"- CPU %: `{json.dumps(result['process_summary']['cpu_percent'], sort_keys=True)}`",
        "",
        "## P2P Log Counters",
        "",
        f"- Rows: `{json.dumps(log_rows, sort_keys=True)}`",
        f"- Runtime topology: `{result['log_summary'].get('runtime_topology')}`",
        f"- RocksDB tuning: `{result['log_summary'].get('rocksdb_tuning')}`",
        f"- Log-derived sync rate: `{json.dumps(result['log_summary'].get('sync_rate', {}), sort_keys=True)}`",
        "",
        "## Evidence",
        "",
        f"- JSON: `{json_path}`",
        f"- Samples: `{samples_path}`",
        f"- Log: `{result['log_path']}`",
        "",
    ]
    md_path.write_text("\n".join(lines))

    result["result_json"] = str(json_path)
    result["result_md"] = str(md_path)
    json_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")


def build_result(args: argparse.Namespace, report_dir: Path, basedir: Path, log_path: Path, startup_ms: float, samples: list[dict[str, Any]], proc_returncode: int | None) -> dict[str, Any]:
    local_progress = summarize_height(samples, "local_head_height")
    severe_log_keys = ("score_threshold", "checkpoint_mismatch", "block_application_failed", "error")
    log_summary = summarize_log(log_path)
    log_rows = log_summary.get("rows", {}) if isinstance(log_summary.get("rows"), dict) else {}
    severe_rows = sum(int(log_rows.get(key, 0)) for key in severe_log_keys)
    process_summary = summarize_process(samples)
    exited_early = proc_returncode is not None and proc_returncode != 0
    status = "pass"
    if local_progress.get("status") != "ok" or severe_rows > 0 or exited_early:
        status = "fail"
    elif int(log_rows.get("warning", 0)) > 0:
        status = "warn"

    return {
        "kind": "teleno-monolith-live-p2p-sync-benchmark",
        "status": status,
        "started_at": args.started_at,
        "finished_at": utc_now(),
        "duration_seconds": args.duration_seconds,
        "sample_interval_seconds": args.sample_interval_seconds,
        "startup_ms": startup_ms,
        "repo_root": str(ROOT_DIR),
        "git_commit": subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=ROOT_DIR,
            text=True,
            capture_output=True,
            check=False,
        ).stdout.strip(),
        "bin": str(args.bin),
        "source_basedir": str(args.source_basedir),
        "basedir": str(basedir),
        "config_path": str(basedir / "config.yml"),
        "log_path": str(log_path),
        "result_dir": str(report_dir),
        "peer": args.peer,
        "p2p_listen": args.p2p_listen,
        "jsonrpc_port": args.jsonrpc_port,
        "remote_rpc_url": args.remote_rpc_url,
        "verify_blocks": args.verify_blocks,
        "thread_settings": thread_settings(args),
        "local_head_progress": local_progress,
        "local_block_store_progress": summarize_height(samples, "local_block_store_height"),
        "remote_head_progress": summarize_height(samples, "remote_head_height"),
        "process_summary": process_summary,
        "log_summary": log_summary,
        "proc_returncode_before_shutdown": proc_returncode,
        "samples": samples,
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bin", type=Path, default=DEFAULT_BIN)
    parser.add_argument("--source-basedir", type=Path, default=DEFAULT_SOURCE_BASEDIR)
    parser.add_argument("--report-dir", type=Path, default=None)
    parser.add_argument("--jsonrpc-port", type=int, default=int(os.environ.get("SYNC_JSONRPC_PORT", "28200")))
    parser.add_argument("--duration-seconds", type=float, default=float(os.environ.get("SYNC_DURATION_SECONDS", "120")))
    parser.add_argument("--sample-interval-seconds", type=float, default=float(os.environ.get("SYNC_SAMPLE_INTERVAL_SECONDS", "5")))
    parser.add_argument("--startup-timeout-seconds", type=float, default=float(os.environ.get("SYNC_STARTUP_TIMEOUT_SECONDS", "60")))
    parser.add_argument("--startup-poll-interval", type=float, default=0.05)
    parser.add_argument("--rpc-timeout", type=int, default=15)
    parser.add_argument("--remote-rpc-timeout", type=int, default=15)
    parser.add_argument("--peer", default=os.environ.get("SYNC_P2P_PEER", DEFAULT_PUBLIC_TESTNET_PEER))
    parser.add_argument("--p2p-listen", default=os.environ.get("SYNC_P2P_LISTEN", "/ip4/0.0.0.0/tcp/0"))
    parser.add_argument("--remote-rpc-url", default=os.environ.get("SYNC_REMOTE_RPC_URL", DEFAULT_REMOTE_RPC_URL))
    parser.add_argument("--seed-reconnect-interval-seconds", type=int, default=10)
    parser.add_argument("--verify-blocks", action="store_true")
    parser.add_argument("--chain-jobs", type=int, default=int(os.environ.get("SYNC_CHAIN_JOBS", "2")))
    parser.add_argument("--jsonrpc-jobs", type=int, default=int(os.environ.get("SYNC_JSONRPC_JOBS", "4")))
    parser.add_argument("--grpc-jobs", type=int, default=int(os.environ.get("SYNC_GRPC_JOBS", "2")))
    parser.add_argument("--p2p-jobs", type=int, default=int(os.environ.get("SYNC_P2P_JOBS", "1")))
    parser.add_argument("--rocksdb-block-cache-mb", type=int, default=int(os.environ.get("SYNC_ROCKSDB_BLOCK_CACHE_MB", "256")))
    parser.add_argument("--rocksdb-max-background-jobs", type=int, default=int(os.environ.get("SYNC_ROCKSDB_MAX_BACKGROUND_JOBS", "4")))
    parser.add_argument("--rocksdb-db-write-buffer-size", type=int, default=int(os.environ.get("SYNC_ROCKSDB_DB_WRITE_BUFFER_SIZE", str(256 * 1024 * 1024))))
    args = parser.parse_args(argv)
    args.started_at = utc_now()
    if args.report_dir is None:
        args.report_dir = DEFAULT_REPORT_ROOT / safe_timestamp()
    return args


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    if not args.bin.exists() or not os.access(args.bin, os.X_OK):
        print(f"error: teleno_node is not executable: {args.bin}", file=sys.stderr)
        return 2
    if args.duration_seconds <= 0:
        print("error: --duration-seconds must be positive", file=sys.stderr)
        return 2
    if args.sample_interval_seconds <= 0:
        print("error: --sample-interval-seconds must be positive", file=sys.stderr)
        return 2
    for name in (
        "chain_jobs",
        "jsonrpc_jobs",
        "grpc_jobs",
        "p2p_jobs",
        "rocksdb_block_cache_mb",
        "rocksdb_max_background_jobs",
        "rocksdb_db_write_buffer_size",
    ):
        if getattr(args, name) <= 0:
            print(f"error: --{name.replace('_', '-')} must be positive", file=sys.stderr)
            return 2
    if not port_is_free(args.jsonrpc_port):
        print(f"error: JSON-RPC port is already in use: {args.jsonrpc_port}", file=sys.stderr)
        return 2

    report_dir = args.report_dir
    basedir = report_dir / "basedir"
    log_path = report_dir / "teleno_node.log"
    report_dir.mkdir(parents=True, exist_ok=True)

    proc: subprocess.Popen[bytes] | None = None
    startup_ms = 0.0
    samples: list[dict[str, Any]] = []
    proc_returncode: int | None = None
    try:
        config_path = prepare_basedir(args, basedir)
        proc, startup_ms = launch_node(args, basedir, config_path, log_path)
        samples = sample_heads(args, proc.pid)
        proc_returncode = proc.poll()
    finally:
        if proc is not None:
            terminate_process(proc)

    result = build_result(args, report_dir, basedir, log_path, startup_ms, samples, proc_returncode)
    write_outputs(result, report_dir)
    print(
        json.dumps(
            {
                "status": result["status"],
                "result_json": result["result_json"],
                "result_md": result["result_md"],
                "average_blocks_per_second": result["local_head_progress"].get("average_blocks_per_second"),
                "height_delta": result["local_head_progress"].get("height_delta"),
                "last_height": result["local_head_progress"].get("last_height"),
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0 if result["status"] in {"pass", "warn"} else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
