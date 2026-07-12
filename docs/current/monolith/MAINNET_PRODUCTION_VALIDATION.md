# Mainnet Production Validation

- Date recorded: 2026-07-12
- Product release target: Koinos One 1.1.0
- Native runtime: `teleno_node` 1.1.0
- Status: complete

## Result

The mainnet producer milestone is complete. A monolithic `teleno_node` managed
through Koinos One synchronized with Koinos mainnet, entered producer mode only
after the operator verified the network, producer identity, registered hot key,
and runtime configuration, and produced blocks that were accepted by the public
Koinos network.

This validates both parts of the product path:

- Teleno performed the consensus-critical block construction, execution,
  signing, P2P, and submission work.
- Koinos One managed the local runtime and exposed the observer-first producer
  workflow used by the operator.

The release record intentionally excludes the protected producer address,
private key material, hostnames, IP addresses, wallet state, and local service
paths. Those values remain in ignored local operational memory and are not
public release artifacts.

## Acceptance Criteria Satisfied

- The runtime used the intended mainnet chain and an already reviewed producer
  configuration.
- The node synchronized before production was enabled.
- The local producer hot key matched the key registered for the producer.
- Block production was explicitly enabled; it was not activated by observer
  setup or by a hidden background action.
- Multiple produced blocks were accepted by the public mainnet chain.
- The legacy producer deployment remained independently controlled, avoiding
  an accidental simultaneous active path for the same producer identity.

## What This Closes

This result closes the former mainnet observer/producer release gate documented
in older roadmap files. Those files retain earlier failed peer-acquisition and
observer-canary attempts as historical evidence, but their “not signed off”
language no longer describes the current product state.

## What It Does Not Claim

Mainnet production validation does not imply full legacy parity for account
history or historical transaction and contract metadata backfill. Those remain
separate backlog items. Continued long-duration monitoring, compatibility
comparison, backup testing, and failure recovery are normal regression and
hardening work after sign-off.

This document records completed evidence. It does not authorize a new mainnet
transaction, producer registration, key replacement, VHP operation, or runtime
configuration change.
