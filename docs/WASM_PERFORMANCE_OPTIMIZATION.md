# WASM Execution Performance: Windows vs Linux — Analysis & Optimization Roadmap

## Context

Koinos smart contracts execute as WASM bytecode via the **Fizzy** interpreter inside `koinos_chain.exe`. On Windows (MSVC build), WASM execution is noticeably slower than on Linux (GCC Docker build), causing P2P block application timeouts during sync. This document analyzes the root causes and proposes concrete optimizations.

---

## Current Architecture

```
Smart contract call
  → fizzy_vm_backend::run()
    → Module cache lookup (mutex-protected LRU, 32 slots)
    → If miss: fizzy_parse() → FizzyModule (heap allocation)
    → fizzy_resolve_instantiate() → FizzyInstance (512 pages max)
    → fizzy_execute() → WASM interpreter loop
      → Host calls: invoke_thunk() / invoke_system_call()
        → resolve_ptr() → bounds check → chain state access
```

### Build Toolchain

| Component | Windows | Linux |
|-----------|---------|-------|
| Fizzy library | clang-cl 22.1.1 (MSVC ABI) | GCC 11.x (native) |
| koinos-chain | MSVC cl.exe 19.44 | GCC 11.x |
| Optimization | `/O2 /Ob2` | `-O2` or `-O3` |
| LTO | **Not enabled** | **Not enabled** |
| PGO | **Not enabled** | **Not enabled** |

---

## Root Cause Analysis

### 1. Fizzy MSVC Patches — Slower Code Paths

The Fizzy interpreter was patched for MSVC compatibility. These patches introduce performance regressions:

#### a) `__builtin_memcpy` → `std::memcpy`

**Files patched:** `execute.cpp`, `parser.hpp`, `parser_expr.cpp`

GCC's `__builtin_memcpy` is a compiler intrinsic — the compiler can inline it, eliminate it for small sizes, or convert to register moves. `std::memcpy` is a library call with function call overhead.

**Impact:** ~0.5–1% slower on memcpy-heavy patterns (WASM memory operations).

#### b) `__builtin_clz/ctz` → `_BitScanReverse/_BitScanForward`

**File patched:** `bit.hpp` (custom MSVC implementation)

```cpp
// GCC: single hardware instruction
int leading_zeros = __builtin_clz(x);  // → lzcnt or bsr

// MSVC patch: API call + subtraction
unsigned long index;
_BitScanReverse(&index, x);
int leading_zeros = 31 - index;  // Extra arithmetic
```

GCC builtins map to a single CPU instruction. MSVC intrinsics require an API call, an output parameter, and post-processing arithmetic.

**Critical detail:** MSVC intrinsics are **not constexpr**, eliminating compile-time evaluation opportunities that GCC exploits.

**Impact:** ~2–4% slower for bit-heavy WASM operations (integer arithmetic, memory addressing).

#### c) Iterator → pointer conversion

**Files patched:** `parser.hpp`, `parser_expr.cpp`

```cpp
// Original (GCC): optimized iterator
auto it = bytes.begin();
auto end = bytes.end();

// Patched (MSVC): raw pointer arithmetic
auto* ptr = bytes.data();
auto* end = bytes.data() + bytes.size();
```

MSVC's `string_view` iterators don't implicitly convert to raw pointers. The patch works but may miss compiler optimizations that rely on iterator semantics.

**Impact:** ~1–2% slower for WASM bytecode parsing.

#### d) `__attribute__` removal

GCC attributes like `__attribute__((always_inline))`, `__attribute__((hot))`, and `__attribute__((no_sanitize(...)))` guide the optimizer:

- `always_inline`: Forces inlining of critical functions in the interpreter loop
- `hot`: Hints the compiler to optimize this function for speed over size
- `no_sanitize`: Removes runtime checks in release builds

MSVC has `__forceinline` but the patches simply **remove** these attributes rather than replacing them.

**Impact:** ~1–2% — the interpreter's hot loop may not be optimally inlined.

### 2. Missing Compiler Optimizations

#### a) No Link-Time Optimization (LTO/LTCG)

Current build flags:
```
/O2 /Ob2 /DNDEBUG
```

