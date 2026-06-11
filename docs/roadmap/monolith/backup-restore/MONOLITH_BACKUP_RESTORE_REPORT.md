# Monolith Backup Restore Report

- Started: 2026-05-23T22:50:50Z
- Completed: 2026-05-24T05:06:15Z
- Backup URL: https://seed.koinosfoundation.org/backups/koinos-backup.tar.gz
- Remote metadata date: 2026-05-23 22:29:32 UTC
- Workdir: /Volumes/external/knodel-monolith-restore
- BASEDIR: /Volumes/external/knodel-monolith-restore/basedir
- JSON-RPC: http://127.0.0.1:18083/

## Result

Restore validation passed against the monolithic `koinos_node` layout.

The downloaded backup was a legacy Koinos backup. It contained `.koinos/chain`, `.koinos/block_store`, `.koinos/transaction_store`, `.koinos/account_history`, `.koinos/contract_meta_store`, `.koinos/p2p`, and `config.yml`. The monolith can reuse the chain state database, but the legacy Badger block store must be transformed into the monolith RocksDB layout at `basedir/db`.

## Steps Performed

- Downloaded `koinos-backup.tar.gz` to `/Volumes/external/knodel-monolith-restore`.
- Verified SHA-256: `461c7f13277c5cb797528619ae9157462c13cf06518d68b6279ff82f7f6b515d`.
- Extracted the legacy payload directly into `/Volumes/external/knodel-monolith-restore/basedir`.
- Removed the downloaded tarball after extraction to recover external SSD space before conversion.
- Converted legacy Badger `block_store/db` to monolith RocksDB `basedir/db`.
- Started `node/teleno-node/build/koinos_node` with P2P disabled and JSON-RPC on `127.0.0.1:18083`.

## Conversion

- Source: `/Volumes/external/knodel-monolith-restore/basedir/block_store/db`
- Destination: `/Volumes/external/knodel-monolith-restore/basedir/db`
- Import result: `records=40278912 blocks=40278911 meta=1 bytes=83883179053`
- RocksDB column families opened by monolith: `default`, `blocks`, `block_meta`, `contract_meta`, `transaction_index`, `account_history`
- Final approximate sizes:
  - Legacy `block_store`: 41 GiB
  - Monolith `db`: 79 GiB

## JSON-RPC Verification

The monolith opened the restored chain DB and converted block store:

```text
[db] RocksDB opened at /Volumes/external/knodel-monolith-restore/basedir/db with 6 column families
[block_store] Initialized
Opened database at block - Height: 36180897, ID: 0x1220b1812740e4873a1fcf6b7a6ce10c5dea205d7701ef23ecdac193eab3526f3a5a
[jsonrpc] Listening on 127.0.0.1:18083 with 4 threads
koinos_node ready
```

`chain.get_head_info` returned:

```json
{
  "head_topology": {
    "height": "36180898",
    "id": "EiDkqRJM/j9SEf50DglACJknvRgGZN7misLkzNMkwHAh0g==",
    "previous": "EiCxgSdA5Ic6H89remzhDF3qIF13Ae8j7NrBk+qzUm86Wg=="
  },
  "last_irreversible_block": "36180838"
}
```

## Notes

- The initial chain state opened at height `36180897`; after startup, RPC reported `36180898`, confirming the monolith consumed data from the converted block store.
- Follow-up completed during Sprint 1.2: the converted block store reported highest block `36180957`, 60 blocks ahead of the restored chain state at startup. The monolith indexer initially over-requested past the block-store head and logged `goal height must be less than current height`; this was fixed by capping the final restore batch to the remaining block count. A rerun indexed the 60 blocks successfully.
- Backup restore validation should use `chain.verify-blocks: false` to match the legacy restore path and apply trusted receipt deltas from the backup. Re-executing blocks during restore can produce a different intermediate `head_state_merkle_root` and is not the parity mode.
- The external SSD ended with about 27 GiB free. Future restore runs should avoid retaining both the downloaded tarball and converted RocksDB at the same time.
