#!/usr/bin/env python3
"""Anomaly 2 analytic check: does root(8 stored entries + 2 rectify entries)
equal the consensus root signed in the header of 30,504,203?

Reads the bucketed replay journal produced by koinos_state_delta_replay_audit,
reimplements the delta merkle root (validated against clean blocks first),
and adds the two entries maybe_rectify_state() appends (KFS bytecode +
metadata), taken verbatim from rectify.cpp.
"""

import base64
import hashlib
import re
import struct
import sys
from pathlib import Path

JOURNAL = Path("/Volumes/external2/koinos2/state-delta-audit-full.delta-journal")
BUCKET_SIZE = 100_000
RECTIFY_CPP = Path.home() / "code/forks/koinos-chain/src/koinos/chain/rectify.cpp"

TARGET = 30_504_202
TARGET_ID = bytes.fromhex(
    "1220f0ca713b49490ff60f5636e2848f48a7b31c95f583074a30ce7e3cb35d154524")
EXPECTED_ROOT = bytes.fromhex(
    "12209d2d9592ddf831e892a5d4d38e93324f6834e255f84509b5e1c907ccfaa685e6")
STORED_ONLY_ROOT = bytes.fromhex(
    "12207fb526273e706238cef899350facfd1ddcfa5e19ae352284be53e68d5c516f45")

# ---------------- protobuf mini codec ----------------

def read_varint(buf, pos):
    result = shift = 0
    while True:
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not b & 0x80:
            return result, pos
        shift += 7

def iter_fields(buf):
    pos = 0
    while pos < len(buf):
        tag, pos = read_varint(buf, pos)
        field, wire = tag >> 3, tag & 7
        if wire == 0:
            val, pos = read_varint(buf, pos)
        elif wire == 2:
            length, pos = read_varint(buf, pos)
            val = buf[pos:pos + length]
            pos += length
        elif wire == 1:
            val = buf[pos:pos + 8]; pos += 8
        elif wire == 5:
            val = buf[pos:pos + 4]; pos += 4
        else:
            raise ValueError(f"wire type {wire}")
        yield field, wire, val

def varint(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)

def encode_object_space(system, zone, sid):
    out = b""
    if system:
        out += b"\x08\x01"
    if zone:
        out += b"\x12" + varint(len(zone)) + zone
    if sid:
        out += b"\x18" + varint(sid)
    return out

def encode_database_key(space_bytes, key):
    # proto3: the space submessage is always present (explicit presence via
    # mutable_space), but an empty key bytes field is skipped entirely
    out = b"\x0a" + varint(len(space_bytes)) + space_bytes
    if key:
        out += b"\x12" + varint(len(key)) + key
    return out

# ---------------- journal access ----------------

def load_bucket_records(height):
    bucket = (height - 1) // BUCKET_SIZE
    path = JOURNAL / f"bucket-{bucket:06d}.bin"
    records = {}
    with open(path, "rb") as f:
        assert f.read(5) == b"SDJB3", "bad bucket file magic"
        while True:
            magic = f.read(5)
            if not magic:
                break
            assert magic == b"SDJR2", f"bad record magic {magic!r}"
            head = f.read(16)
            h, size = struct.unpack(">QQ", head)
            payload = f.read(size)
            records.setdefault(h, []).append(payload)
    return records

def decode_record(payload):
    assert payload[:5] == b"SDRJ1", "bad magic"
    pos = 5
    def field(pos):
        (size,) = struct.unpack(">Q", payload[pos:pos + 8])
        return payload[pos + 8:pos + 8 + size], pos + 8 + size
    block_id, pos = field(pos)
    header, pos = field(pos)
    receipt, pos = field(pos)
    assert pos == len(payload), "trailing bytes"
    return block_id, header, receipt

def header_fields(header_bytes):
    out = {"previous_state_merkle_root": b"", "timestamp": 0, "height": 0}
    for field, wire, val in iter_fields(header_bytes):
        if field == 4:
            out["previous_state_merkle_root"] = val
        elif field == 3:
            out["timestamp"] = val
        elif field == 2:
            out["height"] = val
    return out

def receipt_entries(receipt_bytes):
    entries = []
    for field, wire, val in iter_fields(receipt_bytes):
        if field == 13:
            space_bytes, key, value, has_value = b"", b"", b"", False
            for f2, w2, v2 in iter_fields(val):
                if f2 == 1:
                    system, zone, sid = False, b"", 0
                    for f3, w3, v3 in iter_fields(v2):
                        if f3 == 1:
                            system = bool(v3)
                        elif f3 == 2:
                            zone = v3
                        elif f3 == 3:
                            sid = v3
                    space_bytes = encode_object_space(system, zone, sid)
                elif f2 == 2:
                    key = v2
                elif f2 == 3:
                    value, has_value = v2, True
            entries.append((space_bytes, key, value, has_value))
    return entries

