#!/usr/bin/env python3
"""Run read-only performance benchmarks against a Koinos monolith node.

The default mode attaches to an already running node and only performs
JSON-RPC reads plus local process sampling. Launch mode is opt-in and starts a
dedicated koinos_node process, measures startup-to-RPC time, then terminates it
unless --keep-running is supplied.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import platform
import re
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
DEFAULT_RPC_URL = "http://127.0.0.1:18122/"
DEFAULT_PID_FILE = Path("/Users/pgarcgo/.kcli/teleno-testnet-producer/live-testnet-sync.pid")
DEFAULT_LOG_FILE = Path("/Users/pgarcgo/.kcli/teleno-testnet-producer/live-testnet-sync-latest.log")

SENSITIVE_REPLACEMENTS = [
    (re.compile(r"\b[5KL][1-9A-HJ-NP-Za-km-z]{50,52}\b"), "[REDACTED_WIF]"),
    (re.compile(r"(?i)((?:api|bot|telegram)[_ -]?token|password|secret|private[_ -]?key)\s*[:=]\s*\S+"), r"\1=[REDACTED]"),
]

TIMESTAMP_RE = re.compile(r"^(?P<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?)")
HEIGHT_RE = re.compile(r"\b(?:height|head height|block height)\s*[:=]\s*'?(\d+)'?", re.IGNORECASE)
INDEXING_HINT_RE = re.compile(r"\b(sync|index|appl(?:y|ied)|accept(?:ed)? block|block_store)\b", re.IGNORECASE)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def safe_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def redact(text: str) -> str:
    result = text
    for pattern, replacement in SENSITIVE_REPLACEMENTS:
        result = pattern.sub(replacement, result)
    return result


def run_command(args: list[str], timeout: int = 10) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        completed = subprocess.run(args, text=True, capture_output=True, timeout=timeout, check=False)
        return {
            "command": args,
            "returncode": completed.returncode,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 3),
            "stdout": redact(completed.stdout.strip()),
            "stderr": redact(completed.stderr.strip()),
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "command": args,
            "returncode": 124,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 3),
            "stdout": redact((exc.stdout or "").strip()),
            "stderr": redact((exc.stderr or "timeout").strip()),
        }


def git_value(args: list[str]) -> str:
    result = run_command(["git", *args], timeout=5)
    if result["returncode"] != 0:
        return ""
    return result["stdout"].splitlines()[0] if result["stdout"] else ""


def normalize_rpc_url(url: str) -> str:
    if url.startswith("http://") or url.startswith("https://"):
        return url
    return f"http://{url}/"


def rpc_url_from_listen(listen: str) -> str:
    host, sep, port = listen.rpartition(":")
    if not sep:
        raise ValueError(f"jsonrpc listen value must include a port: {listen}")
    if host in {"", "0.0.0.0", "::"}:
        host = "127.0.0.1"
    if host.startswith("[") and host.endswith("]"):
        return f"http://{host}:{port}/"
    return f"http://{host}:{port}/"


def rpc_call(url: str, method: str, params: dict[str, Any] | None = None, timeout: int = 15) -> tuple[dict[str, Any], float]:
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}).encode()
    req = request.Request(
        normalize_rpc_url(url),
        data=body,
        headers={"content-type": "application/json", "user-agent": "teleno-monolith-benchmark/1.0"},
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


def extract_head_height(result: dict[str, Any]) -> int | None:
    candidates = [
        result.get("head_topology", {}).get("height") if isinstance(result.get("head_topology"), dict) else None,
        result.get("head_info", {}).get("head_topology", {}).get("height") if isinstance(result.get("head_info"), dict) else None,
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


def read_pid_file(path: Path) -> int | None:
    try:
        text = path.read_text().strip()
    except OSError:
        return None
    if not text:
        return None
    try:
        return int(text.split()[0])
    except ValueError:
        return None


def process_exists(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def resolve_pid(pid: int | None, pid_file: str | None) -> tuple[int | None, str]:
    if pid:
        return (pid, "argument") if process_exists(pid) else (None, f"argument pid {pid} is not running")

    if pid_file:
        path = Path(pid_file)
        file_pid = read_pid_file(path)
        if file_pid and process_exists(file_pid):
            return file_pid, f"pid-file:{path}"
        return None, f"pid-file:{path} unavailable or stale"

    if DEFAULT_PID_FILE.exists():
        file_pid = read_pid_file(DEFAULT_PID_FILE)
        if file_pid and process_exists(file_pid):
            return file_pid, f"default-pid-file:{DEFAULT_PID_FILE}"

    result = run_command(["pgrep", "-f", "koinos_node"], timeout=5)
    if result["returncode"] == 0:
        pids = []
        for line in result["stdout"].splitlines():
            try:
                candidate = int(line.strip())
            except ValueError:
                continue
            if process_exists(candidate):
                pids.append(candidate)
        if len(pids) == 1:
            return pids[0], "pgrep"
        if len(pids) > 1:
            return None, f"multiple koinos_node processes found: {pids}"

    return None, "not found"


def sample_process(pid: int) -> dict[str, Any]:
    formats = [
        ["ps", "-o", "rss=", "-o", "pcpu=", "-p", str(pid)],
        ["ps", "-o", "rss=", "-o", "%cpu=", "-p", str(pid)],
    ]
    last_error = ""
    for args in formats:
        result = run_command(args, timeout=5)
        if result["returncode"] != 0:
            last_error = result["stderr"] or result["stdout"]
            continue
        parts = result["stdout"].split()
        if len(parts) < 2:
            last_error = f"unexpected ps output: {result['stdout']}"
            continue
        try:
            rss_kib = int(float(parts[0]))
            cpu_pct = float(parts[1])
            return {
                "ok": True,
                "rss_mb": round(rss_kib / 1024, 3),
                "cpu_percent": round(cpu_pct, 3),
            }
        except ValueError as exc:
            last_error = str(exc)
    return {"ok": False, "error": last_error or "ps failed"}


def parse_log_timestamp(line: str) -> datetime | None:
    match = TIMESTAMP_RE.search(line)
    if not match:
        return None
    value = match.group("ts")
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def parse_log_indexing_speed(log_file: Path) -> dict[str, Any]:
    if not log_file.exists():
        return {"status": "not_found", "path": str(log_file)}

    points: list[tuple[datetime, int]] = []
    lines_scanned = 0
    try:
        with log_file.open("r", errors="replace") as handle:
            for line in handle:
                lines_scanned += 1
                if not INDEXING_HINT_RE.search(line):
                    continue
                ts = parse_log_timestamp(line)
                if not ts:
                    continue
                matches = HEIGHT_RE.findall(line)
                if not matches:
                    continue
                try:
                    height = int(matches[-1])
                except ValueError:
                    continue
                points.append((ts, height))
    except OSError as exc:
        return {"status": "error", "path": str(log_file), "error": str(exc)}

    if len(points) < 2:
        return {
            "status": "insufficient_data",
            "path": str(log_file),
            "lines_scanned": lines_scanned,
            "points": len(points),
        }

    first = points[0]
    last = points[-1]
    seconds = max((last[0] - first[0]).total_seconds(), 0.0)
    height_delta = last[1] - first[1]
    rate = height_delta / seconds if seconds > 0 and height_delta >= 0 else None
    return {
        "status": "ok" if rate is not None else "non_monotonic",
        "path": str(log_file),
        "lines_scanned": lines_scanned,
        "points": len(points),
        "first_height": first[1],
        "last_height": last[1],
        "height_delta": height_delta,
        "seconds": round(seconds, 3),
        "blocks_per_second": round(rate, 3) if rate is not None else None,
    }


def launch_node(args: argparse.Namespace, result_dir: Path) -> tuple[subprocess.Popen[bytes] | None, int | None, float | None, Path | None]:
    if not args.launch_bin:
        return None, None, None, None
    if not args.launch_basedir:
        raise ValueError("--launch-basedir is required with --launch-bin")

    bin_path = Path(args.launch_bin)
    if not bin_path.exists():
        raise FileNotFoundError(str(bin_path))

    log_path = Path(args.launch_log) if args.launch_log else result_dir / "launched-teleno-node.log"
    log_handle = log_path.open("ab", buffering=0)
    cmd = [str(bin_path), "--basedir", args.launch_basedir, "--jsonrpc-listen", args.jsonrpc_listen]
    if args.launch_config:
        cmd.extend(["--config", args.launch_config])
    for disable in args.disable:
        cmd.extend(["--disable", disable])
    for enable in args.enable:
        cmd.extend(["--enable", enable])
    if args.launch_extra_arg:
        cmd.extend(args.launch_extra_arg)

    proc: subprocess.Popen[bytes] | None = None
    try:
        started = time.perf_counter()
        proc = subprocess.Popen(cmd, stdout=log_handle, stderr=subprocess.STDOUT)
        startup_ms = None
        deadline = time.time() + args.startup_timeout_seconds
        last_error = ""
        while time.time() < deadline:
            if proc.poll() is not None:
                raise RuntimeError(f"koinos_node exited during startup with code {proc.returncode}; log={log_path}")
            try:
                rpc_call(args.rpc_url, "chain.get_head_info", timeout=args.rpc_timeout)
                startup_ms = (time.perf_counter() - started) * 1000
                break
            except Exception as exc:  # noqa: BLE001 - startup polling records best effort error only.
                last_error = str(exc)
                time.sleep(args.startup_poll_interval)

        if startup_ms is None:
            raise RuntimeError(f"JSON-RPC did not become ready before timeout; last_error={last_error}; log={log_path}")
    except Exception:
        if proc and proc.poll() is None:
            terminate_launched_process(proc)
        log_handle.close()
        raise

    log_handle.close()
    return proc, proc.pid, startup_ms, log_path


def terminate_launched_process(proc: subprocess.Popen[bytes], timeout: int = 20) -> None:
    if proc.poll() is not None:
        return
    proc.send_signal(signal.SIGTERM)
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=timeout)


def benchmark_rpc(args: argparse.Namespace) -> tuple[dict[str, Any], list[int]]:
    method_results: dict[str, dict[str, Any]] = {}
    observed_heights: list[int] = []

    for method in args.method:
        latencies: list[float] = []
        errors: list[str] = []
        for _ in range(args.warmup_requests):
            try:
                rpc_call(args.rpc_url, method, timeout=args.rpc_timeout)
            except Exception as exc:  # noqa: BLE001 - report all warmup errors.
                errors.append(f"warmup: {exc}")
        for _ in range(args.latency_requests):
            try:
                payload, elapsed_ms = rpc_call(args.rpc_url, method, timeout=args.rpc_timeout)
                latencies.append(elapsed_ms)
                if method == "chain.get_head_info":
                    height = extract_head_height(payload)
                    if height is not None:
                        observed_heights.append(height)
            except Exception as exc:  # noqa: BLE001 - continue to report partial benchmark.
                errors.append(str(exc))
        method_results[method] = {
            "latency_ms": summarize(latencies),
            "errors": errors[:20],
            "error_count": len(errors),
        }

    return method_results, observed_heights


def sample_health(args: argparse.Namespace, pid: int | None) -> tuple[list[dict[str, Any]], list[int]]:
    samples: list[dict[str, Any]] = []
    heights: list[int] = []
    if args.duration_seconds <= 0:
        return samples, heights

    deadline = time.time() + args.duration_seconds
    while time.time() <= deadline:
        sample: dict[str, Any] = {"timestamp": utc_now()}
        try:
            payload, elapsed_ms = rpc_call(args.rpc_url, "chain.get_head_info", timeout=args.rpc_timeout)
            sample["head_rpc_latency_ms"] = round(elapsed_ms, 3)
            height = extract_head_height(payload)
            sample["head_height"] = height
            if height is not None:
                heights.append(height)
        except Exception as exc:  # noqa: BLE001
            sample["head_error"] = str(exc)
        if pid:
            sample["process"] = sample_process(pid)
        samples.append(sample)
        if args.interval_seconds <= 0:
            break
        remaining = deadline - time.time()
        if remaining <= 0:
            break
        time.sleep(min(args.interval_seconds, remaining))
    return samples, heights


def summarize_process_samples(samples: list[dict[str, Any]]) -> dict[str, Any]:
    rss_values: list[float] = []
    cpu_values: list[float] = []
    errors: list[str] = []
    for sample in samples:
        process = sample.get("process")
        if not isinstance(process, dict):
            continue
        if process.get("ok"):
            rss_values.append(float(process["rss_mb"]))
            cpu_values.append(float(process["cpu_percent"]))
        elif process.get("error"):
            errors.append(str(process["error"]))
    return {
        "rss_mb": summarize(rss_values),
        "cpu_percent": summarize(cpu_values),
        "errors": errors[:20],
        "error_count": len(errors),
    }


def summarize_height_progress(heights: list[int], elapsed_seconds: float) -> dict[str, Any]:
    if not heights:
        return {"status": "no_height_samples"}
    first = heights[0]
    last = heights[-1]
    delta = last - first
    return {
        "status": "ok",
        "first": first,
        "last": last,
        "delta": delta,
        "elapsed_seconds": round(elapsed_seconds, 3),
        "blocks_per_second": round(delta / elapsed_seconds, 3) if elapsed_seconds > 0 else None,
    }


def write_outputs(result: dict[str, Any], result_dir: Path) -> None:
    json_path = result_dir / "result.json"
    md_path = result_dir / "result.md"
    json_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")

    lines = [
        "# Monolith Benchmark Result",
        "",
        f"- Status: `{result['status']}`",
        f"- Started: `{result['started_at']}`",
        f"- Finished: `{result['finished_at']}`",
        f"- RPC URL: `{result['rpc_url']}`",
        f"- PID: `{result.get('pid') or 'not-sampled'}`",
    ]
    if result.get("startup_ms") is not None:
        lines.append(f"- Startup to JSON-RPC: `{result['startup_ms']} ms`")
    lines.extend(
        [
            "",
            "## JSON-RPC Latency",
            "",
            "| Method | Requests | Errors | Mean ms | p50 ms | p95 ms | p99 ms | Max ms |",
            "|---|---:|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for method, data in result["rpc"].items():
        stats = data["latency_ms"]
        lines.append(
            "| {method} | {count} | {errors} | {mean} | {p50} | {p95} | {p99} | {maxv} |".format(
                method=method,
                count=stats.get("count", 0),
                errors=data.get("error_count", 0),
                mean=stats.get("mean", ""),
                p50=stats.get("p50", ""),
                p95=stats.get("p95", ""),
                p99=stats.get("p99", ""),
                maxv=stats.get("max", ""),
            )
        )
    process = result.get("process", {})
    if process:
        rss = process.get("rss_mb", {})
        cpu = process.get("cpu_percent", {})
        lines.extend(
            [
                "",
                "## Process Samples",
                "",
                f"- RSS MB: `mean={rss.get('mean', '')} p95={rss.get('p95', '')} max={rss.get('max', '')}`",
                f"- CPU percent: `mean={cpu.get('mean', '')} p95={cpu.get('p95', '')} max={cpu.get('max', '')}`",
            ]
        )
    lines.extend(
        [
            "",
            "## Head Progress",
            "",
            f"- RPC sample progress: `{result.get('head_progress', {})}`",
            f"- Log-derived indexing speed: `{result.get('log_indexing_speed', {})}`",
            "",
            f"JSON result: `{json_path}`",
            "",
        ]
    )
    md_path.write_text("\n".join(lines))
    result["json_path"] = str(json_path)
    result["markdown_path"] = str(md_path)
    json_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark a Koinos monolith node without mutating chain state.")
    parser.add_argument("--rpc-url", default=os.getenv("RPC_URL", DEFAULT_RPC_URL), help="JSON-RPC endpoint to benchmark.")
    parser.add_argument("--method", action="append", default=None, help="JSON-RPC method to benchmark. Repeatable.")
    parser.add_argument("--warmup-requests", type=int, default=int(os.getenv("WARMUP_REQUESTS", "5")))
    parser.add_argument("--latency-requests", type=int, default=int(os.getenv("LATENCY_REQUESTS", "100")))
    parser.add_argument("--duration-seconds", type=float, default=float(os.getenv("DURATION_SECONDS", "30")))
    parser.add_argument("--interval-seconds", type=float, default=float(os.getenv("INTERVAL_SECONDS", "1")))
    parser.add_argument("--rpc-timeout", type=int, default=int(os.getenv("RPC_TIMEOUT", "15")))
    parser.add_argument("--pid", type=int, default=int(os.getenv("PID", "0")) or None)
    parser.add_argument("--pid-file", default=os.getenv("PID_FILE", ""))
    parser.add_argument("--log-file", default=os.getenv("LOG_FILE", str(DEFAULT_LOG_FILE if DEFAULT_LOG_FILE.exists() else "")))
    parser.add_argument("--result-dir", default=os.getenv("RESULT_DIR", ""))

    parser.add_argument("--launch-bin", default=os.getenv("LAUNCH_BIN", ""), help="Optional koinos_node binary to launch for startup benchmarking.")
    parser.add_argument("--launch-basedir", default=os.getenv("LAUNCH_BASEDIR", ""), help="Basedir for launched node.")
    parser.add_argument("--launch-config", default=os.getenv("LAUNCH_CONFIG", ""), help="Config path for launched node.")
    parser.add_argument("--launch-log", default=os.getenv("LAUNCH_LOG", ""), help="Log path for launched node.")
    parser.add_argument("--jsonrpc-listen", default=os.getenv("JSONRPC_LISTEN", "127.0.0.1:18122"))
    parser.add_argument("--startup-timeout-seconds", type=float, default=float(os.getenv("STARTUP_TIMEOUT_SECONDS", "60")))
    parser.add_argument("--startup-poll-interval", type=float, default=float(os.getenv("STARTUP_POLL_INTERVAL", "0.25")))
    parser.add_argument("--keep-running", action=argparse.BooleanOptionalAction, default=os.getenv("KEEP_RUNNING", "0") == "1")
    parser.add_argument("--disable", action="append", default=[], help="Component to disable when launching. Repeatable.")
    parser.add_argument("--enable", action="append", default=[], help="Component to enable when launching. Repeatable.")
    parser.add_argument("--launch-extra-arg", action="append", default=[], help="Extra raw argument for launched koinos_node. Repeatable.")
    args = parser.parse_args()

    args.method = args.method or ["chain.get_head_info"]
    if args.launch_bin:
        args.rpc_url = args.rpc_url or rpc_url_from_listen(args.jsonrpc_listen)
        if args.rpc_url == DEFAULT_RPC_URL and args.jsonrpc_listen != "127.0.0.1:18122":
            args.rpc_url = rpc_url_from_listen(args.jsonrpc_listen)
    args.rpc_url = normalize_rpc_url(args.rpc_url)
    return args


def main() -> int:
    args = parse_args()
    result_dir = Path(args.result_dir) if args.result_dir else Path("/private/tmp/teleno-monolith-benchmarks") / safe_timestamp()
    result_dir.mkdir(parents=True, exist_ok=True)

    launched_proc: subprocess.Popen[bytes] | None = None
    launched_log: Path | None = None
    startup_ms: float | None = None
    pid: int | None = None
    pid_source = ""
    started_wall = utc_now()
    started_timer = time.perf_counter()
    errors: list[str] = []

    try:
        launched_proc, launched_pid, startup_ms, launched_log = launch_node(args, result_dir)
        if launched_pid:
            pid = launched_pid
            pid_source = "launched"
    except Exception as exc:  # noqa: BLE001
        errors.append(str(exc))

    if not pid:
        pid, pid_source = resolve_pid(args.pid, args.pid_file)

    rpc_results: dict[str, Any] = {}
    latency_heights: list[int] = []
    samples: list[dict[str, Any]] = []
    sample_heights: list[int] = []
    try:
        rpc_results, latency_heights = benchmark_rpc(args)
        samples, sample_heights = sample_health(args, pid)
    except Exception as exc:  # noqa: BLE001
        errors.append(str(exc))

    elapsed_seconds = time.perf_counter() - started_timer
    all_heights = latency_heights + sample_heights
    process_summary = summarize_process_samples(samples)
    log_indexing_speed = parse_log_indexing_speed(Path(args.log_file)) if args.log_file else {"status": "not_configured"}

    rpc_error_count = sum(data.get("error_count", 0) for data in rpc_results.values())
    status = "pass"
    if errors or not rpc_results or all(data["latency_ms"].get("count", 0) == 0 for data in rpc_results.values()):
        status = "fail"
    elif rpc_error_count > 0 or not pid:
        status = "warn"

    result: dict[str, Any] = {
        "status": status,
        "started_at": started_wall,
        "finished_at": utc_now(),
        "elapsed_seconds": round(elapsed_seconds, 3),
        "repository": str(ROOT_DIR),
        "git_branch": git_value(["branch", "--show-current"]),
        "git_commit": git_value(["rev-parse", "--short", "HEAD"]),
        "host": platform.node(),
        "platform": platform.platform(),
        "python": sys.version.split()[0],
        "rpc_url": args.rpc_url,
        "pid": pid,
        "pid_source": pid_source,
        "startup_ms": round(startup_ms, 3) if startup_ms is not None else None,
        "launched_log": str(launched_log) if launched_log else "",
        "rpc": rpc_results,
        "samples": samples,
        "process": process_summary,
        "head_progress": summarize_height_progress(all_heights, elapsed_seconds),
        "log_indexing_speed": log_indexing_speed,
        "errors": errors,
    }

    write_outputs(result, result_dir)

    if launched_proc and not args.keep_running:
        terminate_launched_process(launched_proc)
        result["launched_process_terminated"] = True
        write_outputs(result, result_dir)
    elif launched_proc:
        result["launched_process_terminated"] = False
        write_outputs(result, result_dir)

    print(json.dumps({"status": result["status"], "result_dir": str(result_dir), "json": result["json_path"], "markdown": result["markdown_path"]}, indent=2))
    return 0 if result["status"] in {"pass", "warn"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