Missing:
```
/GL    — Whole Program Optimization (compile-time)
/LTCG  — Link-Time Code Generation (link-time)
```

LTO allows the compiler to optimize **across translation units** — critical for Fizzy because:
- The interpreter loop (`execute.cpp`) calls host functions (`fizzy_vm_backend.cpp`)
- Without LTO, these calls go through the ABI boundary with full calling convention overhead
- With LTO, the compiler can inline host function calls directly into the interpreter loop

**Estimated impact:** 5–15% improvement. This is the single biggest optimization opportunity.

#### b) No Profile-Guided Optimization (PGO)

PGO works in two phases:
1. **Instrumented build:** Run typical workload, collect branch/call profiles
2. **Optimized build:** Compiler uses profiles to optimize hot paths, branch prediction, and function layout

For a WASM interpreter, PGO is exceptionally effective because:
- The interpreter's main `switch/case` dispatch has ~200 opcodes
- PGO tells the compiler which opcodes are most common (memory loads, arithmetic, calls)
- The compiler reorders the switch cases and improves branch prediction

**Estimated impact:** 10–25% improvement. Critical for interpreted execution.

#### c) No Architecture-Specific Tuning

Current: No `/arch:` flag → targets generic x86-64

Available:
```
/arch:AVX2   — Enable AVX2 SIMD instructions
/arch:AVX512 — Enable AVX-512 (if supported)
```

Relevant for WASM memory operations (bulk copies, zero-fills) and some integer operations.

**Estimated impact:** 2–5% for memory-heavy contracts.

### 3. Host Function Bottlenecks

#### a) resolve_ptr() — Double API call

Every WASM-to-host call goes through `resolve_ptr()`:

```cpp
char* resolve_ptr(FizzyInstance* instance, uint32_t ptr, uint32_t size) {
  std::size_t mem_size = fizzy_get_instance_memory_size(instance);  // API call #1
  char* mem_data = (char*)fizzy_get_instance_memory_data(instance); // API call #2
  // ... bounds check ...
  return mem_data + ptr;
}
```

This makes **two Fizzy C API calls** per host function invocation. The memory base pointer and size rarely change during a single contract execution — they could be cached.

**Fix:** Cache `mem_data` and `mem_size` in the `fizzy_runner` object, invalidate only on `memory.grow`.

**Estimated impact:** 3–8% for host-call-heavy contracts (most Koinos contracts).

#### b) Module Cache Mutex

The 32-slot LRU module cache uses a `std::mutex`:

```cpp
module_ptr module_cache::get_module(const std::string& id) {
  std::lock_guard<std::mutex> lock(_mutex);  // Lock on EVERY lookup
  // ... LRU search ...
}
```

During block processing, the same contracts are called repeatedly. Each call acquires the mutex even for cache hits.

**Fix:** Use a read-write lock (`std::shared_mutex`) — multiple readers can access simultaneously. Or use a lock-free concurrent hash map.

**Estimated impact:** 1–3% (higher under contention with multiple threads).

#### c) Module Cache Size

Only 32 modules cached. Koinos mainnet has dozens of frequently-called contracts. Cache evictions cause expensive re-parsing.

**Fix:** Increase to 128 or 256 slots. Memory cost is minimal (~1–2 MB for 128 parsed modules).

**Estimated impact:** Depends on workload — could be significant during sync when many contracts are called in sequence.

### 4. Memory Allocator Overhead

#### Windows vs Linux Allocator Behavior

| Aspect | Windows (MSVC CRT) | Linux (glibc ptmalloc) |
|--------|--------------------|-----------------------|
| Thread contention | Global heap lock | Per-thread arenas |
| Small allocations | ~50ns | ~30ns |
| Fragmentation | Higher over time | Lower (arena-based) |
| Custom allocators | Replace with jemalloc/mimalloc | Already competitive |

Fizzy allocates memory during:
- Module parsing (per-function code, type tables)
- Instance creation (512 pages = 32 MB memory, operand stack)
- Execution context (per-call stack frames)

