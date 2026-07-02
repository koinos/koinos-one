#!/usr/bin/env python3
"""Audit stored block receipts by re-executing blocks into a fresh state DB.

This is a root-cause diagnostic for restored/saved block stores. It reads blocks
and receipts from a source block_store, submits the same blocks to a clean audit
node so the chain controller regenerates receipts, and compares the regenerated
state merkle root and state delta entries with the historical stored receipt.

The source basedir is opened read-only by behavior: the source node is started
with chain, P2P, mempool, gRPC, producer, and indexing services disabled, and the
script only calls block_store read methods. For the strictest source isolation,
start your own block_store JSON-RPC endpoint against a copied DB and pass
--source-rpc-url.
"""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
import re
import signal
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_BASEDIR = Path("/Volumes/external/knodel-monolith-restore/basedir")
DEFAULT_REPORT_ROOT = (
    Path("/Volumes/external/teleno-state-delta-audit")
    if Path("/Volumes/external").exists()
    else Path("/private/tmp/teleno-state-delta-audit")
)

WARNING_RE = re.compile(r"<warning|\bwarning\b", re.IGNORECASE)
ERROR_RE = re.compile(r"<error|\berror\b", re.IGNORECASE)
ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
_RPC_CONNECTIONS: dict[tuple[str, str, int, str], http.client.HTTPConnection] = {}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def safe_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def choose_default_bin() -> Path:
    candidates = [
        ROOT_DIR / "node/teleno-node/build/src/teleno_node",
        ROOT_DIR / "node/teleno-node/build/teleno_node",
        ROOT_DIR / "build/bundle-staging/teleno/bin/teleno_node",
    ]
    for candidate in candidates:
        if candidate.exists() and os.access(candidate, os.X_OK):
            return candidate
    return candidates[0]


def normalize_rpc_url(url: str) -> str:
    if url.startswith("http://") or url.startswith("https://"):
        return url
    return f"http://{url}/"


def rpc_call(url: str, method: str, params: dict[str, Any] | None = None, timeout: float = 30) -> dict[str, Any]:
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}).encode()
    parsed_url = urlparse(normalize_rpc_url(url))
    scheme = parsed_url.scheme or "http"
    host = parsed_url.hostname or "127.0.0.1"
    port = parsed_url.port or (443 if scheme == "https" else 80)
    path = parsed_url.path or "/"
    key = (scheme, host, port, path)

    def make_connection() -> http.client.HTTPConnection:
        if scheme == "https":
            return http.client.HTTPSConnection(host, port, timeout=timeout)
        return http.client.HTTPConnection(host, port, timeout=timeout)

    last_error: Exception | None = None
    for attempt in range(2):
        conn = _RPC_CONNECTIONS.get(key)
        if conn is None:
            conn = make_connection()
            _RPC_CONNECTIONS[key] = conn
        try:
            conn.request(
                "POST",
                path,
                body=payload,
                headers={
                    "content-type": "application/json",
                    "content-length": str(len(payload)),
                    "connection": "keep-alive",
                    "user-agent": "teleno-state-delta-audit/1.0",
                },
            )
            response = conn.getresponse()
            data = response.read().decode()
            if response.status < 200 or response.status >= 300:
                raise RuntimeError(f"{method} HTTP {response.status}: {data}")
            parsed = json.loads(data)
            break
        except (OSError, http.client.HTTPException, json.JSONDecodeError, RuntimeError) as exc:
            last_error = exc
            old_conn = _RPC_CONNECTIONS.pop(key, None)
            if old_conn is not None:
                old_conn.close()
            if attempt == 0:
                continue
            raise RuntimeError(f"{method} failed: {exc}") from exc
    else:
        raise RuntimeError(f"{method} failed: {last_error}")

    if "error" in parsed:
        raise RuntimeError(f"{method} error: {json.dumps(parsed['error'], sort_keys=True)}")
    if "result" not in parsed:
        raise RuntimeError(f"{method} missing result: {json.dumps(parsed, sort_keys=True)}")
    return parsed["result"]


def port_is_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(("127.0.0.1", port)) != 0


def terminate_process(proc: subprocess.Popen[bytes], timeout: int = 20) -> None:
    if proc.poll() is not None:
        return
    proc.send_signal(signal.SIGTERM)
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=timeout)


