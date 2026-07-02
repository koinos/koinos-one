# libp2p Stream Exception Hardening Plan

Last updated: 2026-07-02

## Summary

The prodnet public-backup observer is still configured for scheduled public
backup publication, but it is not reliably creating fresh backups because the
native node process is restarting before it survives long enough to reach the
next scheduled backup window. The most recent failure signature is an uncaught
cpp-libp2p exception:

```text
std::logic_error: libp2p::write zero bytes written
```

The immediate product symptom is stale public bootstrap backups. The root fix is
networking hardening: libp2p stream, host, gossip, and disconnect operations
must convert transport failures into peer-level errors instead of allowing
exceptions to escape asynchronous callbacks and abort `teleno_node`.

This document avoids private hostnames, IP addresses, and local service paths.
Use local-only inventory files for live operations context.

## Evidence

- The public-backup service configuration still enables native backup,
  remote upload, public publishing, public restore metadata, and the scheduler.
- The live scheduler status can be idle while no fresh backup is produced
  because process restarts reset the scheduler delay.
- The live config currently has:

  ```yaml
  backup:
    schedule:
      enabled: true
      interval: 24h
      run-on-startup-if-missed: false
  ```

- `BackupScheduler::run_loop()` waits `_interval + jitter` before the first
  run when `run-on-startup-if-missed` is false.
- Journal evidence shows repeated process exits with uncaught P2P transport
  exceptions, including `libp2p::write zero bytes written`; some earlier exits
  also showed `attempt to use moved multihash` or segmentation faults.
- The crash appears after peer churn and disconnects caused by protocol
  negotiation failures with discovered peers.
- Relevant code paths currently have posted or callback-based libp2p operations
  without local exception containment:
  - `node/teleno-node/src/p2p/libp2p_transport.cpp`
  - `Libp2pTransport::connect_peer`
  - `Libp2pTransport::disconnect_peer`
  - `Libp2pTransport::send_peer_rpc`
  - `Libp2pTransport::handle_incoming_rpc`
  - `Libp2pTransport::publish_block`
  - `Libp2pTransport::publish_transaction`

## Goals

1. Keep P2P transport failures from aborting `teleno_node`.
2. Treat stream write/read/close failures as normal peer-level transport errors.
3. Preserve sync behavior and protocol compatibility with Koinos mainnet peers.
4. Restore reliable scheduled public-backup publication.
5. Add tests that prove stream exceptions are contained.
6. Validate the fix on a Linux prodnet observer before claiming the public
   backup pipeline is healthy.

## Non-Goals

- Do not change consensus, block validation, producer signing, or transaction
  submission behavior.
- Do not expose backup admin or P2P admin APIs publicly.
- Do not hide invalid peer behavior by lowering peer scoring or disconnect
  thresholds.
- Do not publish private deployment details in committed docs, logs, or tests.
- Do not make broad scheduler redesign part of the P2P crash fix.

## Immediate Mitigation

Before the code fix is deployed, reduce crash pressure on the public-backup
observer:

1. Disable arbitrary peer discovery for the public-backup deployment:

   ```yaml
   p2p:
     peer-discovery: false
   ```

2. Keep a small, explicit set of known seed peers in the deployment config.
3. After the P2P hardening build is deployed, run one manual configured backup
   or set `backup.schedule.run-on-startup-if-missed: true` for the public-backup
   service so a restart does not defer the next backup for a full interval.
4. Treat this as an operational mitigation only. The product fix remains
   exception containment in the native libp2p transport.

Any live service config write or restart should be done only after explicit
operator approval in the active Codex session.

## Implementation Steps

### 1. Add Safe Async Helpers

Add small helpers in `libp2p_transport.cpp` for promise completion and stream
operations:

- `safe_set_promise_value(...)`
- `safe_set_promise_error(...)`
- `safe_stream_close(...)`
- `safe_stream_write_some(...)`
- `safe_stream_read_some(...)`

The helpers should:

- catch `std::exception` and unknown exceptions;
- never throw from posted lambdas or libp2p callbacks;
- complete the associated promise exactly once;
- include the peer ID or operation name in returned error messages where
  available;
- log at `debug` or `warning` depending on whether the error is expected peer
  churn or an unexpected local transport failure.

Use the existing project style and avoid introducing a large abstraction until
the repeated stream operations are clearly simpler.

### 2. Harden Outbound Peer RPC

Update `Libp2pTransport::send_peer_rpc` so these operations cannot throw out of
the libp2p io context:

- `host->newStream(...)`
- `stream->writeSome(...)`
- `stream->readSome(...)`
- `stream->close(...)`

Expected behavior:

- A thrown `newStream`, `writeSome`, `readSome`, or `close` operation becomes a
  failed Peer RPC result.
