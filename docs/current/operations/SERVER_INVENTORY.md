# Server Inventory

Last updated: 2026-06-21T21:50:00Z.

This document tracks the servers currently known to the Koinos One / Teleno
workstation. It is an operational inventory, not an access-control document.
Do not store passwords, private keys, seed phrases, or wallet material here.

## Summary

The hosts that were reachable by SSH during the latest check were:

| Host | Access | CPU | vCPU | RAM | Root Disk | Free Root Disk | Load | Notes |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| `minador_mio` / `192.168.178.188` | `root` | Intel N100 | 4 | 15 GiB | 459 GiB | 86 GiB | 2.32, 1.77, 1.44 | LAN Linux host. Runs legacy prod Koinos stack and `teleno_node` prodnet observer. |
| VPS1 / `46.225.170.6` | `deployer` | AMD EPYC-Genoa Processor | 4 | 7.6 GiB | 150 GiB | 44 GiB | 1.18, 1.03, 0.66 | External VPS. Runs a Dockerized prodnet `teleno_node` observer restored from public bootstrap. |
| VPS2 / `46.62.155.105` | `root` | Intel Xeon Skylake | 2 | 3.7 GiB | 38 GiB | 23 GiB | 0.05, 0.11, 0.13 | Smaller external VPS. Runs the second legacy testnet observer. |

Based on the currently reachable hosts, `192.168.178.188` has the most local
resources: more RAM and a larger NVMe-backed root disk. It is also busier and
is not an external VPS. Among externally reachable VPS hosts verified in this
snapshot, VPS1 `46.225.170.6` has the most resources among external VPS hosts.
Its old Koinos/Teleno/Knodel data was cleaned on 2026-06-21, then it was reused
for a Dockerized prodnet `teleno_node` observer restored from the public
bootstrap repository. VPS2 `46.62.155.105` is a smaller second testnet observer
host.

## Reachability Snapshot

| SSH target | Configured endpoint | Result | Action |
| --- | --- | --- | --- |
| `minador_mio` | `root@192.168.178.188` | Reachable | Keep as LAN/prodnet operations host. |
| VPS1 / `46.225.170.6` | `deployer@46.225.170.6` | Reachable | Dockerized prodnet `teleno_node` observer; previous observer/canary data was removed before this install. |
| VPS2 / `46.62.155.105` | `root@46.62.155.105` | Reachable | Second external legacy testnet observer VPS. |
| `159.69.1.140` | `root@159.69.1.140` | SSH timed out | Recheck network/firewall or whether the host still exists. |
| `fogata-miner` | `root@57.129.41.30` | Host key changed | Do not connect until the new fingerprint is verified out of band. |
| `foundation-seed` | `root@46.62.204.73` | Host key changed | Do not connect until the new fingerprint is verified out of band. |
| `testnet.koinosfoundation.org` | default local SSH user | Permission denied | Use the correct SSH user/key if this host should be managed from this workstation. |

Host-key-change warnings are intentionally treated as blockers. Do not bypass
them with `StrictHostKeyChecking=no`; first verify the expected server
fingerprint through a trusted channel and then update `known_hosts`.

## Host Details

### `minador_mio` / `192.168.178.188`

- User: `root`
- Hostname: `pgarcgo-NEO-Z100-0dB`
- CPU: Intel(R) N100
- vCPU: 4
- Memory: 15 GiB total, 3.5 GiB used, 11 GiB available
- Swap: 4.0 GiB total, 1.4 GiB used
- Root filesystem: 459 GiB total, 350 GiB used, 86 GiB available, 81% used
- Disk: `nvme0n1`, 476.9 GiB, FORESEE 512GB SSD
- Uptime/load at measurement: 42 days uptime; load average 2.32, 1.77, 1.44
- Known workloads:
  - Legacy prod Koinos Docker/microservice stack.
  - `koinos-block_producer-1` for producer `<PROTECTED_MAINNET_PRODUCER_ADDRESS>`.
  - `koinos-block_producer_2-1` for producer `1KfD7n93LnnihyygopWUVTkbtWVe5aXXGW`.
  - `teleno-prodnet-public-backup.service`, running `/opt/teleno/bin/teleno_node`
    as a prodnet observer/public-backup node.

### VPS1 / `46.225.170.6`

- User: `deployer`
- Hostname: `ubuntu-8gb-nbg1-3`
- CPU: AMD EPYC-Genoa Processor
- vCPU: 4
- Memory: 7.6 GiB total, 2.2 GiB used, 5.4 GiB available
- Swap: none
- Root filesystem after prodnet observer restore: 150 GiB total, 100 GiB used,
  44 GiB available, 70% used
