# Install On macOS

This page explains the normal packaged-app install path for Koinos One on
macOS.

## When To Use This

Use this page when installing Koinos One from a downloaded macOS package, such
as a DMG, or when verifying that a packaged build is the one you intended to
run.

## Before You Start

- Use a Mac with enough free disk space for the app, the node database, restore
  staging, and local backups.
- Decide whether the node data should live on the internal disk or an external
  SSD.
- Keep private wallet material out of screenshots, bug reports, and public
  issues.

## Steps

1. Open the Koinos One DMG or package.
2. Drag `Koinos One` into `Applications`.
3. Launch `Koinos One`.
4. If macOS asks for confirmation, verify the app name and source before
   opening it.
5. Complete [First-Run Setup](first-run-setup.md) before using the node
   controls.

The app manages the local native node through `teleno_node`. You should not need
to start Docker services or legacy Koinos microservices for normal Koinos One
operation.

## Build Identity

Packaged builds should be traceable. In the app, open `Settings` and check the
`Build information` area. It can show product version, release channel, build
time, Git revision, source state, and native node binary identity when the build
includes that metadata.

## How To Verify It Worked

- The window title and header show `Koinos One`.
- The main tabs are visible: `Explorer`, `Dashboard`, `Node`, `Remote`,
  `Producer`, `Wallet`, `Documentation`, and `Settings`.
- `Documentation` opens this manual.
- `Settings > Build information` shows the package identity available for the
  build.

## Troubleshooting

If macOS prevents launch, confirm that you downloaded the intended build and
that the package identity matches the release notes you expected. Do not bypass
macOS security prompts for an unknown package.

If the first-run assistant does not appear in a packaged install, open
`Settings` and verify the selected `Base Data Folder`, then open `Node` and use
the observer-first controls manually.

## Related Pages

- [First-Run Setup](first-run-setup.md)
- [Node Dashboard](node-dashboard.md)
- [Troubleshooting](troubleshooting.md)
