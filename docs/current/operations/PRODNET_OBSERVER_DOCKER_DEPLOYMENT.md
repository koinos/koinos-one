# Prodnet Observer Docker Deployment

Last validated: 2026-06-21T21:50Z.

This runbook documents the current validated way to deploy a prodnet
`teleno_node` observer on an external Linux server using the published Docker
image and the public prodnet bootstrap backup.

The deployment is observer-only. It must not mount wallet material, producer
keys, or enable block production.

## Validated Reference Deployment

VPS1 was installed with this shape:

```text
host: VPS1 / <VPS1_PUBLIC_IP>
ssh user: <SSH_USER>
container: teleno-prodnet-observer
image: ghcr.io/koinos/teleno:beta
basedir: <REMOTE_PRODNET_OBSERVER_BASEDIR>
config: <REMOTE_PRODNET_OBSERVER_BASEDIR>/config.yml
public backup: https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap
restored snapshot: 20260620T201059Z-ms-1781986259826-files-452
jsonrpc: 127.0.0.1:18080 on the host
p2p: 0.0.0.0:18889 on the host
restart policy: unless-stopped
```

The restored VPS1 observer opened RocksDB, reached `[node] teleno_node ready`,
connected to prodnet peers, and served `chain.get_head_info` over local
JSON-RPC while catching up from the restored snapshot.

## Server Requirements

Recommended safe baseline for public-bootstrap prodnet observer installs:

```text
CPU: 4 vCPU
RAM: 8 GB
Disk: 150 GB SSD/NVMe-class storage
Network: public inbound TCP for P2P
OS: Ubuntu with Docker installed
```

Minimum candidate for cost reduction after validation:

```text
CPU: 2 vCPU
RAM: 4 GB
Disk: 100-120 GB SSD/NVMe-class storage
```

Do not choose a small 40-80 GB root disk for prodnet observer operations. The
restored VPS1 basedir is already about 51 GB, and the host root filesystem used
about 100 GB after Docker image layers, the restored database, logs, and normal
OS overhead. Keep free space for RocksDB compaction, chain growth, logs, and
future backup metadata.

## Prepare The Host

Create an empty basedir owned by the Linux user that runs Docker:

```bash
mkdir -p "$HOME/teleno-prodnet-observer/basedir"
```

Pull the image:

```bash
docker pull ghcr.io/koinos/teleno:beta
```

Check the bundled binary version:

```bash
docker run --rm ghcr.io/koinos/teleno:beta --version
```

## Write The Observer Config

Write this file to:

```text
$HOME/teleno-prodnet-observer/basedir/config.yml
```

```yaml
global:
  log-level: info
  log-color: false
  log-datetime: true
  fork-algorithm: pob
chain:
  verify-blocks: true
p2p:
  listen: /ip4/0.0.0.0/tcp/18889
  seed-reconnect-interval-seconds: 60
  peer-discovery: true
  target-peer-count: 20
  max-peer-candidates: 200
  max-candidate-dials-per-cycle: 3
  peer-acquisition-interval-seconds: 5
  candidate-redial-interval-seconds: 60
  peer-log-interval-seconds: 60
  peer:
    - /ip4/<FOUNDATION_SEED_IP>/tcp/8888/p2p/QmPcF1YrxamfKGpyvP6uAZcPxnmK2WUBC4K4N5ZaWky8Sh
    - /ip4/37.27.7.221/tcp/8888/p2p/QmY8NBHwoVrxBvrjS3wQoeTmWG4UUKMxmYHss7QYRXktrs
    - /ip4/95.216.68.185/tcp/8888/p2p/QmeTy5SE79ksZruNZ1DJJqR6UCe1oZvWcYaUnn6MuYE8Ea
    - /ip4/46.62.245.240/tcp/8888/p2p/QmWmxqE6WhcMWZEKwqUAbu87Qgm6JroZLdM4Xmxouu1Mmi
    - /ip4/94.130.148.114/tcp/8888/p2p/QmQ841mUuYeCtbZXdEMeKcYCx4CZydgz84zSDqWVCeJ4H8
jsonrpc:
  listen: 0.0.0.0:18080
backup:
  enabled: false
  public-restore:
    enabled: true
    base-url: https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap
    network: mainnet
    require-https: true
    timeout-seconds: 30
    retries: 3
features:
  chain: true
  mempool: true
  block_store: true
  p2p: true
  jsonrpc: true
  grpc: false
  block_producer: false
  contract_meta_store: false
  transaction_store: false
  account_history: false
```

The JSON-RPC service listens on `0.0.0.0` inside the container only because
Docker cannot publish a container service that listens only on the container
loopback interface. The host publish rule below binds JSON-RPC to host
`127.0.0.1`, so it is not exposed publicly.

## List The Public Prodnet Backup

Before restoring, verify that the public backup metadata is reachable:

```bash
docker run --rm \
  -v "$HOME/teleno-prodnet-observer/basedir:/data" \
  ghcr.io/koinos/teleno:beta \
  --basedir /data \
  --config /data/config.yml \
  --backup-public-list \
  --backup-public-url https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap \
  --backup-json
```

The validated prodnet snapshot was:

```text
20260620T201059Z-ms-1781986259826-files-452
```

## Restore The Public Prodnet Backup

Run restore into the empty basedir:

