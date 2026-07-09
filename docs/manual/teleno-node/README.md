# Teleno Node CLI Guide

The native `teleno_node` runtime now lives in its own repository:
[github.com/koinos/teleno](https://github.com/koinos/teleno).

Koinos One consumes that repository as the `node/teleno-node` git submodule
and bundles the built binary into packaged releases. The full CLI guide for
operators who run `teleno_node` outside the Koinos One GUI moved with it:

- [CLI guide index](https://github.com/koinos/teleno/blob/main/docs/README.md)
- [Install or build](https://github.com/koinos/teleno/blob/main/docs/install-or-build.md)
- [Quickstart](https://github.com/koinos/teleno/blob/main/docs/quickstart.md)
- [Configuration](https://github.com/koinos/teleno/blob/main/docs/configuration.md)
- [Running observer nodes](https://github.com/koinos/teleno/blob/main/docs/running-observer-node.md)
- [Running producer nodes](https://github.com/koinos/teleno/blob/main/docs/running-producer-node.md)
- [Backup and restore CLI](https://github.com/koinos/teleno/blob/main/docs/backup-restore-cli.md)
- [RPC endpoints](https://github.com/koinos/teleno/blob/main/docs/rpc-endpoints.md)
- [Logs and diagnostics](https://github.com/koinos/teleno/blob/main/docs/logs-and-diagnostics.md)
- [Command reference](https://github.com/koinos/teleno/blob/main/docs/command-reference.md)
- [Troubleshooting](https://github.com/koinos/teleno/blob/main/docs/troubleshooting.md)
- [Release builds](https://github.com/koinos/teleno/blob/main/docs/release-builds.md)

## Versioning

The native runtime is versioned independently from the Koinos One app. Its
SemVer source of truth is the `VERSION` file in the teleno repository, and
native release tags use the form `teleno-node-v<version>`. Packaged Koinos One
builds record the exact native binary identity (version, release tag, and
SHA-256) in the build information shown under Settings.
