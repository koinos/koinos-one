# Local Codex Project Memory Example

This file is a template for private local project memory. Copy it to
`AGENTS.local.md` and replace the placeholders with local-only addresses or
operational cautions.

`AGENTS.local.md` is intentionally ignored by Git. Do not commit it, paste it
into public issues, or quote its sensitive values in generated documentation.

## Local Mainnet Safety Guardrails

- Protected mainnet producer address: `<YOUR_MAINNET_PRODUCER_ADDRESS>`
- Treat protected mainnet addresses as read-only unless the user gives a fresh,
  explicit, verified mainnet-safe instruction.
- Before any chain-mutating operation, verify the selected network, signer,
  target address, and operation type.
- Never use protected local addresses as GUI placeholders, examples, tests, or
  public documentation values.
- To make the desktop runtime protect local addresses from producer-config
  writes, launch it with:
  `KOINOS_ONE_PROTECTED_MAINNET_PRODUCER_ADDRESSES=<YOUR_MAINNET_PRODUCER_ADDRESS>`

## Local Server Inventory

Keep private server inventory in:

```text
docs/current/operations/SERVER_INVENTORY.md
docs/operations/CONFIRMED_SSH_HOSTS.md
```

Those files are ignored by Git. Use them for local host context only, and do
not copy real hostnames, IPs, SSH users, workloads, or resource snapshots into
public docs.
