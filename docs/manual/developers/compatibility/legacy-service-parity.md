# Legacy Service Parity

Teleno replaces the old multi-service Koinos runtime with a monolithic node.
Compatibility is measured by externally visible behavior, not by keeping the old
process layout.

## Implemented Core Areas

The current monolith implements:

- chain;
- block store;
- mempool;
- P2P;
- JSON-RPC;
- gRPC;
- block producer;
- forward transaction store indexing;
- forward contract metadata indexing;
- simplified account history.

These services run in one native process and communicate through direct calls
and an internal event bus. Compatibility is judged by chain behavior, P2P
interop, and public RPC behavior, not by preserving the old process topology.

## Partial Or Backlog Areas

The main remaining parity gaps are:

- full account-history parity and historical backfill;
- historical transaction index backfill;
- historical contract metadata backfill;
- longer mainnet/prodnet validation;
- signed prodnet public bootstrap publication and governance;
- gRPC ACL enforcement.

Check the
[Monolith Service Coverage](../deeper-references/monolith-service-coverage.md)
reference and
[`docs/backlog/README.md`](https://github.com/pgarciagon/koinos-one/blob/main/docs/backlog/README.md)
before claiming complete legacy service coverage.

## Removed Legacy Surfaces

These are intentionally outside the active Koinos One command surface:

- GarageMQ/AMQP service messaging;
- legacy microservice build/start/package operator workflows;
- legacy REST wrapper unless explicitly re-scoped as a product compatibility
  requirement.

Legacy docs should be retained only when they prove protocol parity, client
compatibility, migration/restore safety, or release-gate validation.

## How To Describe Parity

Use precise language:

- "implemented" when the current code path exists and is validated for the
  claimed use.
- "partially implemented" when forward behavior exists but historical backfill,
  full legacy API behavior, or production validation is incomplete.
- "backlog" when the work is documented but not complete.
- "removed legacy surface" when the old operator or AMQP surface is
  intentionally out of scope.

Do not use legacy docs as current instructions unless a current document points
to them as compatibility evidence.
