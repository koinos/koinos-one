# P2P Default Peer Hardening Plan

- Date: 2026-07-05
- Scope: libp2p Peer RPC serving, seed reconnect behavior, gossip
  amplification, stable P2P identity, seen-cache bounds, and mainnet default
  peer configuration
- Status: implementation plan
- Source: defensive review of `audit.md` received 2026-07-03, rechecked
  against `origin/main` at `92f65fe`

## Problem

Koinos One can connect to and serve P2P traffic, but the current defaults create
avoidable load concentration on the configured mainnet peers. The code also has
several peer-safety gaps that are individually moderate but compound under a
large desktop install base:

- inbound Peer RPC serving lacks per-peer rate limiting and concurrent stream
  caps;
- libp2p callbacks run on one serialized IO thread;
- seed reconnect begins immediately and repeats without jitter or exponential
  backoff;
- live blocks accepted from peers are republished instead of only forwarding
  through gossipsub;
- P2P identity persistence exists in source but is not wired into production
  startup;
- gossip seen caches are insert-only;
- Peer RPC responses are written with one unchecked partial-write call;
- mainnet config and remote-node generated config use a fixed hardcoded IP
  peer list.

This is primarily an availability and operator-infrastructure risk. It is not a
consensus-fork finding.

## Confirmed Evidence

- `node/teleno-node/src/p2p/libp2p_transport.cpp` hard-pins the libp2p runner
  count to one thread.
- `node/teleno-node/src/p2p/p2p_node.cpp` initializes
  `last_seed_cycle = now - seed_reconnect_interval`, causing an immediate first
  seed reconnect cycle.
- `node/teleno-node/src/p2p/p2p_node.cpp` sleeps one second between seed dials
  and does not apply jitter or exponential backoff to failed seeds.
- `node/teleno-node/src/p2p/p2p_node.cpp` serves `GetBlocks` by synchronously
  reading from block store in the inbound Peer RPC handler path.
- `node/teleno-node/src/p2p/libp2p_transport.cpp` writes Peer RPC responses
  through one `writeSome(...)` call before closing the stream.
- `node/teleno-node/src/p2p/p2p_node.hpp` stores `_seen_blocks` and
  `_seen_transactions` as unbounded sets.
- `node/teleno-node/src/p2p/identity.cpp` implements `resolve_p2p_identity`,
  but production startup does not call it.
- `src/app/remote-nodes.ts` and the checked-in mainnet config files carry a
  fixed mainnet IP multiaddr list.

## Goals

1. Prevent one peer from monopolizing inbound Peer RPC service.
2. Spread seed reconnect load across time and avoid synchronized redial herds.
3. Persist Teleno P2P identity across restarts by default.
4. Bound memory used by block and transaction seen caches.
5. Avoid unnecessary gossip re-publication of blocks received from peers.
6. Replace hardcoded mainnet IP defaults with approved DNS/foundation-operated
   or otherwise explicitly governed seed entries.
7. Keep normal outbound-only observers simple for desktop users.

## Non-Goals

- Do not change consensus validation.
- Do not require every observer to accept inbound public P2P connections.
- Do not publish private operator inventory, hostnames, IPs, SSH users, or
  server capacity data in docs or tests.
- Do not combine this with producer activation, wallet changes, or backup
  admin exposure.

## Implementation Plan

### 1. Replace Hardcoded Mainnet IP Defaults

Define a governed mainnet seed source. Preferred options:

1. DNS multiaddrs operated by the foundation or a documented seed pool.
2. A small list of explicitly approved public seed multiaddrs with operator
   sign-off.
3. A release-time generated seed file that can be updated without exposing
   private inventory.

Update:

- `config/mainnet-observer.yml`
- `config/mainnet-public-bootstrap-observer.yml`
- `config/mainnet-public-backup-observer.yml`
- `config/prodnet-docker-producer.yml`
- `src/app/remote-nodes.ts`
- operator docs that currently show real mainnet peer values

Acceptance rule: committed defaults must not encode private or unapproved live
operator infrastructure. Example docs should use placeholders or governed DNS
names.

### 2. Add Seed Reconnect Jitter And Backoff

Change the seed reconnect loop:

- Randomize the initial cycle delay.
- Add per-seed failure state.
- Apply exponential backoff with a cap after repeated connection failures.
- Add jitter to every reconnect interval.
- Reset failure state after a successful connection.

Suggested config additions:

```yaml
p2p:
  seed-reconnect-jitter-percent: 25
  seed-reconnect-backoff-max-seconds: 900
```

Keep existing `seed-reconnect-interval-seconds` behavior as the base interval.

### 3. Add Inbound Peer RPC Limits

Add limits around incoming Peer RPC streams:

- global concurrent inbound Peer RPC cap;
- per-peer concurrent stream cap if peer identity is available from the stream;
- per-peer request-rate token bucket;
- method-specific cost weighting, with `GetBlocks` higher cost than
  `GetHeadBlock`;
