# Monolith Private Testnet Plan

Purpose: create a private Koinos-compatible testnet that can be used to sign off Sprint 2 block production without depending on Harbinger availability.

## Goals

- Validate the monolith block producer against a real multi-node network.
- Prove both local chain acceptance and remote peer acceptance of produced blocks.
- Verify EventBus fanout into block store, transaction store, and contract meta store.
- Keep the network small, disposable, and reproducible so failures can be debugged quickly.

## Non-Goals

- Do not replace mainnet or Harbinger configurations.
- Do not change protocol behavior to make production easier.
- Do not count a single-node local acceptance test as Sprint 2 signoff.
- Do not use mainnet data, keys, or basedirs.

## Network Shape

Run three isolated nodes:

| Node | Runtime | Purpose |
|------|---------|---------|
| `seed-1` | Monolith first | Stable p2p seed and independent JSON-RPC verifier |
| `producer-1` | Monolith | Sprint 2 block producer under test |
| `observer-1` | Monolith first | Non-producing peer that must accept and sync produced blocks |

Each node needs its own basedir, config, p2p port, JSON-RPC port, and logs directory. Use `/private/tmp/knodel-private-testnet/*` for short local runs or an external SSD path for longer soaks.

## Phase 0: Harness

Create a private-testnet harness script that:

- creates clean basedirs for `seed-1`, `producer-1`, and `observer-1`;
- copies a shared private-testnet `genesis_data.json` and `koinos_descriptors.pb`;
- writes node-specific `config.yml` files with non-conflicting ports;
- starts each process with logs captured per node;
- waits for JSON-RPC readiness;
- polls `chain.get_chain_id` and `chain.get_head_info`;
- records peer snapshots and produced block lines;
- stops all processes cleanly;
- writes one signoff report under `docs/roadmap/`.

Recommended script location:

```text
scripts/private-testnet-sprint2.sh
```

Recommended report path:

```text
docs/roadmap/MONOLITH_PRIVATE_TESTNET_REPORT.md
```

## Phase A: Federated Smoke

Use a private federated network before PoB/VHP work. This validates block assembly, signing, proposal, EventBus fanout, and peer acceptance without needing KOIN/VHP economics.

Configuration target:

```yaml
global:
  fork-algorithm: fifo

features:
  chain: true
  mempool: true
  block_store: true
  transaction_store: true
  contract_meta_store: true
  p2p: true
  jsonrpc: true
  block_producer: true

block_producer:
  algorithm: federated
  private-key-file: /absolute/path/to/producer-1/block_producer/private.key
  gossip-production: true

p2p:
  listen: /ip4/127.0.0.1/tcp/18889
  peer:
    - /ip4/127.0.0.1/tcp/18888/p2p/<seed-1-peer-id>
```

Implementation status on 2026-05-24:

- `scripts/private-testnet-sprint2.sh` exists and passes the Phase A smoke.
- The harness uses three local monolith nodes, not RabbitMQ-backed microservices.
- A deterministic helper, `koinos_private_testnet_keygen`, derives the producer key and address from a seed string.
- The harness patches a temporary Harbinger genesis by replacing `state::key::genesis_key` with the deterministic producer address bytes.
- Private bootstrap uses `p2p.force-gossip: true` and `block_producer.gossip-production: true`.
- The observer is seeded with both the seed node and producer node multiaddrs. This exercises direct producer sync and avoids a seed-only relay dependency during the short smoke.

Exit criteria:

- `producer-1` logs `Produced block - Height: ...`.
- `producer-1` JSON-RPC head height advances.
- `observer-1` JSON-RPC head height catches the produced height.
- `observer-1` block store returns at least the produced height.
- transaction store and contract meta store stay healthy through harmless dummy-key RPC lookups.
- shutdown is clean.

If this phase fails, fix Sprint 2 mechanics before attempting PoB.

## Phase B: Real PoB/VHP Testnet

Use Koinos PoB semantics for final Sprint 2 signoff.

Status on 2026-05-24: local private PoB smoke and the 30-minute private PoB soak pass. The Phase A Harbinger genesis has only six metadata entries, so it is deliberately too small for direct PoB/VHP state patching. The full `vendor/koinos/koinos/config-example/genesis_data.json` has launch KOIN balance entries under the KOIN contract space, but it does not provide a complete ready-to-patch private PoB/VHP/name-service state for a deterministic staked producer. `scripts/probe-private-pob-genesis.js` makes this an executable check: both bundled genesis files are federated-ready but not PoB-ready because they have no kernel system-call dispatch, contract bytecode, or contract metadata entries. The implemented path builds the required `koin`, `name_service`, `pob`, and `vhp` WASM artifacts from `koinos/koinos-contracts-as`, then `scripts/build-private-pob-genesis.js` creates a deterministic runtime genesis with system-contract bytecode, exact system-call dispatch keys, name-service records, producer hot-key registration, KOIN/RC balance, effective VHP, canonical PoB metadata difficulty, and the VHP allowance PoB needs to burn during private bootstrap. The upstream genesis files remain unchanged.

There are two viable funding strategies:

1. **Custom genesis allocation:** create a private genesis based on Harbinger system contracts but with a known producer account funded with private test KOIN.
2. **Bootstrap/faucet authority:** start from a private genesis with an account able to distribute private test KOIN, then fund the producer over JSON-RPC.

