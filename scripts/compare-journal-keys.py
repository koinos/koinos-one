#!/usr/bin/env python3
"""Decisive cross-check: search a wide bucket range for puts/removes of two
KFS vote keys — the one removed by the CLEAN block 32,789,376 (must have a
canonical put) vs the one removed by the BROKEN block 32,789,377 (phantom).
If the clean-block key has a put and the phantom does not, the phantom remove
was a no-op on the canonical chain (11 correct); if BOTH have puts, the
phantom remove was real (12 correct)."""
import struct, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from anomaly2_recompute import decode_record, receipt_entries

JOURNAL = Path("/Volumes/external2/koinos2/state-delta-audit-full.delta-journal")
BUCKET_SIZE = 100_000
KEYS = {
    b"02076430079384610999996": "CLEAN-block(32789376) entry8 target",
    b"02076430234253060999996": "BROKEN-block(32789377) entry8 phantom",
}

def scan_bucket(bucket):
    path = JOURNAL / f"bucket-{bucket:06d}.bin"
    if not path.exists():
        return
    with open(path, "rb") as f:
        assert f.read(5) == b"SDJB3"
        while True:
            magic = f.read(5)
            if not magic:
                break
            assert magic == b"SDJR2"
            h, size = struct.unpack(">QQ", f.read(16))
            payload = f.read(size)
            if not any(k in payload for k in KEYS):
                continue
            _, _, rb = decode_record(payload)
            for i, (sp, key, val, hv) in enumerate(receipt_entries(rb)):
                if key in KEYS:
                    yield h, KEYS[key], ("put" if hv else "REMOVE"), i

def main():
    lo, hi = int(sys.argv[1]), int(sys.argv[2])
    found = {label: [] for label in KEYS.values()}
    for b in range(lo, hi + 1):
        print(f"bucket {b}...", flush=True)
        for h, label, action, idx in scan_bucket(b):
            print(f"  height={h} [{label}] {action} entry={idx}", flush=True)
            found[label].append((h, action))
    print("\n=== SUMMARY ===")
    for label, hits in found.items():
        puts = [h for h, a in hits if a == "put"]
        rems = [h for h, a in hits if a == "REMOVE"]
        print(f"{label}: puts@{puts} removes@{rems}")

if __name__ == "__main__":
    main()
