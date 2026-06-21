# Confirmed SSH Hosts

Last verified: 2026-06-21

This file tracks hosts that were confirmed reachable from the local operator
machine using non-interactive SSH key authentication. It intentionally does not
record SSH private key paths or credentials.

## Confirmed Key-Auth Access

| Name | Address | SSH user | Role / notes |
| --- | --- | --- | --- |
| `minador_mio` | `192.168.178.188` | `root` | LAN Linux host running the legacy prod Koinos node. Also has Teleno observer-only deployment paths; check active service paths before changing anything. |
| VPS1 | `46.225.170.6` | `deployer` | External legacy testnet observer under `/opt/koinos-testnet-legacy-observer`; public P2P documented on `46.225.170.6:28888`. |
| VM2 | `46.62.155.105` | `root` | Second external legacy testnet observer under `/opt/koinos-testnet-legacy-observer`; public P2P documented on `46.62.155.105:28888`. |
| `testnet.koinosfoundation.org` | `37.27.41.35` | `root` | Public testnet host. `/health` returned `ok`, JSON-RPC returned live testnet head, and SSH hostname reported `KoinosTestNet`. |

## Known But Not Confirmed For SSH

| Name | Address | Status |
| --- | --- | --- |
| `foundation-seed` | `46.62.204.73` | SSH port reachable, but local SSH reported a host-key mismatch. Verify the expected fingerprint out of band before changing `known_hosts`. |
| `159.69.1.140` | `159.69.1.140` | SSH key-auth probe timed out; access was not confirmed. |

## Retired / No Longer Owned

| Name | Address | Status |
| --- | --- | --- |
| `fogata-miner` | `57.129.41.30` | No longer owned or managed by this operator as of 2026-06-21. Do not attempt to restore SSH trust or operate services on this host. RIPE/RDAP identifies the current network owner as OVH GmbH / OVHcloud in Germany. |

## Safety Notes

- Treat all mainnet producer operations as high risk and follow the mainnet
  safety guardrails in `AGENTS.md`.
- For hosts with host-key mismatches, do not remove or replace `known_hosts`
  entries until the expected host fingerprint has been verified through a
  trusted channel.
- Before changing services on shared hosts, inspect current container/service
  status and data paths to avoid disturbing active nodes.
