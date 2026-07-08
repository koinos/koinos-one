# Glossary

This glossary defines common terms used across the Koinos One manual.

| Term | Meaning |
| --- | --- |
| Account | An on-chain identity represented by an address and controlled through cryptographic authority. |
| Account history | Account-oriented history indexing. In the current monolith this is partially implemented and not full legacy parity. |
| Backup admin API | The local administrative surface used by Koinos One and Teleno Node tooling for native backup and restore operations. It is local-only and bearer-token protected. |
| BASEDIR | The node data directory passed to `teleno_node --basedir`. Koinos One uses network-specific defaults; the native CLI falls back to `~/.koinos` when no basedir is provided. |
| Block | A signed unit of chain history containing an ordered set of transactions and a header that links to the previous block. |
| Block producer | The node component that signs and produces blocks when production is enabled and correctly configured. |
| Block store | The storage component that persists validated block data and provides it to chain, sync, and API code. |
| Build identity | The version, timestamp, commit, channel, and native node identity that make a packaged Koinos One build traceable. |
| Chain ID | The identifier of a Koinos network, derived from that network's genesis data. |
| Checkpoint backup | A native backup path that uses RocksDB checkpointing instead of copying live database directories directly. |
| Column family | A RocksDB namespace used to keep different categories of node data in separate logical key spaces. |
| Content-addressed backup repository | The native backup repository layout that stores immutable objects by SHA-256 and references them from snapshot manifests. |
| Deterministic execution | The rule that the same valid input on the same state must produce the same result on compatible nodes. |
| Ed25519 | The signature scheme used by signed public bootstrap metadata where a verification key is configured. |
| Electron main process | The privileged Electron process that owns native integration, windows, IPC handlers, and lifecycle control for the desktop app. |
| Finality | The point at which a block is considered settled according to the network's fork-choice and finality behavior. |
| First-run setup | The setup assistant shown on first launch. It prepares an observer node only; block production is never enabled by it. |
| GarageMQ/AMQP | The message bus used by the legacy Koinos microservices. Teleno Node preserves compatible external behavior without using it as a runtime dependency. |
| Genesis | The initial data that defines a network's starting state and chain identity. |
| GossipSub | The libp2p gossip protocol used to propagate blocks and transactions between peers. |
| gRPC | A typed protobuf-based RPC surface exposed for compatible clients where configured. |
| IPC | Inter-process communication between the Electron renderer, preload bridge, and main process. |
| JSON-RPC | A common external RPC surface used by wallets, explorers, CLIs, and tools. |
| KOIN | The native token of the Koinos blockchain. |
| Koinos | The blockchain protocol and network family that Koinos One follows. |
| Koinos One | The desktop app that supervises and operates a native Teleno Node. |
| Local repository | The native backup repository on local disk, usually under `<BASEDIR>/.teleno-native-backups/repository`. |
| Local state write | A command that changes files under the selected `BASEDIR`, such as node databases, runtime metadata, logs, generated configs, or backup repositories. |
| Mainnet | The public production Koinos network. |
| Mempool | The node component that tracks pending transactions before they are included in blocks. |
| Merkle root | A compact cryptographic commitment to ordered data, such as transaction data or state. |
| Native backup | The backup and restore implementation owned by `teleno_node`, including checkpointing, repository metadata, SFTP transfer, public restore, scheduler, and local admin API behavior. |
| Observer | A node that syncs and validates the chain without producing blocks. |
| P2P | Peer-to-peer networking used by nodes for sync, block gossip, and transaction gossip. |
| Peer RPC | RPC calls made between nodes during sync and peer-to-peer coordination. |
| Preload bridge | The restricted Electron preload layer that exposes approved native capabilities to the React renderer. |
| Private network | A custom Koinos network whose nodes share the same custom genesis data and settings. |
| Private SFTP backup | An authenticated remote native backup target owned by an operator or maintainer. It is separate from public bootstrap restore. |
| Producer | A node configured to sign and produce blocks for a registered producer address. |
| Producer address | The on-chain address associated with block production identity and registration. |
| Producer hot key | The local producer signing key used by the node process when block production is enabled. It is not included in native backups. |
| Proof of Burn | The Koinos consensus mechanism: producers burn KOIN into VHP, and VHP determines producer weight and fork choice. |
| Protocol boundary | The set of externally observable rules all compatible Koinos clients must preserve. |
| Public bootstrap restore | Restore from a public read-only backup source before continuing normal sync. |
| Public publish | The maintainer workflow that promotes a sanitized native backup to a public read-only bootstrap repository. It is not normal operator administration. |
| Public RPC | A public Koinos JSON-RPC endpoint operated for clients. It is not the Koinos One backup admin API. |
| RC | Resource Credits, the resource accounting mechanism used by Koinos transactions. |
| Release channel | The build channel recorded in build identity, such as a prerelease-derived channel or an explicit release-channel override. |
| Renderer | The browser-like Electron process that runs the React user interface. |
| Restore activation | The step that swaps a staged restored database into the active `BASEDIR` while preserving previous runtime paths under `.pre-restore/`. |
| RocksDB | The embedded key-value database used by Teleno Node for persisted chain, state, and operational data. |
| RPC | Remote procedure call APIs used by tools to query or submit data to a node. |
| SFTP | SSH File Transfer Protocol, used by native private remote backup upload and fetch paths. |
| Service registry | The native lifecycle helper that starts monolith components in registered order and stops them in reverse order. |
| State | The current chain data used to validate transactions and blocks. |
| State root | A cryptographic commitment to the current chain state. |
| Teleno Node | The native monolithic Koinos node binary, `teleno_node`. |
| Testnet | A public testing network separate from mainnet. |
| Transaction | A signed user intent containing one or more operations. |
| Unified RocksDB layout | The current monolith storage direction with one RocksDB root at `<BASEDIR>/db` and multiple column families. |
| VHP | Virtual Hash Power, the producer weight used by Koinos Proof of Burn. |
