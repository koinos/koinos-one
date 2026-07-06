# Install Or Build

`teleno_node` can be run from a repository build, a packaged Koinos One
installation, a staged bundle, or the Linux container image.

## Repository Build

Run commands from the repository root:

```bash
cd /path/to/koinos-one
```

Initialize submodules when the native dependencies have not been prepared:

```bash
npm run submodules:init
```

Build the native node and its C++ dependency stack:

```bash
./scripts/build-cpp-libp2p-koinos.sh
```

When `node/teleno-node/build/` already exists, a focused rebuild is faster:

```bash
cmake --build node/teleno-node/build --target teleno_node --parallel
```

Verify the binary and command surface:

```bash
./node/teleno-node/build/teleno_node --version
./node/teleno-node/build/teleno_node --help
```

The first command prints the independent native runtime identity. It should
start with the SemVer from `node/teleno-node/VERSION` and include build metadata
for the source revision, for example:

```text
teleno_node 0.1.0+d770931f42b8
```

## Packaged App Binary

Packaged macOS builds stage the native binary as an app resource:

```text
/Applications/Koinos One.app/Contents/Resources/teleno/bin/teleno_node
```

After local package staging, the same layout is available under:

```text
build/bundle-staging/teleno/bin/teleno_node
```

Verify a packaged or staged binary before using it directly:

```bash
"/Applications/Koinos One.app/Contents/Resources/teleno/bin/teleno_node" --version
```

Use the Koinos One GUI for normal desktop operation. Run the packaged binary
directly only when you intentionally want a CLI-managed node and a separately
selected basedir.

## Linux Container

The published image packages the Linux `teleno_node` runtime:

```bash
docker pull ghcr.io/koinos/teleno-node:beta
docker run --rm ghcr.io/koinos/teleno-node:beta --version
```

Versioned runtime images use the native runtime version, not the Koinos One app
version:

```bash
docker pull ghcr.io/koinos/teleno-node:0.1.0
docker run --rm ghcr.io/koinos/teleno-node:0.1.0 --version
```

The container is useful when an operator does not want to install the native
C++ build dependencies on the host. Container examples in this guide keep
JSON-RPC host publishing bound to `127.0.0.1` unless public RPC exposure is
explicitly intended.

## Build Identity

Every packaged app build should be traceable through product version, build
timestamp, Git commit, release channel, and native node build identity. For a
direct CLI binary, keep a record of:

- the `teleno_node --version` output;
- the native release tag, such as `teleno-node-v0.1.0`;
- the Git commit or container tag used to build it;
- the config file path;
- the basedir path;
- the selected network.

## Next Step

After the binary is available, start with [Quickstart](quickstart.md).