The custom genesis allocation is preferable for repeatable CI-like tests because the producer can always be funded from a deterministic key.

PoB setup steps:

1. Start `seed-1` and `observer-1` from the private PoB genesis.
2. Start `producer-1` with block production enabled once, so it writes:

   ```text
   <producer-basedir>/block_producer/private.key
   <producer-basedir>/block_producer/public.key
   ```

3. Register the producer hot public key in the deterministic private genesis:

   ```text
   pob.register_public_key <producer-address> <contents-of-public.key>
   ```

4. Seed private test KOIN, effective VHP, and the producer-to-PoB VHP allowance in the deterministic private genesis:

   ```text
   pob.burn <amount-in-satoshis> <producer-address> <producer-address>
   ```

5. Restart `producer-1` with:

   ```yaml
   global:
     fork-algorithm: pob

   features:
     block_producer: true
     p2p: true
     jsonrpc: true

   block_producer:
     algorithm: pob
     producer: <producer-address>
     private-key-file: /absolute/path/to/block_producer/private.key
     gossip-production: true
   ```

PoB exit criteria:

- producer account has nonzero KOIN and VHP;
- PoB contract returns the registered public key for the producer address;
- `producer-1` waits for gossip readiness before producing;
- `producer-1` produces at least one PoB block;
- `seed-1` and `observer-1` accept and sync that block;
- a 30-minute private soak shows continuing producer and observer head progress;
- the produced block signer is the configured producer address;
- no fork, rejection, or repeated failed proposal loop appears in logs.

## Genesis Work

This is the main unknown and should be handled explicitly.

Tasks:

- [x] Inspect Harbinger and full `config-example` `genesis_data.json` files.
- [x] Add an executable readiness probe for metadata, system-call dispatch, contract bytecode, contract metadata, and KOIN launch balances.
- [x] Confirm that the bundled genesis files do not include ready-to-patch private PoB/VHP/name-service state.
- [x] Confirm that no required system-contract WASM artifacts are currently checked in under `vendor/koinos`.
- [x] Decide whether the private PoB path should import a known-good state snapshot or bootstrap contracts through private signed transactions.
- [x] Source or build the required `koin`, `name_service`, `pob`, and `vhp` contract artifacts.
- [x] Write a deterministic genesis/bootstrap tool instead of manually editing JSON.
- [x] Add a known private-testnet producer allocation with enough KOIN/RC and VHP.
- [x] Document deterministic private key handling through the harness key seed.
- [x] Compute and log the resulting runtime chain ID through JSON-RPC in the report.
- [ ] Ensure all three nodes use the exact same genesis file.

Do not modify the checked-in Harbinger genesis in place. Generate private-testnet artifacts under `/private/tmp` or a dedicated `tools/private-testnet/fixtures` directory.

## Sprint 2 Signoff Checklist

- [x] Build passes:

  ```bash
  cmake --build vendor/koinos/koinos-node/build --target koinos_node koinos_block_producer_test --parallel
  ```

- [x] Unit tests pass:

  ```bash
  ctest --test-dir vendor/koinos/koinos-node/build --output-on-failure -R koinos_block_producer_test
  ```

- [x] Private federated smoke passes.
- [x] Private PoB/VHP smoke passes.
- [x] Independent observer accepts produced PoB blocks.
- [x] EventBus fanout is verified through block store, transaction store, and contract meta store in private federated and private PoB smokes.
- [x] A short soak, minimum 30 minutes, runs without head stalls or producer error loops.
- [x] The report records commit, chain ID, node ports, produced heights, peer IDs, service checks, shutdown result, and generated-genesis readiness.

## Risks

| Risk | Mitigation |
|------|------------|
| Genesis patching creates invalid contract state | Start with a deterministic tool and validate chain startup on all nodes before producing |
| Federated mode passes but PoB fails | Treat federated as a mechanics smoke only; final signoff requires PoB/VHP |
| Peer IDs change between runs | Generate or record deterministic p2p seeds per node |
| Monolith and legacy configs diverge | Generate all configs from one template |
| Single-node false positive | Require observer sync and independent JSON-RPC verification |

## Immediate Implementation Order

1. [x] Add `scripts/private-testnet-sprint2.sh` with federated three-node smoke first.
2. [x] Add node-specific config generation and report generation.
3. [x] Add deterministic producer key generation or import.
4. [x] Add `scripts/probe-private-pob-genesis.js` and fail-fast `PRIVATE_TESTNET_MODE=pob` readiness checking.
5. [x] Source/build the missing system contract artifacts or import a known-good private PoB snapshot.
6. [x] Implement private PoB/VHP bootstrap or state import strategy.
7. [x] Extend the harness from federated smoke to PoB/VHP smoke.
8. [x] Run the Phase A and Phase B harnesses and update `MONOLITH_PRIVATE_TESTNET_REPORT.md`.
9. [x] Run the 30-minute private PoB soak before calling Sprint 2 fully signed off.
10. [x] Add `scripts/external-pob-testnet-signoff.sh` for shared/external validation with independently reachable producer and observer RPC endpoints.
11. [ ] Run shared/external testnet validation once `PRODUCER_RPC_URL` and `OBSERVER_RPC_URL` are available.
