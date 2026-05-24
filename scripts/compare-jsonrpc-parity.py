#!/usr/bin/env python3
"""
Compare Koinos JSON-RPC responses between the legacy Go stack and monolith.

The legacy koinos-jsonrpc encodes many byte fields as 0x-prefixed hex strings,
while the monolith currently uses protobuf JSON encoding for bytes, which is
base64. Test cases store byte request values as abstract hex markers so the same
logical request can be encoded for either endpoint.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


BYTE_KEYS = {
    "id",
    "previous",
    "head_block_id",
    "block_id",
    "transaction_id",
    "contract_id",
    "account",
    "payer",
    "payee",
    "caller",
    "head_state_merkle_root",
    "state_merkle_root",
    "previous_state_merkle_root",
}


@dataclass
class Case:
    name: str
    method: str
    params: dict[str, Any]
    mode: str = "strict"


def rpc_call(url: str, method: str, params: dict[str, Any], timeout: float) -> dict[str, Any]:
    payload = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params,
        },
        separators=(",", ":"),
    ).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "knodel-jsonrpc-parity/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return {"transport_error": f"HTTP {exc.code}: {body}"}
    except Exception as exc:
        return {"transport_error": str(exc)}


def hex_to_base64(value: str) -> str:
    raw = bytes.fromhex(value[2:] if value.startswith("0x") else value)
    return base64.b64encode(raw).decode("ascii")


def base64_to_hex(value: str) -> str | None:
    try:
        raw = base64.b64decode(value, validate=True)
    except Exception:
        try:
            raw = base64.urlsafe_b64decode(value + "=" * ( ( 4 - len(value) % 4 ) % 4 ))
        except Exception:
            return None
    if not raw:
        return None
    return "0x" + raw.hex()


def to_hex_bytes(value: str) -> str | None:
    if value.startswith("0x"):
        return "0x" + value[2:].lower()
    return base64_to_hex(value)


def abstract_param(value: Any) -> Any:
    if isinstance(value, str) and value.startswith("0x"):
        return {"__bytes_hex__": "0x" + value[2:].lower()}
    if isinstance(value, list):
        return [abstract_param(v) for v in value]
    if isinstance(value, dict):
        return {k: abstract_param(v) for k, v in value.items()}
    return value


def encode_params(value: Any, flavor: str) -> Any:
    if isinstance(value, dict) and set(value.keys()) == {"__bytes_hex__"}:
        hex_value = value["__bytes_hex__"]
        return hex_value if flavor == "legacy" else hex_to_base64(hex_value)
    if isinstance(value, list):
        return [encode_params(v, flavor) for v in value]
    if isinstance(value, dict):
        return {k: encode_params(v, flavor) for k, v in value.items()}
    return value


def canonicalize(value: Any, parent_key: str = "") -> Any:
    if isinstance(value, dict):
        if "error" in value and set(value.keys()).issubset({"jsonrpc", "id", "error"}):
            err = value["error"]
            if isinstance(err, dict):
                return {"error": {"code": err.get("code"), "message": err.get("message", "")}}
            return {"error": err}
        if "result" in value and set(value.keys()).issubset({"jsonrpc", "id", "result"}):
            return {"result": canonicalize(value["result"])}
        return {k: canonicalize(v, k) for k, v in sorted(value.items()) if k != "jsonrpc"}
    if isinstance(value, list):
        return [canonicalize(v, parent_key) for v in value]
    if isinstance(value, str):
        key = parent_key.lower()
        if key in BYTE_KEYS or key.endswith("_id") or key.endswith("_ids") or key.endswith("_root"):
            hex_value = to_hex_bytes(value)
            if hex_value:
                return hex_value
        return value
    return value


def comparable(canonical: Any) -> Any:
    if isinstance(canonical, dict) and "error" in canonical:
        err = canonical["error"]
        if isinstance(err, dict):
            # Error text often differs across Go/C++ exception paths. Matching
            # error code is enough for invalid-request parity cases.
            return {"error": {"code": err.get("code")}}
    return canonical


def wait_ready(url: str, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        resp = rpc_call(url, "chain.get_head_info", {}, timeout=5)
        if "result" in resp:
            return
        last = resp
        time.sleep(1)
    raise RuntimeError(f"endpoint not ready: {url}: {last}")


def build_cases(url: str, flavor: str, timeout: float) -> list[Case]:
    wait_ready(url, timeout=timeout)
    head = rpc_call(url, "chain.get_head_info", {}, timeout=timeout)
    highest = rpc_call(url, "block_store.get_highest_block", {}, timeout=timeout)

    head_result = head.get("result", {})
    highest_result = highest.get("result", {})
    head_topology = head_result.get("head_topology", {})
    highest_topology = highest_result.get("topology", {})

    head_id = to_hex_bytes(highest_topology.get("id", "")) or to_hex_bytes(head_topology.get("id", ""))
    head_height = int(highest_topology.get("height") or head_topology.get("height") or 0)
    if not head_id or head_height <= 0:
        raise RuntimeError(f"could not determine head block from {url}: head={head} highest={highest}")

    block_height_params = {
        "head_block_id": {"__bytes_hex__": head_id},
        "ancestor_start_height": str(head_height),
        "num_blocks": 1,
        "return_block": False,
        "return_receipt": False,
    }

    return [
        Case("chain.get_head_info", "chain.get_head_info", {}),
        Case("chain.get_chain_id", "chain.get_chain_id", {}),
        Case("chain.get_fork_heads", "chain.get_fork_heads", {}),
        Case("chain.get_account_nonce.invalid_empty", "chain.get_account_nonce", {}, "error_code"),
        Case("chain.get_account_rc.invalid_empty", "chain.get_account_rc", {}, "error_code"),
        Case("chain.get_resource_limits", "chain.get_resource_limits", {}),
        Case("chain.read_contract.invalid_empty", "chain.read_contract", {}, "error_code"),
        Case("chain.submit_block.invalid_empty", "chain.submit_block", {}, "error_code"),
        Case("chain.submit_transaction.invalid_empty", "chain.submit_transaction", {}, "error_code"),
        Case("chain.invoke_system_call.invalid_empty", "chain.invoke_system_call", {}, "error_code"),
        Case("chain.propose_block.invalid_empty", "chain.propose_block", {}, "error_code"),
        Case("block_store.get_blocks_by_height.head", "block_store.get_blocks_by_height", block_height_params),
        Case(
            "block_store.get_blocks_by_id.head",
            "block_store.get_blocks_by_id",
            {"block_ids": [{"__bytes_hex__": head_id}], "return_block": False, "return_receipt": False},
        ),
        Case("block_store.get_highest_block", "block_store.get_highest_block", {}),
        Case("block_store.add_block.invalid_empty", "block_store.add_block", {}, "error_code"),
        Case("mempool.get_pending_transactions", "mempool.get_pending_transactions", {}),
        Case("mempool.check_pending_account_resources.invalid_empty", "mempool.check_pending_account_resources", {}, "error_code"),
        Case("mempool.get_reserved_account_rc.invalid_empty", "mempool.get_reserved_account_rc", {}, "error_code"),
        Case("contract_meta_store.get_contract_meta.invalid_empty", "contract_meta_store.get_contract_meta", {}, "error_code"),
        Case("transaction_store.get_transactions_by_id.empty", "transaction_store.get_transactions_by_id", {"transaction_ids": []}),
        Case("account_history.get_account_history.invalid_empty", "account_history.get_account_history", {}, "error_code"),
    ]


def run_cases(url: str, flavor: str, cases: list[Case], timeout: float) -> list[dict[str, Any]]:
    results = []
    for case in cases:
        params = encode_params(case.params, flavor)
        response = rpc_call(url, case.method, params, timeout=timeout)
        canonical = canonicalize(response)
        results.append(
            {
                "name": case.name,
                "method": case.method,
                "mode": case.mode,
                "params": case.params,
                "request_params": params,
                "response": response,
                "canonical": canonical,
                "comparable": comparable(canonical) if case.mode == "error_code" else canonical,
            }
        )
    return results


def write_baseline(args: argparse.Namespace) -> int:
    cases = build_cases(args.url, args.flavor, args.timeout)
    results = run_cases(args.url, args.flavor, cases, args.timeout)
    payload = {
        "kind": "koinos-jsonrpc-parity-baseline",
        "url": args.url,
        "flavor": args.flavor,
        "case_count": len(results),
        "cases": results,
    }
    Path(args.output).write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    print(f"wrote baseline with {len(results)} cases to {args.output}")
    return 0


def compare_baseline(args: argparse.Namespace) -> int:
    baseline = json.loads(Path(args.baseline).read_text())
    cases = [Case(item["name"], item["method"], item["params"], item.get("mode", "strict")) for item in baseline["cases"]]
    actual = run_cases(args.url, args.flavor, cases, args.timeout)

    rows = []
    failures = 0
    for expected, got in zip(baseline["cases"], actual):
        expected_canonical = canonicalize(expected["response"])
        expected_cmp = comparable(expected_canonical) if expected.get("mode") == "error_code" else expected_canonical
        got_cmp = got["comparable"] if got.get("mode") == "error_code" else got["canonical"]
        status = "PASS" if expected_cmp == got_cmp else "FAIL"
        if status == "FAIL":
            failures += 1
        rows.append(
            {
                "name": expected["name"],
                "method": expected["method"],
                "mode": expected.get("mode", "strict"),
                "status": status,
                "expected": expected_cmp,
                "actual": got_cmp,
            }
        )

    report = {
        "kind": "koinos-jsonrpc-parity-comparison",
        "baseline": args.baseline,
        "baseline_url": baseline.get("url"),
        "actual_url": args.url,
        "case_count": len(rows),
        "failures": failures,
        "rows": rows,
    }
    Path(args.output).write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")

    for row in rows:
        print(f"{row['status']:4} {row['name']}")
    print(f"failures={failures} cases={len(rows)} report={args.output}")
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--timeout", type=float, default=30)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_base = sub.add_parser("write-baseline")
    p_base.add_argument("--url", required=True)
    p_base.add_argument("--flavor", choices=["legacy", "monolith"], required=True)
    p_base.add_argument("--output", required=True)
    p_base.set_defaults(func=write_baseline)

    p_compare = sub.add_parser("compare-baseline")
    p_compare.add_argument("--baseline", required=True)
    p_compare.add_argument("--url", required=True)
    p_compare.add_argument("--flavor", choices=["legacy", "monolith"], required=True)
    p_compare.add_argument("--output", required=True)
    p_compare.set_defaults(func=compare_baseline)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
