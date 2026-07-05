# Native Release Builds

The native node is bundled into packaged Koinos One releases. Release work must
preserve app build identity and native binary identity.

## Native Build

The active binary target is:

```bash
cmake --build node/teleno-node/build --target teleno_node --parallel
```

Old automation can still invoke the compatibility target:

```bash
cmake --build node/teleno-node/build --target koinos_node --parallel
```

That target depends on `teleno_node`.

## Package Handoff

Packaging scripts stage app files, assets, and the native binary before running
Electron Builder. Verification scripts check that the packaged app contains the
expected native CLI surface.

## Build Identity

Every packaged release should expose:

- Koinos One product version;
- release channel;
- build timestamp;
- Git commit and branch;
- dirty/clean source state;
- native node binary hash and metadata.

Use
[`scripts/generate-build-info.js`](https://github.com/koinos/koinos-one/blob/main/scripts/generate-build-info.js)
as the build identity source for the app surface.

## Release Safety

Do not ship a native node build that diverges from Koinos protocol behavior.
Producer, backup, restore, and storage changes require validation that matches
their blast radius.

## Native Release Checklist

- Build `teleno_node` from the intended source revision.
- Run focused native tests for changed components and broader CTest when shared
  behavior changed.
- Confirm `teleno_node --help` exposes expected CLI surfaces.
- Run package staging and packaged-app verification.
- Check About/Build Info for product version, commit, release channel, build
  timestamp, and native binary identity.
- Update changelog or release notes for user-facing behavior.
