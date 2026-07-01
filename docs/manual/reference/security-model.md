# Security Model

Koinos One should be operated with an observer-first, local-admin-first security
model. Public network participation is separate from administrative control.

## Trust Boundaries

| Boundary | Rule |
| --- | --- |
| P2P | Public P2P ports are for peer networking only. They are not wallet, backup, restore, or admin APIs. |
| Public JSON-RPC and gRPC | Compatibility RPC surfaces for Koinos clients. Public JSON-RPC must not expose native backup or restore admin behavior. Current example configs keep gRPC disabled. |
| Backup admin API | Local-only admin surface. The native server accepts only numeric loopback listen addresses and rejects non-loopback admin binds. |
| Public bootstrap restore | Public read-only backup download source. It does not grant public admin control and does not accept backup creation, deletion, restore activation, wallet, or producer changes. |
| Private SFTP backup | Authenticated private remote backup target. It is separate from public bootstrap restore. |

## Local Admin API Rules

- Default generated backup admin listen: `127.0.0.1:18088`.
- `localhost` is normalized to `127.0.0.1`.
- Non-loopback admin listen addresses fail startup.
- Admin routes under `/admin/*` require `Authorization: Bearer <token>` when a
  token is configured.
- Enabling native backup admin requires a readable, non-empty token file.
- Koinos One generates `<BASEDIR>/.teleno-native-backups/admin.token` with
  random content and `0600` permissions when it owns the token path.
- `/health` and `/healthz` are health checks, but the server itself is still
  loopback-only.

## Private Material

Never publish or commit:

- wallet private keys, seed phrases, WIF values, or raw passwords;
- generated backup admin tokens;
- SSH keys, SFTP passwords, passphrases, or known private host details;
- producer hot keys from `<BASEDIR>/block_producer/`;
- protected local mainnet producer addresses;
- private local server inventory.

Use placeholders in public material:

```text
<YOUR_MAINNET_PRODUCER_ADDRESS>
<YOUR_BACKUP_SFTP_HOST>
<YOUR_REMOTE_BACKUP_DIRECTORY>
```

## Wallets And Producer Keys

Koinos One wallet files are local encrypted app data. Native backups do not
include wallet files, producer private keys, or producer hot keys.

Block production requires both runtime configuration and valid producer key
alignment. Do not treat a running node as production-ready until the operator
has verified database health, selected network, sync health, producer address,
local producer public key, on-chain producer key registration, and VHP status.

## Protected Mainnet Producers

`KOINOS_ONE_PROTECTED_MAINNET_PRODUCER_ADDRESSES` is a local safety override for
protected mainnet producer addresses. When a selected mainnet producer address
is in this list, Koinos One refuses to write it into runtime producer config.

Protected producer addresses are private local memory. Do not copy them into
docs, tests, screenshots, logs, or committed examples.

## Mainnet Mutation Rule

These actions require a fresh explicit user request, target network/address
confirmation, and a dry-run or reviewable plan first:

- producer registration;
- VHP burns;
- producer setup changes;
- default-account changes;
- config writes targeting a producer;
- transaction signing or submission.

Before any chain-mutating operation, verify the selected network, signer,
target address, operation type, and whether the action affects mainnet or a
producer.

## Restore Safety

Restored nodes start as observers first. Restore preserves previous DB/runtime
paths under `.pre-restore/`, writes restore metadata, keeps restored config
separate from active config, and disables block production until operator checks
pass.

For persistent state merkle mismatches, preserve the existing state DB. Do not
clear chain data, start from an empty state DB, or force a fresh full resync as
the first recovery action.
