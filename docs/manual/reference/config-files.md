# Config Files And Data Directories

Use placeholders in examples. Do not publish local absolute paths, real producer
addresses, wallet secrets, tokens, SSH users, or private hostnames.

## Node Data Directories

| Path | Source | Purpose |
| --- | --- | --- |
| `<BASEDIR>` | `teleno_node --basedir <path>` | Root data directory for one node instance. |
| `~/.koinos` | Native `teleno_node` default | Used when the native CLI is started without `--basedir`. |
| `~/.teleno` | Koinos One mainnet default | Default Koinos One mainnet node data directory. |
| `~/.teleno/testnet/.koinos` | Koinos One testnet default | Default Koinos One testnet node data directory. |
| `~/.teleno/custom/.koinos` | Koinos One custom-network default | Default custom-network node data directory. |
| `<BASEDIR>/db` | Unified RocksDB implementation | Current monolith RocksDB root with column families for chain state, blocks, indexes, metadata, and storage metadata. |
| `<BASEDIR>/chain/genesis_data.json` or `<BASEDIR>/genesis_data.json` | Native startup lookup | Genesis data used to identify and initialize the selected network. |
| `<BASEDIR>/block_producer/` | Native block producer | Producer hot key directory. Keep private key material out of docs, logs, screenshots, and backups. |

## Config Files

| File | Purpose |
| --- | --- |
| `<BASEDIR>/config.yml` | Runtime config loaded by `teleno_node` when `--config` is omitted. |
| [`config/mainnet-observer.yml`](https://github.com/koinos/koinos-one/blob/main/config/mainnet-observer.yml) | Mainnet observer example config. |
| [`config/testnet-public-bootstrap-observer.yml`](https://github.com/koinos/koinos-one/blob/main/config/testnet-public-bootstrap-observer.yml) | Testnet observer config with public bootstrap restore source enabled. |
| [`config/testnet-public-bootstrap-observer.container.yml`](https://github.com/koinos/koinos-one/blob/main/config/testnet-public-bootstrap-observer.container.yml) | Container-oriented testnet public bootstrap observer config. |
| [`config/mainnet-public-bootstrap-observer.yml`](https://github.com/koinos/koinos-one/blob/main/config/mainnet-public-bootstrap-observer.yml) | Mainnet observer config with public bootstrap restore source enabled. |
| [`config/mainnet-public-backup-observer.yml`](https://github.com/koinos/koinos-one/blob/main/config/mainnet-public-backup-observer.yml) | Maintainer-oriented public backup publication config. It includes private-backup and public-publish settings and is not normal operator config. |
| [`config/prodnet-docker-producer.yml`](https://github.com/koinos/koinos-one/blob/main/config/prodnet-docker-producer.yml) | Docker producer config template with `block_producer` enabled. Use placeholders for producer addresses. |
| [`config/public-bootstrap/testnet-ed25519.pub`](https://github.com/koinos/koinos-one/blob/main/config/public-bootstrap/testnet-ed25519.pub) | Bundled testnet public bootstrap metadata verification key. |

Mainnet public bootstrap restore is currently documented as relying on HTTPS
origin validation plus per-object SHA-256 verification until prodnet signature
hardening is completed.

## Important Config Sections

| Section | Keys to look for |
| --- | --- |
| `global` | `log-level`, `fork-algorithm`, `log-color`, `log-datetime`, optional RPC allow/deny lists. |
| `chain` | `verify-blocks`, worker counts, transaction-limit settings. |
| `p2p` | `listen`, seed peers, peer discovery, peer acquisition, peer log interval, gossip toggles, optional checkpoints. |
| `jsonrpc` | `listen`, `jobs`. |
| `grpc` | `listen` or `endpoint`, `jobs`. |
| `block_producer` | `algorithm`, `producer`, `private-key-file`, resource bounds, inclusion attempts, gossip production. |
| `rocksdb` | Cache, compression, file-size, write-buffer, and compaction-related settings. |
| `features` | Component enablement for `chain`, `mempool`, `block_store`, `p2p`, `jsonrpc`, `grpc`, `block_producer`, `contract_meta_store`, `transaction_store`, and `account_history`. |
| `backup` | Native backup, private SFTP, public restore, public publish, scheduler, and admin API config. |

## Native Backup Files

| Path | Purpose |
| --- | --- |
| `<BASEDIR>/.teleno-native-backups/teleno-native-backup-config.yml` | Generated Koinos One native backup config. |
| `<BASEDIR>/.teleno-native-backups/admin.token` | Generated backup admin bearer token. Koinos One writes it with `0600` permissions when it owns the token path. |
| `<BASEDIR>/.teleno-native-backups/repository` | Default local content-addressed native backup repository. |
| `<BASEDIR>/.teleno-native-backups/workspace` | Default native backup workspace. |
| `<backup.local.directory>/latest.json` | Points to the latest completed local snapshot. |
| `<backup.local.directory>/snapshots/<backup-id>/` | Completed snapshot metadata: `manifest.json`, `files.json`, and `COMPLETE`. |
| `<backup.local.directory>/objects/sha256/` | Immutable backup objects addressed by SHA-256. |

Restore can also create:

| Path | Purpose |
| --- | --- |
| `<BASEDIR>/.pre-restore/<timestamp>-<backup-id>` | Preserved prior DB/runtime paths during restore activation. |
| `<BASEDIR>/.teleno-restore-staging/<backup-id>` | Restore staging area. |
| `<BASEDIR>/.backup-just-restored` | Marker that the node was just restored and should start observer-first. |
| `<BASEDIR>/.teleno-restore-manifest.json` | Restore activation metadata. |
| `<BASEDIR>/.teleno-restored-config.yml` | Restored config saved separately from the active config. |

## Koinos One App Storage

Koinos One stores app data under Electron's app user-data directory. The exact
platform path is Electron-controlled, so docs should describe the relative
files instead of hard-coding a local machine path.

| Relative path | Purpose |
| --- | --- |
| `secure-storage/<network>/producer-wallet.json` | Encrypted local wallet data. Not included in native backups. |
| `secure-storage/<network>/producer-profile.v1.json` | Local producer profile metadata. |
| `config/public-rpcs.json` | User-configurable public RPC list. |
| `config/app-preferences.v1.json` | App preferences. |
| `config/remote-nodes.inventory.v1.json` | Sanitized remote-node inventory. |
| `config/remote-nodes.receipts.v1.json` | Remote-node action receipts. |