# ---------------- merkle ----------------

def sha256(b):
    return hashlib.sha256(b).digest()

def delta_root(pairs):
    """pairs: list of (serialized_database_key, value)"""
    pairs = sorted(pairs, key=lambda p: p[0])
    nodes = []
    for k, v in pairs:
        nodes.append(sha256(k))
        nodes.append(sha256(v))
    if not nodes:
        nodes = [sha256(b"")]
    while len(nodes) > 1:
        nxt = []
        i = 0
        while i < len(nodes):
            if i + 1 < len(nodes):
                nxt.append(sha256(nodes[i] + nodes[i + 1]))
                i += 2
            else:
                nxt.append(nodes[i])
                i += 1
        nodes = nxt
    return b"\x12\x20" + nodes[0]

def entries_to_pairs(entries):
    return [(encode_database_key(sp, k), v if hv else b"")
            for sp, k, v, hv in entries]

# ---------------- rectify entries ----------------

def rectify_entries():
    src = RECTIFY_CPP.read_text()
    # first (uncommented) mainnet bytecode literal
    m = re.search(
        r'^\s*auto new_bytecode = util::from_base64< std::string >\( "([^"]+)" \);',
        src, re.M)
    assert m, "mainnet bytecode literal not found"
    bytecode = base64.b64decode(m.group(1))

    key = base64.b64decode("AGODyCuhi5XqbJWB30tP4BYEWmCH6mq2zg==")
    kfs_hash = bytes.fromhex(
        "12206d263c191b3a6d7cbd70e24fc5c62159f316f6ec115ba8796f269e2ce41d11aa")

    # contract_metadata_object{hash=1, system=2, authorizes_call_contract=3,
    # authorizes_transaction_application=4, authorizes_upload_contract=5}
    meta = (b"\x0a" + varint(len(kfs_hash)) + kfs_hash
            + b"\x10\x01" + b"\x18\x01" + b"\x20\x01" + b"\x28\x01")

    bytecode_space = encode_object_space(True, b"", 2)   # contract_bytecode
    metadata_space = encode_object_space(True, b"", 3)   # contract_metadata

    return [
        (encode_database_key(bytecode_space, key), bytecode),
        (encode_database_key(metadata_space, key), meta),
    ]

# ---------------- main ----------------

def main():
    records = load_bucket_records(TARGET)

    def rec_for(height, want_id=None):
        cands = [decode_record(p) for p in records[height]]
        if want_id:
            cands = [c for c in cands if c[0] == want_id]
        ids = {c[0] for c in cands}
        assert len(ids) == 1, f"ambiguous records at {height}: {ids}"
        return cands[0]

    # --- self-validation on the two clean predecessors ---
    for h in (TARGET - 2, TARGET - 1):
        _, hdr_b, rcp_b = rec_for(h)
        _, next_hdr_b, _ = rec_for(h + 1)
        root = delta_root(entries_to_pairs(receipt_entries(rcp_b)))
        expected = header_fields(next_hdr_b)["previous_state_merkle_root"]
        status = "OK" if root == expected else "MISMATCH"
        print(f"selfcheck height={h}: computed={root.hex()} "
              f"expected={expected.hex()} {status}")
        if root != expected:
            sys.exit("self-validation failed; merkle reimplementation wrong")

    # --- target block ---
    block_id, hdr_b, rcp_b = rec_for(TARGET, TARGET_ID)
    hdr = header_fields(hdr_b)
    print(f"\ntarget height={TARGET} id={block_id.hex()} "
          f"timestamp={hdr['timestamp']}")

    stored = receipt_entries(rcp_b)
    print(f"stored entries: {len(stored)} "
          f"(removes: {sum(1 for e in stored if not e[3])})")

    root_stored = delta_root(entries_to_pairs(stored))
    print(f"root(stored 8):        {root_stored.hex()}")
    print(f"audit computed root:   {STORED_ONLY_ROOT.hex()} "
          f"{'OK' if root_stored == STORED_ONLY_ROOT else 'MISMATCH'}")

    pairs = entries_to_pairs(stored) + rectify_entries()
    root_plus = delta_root(pairs)
    print(f"root(stored 8 + rectify 2): {root_plus.hex()}")
    print(f"consensus (signed) root:    {EXPECTED_ROOT.hex()}")
    print(f"\nRESULT: {'MATCH - anomaly 2 fully explained by #858' if root_plus == EXPECTED_ROOT else 'NO MATCH - rectify entries do not close the gap'}")

if __name__ == "__main__":
    main()