```bash
docker run -d --name teleno-prodnet-restore \
  -v "$HOME/teleno-prodnet-observer/basedir:/data" \
  ghcr.io/koinos/teleno:beta \
  --basedir /data \
  --config /data/config.yml \
  --backup-public-restore \
  --backup-public-url https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap \
  --backup-id latest \
  --backup-json
```

Watch restore progress:

```bash
docker logs -f teleno-prodnet-restore
```

Check the exit code:

```bash
docker inspect -f '{{.State.ExitCode}}' teleno-prodnet-restore
```

Remove the completed one-shot restore container:

```bash
docker rm teleno-prodnet-restore
```

Do not start block production after restore. A restored node should start as an
observer first.

## Start The Observer

Start the restored observer:

```bash
docker run -d --name teleno-prodnet-observer \
  --restart unless-stopped \
  -v "$HOME/teleno-prodnet-observer/basedir:/data" \
  -p 127.0.0.1:18080:18080 \
  -p 18889:18889 \
  ghcr.io/koinos/teleno:beta \
  --basedir /data \
  --config /data/config.yml \
  --disable block_producer grpc contract_meta_store transaction_store account_history
```

Confirm the container is running:

```bash
docker ps --filter name=teleno-prodnet-observer
```

Tail logs:

```bash
docker logs -f teleno-prodnet-observer
```

The important startup markers are:

```text
[db] RocksDB opened at /data/db with 9 column families
[p2p/transport] Listening on /ip4/0.0.0.0/tcp/18889
[jsonrpc] Listening on 0.0.0.0:18080
[node] teleno_node ready
```

## Verify Local JSON-RPC

Run from the host:

```bash
curl -sS --max-time 5 http://127.0.0.1:18080/ \
  -H "content-type: application/json" \
  --data '{"jsonrpc":"2.0","id":1,"method":"chain.get_head_info","params":{}}'
```

The height should advance while the node catches up to the network head.

## Ongoing Operations

Check runtime stats:

```bash
docker stats --no-stream teleno-prodnet-observer
```

Check disk:

```bash
df -h "$HOME/teleno-prodnet-observer/basedir"
du -sh "$HOME/teleno-prodnet-observer/basedir"
```

Restart:

```bash
docker restart teleno-prodnet-observer
```

Stop:

```bash
docker stop teleno-prodnet-observer
```

Upgrade to a newer image tag:

```bash
docker pull ghcr.io/koinos/teleno:beta
docker stop teleno-prodnet-observer
docker rm teleno-prodnet-observer
```

Then run the start command again against the existing basedir.

## Current VPS1 Performance Notes

VPS1 has 4 vCPU, 7.6 GiB RAM, and a 150 GB root disk. During prodnet catch-up
from the public backup, it had four connected peers and applied blocks at about
60 blocks per second in the sampled logs.

Observed while catching up from the restored snapshot:

```text
sample time: 2026-06-21T21:47:20Z
head height: 36991861
catch-up rate from logs: about 60 blocks/second
Docker stats CPU: 98.46%
Docker stats memory: 464 MiB / 7.564 GiB
node log RSS metric: about 1.7 GiB
basedir size: 51 GB
root filesystem: 150 GB total, 100 GB used, 44-45 GB free
connected peers: 4
```

Observed after catch-up reached live block flow:

```text
sample window: 2026-06-21T21:47:51Z to 2026-06-21T21:49:56Z
head height: 36993212 -> 36993250
Docker stats CPU: 0.56% to 1.97%
Docker stats memory: 464.9 MiB to 469.4 MiB / 7.564 GiB
root filesystem: 150 GB total, 100 GB used, 44 GB free
basedir size: 51 GB
connected peers: 4
```

This means the current VPS1 size is more than enough for steady-state observer
work. CPU is useful during initial catch-up, but memory has large headroom.
Disk is the real constraint.

Cost-reduction recommendation:

- A 2 vCPU / 4 GB RAM server is a realistic candidate for an observer. It
  should still be validated with a real public restore because catch-up and
  RocksDB compaction will be slower than on VPS1.
- Keep at least 100 GB of SSD/NVMe-class disk, and prefer 120 GB or more if the
  server will stay online for months without manual cleanup.
- Do not downsize to 1 vCPU or 2 GB RAM for prodnet unless a separate soak test
  proves it can keep up after initial catch-up and compaction.
- Do not choose a low-end disk tier. RocksDB catch-up and compaction are disk
  sensitive, and slow disks will look like poor node performance even when CPU
  and RAM are acceptable.

The next cost test should be a second observer deployment on a 2 vCPU / 4 GB RAM
/ 120 GB disk VPS using the same public restore process. Compare catch-up rate,
steady-state CPU, memory, and peer stability before replacing VPS1.

The current basedir size includes both the live RocksDB and the retained public
backup object cache. The future low-disk restore idea is tracked in
`../../backlog/backup-restore/PUBLIC_BOOTSTRAP_DISK_OPTIMIZATION_IDEA.md`.

## Security Notes

- Keep JSON-RPC bound to host loopback with `-p 127.0.0.1:18080:18080`.
- Expose only P2P publicly.
- Keep `block_producer: false` and keep the `--disable block_producer` start
  flag for observer deployments.
- Do not mount wallets, producer keys, SSH backup credentials, or signing keys
  into this observer container.
- The current prodnet public bootstrap is fetched over HTTPS and verifies
  content-addressed object hashes. Prodnet Ed25519 signature enforcement remains
  a follow-up hardening item.
