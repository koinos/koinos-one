#!/usr/bin/env python3
"""
Verify backup receipt consistency by checking that each block's
state_merkle_root matches the next block's previous_state_merkle_root.

This is a fast check (no WASM re-execution) that detects receipts where
the stored merkle root is inconsistent with the block headers.

Usage:
    python3 scripts/verify-backup-receipts.py [start_height] [end_height] [batch_size]

    start_height: Block height to start checking (default: 1)
    end_height:   Block height to stop (default: current head)
    batch_size:   Blocks per RPC call (default: 100)

Examples:
    python3 scripts/verify-backup-receipts.py                    # Check all blocks
    python3 scripts/verify-backup-receipts.py 34309000 34310000  # Check specific range
    python3 scripts/verify-backup-receipts.py 34309000 34310000 10  # Smaller batches
"""

import json
import sys
import urllib.request
import time


RPC_URL = "http://127.0.0.1:8080/"
TIMEOUT = 30


def rpc_call(method: str, params: dict) -> dict:
    payload = json.dumps({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
        "id": 1
    }).encode()
    req = urllib.request.Request(RPC_URL, data=payload, headers={"Content-Type": "application/json"})
    try:
        resp = urllib.request.urlopen(req, timeout=TIMEOUT)
        return json.loads(resp.read())
    except Exception as e:
        return {"error": str(e)}


def get_head_height() -> int:
    result = rpc_call("chain.get_head_info", {})
    if "result" in result:
        return int(result["result"]["head_topology"]["height"])
    return 0


def get_head_block_id() -> str:
    result = rpc_call("block_store.get_highest_block", {})
    if "result" in result:
        return result["result"]["topology"]["id"]
    return ""


def get_blocks(height: int, count: int, head_id: str = "") -> list:
    if not head_id:
        head_id = get_head_block_id()
    if not head_id:
        print(f"  Could not get head block ID")
        return []
    result = rpc_call("block_store.get_blocks_by_height", {
        "head_block_id": head_id,
        "ancestor_start_height": height,
        "num_blocks": count,
        "return_block": True,
        "return_receipt": True,
    })
    if "result" in result:
        return result["result"].get("block_items", [])
    if "error" in result:
        err = result["error"]
        if isinstance(err, dict):
            print(f"  RPC error at height {height}: {err.get('message', err)}")
        else:
            print(f"  RPC error at height {height}: {err}")
    return []


def verify_range(start: int, end: int, batch_size: int):
    total_checked = 0
    total_mismatches = 0
    total_missing_receipt = 0
    first_mismatch = None

    print(f"Verifying blocks {start:,} to {end:,} ({end - start:,} blocks)")
    print(f"Batch size: {batch_size}")
    print()

    prev_receipt_merkle = None
    height = start
    head_id = get_head_block_id()
    if not head_id:
        print("ERROR: Could not get head block ID")
        return 0

    while height <= end:
        count = min(batch_size, end - height + 1)
        blocks = get_blocks(height, count, head_id)

        if not blocks:
            print(f"  No blocks returned at height {height}, retrying in 5s...")
            time.sleep(5)
            blocks = get_blocks(height, count)
            if not blocks:
                print(f"  Still no blocks at {height}, skipping batch")
                height += count
                continue

        for item in blocks:
            h = int(item.get("block_height", 0))
            receipt = item.get("receipt", {})
            header = item.get("block", {}).get("header", {})

            receipt_merkle = receipt.get("state_merkle_root", "")
            prev_state_merkle = header.get("previous_state_merkle_root", "")

            # Check: does this block's previous_state_merkle_root match
            # the prior block's receipt state_merkle_root?
            if prev_receipt_merkle is not None and prev_state_merkle:
                if prev_receipt_merkle != prev_state_merkle:
                    total_mismatches += 1
                    if first_mismatch is None:
                        first_mismatch = h
                    print(f"  MISMATCH at block {h:,}:")
                    print(f"    prev receipt merkle: {prev_receipt_merkle}")
                    print(f"    block prev_state:    {prev_state_merkle}")

            if not receipt_merkle:
                total_missing_receipt += 1

            prev_receipt_merkle = receipt_merkle
            total_checked += 1

        height += count

        # Progress
        pct = (height - start) / max(end - start, 1) * 100
        sys.stdout.write(f"\r  Progress: {height:,} / {end:,} ({pct:.1f}%) — {total_mismatches} mismatches")
        sys.stdout.flush()

    print()
    print()
    print("=" * 60)
    print(f"Blocks checked:       {total_checked:,}")
    print(f"Mismatches found:     {total_mismatches:,}")
    print(f"Missing receipts:     {total_missing_receipt:,}")
    if first_mismatch:
        print(f"First mismatch at:    block {first_mismatch:,}")
    else:
        print(f"Result:               ALL CONSISTENT")
    print("=" * 60)

    return total_mismatches


def main():
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    end = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    batch_size = int(sys.argv[3]) if len(sys.argv) > 3 else 100

    if end == 0:
        print("Fetching current head height...")
        end = get_head_height()
        if end == 0:
            print("ERROR: Could not get head height. Is the node running?")
            sys.exit(1)
        print(f"Head height: {end:,}")
        print()

    mismatches = verify_range(start, end, batch_size)
    sys.exit(1 if mismatches > 0 else 0)


if __name__ == "__main__":
    main()