- Disk: `sda`, 152.6 GiB, QEMU HARDDISK
- Uptime/load at measurement: 17 days uptime; load average 1.18, 1.03, 0.66
- Previous Koinos workload: external legacy testnet observer under
  `/opt/koinos-testnet-legacy-observer` and mainnet canary build data under
  `/opt/knodel-mainnet-canary`.
- Cleanup status on 2026-06-21:
  - Stopped and removed the `koinos-testnet-legacy-observer-*` containers.
  - Removed the `koinos-testnet-legacy-observer_default` Docker network.
  - Removed `koinos/*` Docker images.
  - Removed `/opt/koinos-testnet-legacy-observer`.
  - Removed `/opt/knodel-mainnet-canary`.
  - Removed leftover Koinos/Teleno/Knodel-matching artifacts from `/opt` and
    `/tmp`.
  - Verification found no Koinos/Teleno/Knodel containers, images, volumes,
    networks, systemd services, `/home/deployer` paths, `/opt` paths, `/tmp`
    paths, `/var` paths, or `/etc` paths visible to the cleanup checks.
- Current workload after reinstall:
  - Container: `teleno-prodnet-observer`.
  - Image: `ghcr.io/pgarciagon/teleno-node:beta`.
  - Restart policy: `unless-stopped`.
  - Role: prodnet observer only; block production is disabled.
  - Basedir: `/home/deployer/teleno-prodnet-observer/basedir`.
  - Config: `/home/deployer/teleno-prodnet-observer/basedir/config.yml`.
  - Public bootstrap snapshot used for restore:
    `20260620T201059Z-ms-1781986259826-files-452`.
  - Public bootstrap source:
    `https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap`.
  - Published ports: `127.0.0.1:18080` for JSON-RPC and `0.0.0.0:18889` for
    P2P.
  - Basedir size after restore: approximately 51 GiB.
  - Runtime sample while catching up: 98.46% Docker CPU, 464 MiB Docker memory,
    around 60 blocks per second, and node-reported RSS around 1.7 GiB.
  - Runtime sample after reaching live block flow: 0.56% to 1.97% Docker CPU
    and 464.9 MiB to 469.4 MiB Docker memory.
  - Sizing note: current VPS1 compute is more than enough for steady-state
    observer work; disk headroom is the main constraint for cost reductions.

### VPS2 / `46.62.155.105`

- User: `root`
- Hostname: `ubuntu-4gb-hel1-2`
- CPU: Intel Xeon Processor (Skylake, IBRS, no TSX)
- vCPU: 2
- Memory: 3.7 GiB total, 1.3 GiB used, 2.4 GiB available
- Swap: none
- Root filesystem: 38 GiB total, 14 GiB used, 23 GiB available, 39% used
- Disk: `sda`, 38.1 GiB, QEMU HARDDISK
- Uptime/load at measurement: 284 days uptime; load average 0.05, 0.11, 0.13
- Known workload: second external legacy testnet observer under
  `/opt/koinos-testnet-legacy-observer`.

Current container check found the `koinos-testnet-legacy-observer-*` Docker
services running for P2P, transaction store, JSON-RPC, block store, contract
meta store, mempool, chain, and AMQP. It listens on `127.0.0.1:18080` for
JSON-RPC and `0.0.0.0:28888` for public P2P.

## Refresh Commands

Use this command shape to refresh a host snapshot without reading secrets:

```bash
ssh -o BatchMode=yes <host> 'bash -s' <<'REMOTE'
echo HOST=$(hostname)
echo USER=$(id -un)
echo CPU_MODEL=$(lscpu | awk -F: '/Model name/ {gsub(/^[ \t]+/, "", $2); print $2; exit}')
echo VCPU=$(nproc)
free -h | awk '/^Mem:/ {print "MEM_TOTAL="$2; print "MEM_USED="$3; print "MEM_AVAIL="$7} /^Swap:/ {print "SWAP_TOTAL="$2; print "SWAP_USED="$3}'
df -h / | awk 'NR==2 {print "ROOT_SIZE="$2; print "ROOT_USED="$3; print "ROOT_AVAIL="$4; print "ROOT_USE="$5}'
lsblk -dn -o NAME,SIZE,TYPE,ROTA,MODEL | grep disk
uptime
REMOTE
```
