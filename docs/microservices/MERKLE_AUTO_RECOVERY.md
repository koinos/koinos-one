# Merkle Mismatch Auto-Recovery — Implementation Plan

## Problem

When the chain state has an incorrect merkle root (typically after backup restore with `verify-blocks=false`), live blocks arriving via P2P fail permanently with:

```
Block application failed - Height: N, with reason: block previous state merkle mismatch
```

The chain gets stuck at height N-1 indefinitely. Block_store continues receiving blocks from P2P, but the chain can never process them because every new block references the correct parent merkle root that our state doesn't have.

Currently this requires manual intervention: set `verify-blocks=true` in config.yml, restart chain, wait, revert to `false`, restart again.

## Root Cause

`apply_block_delta()` copies pre-computed state deltas from block receipts without WASM execution. If the starting state is slightly wrong (e.g., from a backup where chain/ and block_store/ weren't captured atomically), the deltas produce an incorrect merkle root. The error compounds — once the merkle is wrong, every subsequent block will also fail.

## Solution Architecture

### Overview

```
P2P sends block N → chain → submit_block() → merkle mismatch!
                                    ↓
                            increment mismatch counter
                                    ↓
                          counter >= 5 same block?
                                    ↓ YES
                          write flag file: .merkle-recovery-needed
                                    ↓
                          chain self-terminates cleanly (exit 0)
                                    ↓
                    Knodel detects exit + flag file
                                    ↓
                    Knodel sets verify-blocks=true in config.yml
                                    ↓
                    Knodel restarts chain
                                    ↓
                    Indexer runs with WASM → correct merkle root
                                    ↓
                    Chain starts accepting live blocks
                                    ↓
                    Knodel reverts verify-blocks=false
                                    ↓
                    Knodel deletes flag file
                                    ↓
                    Knodel restarts chain (final, normal mode)
```

### Why Self-Terminate Instead of Internal Recovery?

1. **State DB rollback doesn't exist** — `state_db::database` has no `rollback_to(height)` method. Only `reset()` (to genesis) and `commit_node()` (forward-only).
2. **Internal verify toggle is risky** — switching `_verify_blocks` at runtime while the indexer/P2P are active could cause race conditions.
3. **Self-terminate + restart is clean** — the process exits gracefully, Knodel handles the recovery logic, and the chain starts fresh with correct config.

## Implementation Steps

### Step 1: Chain C++ — Merkle Mismatch Detection (`controller.cpp`)

**File:** `vendor/koinos/koinos-chain/src/koinos/chain/controller.cpp`

Add a counter and flag file writer in `submit_block()`:

```cpp
// New member in controller_impl:
uint64_t _merkle_mismatch_block = 0;
int _merkle_mismatch_count = 0;

// In submit_block(), where "block previous state merkle mismatch" is thrown:
// (around line 573, in the catch block)

catch( const merkle_mismatch_exception& e )
{
    LOG( warning ) << "Block application failed - Height: " << block_height
                   << ", with reason: " << e.what();

    if( block_height == _merkle_mismatch_block )
    {
        _merkle_mismatch_count++;
    }
    else
    {
        _merkle_mismatch_block = block_height;
        _merkle_mismatch_count = 1;
    }

    if( _merkle_mismatch_count >= 5 )
    {
        LOG( error ) << "Persistent merkle mismatch at height " << block_height
                     << " (" << _merkle_mismatch_count << " attempts)"
                     << " — requesting recovery restart";

        // Write flag file for Knodel to detect
        auto flag_path = _basedir / ".merkle-recovery-needed";
        std::ofstream flag( flag_path );
        flag << block_height << std::endl;
        flag.close();

        // Signal clean shutdown
        std::raise( SIGTERM );
    }
}
```

**Changes:**
- Add `_merkle_mismatch_block` and `_merkle_mismatch_count` to `controller_impl`
- Catch the specific merkle mismatch exception separately
- After 5 consecutive failures on the same block: write flag, trigger SIGTERM

### Step 2: Chain C++ — Pass basedir to controller (`controller.cpp`)

The controller needs to know the basedir to write the flag file. Currently it only knows the state DB path.

```cpp
// In controller_impl constructor or open():
_basedir = basedir;  // Store the basedir path

// Or simpler: use a fixed path relative to the state DB:
auto flag_path = _db_path.parent_path().parent_path() / ".merkle-recovery-needed";
```

### Step 3: Knodel Electron — Detect Flag and Recover (`electron/main.ts`)

**File:** `electron/main.ts`

In the `child.on('close')` handler for the chain service:

```typescript
child.on('close', async (code, signal) => {
    // ... existing close handling ...

    // Check for merkle recovery flag
    if (serviceId === 'chain') {
        const flagPath = path.join(settings.baseDir, 'chain', '.merkle-recovery-needed')
        if (fs.existsSync(flagPath)) {
            console.log('[chain] Merkle recovery needed — restarting with verify-blocks=true')

            try {
                // 1. Read the problematic height for logging
                const height = fs.readFileSync(flagPath, 'utf-8').trim()
                console.log(`[chain] Merkle mismatch at height ${height}`)

                // 2. Enable verify-blocks temporarily
                const configPath = path.join(settings.baseDir, 'config.yml')
                const yaml = require('yaml')
                const doc = yaml.parseDocument(fs.readFileSync(configPath, 'utf-8'))
                doc.setIn(['chain', 'verify-blocks'], true)
                fs.writeFileSync(configPath, doc.toString(), 'utf-8')

                // 3. Restart chain — will index with WASM
                const result = await startNativeServiceProcess(settings, 'chain', serviceDefinitions)
                if (!result.ok) {
                    console.log('[chain] Merkle recovery restart failed:', result.output)
                    return
                }

                // 4. Wait for indexing to complete (poll log file)
                const chainLogPath = path.join(settings.baseDir, 'chain', 'logs', 'chain.log')
                for (let i = 0; i < 120; i++) {
                    await new Promise(r => setTimeout(r, 1000))
                    const cs = nativeServiceProcesses.get('chain')
                    if (!cs || cs.closed) break
                    if (fs.existsSync(chainLogPath)) {
                        const log = fs.readFileSync(chainLogPath, 'utf-8')
                        if (log.includes('Listening for requests over AMQP')) break
                    }
                }

                // 5. Revert verify-blocks
                const doc2 = yaml.parseDocument(fs.readFileSync(configPath, 'utf-8'))
                doc2.setIn(['chain', 'verify-blocks'], false)
                fs.writeFileSync(configPath, doc2.toString(), 'utf-8')

                // 6. Delete flag
                fs.unlinkSync(flagPath)

                // 7. Final restart with normal config
                await stopNativeServiceProcess('chain')
                await startNativeServiceProcess(settings, 'chain', serviceDefinitions)

                console.log('[chain] Merkle recovery complete')
            } catch (err) {
                console.log('[chain] Merkle recovery failed:', err)
            }
        }
    }
})
```

### Step 4: Notification to User

During recovery, send a status event to the renderer:

```typescript
// In the recovery block:
mainWindow?.webContents.send('knodel:koinos-node:status-event', {
    type: 'merkle-recovery',
    message: 'Correcting chain state — this may take a few seconds...'
})
```

The footer/status bar shows this message while recovery is in progress.

## Test Plan

### Unit Tests — C++ (chain)

**File:** `vendor/koinos/koinos-chain/tests/merkle_recovery_test.cpp`

```
Test 1: merkle_mismatch_counter_increments
  - Call submit_block with a block that has wrong parent merkle root
  - Verify _merkle_mismatch_count increments
  - Verify no flag file after 4 failures

Test 2: merkle_mismatch_triggers_recovery_after_5
  - Call submit_block with same bad block 5 times
  - Verify flag file .merkle-recovery-needed is created
  - Verify flag file contains the block height

Test 3: merkle_mismatch_counter_resets_on_different_block
  - Fail block at height 100 three times
  - Fail block at height 101 once
  - Verify counter reset to 1 (not 4)

Test 4: merkle_mismatch_no_trigger_on_other_errors
  - Fail block with "unknown previous block" error
  - Verify counter does NOT increment
  - Verify no flag file
```

### Unit Tests — Electron (Knodel)

**File:** `electron/lib/merkle-recovery.test.ts`

```
Test 1: detectMerkleRecoveryFlag_returns_true_when_flag_exists
  - Create .merkle-recovery-needed file in mock basedir
  - Call detection function
  - Assert returns true with height

Test 2: detectMerkleRecoveryFlag_returns_false_when_no_flag
  - Empty basedir
  - Assert returns false

Test 3: merkleRecoverySequence_sets_verify_blocks_true
  - Mock config.yml with verify-blocks: false
  - Run recovery sequence step 1
  - Assert config.yml now has verify-blocks: true

Test 4: merkleRecoverySequence_reverts_verify_blocks_after_indexing
  - Mock the full sequence with simulated chain restart
  - Assert config.yml ends with verify-blocks: false

Test 5: merkleRecoverySequence_cleans_flag_file
  - Run full sequence
  - Assert .merkle-recovery-needed is deleted

Test 6: merkleRecoverySequence_handles_chain_crash_during_recovery
  - Simulate chain crashing during verify-blocks=true re-index
  - Assert flag file is NOT deleted (so recovery retries on next start)
  - Assert config.yml still has verify-blocks: true (safe state)
```

### Integration Test — Manual

```
1. Start Knodel with services running and synced
2. Stop services
3. Corrupt the chain state merkle root:
   - Manually edit a value in .koinos/chain/blockchain/ RocksDB
   - Or: restore a backup with verify-blocks=false
4. Start services
5. Observe chain log: should see 5 merkle mismatch warnings
6. Observe chain self-terminates
7. Observe Knodel auto-restarts chain with verify-blocks=true
8. Observe chain re-indexes successfully
9. Observe Knodel reverts to verify-blocks=false and restarts
10. Verify chain is now syncing normally
```

## Files to Modify

| File | Change |
|------|--------|
| `controller.cpp` | Add mismatch counter + flag file writer |
| `controller_impl` (header) | Add counter members |
| `koinos_chain.cpp` | Pass basedir to controller |
| `electron/main.ts` | Detect flag on chain exit, run recovery sequence |
| `src/App.tsx` | Show recovery status in footer (optional) |
| `src/i18n.ts` | Add recovery message translations |

## Edge Cases

| Case | Handling |
|------|----------|
| Chain crashes during recovery (verify-blocks=true) | Flag file persists → recovery retries on next start |
| Block_store doesn't have enough blocks | Recovery indexer finds nothing new → flag deleted, normal operation |
| Multiple rapid restarts | Flag file acts as mutex — if it exists, recovery runs |
| User manually changes config during recovery | Knodel's revert overwrites — acceptable tradeoff |
| Disk full during flag write | catch block logs error, chain continues failing (existing behavior) |

## Performance Impact

- **Detection:** ~0 overhead (1 integer comparison per failed block)
- **Recovery:** 2-10 seconds for ~60 blocks with WASM
- **Two extra restarts:** ~3 seconds each (chain startup time)
- **Total user-visible delay:** ~10-20 seconds, fully automatic

## Timeline

| Phase | Effort | Description |
|-------|--------|-------------|
| C++ detection + flag | 2 hours | Counter, flag file, SIGTERM |
| Electron recovery | 3 hours | Flag detection, config toggle, restart sequence |
| C++ tests | 2 hours | 4 unit tests for counter/flag logic |
| Electron tests | 2 hours | 6 unit tests for recovery sequence |
| Integration testing | 1 hour | Manual end-to-end verification |
| **Total** | **~10 hours** | |