- A zero-byte write result is treated as a failed write.
- A zero-byte read remains a closed-stream error.
- Timeouts keep their current behavior.
- The caller still receives a `std::runtime_error` from `send_peer_rpc`, so
  `P2PNode` can score and disconnect the peer through the existing error path.

### 3. Harden Incoming Peer RPC

Update `Libp2pTransport::handle_incoming_rpc` so inbound stream operations are
also exception-contained:

- Wrap the initial `stream->readSome(...)`.
- Wrap error-response `stream->writeSome(...)`.
- Wrap success-response `stream->writeSome(...)`.
- Use safe close after the response callback.
- If decoding or handler execution fails, keep returning a gorpc error response
  when the stream is still usable.
- If the stream write itself fails, log and close without throwing.

Inbound failures must not affect unrelated peers or node process lifetime.

### 4. Harden Connect, Disconnect, And Gossip

Update the remaining libp2p transport entry points:

- `connect_peer`
  - catch exceptions in the posted `host->connect(...)` body;
  - always erase `_connecting` on immediate exceptions and callback failures;
  - do not call `_on_connected` if the connection failed after partial setup.
- `disconnect_peer`
  - avoid synchronous `_host->disconnect(...)` throwing on the caller thread;
  - post disconnect onto the libp2p io context or wrap it with local try/catch;
  - erase both `_connected` and `_connecting` for the peer;
  - call `_on_disconnected` at most once per peer removal.
- `publish_block` and `publish_transaction`
  - catch exceptions from `_gossip->publish(...)`;
  - log failures without aborting the process.

### 5. Normalize Transport Error Classification

Review `is_transport_disconnect_error(...)` and related scoring text so new
wrapped errors are recognized as disconnect-worthy when appropriate.

Include messages for:

- zero-byte write;
- stream closed/reset;
- broken pipe;
- protocol negotiation failure;
- failed stream open;
- libp2p operation exception.

The error score should still distinguish normal timeouts from stronger
disconnect signals where practical.

### 6. Add Focused Tests

Add tests that prove the failure is contained instead of relying only on live
soak tests.

Preferred test coverage:

- A small fake stream or transport wrapper test that simulates `writeSome`
  throwing and verifies the node does not abort.
- A Peer RPC test where outbound write failure returns a handled error to the
  caller.
- A disconnect test that confirms `_connecting` and `_connected` are cleaned up
  and `_on_disconnected` is not duplicated.
- A gossip publish test that confirms publish exceptions are logged/contained.

If cpp-libp2p stream types are too difficult to fake directly, extract the safe
operation helpers behind a narrow testable adapter rather than broadening the
transport interface.

### 7. Build And Local Validation

Run the native and app validation that covers the touched surfaces:

```bash
cmake --build node/teleno-node/build --target teleno_node --parallel
ctest --test-dir node/teleno-node/build --output-on-failure
npm run build
```

When libp2p-enabled tests are available in the local build, also run the P2P
test targets and any manual live interop test required by the build setup.

### 8. Linux Soak Validation

On the Linux prodnet observer used for public-backup publication:

1. Deploy the hardened `teleno_node` build.
2. Start first with `p2p.peer-discovery: false` and fixed seed peers.
3. Confirm the service remains active through peer churn.
4. Watch the logs for contained stream errors instead of process exits.
5. Run a manual configured backup or enable missed-startup scheduling.
6. Verify local backup repository metadata advances.
7. Verify the public bootstrap `latest.json` advances.
8. Run for at least one full scheduler interval before calling the pipeline
   stable.

Do not publish confidential hostnames, IP addresses, usernames, service names,
or private paths in committed validation notes.

### 9. Follow-Up Crash Investigation

If `libp2p::write zero bytes written` is fixed but crashes continue:

- capture a fresh core dump or backtrace with symbols;
- investigate `attempt to use moved multihash` separately;
- run an ASAN/UBSAN build if the crash appears memory-safety related;
- keep public-backup scheduling mitigation in place until the process survives
  the full backup interval.

## Acceptance Criteria

The implementation is complete when:

- no libp2p stream, host, gossip, or disconnect exception can escape an
  asynchronous callback and abort `teleno_node`;
- outbound Peer RPC write/read/open failures return handled errors to `P2PNode`;
- inbound Peer RPC failures are logged and isolated to the affected stream;
- peer disconnect cleanup is idempotent for `_connected`, `_connecting`, and
  `_on_disconnected`;
- focused tests cover at least one throwing write path and one disconnect
  cleanup path;
- native tests pass;
- the Linux public-backup observer survives at least one full backup interval;
- public bootstrap metadata advances after a scheduled or explicitly triggered
  backup;
- the final validation notes contain no private deployment details.

## Release Notes Draft

```text
- Hardened native libp2p stream handling so peer write/read/close failures are
  treated as peer transport errors instead of process-fatal exceptions.
- Improved public-backup reliability by preventing P2P peer churn from
  restarting the scheduled backup node before its backup interval.
```
