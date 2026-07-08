#!/usr/bin/env node
/**
 * Reproduce the block 32,789,377 state-delta merkle root anomaly against
 * PUBLIC mainnet data, using koilib for the RPC calls.
 *
 * It fetches the stored receipt of block 32,789,377 (12 state delta entries)
 * and the header of block 32,789,378 from a public Koinos API, then computes
 * the delta merkle root two ways:
 *
 *   - over all 12 entries  (the honest delta, as neighbouring blocks prove)
 *   - over 11 entries      (dropping the entry-8 remove tombstone)
 *
 * and compares both against block 32,789,378's previous_state_merkle_root —
 * the consensus-signed fingerprint of block 32,789,377's delta.
 *
 * Expected output: the 11-entry root matches the header, the 12-entry root
 * does not — confirming the header stored the tombstone-drop-bugged root
 * during the January 2026 halt recovery.
 *
 * The merkle computation mirrors koinos-state-db-cpp state_delta.cpp:
 *   leaf pairs (sha256(serialized chain.database_key), sha256(value or ""))
 *   sorted by serialized database_key, tree nodes sha256(left||right),
 *   odd node promoted, root prefixed with multihash 0x1220.
 *
 * Usage: node verify-block-32789377-root.js [rpc-url]
 *   default rpc-url: https://api.koinos.io
 */

const crypto = require("crypto");
const { Provider } = require("koilib");

const RPC = process.argv[2] || "https://api.koinos.io";

const BLOCK_377_ID =
  "0x1220a97d7b0567ad55e3b04446a2bef447335cfd676668b069544b04a4719146d586";
const BLOCK_378_ID =
  "0x122086d9090d82fceb9900293bd3f870c4d2ac769682a85f997fd847f4f716a96344";
const PHANTOM_KEY = "02076430234253060999996"; // ASCII key of the entry-8 remove

const sha256 = (b) => crypto.createHash("sha256").update(b).digest();

// ---- byte helpers: koinos JSON uses base64url for bytes, 0x-hex for ids ----

function decodeBytes(s) {
  if (s === undefined || s === null || s === "") return Buffer.alloc(0);
  if (s.startsWith("0x")) return Buffer.from(s.slice(2), "hex");
  return Buffer.from(s, "base64url");
}

// ---- minimal protobuf encoding (canonical, proto3 default-skipping) ----

function varint(n) {
  const out = [];
  while (true) {
    const b = n & 0x7f;
    n >>>= 7;
    if (n) out.push(b | 0x80);
    else {
      out.push(b);
      return Buffer.from(out);
    }
  }
}

// koinos.chain.object_space { bool system = 1; bytes zone = 2; uint32 id = 3; }
function encodeObjectSpace(system, zone, id) {
  const parts = [];
  if (system) parts.push(Buffer.from([0x08, 0x01]));
  if (zone.length) parts.push(Buffer.from([0x12]), varint(zone.length), zone);
  if (id) parts.push(Buffer.from([0x18]), varint(id));
  return Buffer.concat(parts);
}

// koinos.chain.database_key { object_space space = 1; bytes key = 2; }
// space submessage is always present; an EMPTY key bytes field is skipped.
function encodeDatabaseKey(spaceBytes, key) {
  const parts = [Buffer.from([0x0a]), varint(spaceBytes.length), spaceBytes];
  if (key.length) parts.push(Buffer.from([0x12]), varint(key.length), key);
  return Buffer.concat(parts);
}

// ---- the delta merkle root, exactly as state_delta::merkle_root() ----

function deltaMerkleRoot(entries) {
  const pairs = entries.map((e) => {
    const sp = e.object_space || {};
    const spaceBytes = encodeObjectSpace(
      !!sp.system,
      decodeBytes(sp.zone),
      sp.id || 0
    );
    const dbKey = encodeDatabaseKey(spaceBytes, decodeBytes(e.key));
    const value = "value" in e ? decodeBytes(e.value) : Buffer.alloc(0);
    return { dbKey, value };
  });

  pairs.sort((a, b) => Buffer.compare(a.dbKey, b.dbKey));

  let nodes = [];
  for (const { dbKey, value } of pairs) {
    nodes.push(sha256(dbKey));
    nodes.push(sha256(value));
  }

  while (nodes.length > 1) {
    const next = [];
    for (let i = 0; i < nodes.length; i += 2) {
      if (i + 1 < nodes.length)
        next.push(sha256(Buffer.concat([nodes[i], nodes[i + 1]])));
      else next.push(nodes[i]);
    }
    nodes = next;
  }

  return "0x1220" + nodes[0].toString("hex");
}

// ---- main ----

async function main() {
  const provider = new Provider([RPC]);

  console.log(`RPC: ${RPC}\n`);

  const res = await provider.call("block_store.get_blocks_by_id", {
    block_ids: [BLOCK_377_ID, BLOCK_378_ID],
    return_block: true,
    return_receipt: true,
  });

  const items = res.block_items || [];
  if (items.length !== 2)
    throw new Error(`expected 2 blocks, got ${items.length}`);

  const b377 = items.find((i) => (i.block_id || i.block?.id) === BLOCK_377_ID) || items[0];
  const b378 = items.find((i) => (i.block_id || i.block?.id) === BLOCK_378_ID) || items[1];

  const entries = b377.receipt?.state_delta_entries || [];
  console.log(`block 32,789,377 stored receipt entries: ${entries.length}`);
  entries.forEach((e, i) => {
    const action = "value" in e ? "put   " : "REMOVE";
    const keyBuf = decodeBytes(e.key);
    const keyTxt = /^[\x20-\x7e]*$/.test(keyBuf.toString("latin1"))
      ? keyBuf.toString("latin1")
      : "0x" + keyBuf.toString("hex");
    console.log(`  ${String(i).padStart(2)} ${action} ${keyTxt}`);
  });

  const signedRoot = b378.block.header.previous_state_merkle_root;
  const signedHex = signedRoot.startsWith("0x")
    ? signedRoot
    : "0x" + decodeBytes(signedRoot).toString("hex");

  const root12 = deltaMerkleRoot(entries);
  const entries11 = entries.filter(
    (e) => !(!("value" in e) && decodeBytes(e.key).toString("latin1") === PHANTOM_KEY)
  );
  if (entries11.length !== entries.length - 1)
    throw new Error("phantom entry not found in receipt");
  const root11 = deltaMerkleRoot(entries11);

  console.log(`\nsigned root in block 32,789,378 header: ${signedHex}`);
  console.log(`root over all 12 entries:               ${root12}  ${root12 === signedHex ? "MATCH" : "no match"}`);
  console.log(`root over 11 (drop phantom remove):     ${root11}  ${root11 === signedHex ? "MATCH" : "no match"}`);

  console.log("");
  if (root11 === signedHex && root12 !== signedHex) {
    console.log(
      "CONFIRMED: block 32,789,378's header stores the 11-entry (tombstone-dropped)\n" +
      "root, while the honest delta of 32,789,377 has 12 entries. The consensus\n" +
      "anchor for this block is the bugged root baked in during the January 2026\n" +
      "halt recovery."
    );
  } else if (root12 === signedHex) {
    console.log("UNEXPECTED: the 12-entry root matches — anomaly not reproduced on this API.");
  } else {
    console.log("UNEXPECTED: neither root matches — check the entry decoding against this API.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
