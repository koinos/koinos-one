#!/usr/bin/env python3
"""
Compare local block_store receipts with a public Koinos node.

Detects receipt divergence by fetching the same blocks from both sources
and comparing state_merkle_root and state_delta_entries.

Usage:
    python3 scripts/compare-receipts.py [start] [end] [sample_size]

    start:       Start block height (default: 1)
    end:         End block height (default: current head)
    sample_size: How many blocks to sample (default: 200)
                 Samples are evenly distributed across the range.

Examples:
    python3 scripts/compare-receipts.py 1 34309560 500       # Sample 500 blocks from backup range
    python3 scripts/compare-receipts.py 34309000 34310000    # Dense check around problem area
    python3 scripts/compare-receipts.py 1 1000000 100        # Check early blocks
"""

import json
import sys
import urllib.request
import time
import hashlib
import base64

LOCAL_RPC = "http://127.0.0.1:8080/"
PUBLIC_RPC = "https://api.koinos.io/"
TIMEOUT = 15


def rpc_call(url: str, method: str, params: dict) -> dict:
    payload = json.dumps({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
        "id": 1
    }).encode()
    req = urllib.request.Request(url, data=payload, headers={
        "Content-Type": "application/json",
        "User-Agent": "knodel-receipt-verifier/1.0",
    })
    try:
        resp = urllib.request.urlopen(req, timeout=TIMEOUT)
        return json.loads(resp.read())
    except Exception as e:
        return {"error": str(e)}


def get_head_block_id(url: str) -> tuple:
    result = rpc_call(url, "block_store.get_highest_block", {})
    if "result" in result:
        topo = result["result"]["topology"]
        return topo["id"], int(topo["height"])
    print(f"  get_head_block_id failed for {url}: {result}")
    # Fallback: try chain.get_head_info
    result2 = rpc_call(url, "chain.get_head_info", {})
    if "result" in result2:
        topo = result2["result"]["head_topology"]
        return topo["id"], int(topo["height"])
    print(f"  chain.get_head_info also failed: {result2}")
    return "", 0


def get_block_receipt(url: str, head_id: str, height: int) -> dict:
    result = rpc_call(url, "block_store.get_blocks_by_height", {
        "head_block_id": head_id,
        "ancestor_start_height": height,
        "num_blocks": 1,
        "return_block": True,
        "return_receipt": True,
    })
    if "result" in result:
        items = result["result"].get("block_items", [])
        if items:
            return items[0]
    return {}


def hash_deltas(deltas: list) -> str:
    """Create a deterministic hash of state delta entries for comparison."""
    if not deltas:
        return "empty"
    # Sort and hash to make comparison deterministic
    serialized = json.dumps(deltas, sort_keys=True)
    return hashlib.sha256(serialized.encode()).hexdigest()[:16]


def compare_block(local_head_id: str, public_head_id: str, height: int) -> dict:
    local = get_block_receipt(LOCAL_RPC, local_head_id, height)
    public = get_block_receipt(PUBLIC_RPC, public_head_id, height)

    if not local or not public:
        return {"height": height, "status": "SKIP", "reason": "missing data"}

    local_receipt = local.get("receipt", {})
    public_receipt = public.get("receipt", {})

    local_merkle = local_receipt.get("state_merkle_root", "")
    public_merkle = public_receipt.get("state_merkle_root", "")

    local_deltas = local_receipt.get("state_delta_entries", [])
    public_deltas = public_receipt.get("state_delta_entries", [])

    local_delta_hash = hash_deltas(local_deltas)
    public_delta_hash = hash_deltas(public_deltas)

    # Also compare block headers
    local_prev = local.get("block", {}).get("header", {}).get("previous_state_merkle_root", "")
    public_prev = public.get("block", {}).get("header", {}).get("previous_state_merkle_root", "")

    result = {
        "height": height,
        "merkle_match": local_merkle == public_merkle,
        "deltas_match": local_delta_hash == public_delta_hash,
        "header_match": local_prev == public_prev,
        "local_merkle": local_merkle[:30] if local_merkle else "N/A",
        "public_merkle": public_merkle[:30] if public_merkle else "N/A",
        "local_delta_count": len(local_deltas),
        "public_delta_count": len(public_deltas),
        "local_delta_hash": local_delta_hash,
        "public_delta_hash": public_delta_hash,
    }

    # Determine status
    merkle_comparable = local_merkle and public_merkle  # Both have merkle roots
    deltas_comparable = local_deltas and public_deltas  # Both have deltas

    if merkle_comparable and local_merkle == public_merkle and local_delta_hash == public_delta_hash:
        result["status"] = "OK"
    elif merkle_comparable and local_merkle == public_merkle and local_delta_hash != public_delta_hash:
        result["status"] = "DELTA_DIFF"
    elif merkle_comparable and local_merkle != public_merkle:
        result["status"] = "MERKLE_DIFF"
    elif not merkle_comparable and deltas_comparable and local_delta_hash == public_delta_hash:
        result["status"] = "DELTAS_OK"  # Can't compare merkle but deltas match
    elif not merkle_comparable and deltas_comparable and local_delta_hash != public_delta_hash:
        result["status"] = "DELTA_DIFF"
    elif not merkle_comparable and not public_merkle and not public_deltas:
        result["status"] = "PUBLIC_NO_RECEIPT"  # Public node doesn't have receipts
    else:
        result["status"] = "UNKNOWN"

    return result


