# P2P Public Peer Identity Implementation Plan

Last updated: 2026-06-22

## Summary

Teleno can currently listen on a public P2P port and connect outbound to
mainnet peers, but it does not yet fully reproduce the legacy public-peer
identity behavior. The legacy Koinos configuration supports `p2p.seed`, which
deterministically generates a stable peer ID for seed or public nodes. Teleno
already parses `p2p.identity-seed` and scalar `p2p.seed`, and
`Libp2pTransport::Config` already has an `identity_key_path` field, but startup
does not wire either value into the cpp-libp2p host identity.

The implementation goal is to make every Teleno node keep a stable P2P identity
across restarts by default, while retaining legacy-compatible `p2p.seed`
support for operators that already use the legacy model.

## Current Evidence

- Legacy config documents:

  ```yaml
  p2p:
    listen: /ip4/0.0.0.0/tcp/8888
    peer:
      - /dns4/seed.koinosfoundation.org/tcp/8888/p2p/...
    # seed: MY_SECRET_SEED_PHRASE
  ```

- The legacy comment says the seed string generates a peer ID and should only be
  used when configuring the node as a seed node.
- Teleno config parsing currently maps:
  - `p2p.identity-seed` to `NodeConfig::p2p_identity_seed`
  - scalar `p2p.seed` to `NodeConfig::p2p_identity_seed`
  - sequence `p2p.seed` and `p2p.peer` to peer seed lists
- Teleno startup currently passes listen address, seed peers, DHT setting, and
  thread count into `Libp2pTransport`, but not the identity seed or identity key
  path.
- The VPS1 prodnet observer is reachable on its public P2P port and has
  outbound peer sessions, but there is not yet evidence that other nodes can
  rely on a stable published multiaddr for inbound dialing after restarts.

## Goals

1. Provide stable P2P identity for normal users without requiring them to edit a
   seed phrase into `config.yml`.
2. Preserve legacy-compatible `p2p.seed` behavior for existing operators and
   seed-node style deployments.
3. Make `identity-key-file` and `seed` mutually exclusive, because both define
   the same private P2P identity.
4. Keep all identity material local and secret. Never log the seed or private
   key bytes.
5. Log and expose the node's public peer ID and full dialable multiaddr so the
   operator can confirm whether the node is usable as a public peer.
6. Validate the feature on macOS, Linux Docker, and a public VPS observer before
   claiming public-peer parity.

## Non-Goals

- Do not expose the admin API publicly.
- Do not reuse wallet keys, producer keys, or account keys as P2P identity
  material.
- Do not make public-peer operation mandatory for every observer. Outbound-only
  observers should still work with the default configuration.
- Do not change consensus, block production, or producer registration logic.

## Configuration Model

Preferred default:

```yaml
p2p:
  listen: /ip4/0.0.0.0/tcp/18889
  identity-key-file: p2p/identity.key
```

Legacy-compatible alternative:

```yaml
p2p:
  listen: /ip4/0.0.0.0/tcp/18889
  seed: "long-random-secret-only-for-p2p-identity"
```

Optional public address declaration:

```yaml
p2p:
  listen: /ip4/0.0.0.0/tcp/18889
  identity-key-file: p2p/identity.key
  advertised-address:
    - /ip4/<VPS1_PUBLIC_IP>/tcp/18889
```

Rules:

- If neither `identity-key-file` nor `seed` is configured, create and reuse
  `<basedir>/p2p/identity.key`.
- Relative `identity-key-file` paths resolve under `basedir`.
- The identity key file must be created with restrictive permissions where the
  platform supports it.
- If both `identity-key-file` and `seed` or `identity-seed` are configured,
  fail startup with a clear error.
- `identity-seed` remains accepted as a Teleno alias, but `seed` remains the
  legacy-compatible name.
- `advertised-address` entries do not contain the private key. They are public
  base multiaddrs. At runtime the node appends or logs the resolved `/p2p/<id>`
  peer ID.

## Implementation Steps

### 1. Config Parsing And Validation

- Add `p2p_identity_key_file` and `p2p_advertised_addresses` to `NodeConfig`.
- Parse:
  - `p2p.identity-key-file`
  - `p2p.advertised-address` as scalar or list
  - existing `p2p.seed`
  - existing `p2p.identity-seed`
- Add config validation after YAML merge:
  - reject both key-file and seed modes
  - reject empty seed strings
  - reject empty advertised addresses
  - resolve relative key-file paths under `basedir`
- Update `node/teleno-node/tests/core/config_test.cpp`.

### 2. Identity Key Management

