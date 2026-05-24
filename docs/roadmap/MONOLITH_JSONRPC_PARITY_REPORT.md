# Monolith JSON-RPC Parity Report

- Date: 2026-05-24
- Dataset: `/Volumes/external/knodel-monolith-restore/basedir`
- Legacy endpoint: `http://127.0.0.1:18084/`
- Monolith endpoint: `http://127.0.0.1:18083/`
- Baseline file: `/private/tmp/knodel-jsonrpc-legacy-baseline.json`
- Comparison file: `/private/tmp/knodel-jsonrpc-parity-comparison.json`

## Result

Sprint 1.2 JSON-RPC parity passed: 21/21 JSON-RPC cases matched after canonicalizing byte encodings.

The comparison intentionally normalizes byte fields because the legacy Go JSON-RPC returns several IDs as `0x` hex or URL-safe base64, while the monolith protobuf JSON path may return standard base64 or hex depending on the field path. After byte-equivalent normalization, responses are semantically identical for the tested cases.

## Coverage

- `chain.get_head_info`
- `chain.get_chain_id`
- `chain.get_fork_heads`
- `chain.get_account_nonce`
- `chain.get_account_rc`
- `chain.get_resource_limits`
- `chain.read_contract`
- `chain.submit_block`
- `chain.submit_transaction`
- `chain.invoke_system_call`
- `chain.propose_block`
- `block_store.get_blocks_by_height`
- `block_store.get_blocks_by_id`
- `block_store.get_highest_block`
- `block_store.add_block`
- `mempool.get_pending_transactions`
- `mempool.check_pending_account_resources`
- `mempool.get_reserved_account_rc`
- `contract_meta_store.get_contract_meta`
- `transaction_store.get_transactions_by_id`
- `account_history.get_account_history`

Read calls use real restored data. Mutating calls use invalid empty requests and compare error-code parity so they exercise request routing without changing chain data.

## Fixes Made

- Fixed monolith chain indexer batch sizing so restore catch-up does not request beyond block-store head. Before this fix, the monolith logged `goal height must be less than current height` and stopped 60 blocks behind the converted block store.
- Aligned invalid empty request behavior for:
  - `block_store.add_block`
  - `contract_meta_store.get_contract_meta`
  - `transaction_store.get_transactions_by_id`
- Added `scripts/compare-jsonrpc-parity.py` to capture a legacy baseline and compare a monolith endpoint against it.
- Updated the restore harness to write `chain.verify-blocks: false` for backup restore validation. This matches the legacy restore/indexing mode used for parity and applies trusted receipts/deltas from the backup instead of re-executing blocks during restore verification.

## Commands

Legacy baseline capture:

```bash
python3 scripts/compare-jsonrpc-parity.py write-baseline \
  --url http://127.0.0.1:18084/ \
  --flavor legacy \
  --output /private/tmp/knodel-jsonrpc-legacy-baseline.json
```

Monolith comparison:

```bash
python3 scripts/compare-jsonrpc-parity.py compare-baseline \
  --baseline /private/tmp/knodel-jsonrpc-legacy-baseline.json \
  --url http://127.0.0.1:18083/ \
  --flavor monolith \
  --output /private/tmp/knodel-jsonrpc-parity-comparison.json
```

Final output:

```text
failures=0 cases=21 report=/private/tmp/knodel-jsonrpc-parity-comparison.json
```