def main():
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    end = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    sample_size = int(sys.argv[3]) if len(sys.argv) > 3 else 200

    print("Fetching head block IDs...")
    local_head_id, local_height = get_head_block_id(LOCAL_RPC)
    public_head_id, public_height = get_head_block_id(PUBLIC_RPC)

    if not local_head_id:
        print("ERROR: Cannot connect to local node")
        sys.exit(1)
    if not public_head_id:
        print("ERROR: Cannot connect to public node")
        sys.exit(1)

    print(f"  Local head:  {local_height:,}")
    print(f"  Public head: {public_height:,}")

    if end == 0:
        end = min(local_height, public_height)

    # Generate sample heights
    total_range = end - start
    if sample_size >= total_range:
        heights = list(range(start, end + 1))
    else:
        step = total_range / sample_size
        heights = [int(start + i * step) for i in range(sample_size)]

    print(f"\nComparing {len(heights)} blocks in range [{start:,}, {end:,}]")
    print(f"Local RPC:  {LOCAL_RPC}")
    print(f"Public RPC: {PUBLIC_RPC}")
    print()

    ok = 0
    merkle_diff = 0
    delta_diff = 0
    skipped = 0
    first_diff = None
    diffs = []

    for i, h in enumerate(heights):
        result = compare_block(local_head_id, public_head_id, h)

        if result["status"] == "OK":
            ok += 1
        elif result["status"] == "MERKLE_DIFF":
            merkle_diff += 1
            diffs.append(result)
            if first_diff is None:
                first_diff = h
            print(f"\n  MERKLE_DIFF at block {h:,}:")
            print(f"    Local:  {result['local_merkle']}")
            print(f"    Public: {result['public_merkle']}")
        elif result["status"] == "DELTA_DIFF":
            delta_diff += 1
            diffs.append(result)
            if first_diff is None:
                first_diff = h
            print(f"\n  DELTA_DIFF at block {h:,}:")
            print(f"    Local deltas:  {result['local_delta_count']} (hash: {result['local_delta_hash']})")
            print(f"    Public deltas: {result['public_delta_count']} (hash: {result['public_delta_hash']})")
        elif result["status"] == "SKIP":
            skipped += 1

        pct = (i + 1) / len(heights) * 100
        sys.stdout.write(f"\r  Progress: {i+1}/{len(heights)} ({pct:.0f}%) — OK:{ok} MERKLE_DIFF:{merkle_diff} DELTA_DIFF:{delta_diff} SKIP:{skipped}")
        sys.stdout.flush()

        # Small delay to not hammer the public API
        if i % 10 == 0 and i > 0:
            time.sleep(0.5)

    print("\n")
    print("=" * 70)
    print(f"  Range:          {start:,} — {end:,}")
    print(f"  Blocks sampled: {len(heights)}")
    print(f"  OK:             {ok}")
    print(f"  Merkle diff:    {merkle_diff}")
    print(f"  Delta diff:     {delta_diff}")
    print(f"  Skipped:        {skipped}")
    if first_diff:
        print(f"  First diff at:  block {first_diff:,}")
    else:
        print(f"  Result:         BACKUP MATCHES PUBLIC NODE")
    print("=" * 70)

    if diffs:
        print("\nDifferences found:")
        for d in diffs[:20]:
            print(f"  Block {d['height']:,}: {d['status']}")
            print(f"    Local  merkle={d['local_merkle']} deltas={d['local_delta_count']} hash={d['local_delta_hash']}")
            print(f"    Public merkle={d['public_merkle']} deltas={d['public_delta_count']} hash={d['public_delta_hash']}")
        if len(diffs) > 20:
            print(f"  ... and {len(diffs) - 20} more")

    sys.exit(1 if merkle_diff > 0 or delta_diff > 0 else 0)


if __name__ == "__main__":
    main()
