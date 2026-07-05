# Security Policy

Koinos One can manage wallets, local node data, backups, restore flows,
producer configuration, and native runtime processes. Treat reports involving
keys, passwords, producer setup, backup credentials, remote-node access,
admin tokens, or mainnet mutation paths as sensitive.

## Supported Versions

Security fixes are accepted for the `main` branch and the latest published
Koinos One release. Older releases may receive fixes when a maintainer marks
them as supported for a specific issue.

## Reporting A Vulnerability

Do not open a public issue for a vulnerability or leaked secret.

Use GitHub private vulnerability reporting from the repository Security tab when
available. If private reporting is unavailable, contact the repository
maintainer through GitHub before sharing exploit details publicly.

Please include:

- affected version, commit, or release artifact;
- affected platform and network;
- steps to reproduce;
- impact assessment;
- whether keys, funds, producer state, or backup credentials are involved.

## Disclosure And Safety

Avoid sharing real wallet keys, seed phrases, backup passwords, private server
details, admin tokens, or protected producer addresses. Use redacted logs and
generic placeholders such as `<YOUR_MAINNET_PRODUCER_ADDRESS>`.

Do not perform live chain-mutating tests while reproducing a vulnerability
unless a maintainer explicitly approves the target network, signer, address,
and operation type.
