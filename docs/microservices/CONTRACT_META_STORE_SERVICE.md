# Contract Meta Store Service — Exhaustive Technical Reference

The contract meta store (`koinos-contract-meta-store.exe`) indexes smart contract metadata (ABIs) for the Koinos blockchain. It listens for contract upload events and stores the contract's ABI for later retrieval by wallets and explorers.

## Binary & Version

- **Binary:** `koinos-contract-meta-store.exe` (Go)
- **Version:** v1.1.0
- **Source:** `vendor/koinos/koinos-contract-meta-store/`

---

## Purpose

When a smart contract is uploaded to Koinos, the upload transaction includes the contract's ABI (Application Binary Interface) — a protobuf descriptor that describes the contract's methods, events, and data types. The contract meta store captures and indexes these ABIs so that:

- Wallets can decode contract calls and display human-readable information
- Block explorers can show contract interactions
- dApps can discover available contract methods
- The JSON-RPC gateway can translate contract calls

---

## Configuration

| Flag | Default | Description |
|------|---------|-------------|
| `--basedir, -d` | `~/.koinos` | Base data directory |
| `--amqp, -a` | `amqp://guest:guest@localhost:5672/` | AMQP broker URL |
| `--reset, -r` | false | Reset database |
| `--instance-id, -i` | auto | Instance identifier |
| `--log-level, -l` | `info` | Log level |
| `--jobs, -j` | CPU cores | Worker threads |

---

## Data Model

### Storage

Uses Badger DB at `{basedir}/contract_meta_store/db/`.

### Indexed Data

| Key | Value | Description |
|-----|-------|-------------|
| Contract ID (address) | Contract metadata protobuf | ABI + upload info |

### Contract Metadata

```protobuf
ContractMeta {
  abi: bytes              // Protobuf FileDescriptorSet (contract's schema)
  authority_type: enum    // Who can call: no_authority, contract_call, etc.
}
```

---

## Event Processing

### Broadcast Subscriptions

| Event | Action |
|-------|--------|
| `koinos.event.*.koinos.contracts.contract_meta_store.set_contract_metadata` | Store/update contract ABI |

When a contract is uploaded via `upload_contract` system call, the chain emits a contract event. The meta store captures the ABI from this event and indexes it.

---

## RPC Methods

| Method | Description |
|--------|-------------|
| `get_contract_meta(contract_id)` | Returns ABI and metadata for a contract |

---

## Disk Usage

Minimal — typically a few MB. Only stores contract ABIs, not the bytecode itself (bytecode is in chain state).

---

## Notes

This is the simplest microservice in the Koinos stack. It serves as a convenience index — the blockchain functions without it, but wallets and explorers lose the ability to decode contract interactions.
