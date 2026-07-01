# Reference

This section contains short lookup pages shared by users, operators, and
developers.

Use these pages as quick lookups while reading the rest of the manual. Longer
operational detail stays in the user, operator, and developer guides.

## Pages

| Page | Use it for |
| --- | --- |
| [Glossary](glossary.md) | Common Koinos, Koinos One, and Teleno Node terms. |
| [Ports And Endpoints](ports.md) | Local listens, public endpoints, P2P ports, JSON-RPC, gRPC, and backup/admin exposure rules. |
| [Config Files And Data Directories](config-files.md) | Important config files, generated files, node data paths, and backup repositories. |
| [Environment Variables](environment-variables.md) | Supported runtime, backup, safety, build, and local helper environment variables confirmed from source. |
| [Security Model](security-model.md) | Private material, protected producer boundaries, local-only admin behavior, wallets, and mainnet mutation rules. |
| [Release Channels](release-channels.md) | Product version, release channel, build timestamp, Git commit, and native node build identity expectations. |
| [Changelog](changelog.md) | Release notes generated from the project changelog, with stable anchors for each version. |

## Safety Notes

- Public bootstrap restore means a public read-only backup source. It does not
  mean public administrative control.
- Use placeholders such as `<YOUR_MAINNET_PRODUCER_ADDRESS>` in public examples.
- Do not put private hostnames, IPs, users, wallet secrets, tokens, or key
  material in manual pages.
