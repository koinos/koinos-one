#!/usr/bin/env python3
"""Run bounded live-producer regression checks against the Koinos testnet.

This runner is intentionally conservative. It can prove health/read/client
compatibility without private material, and it only submits transfers when
--submit-transfers is provided.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import request
from urllib.error import HTTPError, URLError


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_RUN_ROOT = Path("/Users/pgarcgo/.kcli/knodel-testnet-producer")
DEFAULT_PRODUCER = "1Kjfrv3qxWvb3afwUdFevZHS1WdT4ginPi"
DEFAULT_LOCAL_RPC = "http://127.0.0.1:18122"
DEFAULT_PUBLIC_RPC = "https://testnet.koinosfoundation.org/jsonrpc"

WARNING_RE = re.compile(r"<(?:\x1b\[[0-9;]*m)?warning", re.IGNORECASE)
KNOWN_TRANSIENT_WARNING_MARKERS = [
    "cannot retrieve pending transactions from an unknown block",
]
SENSITIVE_REPLACEMENTS = [
    (re.compile(r"\b[5KL][1-9A-HJ-NP-Za-km-z]{50,52}\b"), "[REDACTED_WIF]"),
    (re.compile(r"(?i)((?:api|bot|telegram)[_ -]?token|password|secret|private[_ -]?key)\s*[:=]\s*\S+"), r"\1=[REDACTED]"),
]


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def redact(text: str) -> str:
    result = text
    for pattern, replacement in SENSITIVE_REPLACEMENTS:
        result = pattern.sub(replacement, result)
    return result


def compact_output(text: str, limit: int = 4000) -> str:
    text = redact(text.strip())
    if len(text) <= limit:
        return text
    return text[:limit] + "\n...[truncated]"


def run_command(args: list[str], timeout: int = 30, interactive: bool = False) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        if interactive:
            completed = subprocess.run(args, timeout=timeout, check=False)
            elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
            return {
                "command": args,
                "returncode": completed.returncode,
                "elapsed_ms": elapsed_ms,
                "stdout": "[interactive output not captured]",
                "stderr": "",
            }
        completed = subprocess.run(
            args,
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        return {
            "command": args,
            "returncode": completed.returncode,
            "elapsed_ms": elapsed_ms,
            "stdout": compact_output(completed.stdout),
            "stderr": compact_output(completed.stderr),
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "command": args,
            "returncode": 124,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
            "stdout": compact_output(exc.stdout or ""),
            "stderr": compact_output(exc.stderr or "timeout"),
        }


def is_interactive_unlock_failure(result: dict[str, Any]) -> bool:
    text = f"{result.get('stdout', '')}\n{result.get('stderr', '')}"
    return (
        "Unlocking wallet" in text
        and (
            "doesn't support interactive reading from TTY" in text
            or "Device not configured" in text
            or "/dev/tty" in text
        )
    )


def is_expected_negative_rejection(result: dict[str, Any]) -> bool:
    text = f"{result.get('stdout', '')}\n{result.get('stderr', '')}".lower()
    expected_markers = [
        "insufficient token balance",
        "insufficient balance",
        "insufficient funds",
        "exceeds balance",
        "exceeds available",
    ]
    return any(marker in text for marker in expected_markers)


def has_cli_error(result: dict[str, Any]) -> bool:
    text = f"{result.get('stdout', '')}\n{result.get('stderr', '')}".lower()
    error_markers = [
        "❌ error",
        "error registering producer key",
        "error transferring tokens",
        "error burning koin",
        "insufficient pending account resources",
    ]
    return any(marker in text for marker in error_markers)


def b64url_decode(value: str) -> bytes:
    padded = value + ("=" * (-len(value) % 4))
    return base64.urlsafe_b64decode(padded.encode())


def b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode()


def read_varint(data: bytes, offset: int) -> tuple[int, int]:
    shift = 0
    value = 0
    index = offset
    while index < len(data):
        byte = data[index]
        value |= (byte & 0x7F) << shift
        index += 1
        if (byte & 0x80) == 0:
            return value, index
        shift += 7
    raise ValueError("unterminated varint")


def write_varint(value: int) -> bytes:
    if value < 0:
        raise ValueError("varint value must be non-negative")
    out = bytearray()
    while value >= 0x80:
        out.append((value & 0x7F) | 0x80)
        value >>= 7
    out.append(value)
    return bytes(out)


def decode_nonce_value(encoded: str) -> int:
    data = b64url_decode(encoded)
    index = 0
    while index < len(data):
        tag, index = read_varint(data, index)
        field_number = tag >> 3
        wire_type = tag & 0x07
        if field_number == 5 and wire_type == 0:
            value, _ = read_varint(data, index)
            return value
        if wire_type == 0:
            _, index = read_varint(data, index)
        elif wire_type == 2:
            length, index = read_varint(data, index)
            index += length
        else:
            raise ValueError(f"unsupported nonce value_type wire type {wire_type}")
    raise ValueError("nonce value_type did not contain uint64_value")


def encode_nonce_value(value: int) -> str:
    # koinos.chain.value_type with field 5 (uint64_value), wire type 0.
    return b64url_encode(write_varint((5 << 3) | 0) + write_varint(value))


def extract_tx_ids(result: dict[str, Any]) -> list[str]:
    text = f"{result.get('stdout', '')}\n{result.get('stderr', '')}"
    return re.findall(r"0x[0-9a-fA-F]{40,}", text)


def tx_id_variants(tx_id: str) -> set[str]:
    variants = {tx_id}
    if tx_id.startswith("0x"):
        try:
            raw = bytes.fromhex(tx_id[2:])
        except ValueError:
            return variants
        variants.add(base64.b64encode(raw).decode())
        variants.add(base64.urlsafe_b64encode(raw).decode())
        variants.add(base64.urlsafe_b64encode(raw).decode().rstrip("="))
    return variants


def text_contains_tx_id(text: str, tx_id: str) -> bool:
    return any(variant in text for variant in tx_id_variants(tx_id))


def extract_registered_public_key(result: dict[str, Any]) -> str:
    text = f"{result.get('stdout', '')}\n{result.get('stderr', '')}"
    match = re.search(r"Public Key:\s*([A-Za-z0-9_-]{40,120})", text)
    return match.group(1) if match else ""


def rpc_call(url: str, method: str, params: dict[str, Any] | None = None, timeout: int = 15) -> tuple[dict[str, Any], float]:
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}).encode()
    req = request.Request(
        url,
        data=body,
        headers={"content-type": "application/json", "user-agent": "knodel-live-regression/1.0"},
        method="POST",
    )
    started = time.perf_counter()
    try:
        with request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
    except HTTPError as exc:
        raise RuntimeError(f"{method} HTTP {exc.code}: {exc.read().decode(errors='replace')}") from exc
    except URLError as exc:
        raise RuntimeError(f"{method} failed: {exc.reason}") from exc
    elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
    try:
        parsed = json.loads(raw.decode())
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{method} returned invalid JSON: {raw[:200]!r}") from exc
    if parsed.get("error"):
        raise RuntimeError(f"{method} error: {json.dumps(parsed['error'], sort_keys=True)}")
    return parsed.get("result") or {}, elapsed_ms


def normalize_head(result: dict[str, Any]) -> dict[str, Any]:
    topology = result.get("head_topology") or result.get("headTopology") or {}
    return {
        "height": int(topology.get("height") or 0),
        "id": topology.get("id") or "",
        "previous": topology.get("previous") or "",
        "last_irreversible_block": int(result.get("last_irreversible_block") or result.get("lastIrreversibleBlock") or 0),
        "head_state_merkle_root": result.get("head_state_merkle_root") or result.get("headStateMerkleRoot") or "",
        "head_block_time": result.get("head_block_time") or result.get("headBlockTime") or "",
    }


def get_head(url: str) -> tuple[dict[str, Any], float]:
    result, latency_ms = rpc_call(url, "chain.get_head_info")
    return normalize_head(result), latency_ms


def get_account_nonce(url: str, account: str) -> int:
    result, _ = rpc_call(url, "chain.get_account_nonce", {"account": account})
    nonce = result.get("nonce")
    if not isinstance(nonce, str) or not nonce:
        raise RuntimeError(f"chain.get_account_nonce returned no nonce for {account}")
    return decode_nonce_value(nonce)


def summarize_pending_mempool(url: str) -> dict[str, Any]:
    result, latency_ms = rpc_call(url, "mempool.get_pending_transactions", {})
    pending = result.get("pending_transactions") or result.get("pendingTransactions") or []
    ids: list[str] = []
    for item in pending:
        if not isinstance(item, dict):
            continue
        tx = item.get("transaction") or item.get("trx", {}).get("transaction") or {}
        tx_id = tx.get("id")
        if isinstance(tx_id, str) and tx_id:
            ids.append(tx_id)
    return {
        "count": len(pending),
        "ids": ids,
        "latency_ms": latency_ms,
    }


def command_lines(command: str) -> list[str]:
    result = subprocess.run(command, shell=True, text=True, capture_output=True, check=False)
    if result.returncode != 0:
        return []
    return [line for line in result.stdout.splitlines() if line.strip()]


def read_recent_log(path: Path | None, max_bytes: int = 2_000_000) -> str:
    if not path or not path.exists():
        return ""
    size = path.stat().st_size
    with path.open("rb") as handle:
        if size > max_bytes:
            handle.seek(size - max_bytes)
        return handle.read().decode(errors="replace")


def find_log(run_root: Path, explicit: str | None) -> Path | None:
    if explicit:
        path = Path(explicit).expanduser()
        return path if path.exists() else path
    latest = run_root / "live-testnet-sync-latest.log"
    if latest.exists():
        return latest
    candidates = sorted(run_root.glob("live-testnet-producer-*.log"), key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0] if candidates else None


def disk_info(path: Path) -> dict[str, Any]:
    target = path
    if not target.exists():
        target = path.parent
    usage = shutil.disk_usage(target)
    gib = 1024 ** 3
    return {
        "path": str(target),
        "total_gib": round(usage.total / gib, 2),
        "used_gib": round(usage.used / gib, 2),
        "free_gib": round(usage.free / gib, 2),
        "used_percent": round((usage.used / usage.total) * 100, 2) if usage.total else 0,
    }


@dataclass
class Phase:
    name: str
    status: str
    detail: str
    data: dict[str, Any] = field(default_factory=dict)


class RegressionRun:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.started_at = utc_now()
        self.result_dir = Path(args.result_dir).expanduser() / self.started_at.replace(":", "").replace("-", "")
        self.result_dir.mkdir(parents=True, exist_ok=True)
        self.phases: list[Phase] = []
        self.metrics: dict[str, Any] = {}
        self.log_path = find_log(Path(args.run_root).expanduser(), args.producer_log)

    def add_phase(self, name: str, status: str, detail: str, **data: Any) -> None:
        self.phases.append(Phase(name=name, status=status, detail=detail, data=data))

    def phase1_health(self) -> None:
        data: dict[str, Any] = {}
        errors: list[str] = []
        warnings: list[str] = []

        local_head = public_head = None
        local_latency = public_latency = None
        for attempt in range(1, self.args.head_convergence_retries + 2):
            local_head, local_latency = get_head(self.args.local_rpc)
            public_head, public_latency = get_head(self.args.public_rpc)
            if local_head["id"] == public_head["id"] and local_head["height"] == public_head["height"]:
                break
            if attempt <= self.args.head_convergence_retries:
                time.sleep(self.args.head_convergence_delay)

        data["local_head"] = local_head
        data["public_head"] = public_head
        data["local_rpc_latency_ms"] = local_latency
        data["public_rpc_latency_ms"] = public_latency
        if not local_head or not public_head or local_head["id"] != public_head["id"]:
            errors.append("local and public heads did not converge")

        data["koinos_node_processes"] = command_lines("pgrep -fl koinos_node")
        data["caffeinate_processes"] = command_lines("pgrep -fl 'caffeinate.*koinos|caffeinate.*-w'")
        if not data["koinos_node_processes"]:
            errors.append("koinos_node process not found")
        if not data["caffeinate_processes"]:
            warnings.append("caffeinate guard not found")

        basedir = Path(self.args.run_root).expanduser() / "basedir"
        data["disk"] = disk_info(basedir)
        if data["disk"]["free_gib"] < self.args.min_disk_free_gib:
            errors.append(f"disk free below stop floor: {data['disk']['free_gib']} GiB")
        elif data["disk"]["free_gib"] < self.args.warn_disk_free_gib:
            warnings.append(f"disk free below warning floor: {data['disk']['free_gib']} GiB")

        log_text = read_recent_log(self.log_path)
        data["log_path"] = str(self.log_path) if self.log_path else ""
        data["log_window_bytes"] = len(log_text.encode())
        data["produced_block_rows"] = log_text.count("[block_producer] Produced block - Height")
        data["peer_snapshot_rows"] = log_text.count("[p2p] Connected peers:")
        warning_lines = [line for line in log_text.splitlines() if WARNING_RE.search(line)]
        known_warning_lines = [
            line for line in warning_lines
            if any(marker in line for marker in KNOWN_TRANSIENT_WARNING_MARKERS)
        ]
        severe_warning_lines = [line for line in warning_lines if line not in known_warning_lines]
        data["warning_rows"] = len(warning_lines)
        data["known_transient_warning_rows"] = len(known_warning_lines)
        data["severe_warning_rows"] = len(severe_warning_lines)
        data["score_threshold_rows"] = len(re.findall(r"score threshold", log_text, re.IGNORECASE))
        data["checkpoint_mismatch_rows"] = len(re.findall(r"checkpoint mismatch", log_text, re.IGNORECASE))
        data["gossip_gate_rows"] = len(re.findall(r"gossip production gate|production gate closed", log_text, re.IGNORECASE))
        data["seed_peer_rows"] = len(re.findall(r"testnet\.koinosfoundation\.org/tcp/8888", log_text))

        if data["produced_block_rows"] == 0:
            warnings.append("no produced block rows in recent log window")
        if data["peer_snapshot_rows"] == 0 or data["seed_peer_rows"] == 0:
            errors.append("no recent connected-peer snapshot for public seed")
        if data["known_transient_warning_rows"] > 0:
            warnings.append(f"known transient warning rows={data['known_transient_warning_rows']}")
        for key in ("severe_warning_rows", "score_threshold_rows", "checkpoint_mismatch_rows", "gossip_gate_rows"):
            if data[key] > 0:
                errors.append(f"{key}={data[key]}")

        if errors:
            self.add_phase("Phase 1: Baseline Health Gate", "fail", "; ".join(errors), warnings=warnings, **data)
        elif warnings:
            self.add_phase("Phase 1: Baseline Health Gate", "warn", "; ".join(warnings), warnings=warnings, **data)
        else:
            self.add_phase("Phase 1: Baseline Health Gate", "pass", "local/public heads converge and node health is clean", **data)
        self.metrics["last_local_head"] = local_head
        self.metrics["last_public_head"] = public_head

    def kcli(self, *args: str, timeout: int = 45, interactive: bool = False) -> dict[str, Any]:
        command = [self.args.kcli, "-r", self.args.local_rpc, *args]
        if self.args.kcli_password_file and args and args[0] in {"transfer", "token-transfer", "register-producer-key", "burn"}:
            command.extend(["--password-file", self.args.kcli_password_file])
        if args and args[0] in {"transfer", "token-transfer", "register-producer-key", "burn"}:
            if self.args.kcli_yes or ((self.args.submit_transfers or self.args.submit_system_ops) and "--dry-run" not in args):
                command.append("--yes")
        return run_command(command, timeout=timeout, interactive=interactive)

    def kcli_public(self, *args: str, timeout: int = 45) -> dict[str, Any]:
        return run_command([self.args.kcli, "-r", self.args.public_rpc, *args], timeout=timeout)

    def run_kcli_checks(self, commands: list[tuple[str, list[str], bool]]) -> tuple[str, dict[str, Any]]:
        results: dict[str, Any] = {}
        failures: list[str] = []
        for label, cmd, public in commands:
            result = self.kcli_public(*cmd) if public else self.kcli(*cmd)
            results[label] = result
            if result["returncode"] != 0:
                failures.append(label)
        return ("; ".join(failures), results)

    def phase2_client_reads(self) -> None:
        head = self.metrics.get("last_local_head") or {}
        block_height = str(head.get("height") or "")
        commands: list[tuple[str, list[str], bool]] = [
            ("local chain-info", ["chain-info"], False),
            ("public chain-info", ["chain-info"], True),
            ("local balance", ["balance", self.args.producer_address], False),
            ("public balance", ["balance", self.args.producer_address], True),
            ("local vhp", ["vhp", self.args.producer_address], False),
            ("public vhp", ["vhp", self.args.producer_address], True),
            ("local producer key", ["get-producer-key", self.args.producer_address], False),
            ("public producer key", ["get-producer-key", self.args.producer_address], True),
        ]
        if block_height:
            commands.append(("local head block", ["block", block_height, "--full"], False))
            commands.append(("public head block", ["block", block_height, "--full"], True))
        failures, results = self.run_kcli_checks(commands)
        if failures:
            self.add_phase("Phase 2: Client Read Compatibility", "fail", f"kcli command failures: {failures}", commands=results)
        else:
            self.add_phase("Phase 2: Client Read Compatibility", "pass", "kcli read commands passed against local and public RPC", commands=results)

    def phase3_transfer_smoke(self) -> None:
        if not self.args.recipient_address:
            self.add_phase("Phase 3: Valid Transfer Smoke", "blocked", "RECIPIENT_ADDRESS or --recipient-address is required for transfer smoke")
            return
        dry_run = self.kcli(
            "transfer",
            self.args.recipient_address,
            str(self.args.transfer_amount),
            "--dry-run",
            timeout=60,
            interactive=self.args.interactive_kcli,
        )
        data = {"dry_run": dry_run}
        if dry_run["returncode"] != 0:
            if is_interactive_unlock_failure(dry_run):
                self.add_phase("Phase 3: Valid Transfer Smoke", "blocked", "kcli transfer dry-run requires interactive wallet unlock in this environment", **data)
                return
            self.add_phase("Phase 3: Valid Transfer Smoke", "fail", "kcli transfer dry-run failed", **data)
            return
        if not self.args.submit_transfers:
            self.add_phase("Phase 3: Valid Transfer Smoke", "warn", "dry-run passed; real transfer skipped because --submit-transfers was not provided", **data)
            return
        total = float(self.args.transfer_amount)
        if total > self.args.max_total_koin:
            self.add_phase("Phase 3: Valid Transfer Smoke", "blocked", "transfer amount exceeds --max-total-koin", **data)
            return
        submitted = self.kcli("transfer", self.args.recipient_address, str(self.args.transfer_amount), timeout=240, interactive=self.args.interactive_kcli)
        data["submitted"] = submitted
        if submitted["returncode"] != 0:
            self.add_phase("Phase 3: Valid Transfer Smoke", "fail", "real transfer failed", **data)
            return
        submitted_text = submitted["stdout"] + "\n" + submitted["stderr"]
        tx_ids = extract_tx_ids(submitted)
        confirmed_blocks = re.findall(r"confirmed in block ([0-9]+)", submitted_text)
        data["tx_ids"] = tx_ids
        data["confirmed_blocks"] = confirmed_blocks
        if not tx_ids:
            self.add_phase("Phase 3: Valid Transfer Smoke", "fail", "real transfer completed but no transaction id was found in kcli output", **data)
            return
        if not confirmed_blocks:
            self.add_phase("Phase 3: Valid Transfer Smoke", "fail", "real transfer completed but kcli did not confirm an inclusion block", **data)
            return

        tx_id = tx_ids[-1]
        block_height = confirmed_blocks[-1]
        local_block = self.kcli("block", block_height, "--full", timeout=60)
        public_block = self.kcli_public("block", block_height, "--full", timeout=60)
        data["local_block"] = local_block
        data["public_block"] = public_block

        failures: list[str] = []
        if local_block["returncode"] != 0:
            failures.append("local block lookup failed")
        if public_block["returncode"] != 0:
            failures.append("public block lookup failed")
        if not text_contains_tx_id(public_block.get("stdout", "") + public_block.get("stderr", ""), tx_id):
            failures.append("public block output did not include tx id")

        produced_pattern = rf"Produced block - Height: {re.escape(block_height)}, .*\(1 transaction\)"
        data["local_producer_log_contains_transaction_block"] = False
        for _ in range(6):
            log_text = read_recent_log(self.log_path)
            if re.search(produced_pattern, log_text):
                data["local_producer_log_contains_transaction_block"] = True
                break
            time.sleep(1)
        if not data["local_producer_log_contains_transaction_block"]:
            failures.append("producer log did not show local block with 1 transaction")

        if failures:
            self.add_phase("Phase 3: Valid Transfer Smoke", "fail", "; ".join(failures), **data)
        else:
            self.add_phase("Phase 3: Valid Transfer Smoke", "pass", f"tx {tx_id} confirmed in locally produced public block {block_height}", **data)

    def phase4_mempool_burst(self) -> None:
        if not self.args.recipient_address:
            self.add_phase("Phase 4: Mempool Burst", "blocked", "recipient address is required")
            return
        if not self.args.submit_transfers:
            self.add_phase("Phase 4: Mempool Burst", "blocked", "true mempool pressure requires --submit-transfers")
            return
        total = float(self.args.transfer_amount) * int(self.args.tx_count)
        if total > self.args.max_total_koin:
            self.add_phase("Phase 4: Mempool Burst", "blocked", f"batch total {total} exceeds --max-total-koin {self.args.max_total_koin}")
            return
        mempool_samples: list[dict[str, Any]] = []
        try:
            base_nonce = get_account_nonce(self.args.local_rpc, self.args.producer_address)
            start_head, _ = get_head(self.args.public_rpc)
            mempool_samples.append({"label": "before", **summarize_pending_mempool(self.args.local_rpc)})
        except Exception as exc:  # noqa: BLE001
            self.add_phase("Phase 4: Mempool Burst", "fail", f"could not prepare explicit nonce burst: {exc}")
            return

        transfers: list[dict[str, Any]] = []
        tx_ids: list[str] = []
        failures: list[int] = []
        for index in range(int(self.args.tx_count)):
            nonce = encode_nonce_value(base_nonce + index + 1)
            result = self.kcli(
                "transfer",
                self.args.recipient_address,
                str(self.args.transfer_amount),
                "--no-wait",
                "--nonce",
                nonce,
                timeout=90,
                interactive=self.args.interactive_kcli,
            )
            result["explicit_nonce_index"] = base_nonce + index + 1
            transfers.append(result)
            if result["returncode"] != 0:
                failures.append(index + 1)
                break
            ids = extract_tx_ids(result)
            if not ids:
                failures.append(index + 1)
                result["missing_tx_id"] = True
                break
            tx_ids.append(ids[-1])
            try:
                mempool_samples.append({"label": f"after-submit-{index + 1}", **summarize_pending_mempool(self.args.local_rpc)})
            except Exception as exc:  # noqa: BLE001
                mempool_samples.append({"label": f"after-submit-{index + 1}", "error": str(exc)})
            if index + 1 < int(self.args.tx_count):
                time.sleep(self.args.tx_interval)
        if failures:
            self.add_phase("Phase 4: Mempool Burst", "fail", f"non-waiting transfer burst failed at transfer {failures[0]}", base_nonce=base_nonce, transfers=transfers, tx_ids=tx_ids)
            return

        inclusion = self.wait_for_public_inclusion(tx_ids, start_head["height"] + 1, self.args.burst_confirm_timeout)
        try:
            mempool_samples.append({"label": "after-inclusion", **summarize_pending_mempool(self.args.local_rpc)})
        except Exception as exc:  # noqa: BLE001
            mempool_samples.append({"label": "after-inclusion", "error": str(exc)})
        included = inclusion["included"]
        missing = [tx_id for tx_id in tx_ids if tx_id not in included]
        block_counts: dict[str, int] = {}
        for height in included.values():
            block_counts[str(height)] = block_counts.get(str(height), 0) + 1
        data = {
            "base_nonce": base_nonce,
            "start_public_head": start_head,
            "transfers": transfers,
            "tx_ids": tx_ids,
            "inclusion": inclusion,
            "included_block_counts": block_counts,
            "mempool_samples": mempool_samples,
        }
        saw_pending = any(sample.get("count", 0) > 0 for sample in mempool_samples if sample.get("label", "").startswith("after-submit"))
        drained = (mempool_samples[-1].get("count") == 0) if mempool_samples else False
        if missing:
            self.add_phase("Phase 4: Mempool Burst", "fail", "not all non-waiting burst transactions were included before timeout", missing_tx_ids=missing, **data)
        elif not saw_pending:
            self.add_phase("Phase 4: Mempool Burst", "warn", "all non-waiting transactions were included, but pending mempool contents were not observed before inclusion", **data)
        elif not drained:
            self.add_phase("Phase 4: Mempool Burst", "warn", "all non-waiting transactions were included, but mempool did not drain to zero in the final sample", **data)
        elif max(block_counts.values() or [0]) < 2 and len(tx_ids) > 1:
            self.add_phase("Phase 4: Mempool Burst", "warn", "all non-waiting transactions were included, but no sampled block contained more than one burst transaction", **data)
        else:
            self.add_phase("Phase 4: Mempool Burst", "pass", "non-waiting explicit-nonce transfer burst was submitted and included", **data)

    def wait_for_public_inclusion(self, tx_ids: list[str], start_height: int, timeout_seconds: int) -> dict[str, Any]:
        pending = set(tx_ids)
        included: dict[str, int] = {}
        checked_blocks: list[int] = []
        block_outputs: dict[str, dict[str, Any]] = {}
        next_height = start_height
        deadline = time.time() + timeout_seconds
        while pending and time.time() <= deadline:
            public_head, _ = get_head(self.args.public_rpc)
            head_height = public_head["height"]
            while next_height <= head_height and pending:
                block = self.kcli_public("block", str(next_height), "--full", timeout=45)
                checked_blocks.append(next_height)
                if block["returncode"] == 0:
                    text = f"{block.get('stdout', '')}\n{block.get('stderr', '')}"
                    matched = [tx_id for tx_id in list(pending) if text_contains_tx_id(text, tx_id)]
                    if matched:
                        block_outputs[str(next_height)] = block
                    for tx_id in matched:
                        included[tx_id] = next_height
                        pending.remove(tx_id)
                next_height += 1
            if pending:
                time.sleep(self.args.burst_poll_interval)
        return {
            "included": included,
            "missing": sorted(pending),
            "checked_blocks": checked_blocks,
            "block_outputs": block_outputs,
            "timeout_seconds": timeout_seconds,
        }

    def phase5_negative(self) -> None:
        if not self.args.recipient_address:
            self.add_phase("Phase 5: Negative Transaction Handling", "blocked", "recipient address is required")
            return
        result = self.kcli("transfer", self.args.recipient_address, "999999999999", "--dry-run", timeout=60, interactive=self.args.interactive_kcli)
        if is_interactive_unlock_failure(result):
            self.add_phase("Phase 5: Negative Transaction Handling", "blocked", "kcli dry-run requires interactive wallet unlock in this environment", command=result)
            return
        if is_expected_negative_rejection(result):
            self.add_phase("Phase 5: Negative Transaction Handling", "pass", "oversized transfer was rejected during dry-run", command=result)
        elif result["returncode"] == 0:
            self.add_phase("Phase 5: Negative Transaction Handling", "fail", "oversized transfer dry-run unexpectedly succeeded", command=result)
        else:
            self.add_phase("Phase 5: Negative Transaction Handling", "fail", "oversized transfer dry-run failed without the expected rejection marker", command=result)

    def phase6_contract_reads(self) -> None:
        head = self.metrics.get("last_local_head") or {}
        block_height = str(head.get("height") or "")
        commands: list[tuple[str, list[str], bool]] = [
            ("local balance", ["balance", self.args.producer_address], False),
            ("local vhp", ["vhp", self.args.producer_address], False),
            ("local producer key", ["get-producer-key", self.args.producer_address], False),
            ("local nonce", ["nonce", self.args.producer_address], False),
        ]
        if self.args.recipient_address:
            commands.append(("local recipient balance", ["balance", self.args.recipient_address], False))
        if block_height:
            commands.append(("local block full", ["block", block_height, "--full"], False))
        failures, results = self.run_kcli_checks(commands)
        complex_results: dict[str, Any] = {}
        complex_failures: list[str] = []
        producer_public_key = self.args.producer_public_key
        if self.args.complex_dry_runs:
            if not self.args.kcli_password_file:
                complex_results["skipped"] = "KCLI_PASSWORD_FILE or --kcli-password-file is required for mutating dry-runs"
            else:
                if not producer_public_key:
                    key_result = results.get("local producer key") or self.kcli("get-producer-key", self.args.producer_address)
                    producer_public_key = extract_registered_public_key(key_result)
                    complex_results["inferred_producer_public_key"] = bool(producer_public_key)
                dry_run_commands: list[tuple[str, list[str]]] = [
                    ("burn dry-run", ["burn", "--amount", str(self.args.burn_dry_run_amount), "--dry-run"]),
                ]
                if producer_public_key:
                    dry_run_commands.append(
                        ("register producer key dry-run", ["register-producer-key", self.args.producer_address, producer_public_key, "--dry-run"])
                    )
                else:
                    complex_failures.append("producer public key could not be inferred")
                for label, cmd in dry_run_commands:
                    result = self.kcli(*cmd, timeout=90, interactive=self.args.interactive_kcli)
                    complex_results[label] = result
                    if result["returncode"] != 0 or has_cli_error(result):
                        complex_failures.append(label)
        system_op_results: dict[str, Any] = {}
        system_op_failures: list[str] = []
        if self.args.submit_system_ops:
            if not self.args.kcli_password_file:
                system_op_failures.append("KCLI_PASSWORD_FILE or --kcli-password-file is required for real system operations")
            else:
                if not producer_public_key:
                    key_result = results.get("local producer key") or self.kcli("get-producer-key", self.args.producer_address)
                    producer_public_key = extract_registered_public_key(key_result)
                before_balance = self.kcli("balance", self.args.producer_address, timeout=60)
                before_vhp = self.kcli("vhp", self.args.producer_address, timeout=60)
                burn = self.kcli("burn", "--amount", str(self.args.burn_real_amount), timeout=240, interactive=self.args.interactive_kcli)
                after_burn_balance = self.kcli("balance", self.args.producer_address, timeout=60)
                after_burn_vhp = self.kcli("vhp", self.args.producer_address, timeout=60)
                system_op_results.update(
                    {
                        "before_balance": before_balance,
                        "before_vhp": before_vhp,
                        "burn": burn,
                        "after_burn_balance": after_burn_balance,
                        "after_burn_vhp": after_burn_vhp,
                    }
                )
                if burn["returncode"] != 0 or has_cli_error(burn):
                    system_op_failures.append("real PoB burn")
                if self.args.submit_producer_registration and producer_public_key:
                    register = self.kcli(
                        "register-producer-key",
                        self.args.producer_address,
                        producer_public_key,
                        timeout=240,
                        interactive=self.args.interactive_kcli,
                    )
                    verify_key = self.kcli("get-producer-key", self.args.producer_address, timeout=60)
                    system_op_results["register_producer_key"] = register
                    system_op_results["verify_producer_key"] = verify_key
                    if register["returncode"] != 0 or has_cli_error(register):
                        system_op_failures.append("real producer-key registration")
                    if verify_key["returncode"] != 0 or has_cli_error(verify_key) or producer_public_key not in f"{verify_key.get('stdout', '')}\n{verify_key.get('stderr', '')}":
                        system_op_failures.append("producer key verification after registration")
                elif self.args.submit_producer_registration:
                    system_op_failures.append("producer public key could not be inferred for real registration")
                else:
                    system_op_results["producer_registration"] = {
                        "skipped": "real producer-key registration requires --submit-producer-registration because it can temporarily reset producer-key activation",
                    }
        if failures:
            self.add_phase("Phase 6: Contract Reads and Producer State Reads", "fail", f"kcli read failures: {failures}", commands=results, complex_dry_runs=complex_results, system_operations=system_op_results)
        elif complex_failures:
            self.add_phase("Phase 6: Contract Reads and Producer State Reads", "fail", f"complex operation dry-run failures: {'; '.join(complex_failures)}", commands=results, complex_dry_runs=complex_results, system_operations=system_op_results)
        elif system_op_failures:
            self.add_phase("Phase 6: Contract Reads and Producer State Reads", "fail", f"real system operation failures: {'; '.join(system_op_failures)}", commands=results, complex_dry_runs=complex_results, system_operations=system_op_results)
        else:
            detail = "read-only contract and chain queries passed"
            if self.args.complex_dry_runs and "skipped" not in complex_results:
                detail += "; PoB burn and producer-key dry-runs passed"
            if self.args.submit_system_ops:
                detail += "; real PoB burn passed"
                if self.args.submit_producer_registration:
                    detail += "; same-key producer registration passed"
            self.add_phase("Phase 6: Contract Reads and Producer State Reads", "pass", detail, commands=results, complex_dry_runs=complex_results, system_operations=system_op_results)

    def phase7_observer(self) -> None:
        if not self.args.observer_rpc:
            self.add_phase("Phase 7: Independent Observer Verification", "blocked", "OBSERVER_RPC is not configured")
            return
        try:
            observer_head, observer_latency = get_head(self.args.observer_rpc)
            public_head, public_latency = get_head(self.args.public_rpc)
        except Exception as exc:  # noqa: BLE001
            self.add_phase("Phase 7: Independent Observer Verification", "fail", str(exc))
            return
        lag = public_head["height"] - observer_head["height"]
        data = {
            "observer_head": observer_head,
            "public_head": public_head,
            "observer_latency_ms": observer_latency,
            "public_latency_ms": public_latency,
            "observer_lag": lag,
        }
        if observer_head["id"] == public_head["id"]:
            self.add_phase("Phase 7: Independent Observer Verification", "pass", "observer head matches public RPC", **data)
        elif lag <= self.args.max_observer_lag:
            self.add_phase("Phase 7: Independent Observer Verification", "warn", "observer is close but not at the public head", **data)
        else:
            self.add_phase("Phase 7: Independent Observer Verification", "blocked", "observer is not close enough to act as near-head witness", **data)

    def phase8_soak_samples(self) -> None:
        if self.args.sample_seconds <= 0:
            self.add_phase("Phase 8: Soak With Transaction Injection", "blocked", "--sample-seconds must be greater than 0 for soak sampling")
            return
        samples = self.collect_samples(self.args.sample_seconds, self.args.sample_interval)
        self.add_phase("Phase 8: Soak With Transaction Injection", "pass", "bounded soak samples collected without transfer injection", samples=samples)

    def collect_samples(self, sample_seconds: int, sample_interval: int) -> list[dict[str, Any]]:
        samples: list[dict[str, Any]] = []
        deadline = time.time() + sample_seconds
        while time.time() <= deadline:
            sample: dict[str, Any] = {"time": utc_now()}
            try:
                local_head, local_latency = get_head(self.args.local_rpc)
                public_head, public_latency = get_head(self.args.public_rpc)
                sample.update(
                    {
                        "local_head": local_head,
                        "public_head": public_head,
                        "local_rpc_latency_ms": local_latency,
                        "public_rpc_latency_ms": public_latency,
                        "heads_match": local_head["id"] == public_head["id"],
                    }
                )
            except Exception as exc:  # noqa: BLE001
                sample["error"] = str(exc)
            ps = command_lines("pgrep -n koinos_node | xargs -I{} ps -o pid=,%cpu=,rss= -p {} 2>/dev/null")
            sample["process"] = ps[0] if ps else ""
            sample["disk"] = disk_info(Path(self.args.run_root).expanduser() / "basedir")
            samples.append(sample)
            if time.time() + sample_interval > deadline:
                break
            time.sleep(sample_interval)
        return samples

    def phase9_performance(self) -> None:
        samples = self.collect_samples(max(1, self.args.sample_seconds), max(1, self.args.sample_interval))
        latencies = [sample.get("local_rpc_latency_ms") for sample in samples if isinstance(sample.get("local_rpc_latency_ms"), (int, float))]
        summary: dict[str, Any] = {"samples": samples}
        if latencies:
            ordered = sorted(latencies)
            p95_index = min(len(ordered) - 1, int(round((len(ordered) - 1) * 0.95)))
            summary["local_rpc_latency_p95_ms"] = ordered[p95_index]
            summary["local_rpc_latency_max_ms"] = max(ordered)
        stop_errors = [sample.get("error") for sample in samples if sample.get("error")]
        disk_below_floor = any((sample.get("disk") or {}).get("free_gib", 999999) < self.args.min_disk_free_gib for sample in samples)
        if stop_errors:
            self.add_phase("Phase 9: Performance Regression", "fail", "RPC errors during performance sampling", **summary)
        elif disk_below_floor:
            self.add_phase("Phase 9: Performance Regression", "fail", "disk free crossed stop floor during performance sampling", **summary)
        else:
            self.add_phase("Phase 9: Performance Regression", "pass", "bounded performance samples collected", **summary)

    def run(self) -> dict[str, Any]:
        self.phase1_health()
        if self.args.level >= 1:
            self.phase2_client_reads()
        if self.args.level >= 2:
            self.phase3_transfer_smoke()
        if self.args.level >= 3:
            self.phase4_mempool_burst()
            self.phase5_negative()
            self.phase6_contract_reads()
        if self.args.level >= 4:
            self.phase7_observer()
            self.phase8_soak_samples()
        if self.args.level >= 5:
            self.phase9_performance()

        statuses = [phase.status for phase in self.phases]
        if "fail" in statuses:
            status = "fail"
        elif "blocked" in statuses:
            status = "blocked"
        elif "warn" in statuses:
            status = "warn"
        else:
            status = "pass"

        finished_at = utc_now()
        result = {
            "kind": "knodel-live-producer-regression",
            "status": status,
            "started_at": self.started_at,
            "finished_at": finished_at,
            "level": self.args.level,
            "submit_transfers": self.args.submit_transfers,
            "submit_system_ops": self.args.submit_system_ops,
            "interactive_kcli": self.args.interactive_kcli,
            "local_rpc": self.args.local_rpc,
            "public_rpc": self.args.public_rpc,
            "observer_rpc_configured": bool(self.args.observer_rpc),
            "run_root": self.args.run_root,
            "producer_address": self.args.producer_address,
            "recipient_address": self.args.recipient_address or "",
            "result_dir": str(self.result_dir),
            "phases": [phase.__dict__ for phase in self.phases],
            "metrics": self.metrics,
        }
        self.write_outputs(result)
        return result

    def write_outputs(self, result: dict[str, Any]) -> None:
        json_path = self.result_dir / "result.json"
        md_path = self.result_dir / "result.md"
        json_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
        lines = [
            "# Live Producer Regression Result",
            "",
            f"- Status: {result['status']}",
            f"- Level: {result['level']}",
            f"- Started: {result['started_at']}",
            f"- Finished: {result['finished_at']}",
            f"- Local RPC: `{result['local_rpc']}`",
            f"- Public RPC: `{result['public_rpc']}`",
            f"- Submit transfers: `{str(result['submit_transfers']).lower()}`",
            f"- Submit system ops: `{str(result.get('submit_system_ops', False)).lower()}`",
            "",
            "| Phase | Status | Detail |",
            "|---|---|---|",
        ]
        for phase in self.phases:
            detail = phase.detail.replace("|", "\\|")
            lines.append(f"| {phase.name} | {phase.status} | {detail} |")
        lines.extend(["", f"JSON result: `{json_path}`", ""])
        md_path.write_text("\n".join(lines))
        result["json_path"] = str(json_path)
        result["markdown_path"] = str(md_path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run live Koinos monolith producer regression checks.")
    parser.add_argument("--level", type=int, choices=range(1, 6), default=int(os.getenv("LEVEL", "1")), help="Regression level 1..5.")
    parser.add_argument("--local-rpc", default=os.getenv("LOCAL_RPC", DEFAULT_LOCAL_RPC))
    parser.add_argument("--public-rpc", default=os.getenv("PUBLIC_RPC", DEFAULT_PUBLIC_RPC))
    parser.add_argument("--observer-rpc", default=os.getenv("OBSERVER_RPC", ""))
    parser.add_argument("--run-root", default=os.getenv("RUN_ROOT", str(DEFAULT_RUN_ROOT)))
    parser.add_argument("--producer-log", default=os.getenv("PRODUCER_LOG", ""))
    parser.add_argument("--producer-address", default=os.getenv("PRODUCER_ADDRESS", DEFAULT_PRODUCER))
    parser.add_argument("--producer-public-key", default=os.getenv("PRODUCER_PUBLIC_KEY", ""))
    parser.add_argument("--recipient-address", default=os.getenv("RECIPIENT_ADDRESS", ""))
    parser.add_argument("--transfer-amount", default=os.getenv("TRANSFER_AMOUNT", "0.001"))
    parser.add_argument("--tx-count", type=int, default=int(os.getenv("TX_COUNT", "5")))
    parser.add_argument("--tx-interval", type=int, default=int(os.getenv("TX_INTERVAL", "10")))
    parser.add_argument("--max-total-koin", type=float, default=float(os.getenv("MAX_TOTAL_KOIN", "0.10")))
    parser.add_argument("--burst-confirm-timeout", type=int, default=int(os.getenv("BURST_CONFIRM_TIMEOUT", "180")))
    parser.add_argument("--burst-poll-interval", type=int, default=int(os.getenv("BURST_POLL_INTERVAL", "3")))
    parser.add_argument("--burn-dry-run-amount", default=os.getenv("BURN_DRY_RUN_AMOUNT", "0.001"))
    parser.add_argument("--burn-real-amount", default=os.getenv("BURN_REAL_AMOUNT", "0.001"))
    parser.add_argument("--sample-seconds", type=int, default=int(os.getenv("SAMPLE_SECONDS", "60")))
    parser.add_argument("--sample-interval", type=int, default=int(os.getenv("SAMPLE_INTERVAL", "10")))
    parser.add_argument("--result-dir", default=os.getenv("RESULT_DIR", "/private/tmp/knodel-transaction-regression"))
    parser.add_argument("--kcli", default=os.getenv("KCLI", "kcli"))
    parser.add_argument("--kcli-password-file", default=os.getenv("KCLI_PASSWORD_FILE", ""), help="Path to a local 0600 wallet password file passed to kcli mutating commands.")
    parser.add_argument("--kcli-yes", action="store_true", default=os.getenv("KCLI_YES", "0") == "1", help="Pass --yes to kcli mutating commands.")
    parser.add_argument("--min-disk-free-gib", type=float, default=float(os.getenv("MIN_DISK_FREE_GIB", "10")))
    parser.add_argument("--warn-disk-free-gib", type=float, default=float(os.getenv("WARN_DISK_FREE_GIB", "15")))
    parser.add_argument("--max-observer-lag", type=int, default=int(os.getenv("MAX_OBSERVER_LAG", "120")))
    parser.add_argument("--head-convergence-retries", type=int, default=int(os.getenv("HEAD_CONVERGENCE_RETRIES", "2")))
    parser.add_argument("--head-convergence-delay", type=int, default=int(os.getenv("HEAD_CONVERGENCE_DELAY", "5")))
    parser.add_argument("--submit-transfers", action="store_true", default=os.getenv("SUBMIT_TRANSFERS", "0") == "1")
    parser.add_argument("--submit-system-ops", action="store_true", default=os.getenv("SUBMIT_SYSTEM_OPS", "0") == "1", help="Submit small real PoB/system-contract operations on testnet, in addition to safe dry-runs.")
    parser.add_argument("--submit-producer-registration", action="store_true", default=os.getenv("SUBMIT_PRODUCER_REGISTRATION", "0") == "1", help="Also re-register the current producer key. This can temporarily reset producer-key activation on testnet.")
    parser.add_argument("--complex-dry-runs", action=argparse.BooleanOptionalAction, default=os.getenv("COMPLEX_DRY_RUNS", "1") != "0", help="Run safe mutating dry-runs for PoB/system-contract operations when wallet unlock is available.")
    parser.add_argument("--interactive-kcli", action="store_true", default=os.getenv("INTERACTIVE_KCLI", "0") == "1", help="Let kcli transfer commands inherit the terminal so wallet unlock prompts can work.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    run = RegressionRun(args)
    try:
        result = run.run()
    except Exception as exc:  # noqa: BLE001
        failed = {
            "kind": "knodel-live-producer-regression",
            "status": "fail",
            "started_at": run.started_at,
            "finished_at": utc_now(),
            "level": args.level,
            "error": redact(str(exc)),
            "result_dir": str(run.result_dir),
            "phases": [phase.__dict__ for phase in run.phases],
        }
        run.write_outputs(failed)
        print(json.dumps({"status": "fail", "error": failed["error"], "result_dir": str(run.result_dir)}, indent=2), file=sys.stderr)
        return 1

    print(f"live producer regression {result['status']}: {result['markdown_path']}")
    return 0 if result["status"] in {"pass", "warn"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