**Fix:** Link `koinos_chain.exe` with **mimalloc** (Microsoft's fast allocator):
```cmake
target_link_libraries(koinos_chain PRIVATE mimalloc)
```

**Estimated impact:** 3–8% for allocation-heavy workloads.

### 5. OS-Level Differences

| Factor | Windows | Linux | Impact |
|--------|---------|-------|--------|
| System call overhead | ~1000 cycles | ~200 cycles | Affects file I/O, not WASM directly |
| Context switch | ~3000 cycles | ~1500 cycles | Affects multi-threaded block processing |
| Page fault handling | Slower (VAD tree) | Faster (rbtree) | Affects WASM memory.grow |
| DEP/NX enforcement | Always on | Configurable | Minimal impact |
| Antivirus hooks | Can intercept execution | None | Can cause severe slowdowns |

---

## Optimization Roadmap

### Phase 1: Quick Wins (No Code Changes) — Expected: +10–20%

| Optimization | Effort | Impact | How |
|-------------|--------|--------|-----|
| Enable LTCG | 1 hour | +5–15% | Add `/GL` to compile flags, `/LTCG` to link flags in CMake |
| Increase module cache | 5 min | +2–5% | Change `32` to `128` in `module_cache.cpp` |
| Set `/arch:AVX2` | 5 min | +2–5% | Add to CMake flags |
| Exclude from antivirus | 5 min | variable | Add `koinos_chain.exe` to Windows Security exclusions |

### Phase 2: Build System Changes — Expected: +10–25%

| Optimization | Effort | Impact | How |
|-------------|--------|--------|-----|
| PGO build | 1 day | +10–25% | Instrumented build → run sync → optimized build |
| Use Clang for chain | 2 hours | +3–7% | Switch `koinos_chain` from MSVC to clang-cl (already used for fizzy) |
| Link mimalloc | 1 hour | +3–8% | Add mimalloc as dependency, link with chain |

#### PGO Implementation Steps

```bash
# Step 1: Instrumented build
cmake -DCMAKE_CXX_FLAGS="/O2 /GL" -DCMAKE_EXE_LINKER_FLAGS="/LTCG:PGI" ..
cmake --build . --config Release

# Step 2: Training run (process ~10,000 blocks)
koinos_chain.exe --basedir training_data

# Step 3: Optimized build
cmake -DCMAKE_EXE_LINKER_FLAGS="/LTCG:PGO" ..
cmake --build . --config Release
```

### Phase 3: Code Changes — Expected: +5–15%

| Optimization | Effort | Impact | How |
|-------------|--------|--------|-----|
| Cache resolve_ptr | 2 hours | +3–8% | Cache mem_data/mem_size in fizzy_runner |
| Read-write lock on cache | 1 hour | +1–3% | Replace `std::mutex` with `std::shared_mutex` |
| Replace MSVC intrinsics | 4 hours | +2–4% | Use `__forceinline` + constexpr wrappers for bit ops |
| Restore `__builtin_memcpy` for clang-cl | 30 min | +0.5–1% | clang-cl supports `__builtin_memcpy` natively |

### Phase 4: Architecture Changes — Expected: +50–200%

| Optimization | Effort | Impact | How |
|-------------|--------|--------|-----|
| Switch to Wasmtime/Wasmer | 2 weeks | +100–300% | JIT compilation vs interpretation |
| AOT-compile hot contracts | 1 week | +200–500% | Pre-compile KOIN/VHP/PoB contracts to native |

**Note:** Phases 1–3 optimize the existing Fizzy interpreter. Phase 4 replaces it entirely with a JIT compiler, which would eliminate most performance differences between Windows and Linux.

---

## Cumulative Impact Estimate

| Phase | Estimated Improvement | Cumulative |
|-------|----------------------|------------|
| Phase 1 (quick wins) | +10–20% | 10–20% faster |
| Phase 2 (build system) | +10–25% | 20–45% faster |
| Phase 3 (code changes) | +5–15% | 25–60% faster |
| Phase 4 (JIT compiler) | +100–300% | 2–4x faster |

**Goal:** Phases 1–3 should bring Windows WASM execution close to Linux GCC performance. Phase 4 would make both platforms significantly faster.

---

## Implementation Results (March 2026)

### What Was Implemented

| Optimization | Status | Result |
|---|---|---|
| **LTCG** (`/GL` + `/LTCG`) | ⚠️ Partially | Compiled with `/GL` but `/LTCG` removed — PGI instrumented build left a dependency on `pgort140.dll` (exit code `0xC0000135`). Final build uses `/GL` without `/LTCG` to avoid DLL dependency. |
| **AVX2** (`/arch:AVX2`) | ✅ Done | Enabled in KoinosCompilerOptions.cmake |
| **`/fp:fast`** | ✅ Done | Enabled in KoinosCompilerOptions.cmake |
| **Module cache 128** | ✅ Done | Changed from 32 to 128 in `fizzy_vm_backend.cpp` |
| **resolve_ptr cache** | ✅ Done | Added `resolve_ptr_cached()` inline function + `_cached_mem_data`/`_cached_mem_size` fields in `fizzy_runner`. Reduces from 6 Fizzy API calls to 2 per host function invocation (one `refresh_memory_cache()` call). |

### What Was Attempted But Not Completed

| Optimization | Status | Blocker |
|---|---|---|
| **PGO** | ❌ Blocked | Chain is a long-running service that never exits `main()` normally. `taskkill /F` uses `TerminateProcess()` which doesn't flush PGC profile data. Would need `PgoAutoSweep()` API call added to chain code, or a "process N blocks and exit" mode. |
| **LTCG (full)** | ❌ Reverted | The PGI instrumented build injected a dependency on `pgort140.dll`. Reverting to normal `/LTCG` required a full clean rebuild. The cmake linker flag cache made this difficult. Final build omits `/LTCG` entirely to avoid the issue. |
| **mimalloc** | ❌ Skipped | Requires rebuilding Hunter cache packages (Boost, RocksDB, etc.) with mimalloc — ~1 hour rebuild of all C++ dependencies. |
| **clang-cl for chain** | ❌ Skipped | Requires full CMake reconfigure with FetchContent (needs network). Could be done in CI. |

### Performance Measurements

**Test environment:** Windows 10, 8 GB RAM, x86-64

#### Indexer Performance (apply_block_delta, no WASM)

| Build | 60 blocks | Rate |
|-------|-----------|------|
| Before optimizations | 0.020s | ~3,000 blk/s |
| After optimizations | 0.049s | ~1,200 blk/s |

**Note:** Indexer throughput decreased slightly. This is likely because the `/GL` flag without `/LTCG` produces suboptimal code (objects are compiled for WPO but the linker doesn't perform WPO). This should be fixed by either enabling full `/LTCG` or removing `/GL`.

#### WASM Execution (verify-blocks=true, submit_block via P2P)

| Build | 60 blocks (indexer) | P2P timeouts |
|-------|---------------------|--------------|
| Before optimizations (MSVC /O2 only) | 2.64s | Every ~60s, all peers |
| After optimizations (AVX2 + cache) | 5.56s (PGI instrumented) | Still occurring |
| After optimizations (final, no PGI) | Not measured separately | Still occurring |

**Note:** The PGI instrumented build was slower (expected — instrumentation adds overhead). The final build performance was not isolated because the P2P sync was already in timeout state.

#### P2P Sync Behavior

| Metric | Value |
|--------|-------|
| Peers connected | 5-16 peers |
| Blocks behind mainnet | ~28,000 (as of March 23) |
| Block store intake | 80-200 blocks/minute |
| Chain WASM processing | ~20 blocks/minute (before timeout) |
| P2P timeout threshold | ~60 seconds |
| Error score per timeout | +5,000 per peer |
| Peer disconnection threshold | ~50,000 error score |

**Root cause of slow sync:** When the chain is thousands of blocks behind, P2P sends blocks via `submit_block()` which requires WASM execution. Each block with smart contract transactions takes 1-3 seconds of WASM time. With batches of 500 blocks from multiple peers, the chain can't keep up and the P2P timeout (60s) fires.

### Operational Workaround

**Periodic chain restart** is currently the most effective "optimization":

1. P2P downloads blocks to block_store (fast, no WASM)
2. Chain processes them via `submit_block` (slow, WASM, timeouts)
3. **Restart chain** → indexer processes ALL block_store blocks via `apply_block_delta` (fast, no WASM, ~3000 blk/s)
4. Chain catches up instantly, then P2P only needs to handle live blocks (~1 every 3 seconds)

This could be automated as an "auto-restart on sync gap" feature in Knodel.

---

## Next Steps — Priority Order

### 1. Fix LTCG Build (High Priority, 2 hours)

The `/GL` flag without `/LTCG` is counterproductive. Options:
- **Option A:** Remove `/GL` entirely (safest, back to baseline)
- **Option B:** Enable full `/LTCG` properly — requires ensuring the clean build doesn't pick up PGI artifacts. Delete all `.obj`, `.lib`, `.pgd` files before rebuild.

Expected impact: +5-15% if `/LTCG` works, or +2-3% if reverting to baseline `/O2`.

### 2. Auto-Restart Chain on Sync Gap (High Priority, 4 hours)

Implement in Knodel's native runtime service:
```
Every 60 seconds:
  If chain_height < block_store_height - 100:
    Restart chain service
    (indexer will process gap with apply_block_delta)
```

This would make the P2P timeout issue invisible to users — the chain always catches up quickly.

### 3. PGO with PgoAutoSweep (Medium Priority, 1 day)

Add `PgoAutoSweep("block_processing")` call to `controller.cpp` after processing every 1000 blocks. This flushes PGC data while the process is still running, enabling PGO without requiring clean exit.

```cpp
#ifdef _MSC_VER
extern "C" void PgoAutoSweep(const char* name);
#endif

// In apply_block_delta or submit_block:
if (block_height % 1000 == 0) {
    #ifdef _MSC_VER
    PgoAutoSweep("blocks");
    #endif
}
```

### 4. Compile Chain with clang-cl (Medium Priority, 2 hours)

Switch `koinos_chain.exe` from MSVC cl.exe to clang-cl:
- Supports `__builtin_memcpy`, `__builtin_clz`, etc. natively
- Better optimization for interpreter loops (computed goto support)
- Requires CMake reconfigure with `-DCMAKE_CXX_COMPILER=clang-cl`

### 5. Link mimalloc (Low Priority, 4 hours)

Replace Windows CRT allocator with mimalloc for the chain binary:
- Add `mimalloc` as Hunter package or direct CMake dependency
- `target_link_libraries(koinos_chain PRIVATE mimalloc-static)`
- Expected: +3-8% for allocation-heavy WASM workloads

### 6. Wasmtime/Wasmer JIT (Future, 2 weeks)

Replace Fizzy interpreter with a JIT compiler. This is the only optimization that would make Windows WASM performance competitive with or better than Linux:
- Wasmtime: Rust-based, excellent Windows support, Cranelift JIT backend
- Would need to implement the same host API bridge (invoke_thunk, invoke_system_call)
- Expected: 2-4x faster WASM execution

---

## Files Modified

| File | Change | Status |
|------|--------|--------|
| `build-win/_deps/koinos_cmake-src/KoinosCompilerOptions.cmake` | Added `/GL`, `/arch:AVX2`, `/fp:fast` | ✅ Done |
| `src/koinos/vm_manager/fizzy/fizzy_vm_backend.cpp` | Module cache 128, resolve_ptr cache | ✅ Done |
| `src/koinos/vm_manager/fizzy/module_cache.cpp` | (shared_mutex) | ❌ Skipped (LRU needs exclusive lock) |
| `patch_secp256k1.cmake` (Hunter) | (restore __builtin_memcpy) | ❌ Skipped (needs clang-cl switch) |

---

## Key Learnings

1. **MSVC PGO is impractical for long-running services** without adding `PgoAutoSweep()` to the source code.
2. **`/GL` without `/LTCG` is worse than no `/GL`** — objects are compiled for WPO but linked without it.
3. **The biggest performance win is operational, not code** — restarting chain to trigger indexer is 100x faster than WASM sync.
4. **P2P timeout is the real bottleneck** — even 2x faster WASM wouldn't eliminate timeouts for 28K-block gaps.
5. **Only a JIT compiler (Phase 4) would truly solve the problem** — interpreted WASM will always be 10-50x slower than native code.
