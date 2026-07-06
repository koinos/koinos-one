# Teleno Node Linux Container

This image packages the Linux `teleno_node` runtime so an operator can run or bootstrap a node without installing the C++ build dependencies on the host.

The GitHub Actions workflow publishes to GitHub Container Registry:

```text
ghcr.io/koinos/teleno-node
```

The default rolling test image tag is:

```bash
docker pull ghcr.io/koinos/teleno-node:beta
```

Independent runtime releases also publish native-version tags such as:

```bash
docker pull ghcr.io/koinos/teleno-node:0.1.0
docker pull ghcr.io/koinos/teleno-node:teleno-node-v0.1.0
```

## Build Locally

```bash
TELENO_NODE_VERSION="$(tr -d '[:space:]' < node/teleno-node/VERSION)"
docker build \
  --build-arg TELENO_NODE_VERSION="$TELENO_NODE_VERSION" \
  -t "teleno-node:${TELENO_NODE_VERSION}" .
docker run --rm "teleno-node:${TELENO_NODE_VERSION}" --version
```

The Docker build uses `scripts/build-cpp-libp2p-koinos.sh`, so the container binary is built through the same Linux native path as the manual Ubuntu build.

## Run A Testnet Observer

Create or choose a host directory for the node basedir:

```bash
mkdir -p "$HOME/teleno-testnet/basedir"
```

Start the node with the basedir mounted at `/data`:

```bash
docker run --rm --name teleno-testnet \
  -v "$HOME/teleno-testnet/basedir:/data" \
  -p 127.0.0.1:18122:18122 \
  -p 18888:18888 \
  ghcr.io/koinos/teleno-node:beta \
  --basedir /data \
  --config /data/config.yml \
  --jsonrpc-listen 0.0.0.0:18122 \
  --p2p-listen 0.0.0.0:18888/tcp \
  --log-level info \
  --disable block_producer grpc
```

The JSON-RPC service binds to `0.0.0.0` inside the container because Docker port publishing cannot expose a service that only listens on the container's own `127.0.0.1`. The `-p 127.0.0.1:18122:18122` publish rule keeps it reachable only from the host loopback interface.

## Restore Public Testnet Bootstrap

The image includes the public testnet bootstrap signing public key at:

```text
/usr/local/share/teleno/public-bootstrap/testnet-ed25519.pub
```

Restore the current signed public testnet snapshot into an empty basedir:

```bash
docker run --rm --entrypoint /bin/sh \
  -v "$HOME/teleno-testnet/basedir:/data" \
  ghcr.io/koinos/teleno-node:beta \
  -lc 'test -f /data/config.yml || cp /usr/local/share/teleno/config/testnet-public-bootstrap-observer.container.yml /data/config.yml
       exec teleno_node --basedir /data --config /data/config.yml \
         --backup-public-restore \
         --backup-public-url https://testnet.koinosfoundation.org/backups/testnet/teleno-bootstrap \
         --backup-json'
```

After restore, start the observer using `/data/config.yml` as shown above.

## Private Remote Backups

Do not bake SSH private keys, password files, or public-bootstrap signing private keys into a Docker image. Mount them at runtime and reference those mounted paths from the node backup config:

```bash
docker run --rm \
  -v "$HOME/teleno-testnet/basedir:/data" \
  -v "$HOME/.ssh:/keys:ro" \
  ghcr.io/koinos/teleno-node:beta \
  --basedir /data \
  --config /data/config.yml \
  --backup-list-remote
```

## Fast Prodnet Producer Launch

The image includes a guarded helper for prodnet block production:

```text
/usr/local/bin/teleno-prod-producer
```

It is intentionally not the default entrypoint. It refuses to start unless the operator explicitly confirms mainnet production, provides a producer address, and mounts an existing registered producer hot key.

Prepare the host basedir:

```bash
mkdir -p "$HOME/teleno-prodnet/basedir/block_producer"
install -m 600 /path/to/registered-prod-private.key \
  "$HOME/teleno-prodnet/basedir/block_producer/private.key"
```

Start the prodnet producer:

```bash
docker run -d --name teleno-prod-producer \
  --restart unless-stopped \
  -e TELENO_ENABLE_PROD_PRODUCER=I_UNDERSTAND_MAINNET_BLOCK_PRODUCTION \
  -e TELENO_PRODUCER_ADDRESS="<prodnet-producer-address>" \
  -v "$HOME/teleno-prodnet/basedir:/data" \
  -p 127.0.0.1:8080:8080 \
  -p 8888:8888 \
  --entrypoint teleno-prod-producer \
  ghcr.io/koinos/teleno-node:beta
```

Check the node from the Linux host:

```bash
curl -sS http://127.0.0.1:8080/ \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"chain.get_head_info","params":{}}'
```

Tail logs:

```bash
docker logs -f teleno-prod-producer
```

Stop it:

```bash
docker stop teleno-prod-producer
```

The helper writes `/data/config.yml` from the bundled prodnet template when no config exists, then patches only the producer address and private-key path. It does not create a missing producer private key for prodnet. If the key is absent, startup fails so the operator does not accidentally run with an unregistered hot key.

## Publish From GitHub

The workflow `.github/workflows/teleno-node-container.yml` builds and smoke-tests the image on Ubuntu 24.04. It publishes package tags to GitHub Container Registry on:

- pushes to `main` that touch the container or native-node build inputs;
- tags matching `v*`, `node-v*`, or `teleno-node-v*`;
- manual workflow dispatch when `push_image` is enabled.

The workflow always publishes a commit tag like `sha-<shortsha>`. On `main` and manual dispatch it also publishes `beta`. Manual dispatch or native release tags publish version tags from `node/teleno-node/VERSION`; manual dispatch can add another tag through the `image_tag` input.

The package may need to be made public once in GitHub Packages if operators should pull it without authenticating.
