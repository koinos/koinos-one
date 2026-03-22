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

## Files to Modify

| File | Change |
|------|--------|
| `CMakeLists.txt` (chain) | Add `/GL`, `/LTCG`, `/arch:AVX2` flags |
| `KoinosCompilerOptions.cmake` | Enable LTCG for Release builds |
| `vm_manager/fizzy/fizzy_vm_backend.cpp` | Cache resolve_ptr memory pointer |
| `vm_manager/fizzy/module_cache.cpp` | Increase cache size, use shared_mutex |
| `patch_secp256k1.cmake` (Hunter) | Restore `__builtin_memcpy` for clang-cl, add `__forceinline` |
| `CMakeLists.txt` (chain) | Link mimalloc |

---

## Measurement Plan

To validate improvements, measure before and after each phase:

```bash
# Metric 1: Indexer throughput (blocks/sec with verify-blocks=true)
# Start chain from backup, time indexing of 10,000 blocks

# Metric 2: Single block execution time
# Use the calibration test in tests/thunk_test.cpp (lines 2507-2619)

# Metric 3: P2P sync rate
# Monitor blocks/minute during live sync
# Check timeout rate in P2P logs
```

Target: Eliminate P2P block application timeouts during sync.
