# Testing And Validation

Native development uses focused C++ tests, app tests, smoke scripts, parity
scripts, and packaged-app verification.

## Native C++ Tests

Registered CTest areas include:

- config and service registry;
- chain controller delta handling;
- RocksDB manager;
- backup plan, checkpoint, snapshot, SFTP, public restore, service, and admin
  server;
- P2P Go RPC codec and one-peer sync behavior;
- block producer;
- mempool adapter;
- gRPC server.

Run:

```bash
ctest --test-dir node/teleno-node/build --output-on-failure
```

Run focused groups with `-R` when iterating:

```bash
ctest --test-dir node/teleno-node/build -R p2p --output-on-failure
```

## App Tests

Run Vitest:

```bash
npm run test
```

Run targeted UI tests:

```bash
npm run test:ui
npm run test:ui:backup
```

Run Electron smoke:

```bash
npm run test:ui:electron
```

## Validation Scripts

Use scripts for broader behavior:

- `scripts/smoke-native-backup-restore.sh`
- `scripts/smoke-public-bootstrap-promotion.sh`
- `scripts/compare-jsonrpc-parity.py`
- `scripts/compare-grpc-parity.sh`
- `scripts/validate-grpc-client-compatibility.sh`
- `scripts/run-koinos-integration-compat.sh`
- `scripts/smoke-monolith-p2p-local.sh`
- `scripts/smoke-gossip-interop.sh`

## Packaging And Manual Validation

Use these for release-facing changes:

```bash
npm run docs:build
npm run build
npm run test:package-staging
npm run test:packaged
```

`npm run build` includes strict MkDocs validation. Manual navigation must remain
compatible with the in-app Documentation iframe, which expects concrete HTML
files under `manual-site/`.

## Evidence Boundaries

Historical validation reports remain under `docs/roadmap/`. Current behavior is
summarized under `docs/current/`. Missing or incomplete validation belongs in
`docs/backlog/`.

Do not claim full mainnet, account-history, historical index, or producer
signoff unless current docs and fresh evidence support that claim.

## Mainnet And Producer Validation

Mainnet or producer-mutating validation is not a casual test category. It needs
a fresh explicit user request, clear target network and address confirmation,
and a reviewable dry-run or plan before any signing, submission, registration,
burn, producer setup change, or producer-targeted config write.