- Add a small P2P identity utility responsible for:
  - loading an existing key file
  - creating a new Ed25519 key file if no file exists
  - deriving an identity from `p2p.seed`
  - writing key files with restrictive permissions
  - returning the peer ID without exposing private material in logs
- Before implementing seed derivation, inspect the legacy Koinos Go
  implementation and match its derivation exactly if feasible.
- If exact derivation is not feasible with cpp-libp2p primitives, document the
  incompatibility and keep `p2p.seed` stable within Teleno, but do not call it
  legacy-compatible until verified.

### 3. cpp-libp2p Host Wiring

- Extend `Libp2pTransport::Config` to carry either:
  - a resolved identity key file, or
  - already loaded identity material, depending on the cpp-libp2p injector API.
- Replace the current default generated host identity with the configured or
  loaded identity.
- Keep behavior unchanged when `KOINOS_HAS_LIBP2P` is disabled.
- Ensure restart stability:
  - start node
  - capture peer ID
  - stop node
  - restart node
  - confirm the peer ID is identical

### 4. Runtime Reporting

- Log these values at startup:
  - P2P listen address
  - P2P peer ID
  - identity source: generated key file, configured key file, or seed-derived
  - advertised public multiaddrs with `/p2p/<peer-id>`
- Do not log:
  - seed string
  - private key path contents
  - private key bytes
- Expose the same sanitized values through the local admin/runtime status path
  used by Koinos One.
- Show the peer ID and full advertised multiaddr in the Node overview UI.

### 5. Docker And Operator Integration

- Update Docker examples so the identity key file lives in a mounted data
  volume, not inside the container layer.
- Document the public-peer checklist:
  - public TCP port open
  - Docker port mapped
  - stable identity key present
  - logged public multiaddr includes the expected public IP or DNS name
  - external libp2p probe can dial Peer RPC
- Update prodnet observer deployment docs to distinguish:
  - normal observer
  - public dialable observer
  - seed-style public peer

### 6. Migration Behavior

- Existing basedirs without identity files should get a generated
  `<basedir>/p2p/identity.key` on next start.
- Existing configs with `p2p.seed` should keep using the seed-derived identity.
- Add a later optional migration command:

  ```bash
  teleno_node --basedir <basedir> --p2p-migrate-seed-to-key-file
  ```

  The command should derive the key from the configured seed, write the key file,
  and print the config change the operator should make. It must not silently
  remove the seed from the config.

### 7. Tests

C++ unit tests:

- Config parser accepts `identity-key-file`.
- Config parser accepts legacy scalar `seed`.
- Config parser rejects seed plus key file.
- Relative identity key file resolves under `basedir`.
- Generated key file is reused across restarts.
- Seed-derived identity is deterministic.
- No startup log includes the seed string.

C++ or integration smoke tests:

- Start with no identity config and confirm the same peer ID after restart.
- Start with configured key file and confirm the same peer ID after restart.
- Start with seed and confirm the same peer ID after restart.
- Start with both seed and key file and confirm startup fails clearly.
- Run a two-node local libp2p smoke where one node dials the other's full
  `/ip4/.../tcp/.../p2p/...` address.

Manual Linux Docker validation:

- Deploy observer on VPS1 with mounted identity volume.
- Confirm public TCP port is reachable externally.
- Confirm peer ID survives container restart.
- Confirm an external probe reaches Peer RPC using the logged public multiaddr.
- Confirm the node still syncs from normal configured peers.

Koinos One UX validation:

- Node overview shows peer ID and identity source.
- Node overview shows the dialable public multiaddr when configured.
- Settings validation reports conflict if both seed and key-file modes are set.

## Acceptance Criteria

The work is complete when:

1. A fresh Teleno basedir automatically creates a persistent P2P identity file.
2. Restarting the node preserves the same peer ID.
3. Legacy-style `p2p.seed` produces a deterministic peer ID.
4. `p2p.seed` and `p2p.identity-key-file` cannot be used together.
5. A public Docker observer can be dialed by full multiaddr from outside the
   host.
6. The Node UI displays the peer ID and public multiaddr without exposing
   secrets.
7. Documentation explains how to back up the P2P identity key separately from
   wallet, producer, and chain-state backups.

## Open Questions

- What exact derivation function does legacy Koinos use for `p2p.seed`, and can
  cpp-libp2p reproduce it byte-for-byte?
- Should `advertised-address` be a first-release requirement, or should the
  first implementation only log public multiaddrs assembled from configured
  host/IP metadata?
- Should Koinos One expose a "copy public peer address" button only when the
  node has a public advertised address configured?
- Should public bootstrap restore preserve or exclude the local P2P identity
  file by default? The safer default is exclude, because each node should have a
  unique P2P identity unless the operator deliberately restores it.

