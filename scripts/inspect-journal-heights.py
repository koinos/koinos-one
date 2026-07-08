#!/usr/bin/env python3
"""Stream journal buckets, decode only requested heights."""
import struct, sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from anomaly2_recompute import decode_record, iter_fields, receipt_entries

JOURNAL = Path("/Volumes/external2/koinos2/state-delta-audit-full.delta-journal")
BUCKET_SIZE = 100_000

def hdr_all(hb):
    out = {"previous": b"", "height": 0, "timestamp": 0, "root": b"", "signer": b""}
    for f, w, v in iter_fields(hb):
        if f == 1: out["previous"] = v
        elif f == 2: out["height"] = v
        elif f == 3: out["timestamp"] = v
        elif f == 4: out["root"] = v
        elif f == 6: out["signer"] = v
    return out

def stream(wanted):
    by_bucket = {}
    for h in wanted:
        by_bucket.setdefault((h - 1) // BUCKET_SIZE, set()).add(h)
    for bucket, heights in sorted(by_bucket.items()):
        path = JOURNAL / f"bucket-{bucket:06d}.bin"
        with open(path, "rb") as f:
            assert f.read(5) == b"SDJB3"
            while True:
                magic = f.read(5)
                if not magic:
                    break
                assert magic == b"SDJR2", magic
                h, size = struct.unpack(">QQ", f.read(16))
                if h in heights:
                    yield h, f.read(size)
                else:
                    f.seek(size, 1)

def main():
    wanted = sorted(int(a) for a in sys.argv[1:])
    for h, payload in stream(wanted):
        bid, hb, rb = decode_record(payload)
        d = hdr_all(hb)
        ts = datetime.fromtimestamp(d["timestamp"]/1000, tz=timezone.utc).isoformat()
        entries = receipt_entries(rb)
        removes = sum(1 for e in entries if not e[3])
        print(f"h={h} id={bid.hex()} ts={ts}")
        print(f"   signer={d['signer'].hex()} entries={len(entries)} removes={removes} prev_root={d['root'].hex()[:20]}...")
        for i, (sp, key, val, hv) in enumerate(entries):
            act = "put" if hv else "REMOVE"
            ktxt = key.decode('ascii') if key and all(32 <= b < 127 for b in key) else key.hex()[:40]
            print(f"   {i:2d} {act:6s} space={sp.hex()[:44]:44s} key={ktxt[:46]:46s} vlen={len(val)}")

if __name__ == "__main__":
    main()