def git_value(args: list[str]) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT_DIR, text=True, capture_output=True, check=False)
    if result.returncode != 0:
        return ""
    return result.stdout.strip().splitlines()[0] if result.stdout.strip() else ""


def log_counts(log_path: Path) -> dict[str, int]:
    try:
        lines = log_path.read_text(errors="replace").splitlines()
    except OSError:
        return {"warning_rows": 0, "error_rows": 0}
    lines = [ANSI_RE.sub("", line) for line in lines]
    return {
        "warning_rows": sum(1 for line in lines if WARNING_RE.search(line)),
        "error_rows": sum(1 for line in lines if ERROR_RE.search(line)),
    }


def append_jsonl(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as output:
        output.write(json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n")


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def write_audit_config(basedir: Path, jsonrpc_port: int, chain_jobs: int, rocksdb_jobs: int) -> Path:
    path = basedir / "config.yml"
    path.write_text(
        "\n".join(
            [
                "global:",
                "  instance-id: state-delta-audit",
                "  log-level: info",
                "  log-color: false",
                "  log-datetime: true",
                "  fork-algorithm: pob",
                "chain:",
                f"  jobs: {chain_jobs}",
                "  verify-blocks: true",
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
        + "\n"
    )
    return path


def prepare_audit_basedir(source_basedir: Path, audit_basedir: Path, jsonrpc_port: int, chain_jobs: int, rocksdb_jobs: int) -> Path:
    if audit_basedir.exists():
        raise RuntimeError(f"audit basedir already exists: {audit_basedir}")
    (audit_basedir / "chain").mkdir(parents=True, exist_ok=True)
    (audit_basedir / "jsonrpc/descriptors").mkdir(parents=True, exist_ok=True)

    genesis = source_basedir / "chain/genesis_data.json"
    descriptors = source_basedir / "jsonrpc/descriptors/koinos_descriptors.pb"
    if not genesis.exists():
        raise FileNotFoundError(f"missing source genesis: {genesis}")
    if not descriptors.exists():
        raise FileNotFoundError(f"missing source descriptors: {descriptors}")

    (audit_basedir / "chain/genesis_data.json").write_bytes(genesis.read_bytes())
    (audit_basedir / "genesis_data.json").write_bytes(genesis.read_bytes())
    (audit_basedir / "jsonrpc/descriptors/koinos_descriptors.pb").write_bytes(descriptors.read_bytes())
    return write_audit_config(audit_basedir, jsonrpc_port, chain_jobs, rocksdb_jobs)


def launch_node(
    bin_path: Path,
    basedir: Path,
    config: Path | None,
    port: int,
    log_path: Path,
    extra_args: list[str] | None = None,
) -> subprocess.Popen[bytes]:
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


def wait_for_rpc(url: str, proc: subprocess.Popen[bytes] | None, timeout: float) -> None:
    deadline = time.time() + timeout
    last_error = ""
    while time.time() < deadline:
        if proc is not None and proc.poll() is not None:
            raise RuntimeError(f"teleno_node exited before JSON-RPC readiness with code {proc.returncode}")
        try:
            rpc_call(url, "block_store.get_highest_block", {}, timeout=5)
            return
        except Exception as exc:  # noqa: BLE001
            last_error = str(exc)
            time.sleep(0.25)
    raise RuntimeError(f"JSON-RPC not ready before timeout: {last_error}")


def canonical(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): canonical(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [canonical(item) for item in value]
    return value


def stable_json(value: Any) -> str:
    return json.dumps(canonical(value), sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def stable_hash(value: Any) -> str:
    return hashlib.sha256(stable_json(value).encode()).hexdigest()


def sorted_delta_hash(deltas: list[Any]) -> str:
    normalized = [stable_json(delta) for delta in deltas]
    return hashlib.sha256(json.dumps(sorted(normalized), separators=(",", ":")).encode()).hexdigest()


def first_list_difference(left: list[Any], right: list[Any]) -> dict[str, Any] | None:
    limit = min(len(left), len(right))
    for index in range(limit):
        if canonical(left[index]) != canonical(right[index]):
            return {"index": index, "stored": left[index], "regenerated": right[index]}
    if len(left) != len(right):
        return {
            "index": limit,
            "stored": left[limit] if limit < len(left) else None,
            "regenerated": right[limit] if limit < len(right) else None,
        }
    return None


def receipt_delta_summary(receipt: dict[str, Any]) -> dict[str, Any]:
    deltas = receipt.get("state_delta_entries") or []
    tx_receipts = receipt.get("transaction_receipts") or []
    tx_delta_hashes = []
    for index, tx_receipt in enumerate(tx_receipts):
        tx_deltas = tx_receipt.get("state_delta_entries") or []
        tx_delta_hashes.append(
            {
                "index": index,
                "id": tx_receipt.get("id", ""),
                "delta_count": len(tx_deltas),
                "ordered_hash": stable_hash(tx_deltas),
                "sorted_hash": sorted_delta_hash(tx_deltas),
            }
        )
    return {
        "id": receipt.get("id", ""),
        "state_merkle_root": receipt.get("state_merkle_root", ""),
        "delta_count": len(deltas),
        "delta_ordered_hash": stable_hash(deltas),
        "delta_sorted_hash": sorted_delta_hash(deltas),
        "transaction_receipt_count": len(tx_receipts),
        "transaction_delta_hashes": tx_delta_hashes,
    }


def compare_transaction_deltas(stored_receipt: dict[str, Any], regenerated_receipt: dict[str, Any]) -> dict[str, Any]:
    stored_txs = stored_receipt.get("transaction_receipts") or []
    regenerated_txs = regenerated_receipt.get("transaction_receipts") or []
    result: dict[str, Any] = {
        "match": True,
        "stored_count": len(stored_txs),
        "regenerated_count": len(regenerated_txs),
        "first_mismatch": None,
    }
    if len(stored_txs) != len(regenerated_txs):
        result["match"] = False
        result["first_mismatch"] = {
            "index": min(len(stored_txs), len(regenerated_txs)),
            "reason": "transaction receipt count differs",
        }
        return result

    for index, (stored_tx, regenerated_tx) in enumerate(zip(stored_txs, regenerated_txs)):
        stored_deltas = stored_tx.get("state_delta_entries") or []
        regenerated_deltas = regenerated_tx.get("state_delta_entries") or []
        if canonical(stored_deltas) != canonical(regenerated_deltas):
            result["match"] = False
            result["first_mismatch"] = {
                "index": index,
                "stored_id": stored_tx.get("id", ""),
                "regenerated_id": regenerated_tx.get("id", ""),
                "stored_delta_count": len(stored_deltas),
                "regenerated_delta_count": len(regenerated_deltas),
                "stored_ordered_hash": stable_hash(stored_deltas),
                "regenerated_ordered_hash": stable_hash(regenerated_deltas),
                "stored_sorted_hash": sorted_delta_hash(stored_deltas),
                "regenerated_sorted_hash": sorted_delta_hash(regenerated_deltas),
                "first_delta_difference": first_list_difference(stored_deltas, regenerated_deltas),
            }
            return result
    return result


def classify_comparison(stored_receipt: dict[str, Any], regenerated_receipt: dict[str, Any]) -> dict[str, Any]:
    stored_deltas = stored_receipt.get("state_delta_entries") or []
    regenerated_deltas = regenerated_receipt.get("state_delta_entries") or []
    stored_root = stored_receipt.get("state_merkle_root", "")
    regenerated_root = regenerated_receipt.get("state_merkle_root", "")
    merkle_comparable = bool(stored_root and regenerated_root)
    merkle_match = (stored_root == regenerated_root) if merkle_comparable else False
    block_deltas_match = canonical(stored_deltas) == canonical(regenerated_deltas)
    tx_deltas = compare_transaction_deltas(stored_receipt, regenerated_receipt)
    status = "ok" if (not merkle_comparable or merkle_match) and block_deltas_match and tx_deltas["match"] else "mismatch"
    return {
        "status": status,
        "merkle_comparable": merkle_comparable,
        "merkle_match": merkle_match,
        "missing_stored_state_merkle_root": not bool(stored_root),
        "missing_regenerated_state_merkle_root": not bool(regenerated_root),
        "block_deltas_match": block_deltas_match,
        "transaction_deltas_match": tx_deltas["match"],
        "stored": receipt_delta_summary(stored_receipt),
        "regenerated": receipt_delta_summary(regenerated_receipt),
        "first_block_delta_difference": None if block_deltas_match else first_list_difference(stored_deltas, regenerated_deltas),
        "transaction_delta_difference": tx_deltas["first_mismatch"],
    }


def extract_height(topology: dict[str, Any]) -> int:
    value = topology.get("height")
    return int(value) if value is not None else 0


def get_source_highest(source_url: str, timeout: float) -> dict[str, Any]:
    highest = rpc_call(source_url, "block_store.get_highest_block", {}, timeout=timeout)
    topology = highest.get("topology") or {}
    if not topology.get("id"):
        raise RuntimeError(f"source highest block has no id: {topology}")
    return topology


def get_source_batch(source_url: str, head_block_id: str, start: int, count: int, timeout: float) -> list[dict[str, Any]]:
    result = rpc_call(
        source_url,
        "block_store.get_blocks_by_height",
        {
            "head_block_id": head_block_id,
            "ancestor_start_height": str(start),
            "num_blocks": count,
            "return_block": True,
            "return_receipt": True,
        },
        timeout=timeout,
    )
    return result.get("block_items") or []


def audit_range(args: argparse.Namespace, source_url: str, audit_url: str, source_topology: dict[str, Any]) -> dict[str, Any]:
    source_head_id = source_topology["id"]
    checked = 0
    mismatches = 0
    missing_receipts = 0
    missing_source_merkle_roots = 0
    submit_failures = 0
    first_problem: dict[str, Any] | None = None
    problems: list[dict[str, Any]] = []
    batches: list[dict[str, Any]] = []
    started = time.perf_counter()
    progress_file = args.progress_file
    checkpoint_file = args.checkpoint_file
    append_jsonl(
        progress_file,
        {
            "event": "started",
            "timestamp": utc_now(),
            "start_height": args.start_height,
            "end_height": args.end_height,
            "batch_size": args.batch_size,
            "source_topology": source_topology,
        },
    )

    audit_head_info = rpc_call(audit_url, "chain.get_head_info", {}, timeout=args.rpc_timeout)
    audit_head_root = audit_head_info.get("head_state_merkle_root", "")

    height = args.start_height
    while height <= args.end_height:
        count = min(args.batch_size, args.end_height - height + 1)
        batch_started = time.perf_counter()
        items = get_source_batch(source_url, source_head_id, height, count, args.rpc_timeout)
        if len(items) != count:
            raise RuntimeError(f"expected {count} source block items at height {height}, got {len(items)}")

        for item in items:
            block = item.get("block")
            source_receipt = item.get("receipt") or {}
            block_height = int(item.get("block_height") or block.get("header", {}).get("height") or height)
            block_id = block.get("id", "") if isinstance(block, dict) else ""
            header = block.get("header", {}) if isinstance(block, dict) else {}
            before_root = audit_head_root
            expected_previous_root = header.get("previous_state_merkle_root", "")

            if not source_receipt:
                missing_receipts += 1
                problem = {
                    "height": block_height,
                    "block_id": block_id,
                    "status": "missing_source_receipt",
                }
                problems.append(problem)
                first_problem = first_problem or problem
                if not args.continue_on_mismatch:
                    return build_audit_summary(
                        args,
                        started,
                        checked,
                        mismatches,
                        missing_receipts,
                        missing_source_merkle_roots,
                        submit_failures,
                        first_problem,
                        problems,
                        batches,
                    )

            if expected_previous_root and before_root and expected_previous_root != before_root:
                problem = {
                    "height": block_height,
                    "block_id": block_id,
                    "status": "previous_state_root_mismatch_before_submit",
                    "expected_previous_state_merkle_root": expected_previous_root,
                    "audit_head_state_merkle_root": before_root,
                    "audit_head": audit_head_info.get("head_topology", {}),
                }
                mismatches += 1
                problems.append(problem)
                first_problem = first_problem or problem
                if not args.continue_on_mismatch:
                    return build_audit_summary(
                        args,
                        started,
                        checked,
                        mismatches,
                        missing_receipts,
                        missing_source_merkle_roots,
                        submit_failures,
                        first_problem,
                        problems,
                        batches,
                    )

            try:
                submitted = rpc_call(audit_url, "chain.submit_block", {"block": block}, timeout=args.rpc_timeout)
            except Exception as exc:  # noqa: BLE001
                submit_failures += 1
                problem = {
                    "height": block_height,
                    "block_id": block_id,
                    "status": "submit_block_failed",
                    "error": str(exc),
                    "stored": receipt_delta_summary(source_receipt) if source_receipt else {},
                }
                problems.append(problem)
                first_problem = first_problem or problem
                if not args.continue_on_mismatch:
                    return build_audit_summary(
                        args,
                        started,
                        checked,
                        mismatches,
                        missing_receipts,
                        missing_source_merkle_roots,
                        submit_failures,
                        first_problem,
                        problems,
                        batches,
                    )
                continue

            regenerated_receipt = submitted.get("receipt") or {}
            audit_head_root = regenerated_receipt.get("state_merkle_root", audit_head_root)
            audit_head_info = {
                "head_topology": {
                    "height": str(block_height),
                    "id": block_id,
                    "previous": header.get("previous", ""),
                },
                "head_state_merkle_root": audit_head_root,
            }
            comparison = classify_comparison(source_receipt, regenerated_receipt)
            checked += 1
            if comparison["missing_stored_state_merkle_root"]:
                missing_source_merkle_roots += 1
            if comparison["status"] != "ok":
                mismatches += 1
                problem = {
                    "height": block_height,
                    "block_id": block_id,
                    "status": comparison["status"],
                    "block_header_previous_state_merkle_root": expected_previous_root,
                    **comparison,
                }
                problems.append(problem)
                first_problem = first_problem or problem
                if not args.continue_on_mismatch:
                    return build_audit_summary(
                        args,
                        started,
                        checked,
                        mismatches,
                        missing_receipts,
                        missing_source_merkle_roots,
                        submit_failures,
                        first_problem,
                        problems,
                        batches,
                    )

        elapsed = time.perf_counter() - batch_started
        batch_record = {
            "event": "batch",
            "timestamp": utc_now(),
            "start_height": height,
            "end_height": height + count - 1,
            "count": count,
            "elapsed_seconds": round(elapsed, 3),
            "blocks_per_second": round(count / elapsed, 3) if elapsed > 0 else None,
            "checked_so_far": checked,
            "mismatches_so_far": mismatches,
            "missing_source_receipts_so_far": missing_receipts,
            "missing_source_merkle_roots_so_far": missing_source_merkle_roots,
            "submit_failures_so_far": submit_failures,
        }
        append_jsonl(progress_file, batch_record)
        write_json(
            checkpoint_file,
            {
                "timestamp": utc_now(),
                "last_completed_height": height + count - 1,
                "next_start_height": height + count,
                "end_height": args.end_height,
                "checked_blocks": checked,
                "mismatches": mismatches,
                "missing_source_receipts": missing_receipts,
                "missing_source_merkle_roots": missing_source_merkle_roots,
                "submit_failures": submit_failures,
                "audit_head_state_merkle_root": audit_head_root,
                "audit_head": audit_head_info.get("head_topology", {}),
            },
        )
        batches.append(batch_record)
        if len(batches) > args.max_batch_records:
            batches = batches[-args.max_batch_records:]
        print(
            f"height {height:,}-{height + count - 1:,}: checked={checked:,} mismatches={mismatches:,}",
            flush=True,
        )
        height += count

    return build_audit_summary(
        args,
        started,
        checked,
        mismatches,
        missing_receipts,
        missing_source_merkle_roots,
        submit_failures,
        first_problem,
        problems,
        batches,
    )


def build_audit_summary(
    args: argparse.Namespace,
    started: float,
    checked: int,
    mismatches: int,
    missing_receipts: int,
    missing_source_merkle_roots: int,
    submit_failures: int,
    first_problem: dict[str, Any] | None,
    problems: list[dict[str, Any]],
    batches: list[dict[str, Any]],
) -> dict[str, Any]:
    elapsed = time.perf_counter() - started
    status = "pass" if mismatches == 0 and missing_receipts == 0 and submit_failures == 0 else "fail"
    return {
        "status": status,
        "range": {"start_height": args.start_height, "end_height": args.end_height},
        "checked_blocks": checked,
        "mismatches": mismatches,
        "missing_source_receipts": missing_receipts,
        "missing_source_merkle_roots": missing_source_merkle_roots,
        "submit_failures": submit_failures,
        "elapsed_seconds": round(elapsed, 3),
        "blocks_per_second": round(checked / elapsed, 3) if elapsed > 0 else None,
        "progress_file": str(args.progress_file),
        "checkpoint_file": str(args.checkpoint_file),
        "first_problem": first_problem,
        "problems": problems[: args.max_problem_records],
        "problem_records_truncated": max(0, len(problems) - args.max_problem_records),
        "batches": batches,
        "batch_records_kept": len(batches),
        "max_batch_records": args.max_batch_records,
    }


def write_outputs(result: dict[str, Any], report_dir: Path) -> None:
    json_path = report_dir / "result.json"
    md_path = report_dir / "result.md"
    result["result_json"] = str(json_path)
    result["result_md"] = str(md_path)
    json_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")

    audit = result.get("audit", {})
    first_problem = audit.get("first_problem")
    lines = [
        "# State Delta Audit",
        "",
        f"- Status: `{result['status']}`",
        f"- Started: `{result['started_at']}`",
        f"- Finished: `{result['finished_at']}`",
        f"- Git commit: `{result['git_commit']}`",
        f"- Source: `{result['source']}`",
        f"- Audit basedir: `{result['audit_basedir']}`",
        f"- Reuse audit basedir: `{result.get('reuse_audit_basedir')}`",
        f"- Progress file: `{result.get('progress_file')}`",
        f"- Checkpoint file: `{result.get('checkpoint_file')}`",
        f"- Range: `{audit.get('range', {}).get('start_height')}` to `{audit.get('range', {}).get('end_height')}`",
        f"- Checked blocks: `{audit.get('checked_blocks')}`",
        f"- Mismatches: `{audit.get('mismatches')}`",
        f"- Missing source receipts: `{audit.get('missing_source_receipts')}`",
        f"- Missing source state roots: `{audit.get('missing_source_merkle_roots')}`",
        f"- Submit failures: `{audit.get('submit_failures')}`",
        f"- Blocks/sec: `{audit.get('blocks_per_second')}`",
        f"- Source log warnings/errors: `{result.get('source_log_counts')}`",
        f"- Audit log warnings/errors: `{result.get('audit_log_counts')}`",
        "",
    ]
    if first_problem:
        lines.extend(
            [
                "## First Problem",
                "",
                f"- Height: `{first_problem.get('height')}`",
                f"- Block ID: `{first_problem.get('block_id')}`",
                f"- Status: `{first_problem.get('status')}`",
            ]
        )
        stored = first_problem.get("stored") or {}
        regenerated = first_problem.get("regenerated") or {}
        if stored or regenerated:
            lines.extend(
                [
                    f"- Stored root: `{stored.get('state_merkle_root')}`",
                    f"- Regenerated root: `{regenerated.get('state_merkle_root')}`",
                    f"- Stored delta count/hash: `{stored.get('delta_count')}` / `{stored.get('delta_ordered_hash')}`",
                    f"- Regenerated delta count/hash: `{regenerated.get('delta_count')}` / `{regenerated.get('delta_ordered_hash')}`",
                ]
            )
        if first_problem.get("error"):
            lines.append(f"- Error: `{first_problem.get('error')}`")
        lines.append("")
    lines.extend([f"JSON result: `{json_path}`", ""])
    md_path.write_text("\n".join(lines))
    json_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bin", type=Path, default=choose_default_bin())
    parser.add_argument("--source-basedir", type=Path, default=DEFAULT_SOURCE_BASEDIR)
    parser.add_argument("--source-rpc-url", default="", help="use an existing source block_store JSON-RPC endpoint")
    parser.add_argument("--report-dir", type=Path, default=None)
    parser.add_argument("--progress-file", type=Path, default=None)
    parser.add_argument("--checkpoint-file", type=Path, default=None)
    parser.add_argument("--audit-basedir", type=Path, default=None, help="audit node basedir; defaults to REPORT_DIR/audit-basedir")
    parser.add_argument("--reuse-audit-basedir", action="store_true", help="resume from an existing audit basedir already indexed to start-height - 1")
    parser.add_argument("--start-height", type=int, default=1)
    parser.add_argument("--end-height", type=int, default=None)
    parser.add_argument("--block-count", type=int, default=100)
    parser.add_argument("--full", action="store_true", help="scan through the source block_store head")
    parser.add_argument("--batch-size", type=int, default=10)
    parser.add_argument("--source-jsonrpc-port", type=int, default=28730)
    parser.add_argument("--audit-jsonrpc-port", type=int, default=28731)
    parser.add_argument("--startup-timeout-seconds", type=float, default=120)
    parser.add_argument("--rpc-timeout", type=float, default=60)
    parser.add_argument("--chain-jobs", type=int, default=2)
    parser.add_argument("--rocksdb-jobs", type=int, default=4)
    parser.add_argument("--continue-on-mismatch", action="store_true")
    parser.add_argument("--max-problem-records", type=int, default=25)
    parser.add_argument("--max-batch-records", type=int, default=500)
    args = parser.parse_args(argv)

    if args.report_dir is None:
        args.report_dir = DEFAULT_REPORT_ROOT / safe_timestamp()
    if args.progress_file is None:
        args.progress_file = args.report_dir / "progress.jsonl"
    if args.checkpoint_file is None:
        args.checkpoint_file = args.report_dir / "checkpoint.json"
    if args.start_height <= 0:
        parser.error("--start-height must be positive")
    if args.end_height is not None and args.end_height < args.start_height:
        parser.error("--end-height must be greater than or equal to --start-height")
    if args.block_count <= 0:
        parser.error("--block-count must be positive")
    if args.batch_size <= 0 or args.batch_size > 1000:
        parser.error("--batch-size must be between 1 and 1000")
    if args.chain_jobs <= 0:
        parser.error("--chain-jobs must be positive")
    if args.rocksdb_jobs <= 0:
        parser.error("--rocksdb-jobs must be positive")
    if args.max_problem_records <= 0:
        parser.error("--max-problem-records must be positive")
    if args.max_batch_records <= 0:
        parser.error("--max-batch-records must be positive")
    args.started_at = utc_now()
    return args


def build_result(
    args: argparse.Namespace,
    source: str,
    report_dir: Path,
    audit_basedir: Path,
    source_topology: dict[str, Any],
    audit_summary: dict[str, Any],
    source_log: Path | None,
    audit_log: Path,
) -> dict[str, Any]:
    return {
        "kind": "teleno-state-delta-audit",
        "status": audit_summary["status"],
        "started_at": args.started_at,
        "finished_at": utc_now(),
        "repo_root": str(ROOT_DIR),
        "git_branch": git_value(["branch", "--show-current"]),
        "git_commit": git_value(["rev-parse", "--short", "HEAD"]),
        "source": source,
        "source_topology": source_topology,
        "audit_basedir": str(audit_basedir),
        "reuse_audit_basedir": bool(args.reuse_audit_basedir),
        "report_dir": str(report_dir),
        "source_log": str(source_log) if source_log else "",
        "audit_log": str(audit_log),
        "source_log_counts": log_counts(source_log) if source_log else {},
        "audit_log_counts": log_counts(audit_log),
        "progress_file": str(args.progress_file),
        "checkpoint_file": str(args.checkpoint_file),
        "audit": audit_summary,
    }


def main(argv: list[str]) -> int:
    args = parse_args(argv)

    if not args.bin.exists() or not os.access(args.bin, os.X_OK):
        print(f"error: teleno_node is not executable: {args.bin}", file=sys.stderr)
        return 2
    if not args.source_rpc_url and not args.source_basedir.exists():
        print(f"error: source basedir does not exist: {args.source_basedir}", file=sys.stderr)
        return 2

    ports_to_check = [args.audit_jsonrpc_port]
    if not args.source_rpc_url:
        ports_to_check.append(args.source_jsonrpc_port)
    for port in ports_to_check:
        if not port_is_free(port):
            print(f"error: port already in use: {port}", file=sys.stderr)
            return 2

    report_dir = args.report_dir
    audit_basedir = args.audit_basedir or (report_dir / "audit-basedir")
    report_dir.mkdir(parents=True, exist_ok=True)

    source_log = None if args.source_rpc_url else report_dir / "source-node.log"
    audit_log = report_dir / "audit-node.log"

    source_proc: subprocess.Popen[bytes] | None = None
    audit_proc: subprocess.Popen[bytes] | None = None

    try:
        if args.source_rpc_url:
            source_url = normalize_rpc_url(args.source_rpc_url)
            source = source_url
            wait_for_rpc(source_url, None, args.startup_timeout_seconds)
        else:
            source_url = f"http://127.0.0.1:{args.source_jsonrpc_port}/"
            source = str(args.source_basedir)
            source_proc = launch_node(
                args.bin,
                args.source_basedir,
                None,
                args.source_jsonrpc_port,
                source_log or report_dir / "source-node.log",
                [
                    "--disable",
                    "chain",
                    "mempool",
                    "p2p",
                    "grpc",
                    "block_producer",
                    "contract_meta_store",
                    "transaction_store",
                    "account_history",
                ],
            )
            wait_for_rpc(source_url, source_proc, args.startup_timeout_seconds)

        source_topology = get_source_highest(source_url, args.rpc_timeout)
        source_height = extract_height(source_topology)
        if args.full:
            args.end_height = source_height
        elif args.end_height is None:
            args.end_height = min(source_height, args.start_height + args.block_count - 1)
        if args.end_height > source_height:
            raise RuntimeError(f"requested end height {args.end_height} exceeds source block_store height {source_height}")

        if args.reuse_audit_basedir:
            if not audit_basedir.exists():
                raise RuntimeError(f"--reuse-audit-basedir requires an existing audit basedir: {audit_basedir}")
            audit_config = write_audit_config(audit_basedir, args.audit_jsonrpc_port, args.chain_jobs, args.rocksdb_jobs)
        else:
            if args.start_height != 1:
                raise RuntimeError(
                    "fresh audit basedirs must start at height 1; use --reuse-audit-basedir with an audit basedir "
                    "already applied through start-height - 1"
                )
            audit_config = prepare_audit_basedir(
                args.source_basedir,
                audit_basedir,
                args.audit_jsonrpc_port,
                args.chain_jobs,
                args.rocksdb_jobs,
            )
        audit_proc = launch_node(args.bin, audit_basedir, audit_config, args.audit_jsonrpc_port, audit_log)
        audit_url = f"http://127.0.0.1:{args.audit_jsonrpc_port}/"
        wait_for_rpc(audit_url, audit_proc, args.startup_timeout_seconds)

        audit_summary = audit_range(args, source_url, audit_url, source_topology)
        result = build_result(args, source, report_dir, audit_basedir, source_topology, audit_summary, source_log, audit_log)
        write_outputs(result, report_dir)
        print(
            json.dumps(
                {
                    "status": result["status"],
                    "range": audit_summary["range"],
                    "checked_blocks": audit_summary["checked_blocks"],
                    "mismatches": audit_summary["mismatches"],
                    "first_problem": audit_summary["first_problem"],
                    "result_json": result["result_json"],
                    "result_md": result["result_md"],
                },
                indent=2,
                sort_keys=True,
            )
        )
        return 0 if result["status"] == "pass" else 1
    except Exception as exc:  # noqa: BLE001
        result = {
            "kind": "teleno-state-delta-audit",
            "status": "fail",
            "started_at": args.started_at,
            "finished_at": utc_now(),
            "repo_root": str(ROOT_DIR),
            "git_branch": git_value(["branch", "--show-current"]),
            "git_commit": git_value(["rev-parse", "--short", "HEAD"]),
            "source": args.source_rpc_url or str(args.source_basedir),
            "audit_basedir": str(audit_basedir),
            "reuse_audit_basedir": bool(args.reuse_audit_basedir),
            "report_dir": str(report_dir),
            "source_log": str(source_log) if source_log else "",
            "audit_log": str(audit_log),
            "source_log_counts": log_counts(source_log) if source_log else {},
            "audit_log_counts": log_counts(audit_log),
            "error": str(exc),
            "audit": {
                "status": "fail",
                "range": {"start_height": args.start_height, "end_height": args.end_height},
                "checked_blocks": 0,
                "mismatches": 0,
                "missing_source_receipts": 0,
                "missing_source_merkle_roots": 0,
                "submit_failures": 0,
                "first_problem": {"status": "script_error", "error": str(exc)},
                "problems": [],
            },
        }
        write_outputs(result, report_dir)
        print(f"error: {exc}", file=sys.stderr)
        return 1
    finally:
        for proc in (audit_proc, source_proc):
            if proc is not None:
                terminate_process(proc)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