- clean refusal or error responses when over limit.

If peer identity is not available at the first implementation point, start with
global caps and remote-address scoped caps, then refine to peer-id scoped caps.

### 4. Offload Heavy GetBlocks Work

Do not perform block-store reads and response serialization directly on the
libp2p callback path. Add a bounded worker executor for Peer RPC methods with
heavy storage work.

Minimum requirements:

- bounded queue;
- timeout;
- cancellation or discard when stream closes;
- metrics/log rows for rejected and timed-out requests;
- no unbounded memory growth for queued large responses.

### 5. Implement Full Write Loop For Peer RPC Responses

Replace `safe_stream_write_and_close(...)` single `writeSome(...)` behavior
with a loop that continues until all bytes are written or an error occurs.

Additional guard:

- enforce a server-side encoded response byte cap for `GetBlocks`;
- if the response would exceed the cap, return a protocol error and log a
  rate-limit style row, not a partial payload.

### 6. Stop Re-Publishing Relayed Blocks

Distinguish locally produced blocks from blocks accepted from peers.

Options:

- Extend the `broadcast::block_accepted` event with an origin/source enum.
- Have the block producer publish its own accepted block explicitly after
  successful local validation.
- Carry a local production flag in the event emission path.

Rule: blocks received from gossipsub or sync should not be re-published as new
signed gossipsub messages by every node. Native gossipsub forwarding is enough.

### 7. Wire Persistent P2P Identity

This should build on `docs/backlog/networking/P2P_PUBLIC_PEER_IDENTITY_PLAN.md`.

Startup should:

1. Resolve identity from `p2p.identity-key-file`, legacy scalar `p2p.seed`, or
   default `<basedir>/p2p/identity.key`.
2. Fail clearly if both seed and key-file identity modes are configured.
3. Pass the resolved key pair into the cpp-libp2p injector.
4. Log only public peer id and sanitized advertised multiaddrs.
5. Expose public peer id through the local status/admin path used by Koinos One.

Identity material must stay outside public docs, screenshots, and logs.

### 8. Bound Seen Caches

Replace insert-only `std::set` caches with bounded structures:

- block seen cache: keyed by block id, purge by LIB height where possible, with
  a hard max entry count;
- transaction seen cache: LRU/ring buffer with a hard max count or TTL;
- expose counters for dropped/evicted entries.

The bounds should be conservative enough for normal fork and gossip behavior
but should not allow unbounded memory growth over long sessions.

### 9. Add Operator Metrics And Logs

Add concise logs for:

- rate-limited inbound Peer RPC requests;
- seed reconnect backoff state;
- peer id and identity source at startup;
- response too large;
- seen-cache eviction count.

Do not log private seed strings, key bytes, private paths, raw host inventory,
or secret-looking tokens.

## Tests

### Native Unit Tests

- Seed reconnect initial delay is randomized in a bounded range.
- Failed seed dials back off and reset after success.
- Inbound Peer RPC limiter rejects over-quota requests.
- `GetBlocks` response byte cap returns an error instead of truncating.
- Write-loop writes all bytes across partial writes.
- Seen caches evict entries and remain bounded.
- P2P identity persists across restart with generated key file.
- Scalar legacy `p2p.seed` remains deterministic.

### Integration Tests

- Local two-node libp2p smoke:
  - stable peer id across restart;
  - successful Peer RPC after restart;
  - inbound cap rejects flood workload without crashing.
- Sync smoke with a response larger than one muxer window.
- Gossip smoke proving a relayed block is not re-published as a new local
  gossipsub publication.

### Config Tests

- Mainnet profiles no longer contain unapproved hardcoded IP peer defaults.
- Remote-node generated observer config uses the governed seed source.
- Placeholder examples remain clearly non-secret and non-private.

## Acceptance Criteria

- Mainnet default peer configuration no longer relies on private or unapproved
  live operator IPs.
- Seed reconnect attempts are jittered and back off after repeated failures.
- Inbound Peer RPC has global and preferably per-peer limits.
- `GetBlocks` handling cannot monopolize the libp2p callback path.
- Peer RPC response writes are complete or fail explicitly.
- Teleno peer identity is stable across restarts by default.
- `_seen_blocks` and `_seen_transactions` cannot grow without bound.
- Relayed live blocks are not re-published by every node as new gossipsub
  messages.

## Release Gate

Before a large install-base release:

1. Run native P2P unit tests and integration smokes.
2. Run `ctest --test-dir node/teleno-node/build --output-on-failure`.
3. Run a mainnet observer soak against governed seeds.
4. Confirm configured seed operators approve the published default list.
5. Confirm no docs, screenshots, or generated config examples contain private
   local inventory.

## Rollout Order

1. Replace default peers and add reconnect jitter/backoff.
2. Wire persistent identity.
3. Add write-loop and response byte caps.
4. Add inbound Peer RPC caps and worker offload.
5. Bound seen caches.
6. Remove relayed-block re-publication.
7. Run soak and operator validation before broad release.
