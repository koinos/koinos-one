# Mainnet Safety

Developers must treat mainnet and producer workflows as high-risk. The project
contains local private memory for protected producer addresses and server
inventory. Do not publish or quote that material.

## Private Material

Do not commit, quote, summarize, or expose:

- protected mainnet producer addresses from local-only files;
- private server inventory;
- hostnames, IPs, SSH users, workloads, or reachability notes;
- wallet secrets, private keys, passwords, tokens, or generated producer key
  material.

Public docs and committed examples must use placeholders such as:

```text
<YOUR_MAINNET_PRODUCER_ADDRESS>
```

## Chain-Mutating Work

These require a fresh explicit user request, clear target confirmation, and a
reviewable dry-run or plan first:

- producer registration;
- VHP burns;
- producer setup changes;
- default account changes;
- config writes targeting a producer;
- transaction signing or submission.

Before any chain-mutating operation, verify:

- selected network;
- signer;
- target address;
- operation type;
- whether the action affects mainnet or a producer.

Generic placeholders are required in public docs and examples. Use
`<YOUR_MAINNET_PRODUCER_ADDRESS>` or similarly explicit placeholders instead of
real protected local producer addresses.

## Restore And Recovery

Restored nodes should start as observers first. Enable production only after
database health, network, producer address, VHP, and producer key checks pass.

For persistent state merkle mismatches, do not clear chain data or force a fresh
resync as the first action. Preserve the existing state DB until
validation-based recovery has been attempted and the user explicitly approves
more invasive steps.

## Documentation Boundary

Public manual pages may describe safety categories, confirmation requirements,
and placeholder formats. They must not quote local-only files, private server
inventory, real protected addresses, SSH users, IP addresses, hostnames, wallet
secrets, token files, or producer key material.
