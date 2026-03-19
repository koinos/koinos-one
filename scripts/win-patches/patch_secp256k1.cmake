if(NOT EXISTS "${SOURCE_DIR}/CMakeLists.txt")
  return()
endif()
file(READ "${SOURCE_DIR}/CMakeLists.txt" content)
set(modified FALSE)
string(FIND "${content}" "Compiler does not support __int128 or insline assembly" _pos)
if(NOT _pos EQUAL -1)
  string(REPLACE
    "message(SEND_ERROR \"Compiler does not support __int128 or insline assembly\")"
    "set(USE_SCALAR_8X32 1)\n\t\tset(USE_FIELD_10X26 1)"
    content "${content}")
  set(modified TRUE)
  message(STATUS "PATCH: libsecp256k1-vrf - 32-bit scalar/field for MSVC")
endif()
string(FIND "${content}" "-Wcast-qual" _pos)
if(NOT _pos EQUAL -1)
  string(REPLACE "-Wcast-qual" "" content "${content}")
  string(REPLACE "-Wcast-align" "" content "${content}")
  string(REPLACE "-Wmissing-declarations" "" content "${content}")
  string(REPLACE "-msse2" "" content "${content}")
  string(REPLACE "-mfpmath=sse" "" content "${content}")
  set(modified TRUE)
  message(STATUS "PATCH: fizzy - removed GCC flags")
endif()
if(modified)
  file(WRITE "${SOURCE_DIR}/CMakeLists.txt" "${content}")
endif()

# ===== FIZZY MSVC COMPAT PATCHES =====
# Replace __builtin_memcpy with std::memcpy in all fizzy sources
foreach(_fizzy_src
    "${SOURCE_DIR}/lib/fizzy/execute.cpp"
    "${SOURCE_DIR}/lib/fizzy/parser.hpp"
    "${SOURCE_DIR}/lib/fizzy/parser_expr.cpp")
  if(EXISTS "${_fizzy_src}")
    file(READ "${_fizzy_src}" _fc)
    set(_fizzy_mod FALSE)
    string(FIND "${_fc}" "__builtin_memcpy" _bm_pos)
    if(NOT _bm_pos EQUAL -1)
      string(REPLACE "__builtin_memcpy" "std::memcpy" _fc "${_fc}")
      set(_fizzy_mod TRUE)
    endif()
    string(FIND "${_fc}" "__attribute__((no_sanitize" _ns_pos)
    if(NOT _ns_pos EQUAL -1)
      string(REGEX REPLACE "__attribute__\\(\\(no_sanitize\\([^)]*\\)\\)\\)[ \t]*" "" _fc "${_fc}")
      set(_fizzy_mod TRUE)
    endif()
    if(_fizzy_mod)
      file(WRITE "${_fizzy_src}" "${_fc}")
      message(STATUS "PATCH: ${_fizzy_src} - MSVC compat (__builtin_memcpy, __attribute__)")
    endif()
  endif()
endforeach()

# Patch parser.cpp: MSVC STL string_view iterator != raw pointer
# Convert .begin()/.end() on bytes_view to .data()/.data()+.size()
set(_parser_cpp "${SOURCE_DIR}/lib/fizzy/parser.cpp")
if(EXISTS "${_parser_cpp}")
  file(READ "${_parser_cpp}" _pc)
  string(FIND "${_pc}" "input.begin()" _ib_pos)
  if(NOT _ib_pos EQUAL -1)
    # Add #include <iterator> for std::back_inserter
    string(REPLACE "#include <unordered_set>" "#include <iterator>\n#include <unordered_set>" _pc "${_pc}")
    # In parse(bytes_view input): replace iterator-based loop with pointer-based
    string(REPLACE
      "for (auto it = input.begin(); it != input.end();)"
      "for (auto it = input.data(); it != input.data() + input.size();)"
      _pc "${_pc}")
    # Replace input.end() references inside the loop
    string(REPLACE "input.end()" "input.data() + input.size()" _pc "${_pc}")
    # In parse_code: replace code_binary.begin()/end() with data pointers
    string(REPLACE "code_binary.begin()" "code_binary.data()" _pc "${_pc}")
    string(REPLACE "code_binary.end()" "code_binary.data() + code_binary.size()" _pc "${_pc}")
    file(WRITE "${_parser_cpp}" "${_pc}")
    message(STATUS "PATCH: fizzy/parser.cpp - MSVC iterator-to-pointer compat")
  endif()
endif()

# Patch bit.hpp: MSVC intrinsics
set(bithpp "${SOURCE_DIR}/lib/fizzy/cxx20/bit.hpp")
if(EXISTS "${bithpp}")
  file(READ "${bithpp}" bc)
  string(FIND "${bc}" "__builtin_ctzll" _pos3)
  if(NOT _pos3 EQUAL -1)
    file(WRITE "${bithpp}" [=[
#pragma once
#include <cstdint>
#include <cstring>
#include <type_traits>
#ifdef _MSC_VER
#include <intrin.h>
#endif
#if __has_include(<version>)
#include <version>
#endif
#ifdef __cpp_lib_bit_cast
#include <bit>
namespace fizzy { using std::bit_cast; }
#else
namespace fizzy {
template <class To, class From>
[[nodiscard]] inline To bit_cast(const From& src) noexcept {
    static_assert(sizeof(To) == sizeof(From));
    To dst;
    std::memcpy(&dst, &src, sizeof(To));
    return dst;
}
}
#endif
#if defined(__cpp_lib_bitops) && !defined(_MSC_VER)
#include <bit>
namespace fizzy {
using std::countl_zero;
using std::countr_zero;
using std::popcount;
}
#else
namespace fizzy {
inline int popcount(uint32_t x) noexcept {
#ifdef _MSC_VER
    return static_cast<int>(__popcnt(x));
#else
    return __builtin_popcount(x);
#endif
}
inline int popcount(uint64_t x) noexcept {
#ifdef _MSC_VER
    return static_cast<int>(__popcnt64(x));
#else
    return __builtin_popcountll(x);
#endif
}
inline int countl_zero(uint32_t x) noexcept {
    if (x == 0) return 32;
#ifdef _MSC_VER
    unsigned long idx; _BitScanReverse(&idx, x); return 31 - static_cast<int>(idx);
#else
    return __builtin_clz(x);
#endif
}
inline int countl_zero(uint64_t x) noexcept {
    if (x == 0) return 64;
#ifdef _MSC_VER
    unsigned long idx; _BitScanReverse64(&idx, x); return 63 - static_cast<int>(idx);
#else
    return __builtin_clzll(x);
#endif
}
inline int countr_zero(uint32_t x) noexcept {
    if (x == 0) return 32;
#ifdef _MSC_VER
    unsigned long idx; _BitScanForward(&idx, x); return static_cast<int>(idx);
#else
    return __builtin_ctz(x);
#endif
}
inline int countr_zero(uint64_t x) noexcept {
    if (x == 0) return 64;
#ifdef _MSC_VER
    unsigned long idx; _BitScanForward64(&idx, x); return static_cast<int>(idx);
#else
    return __builtin_ctzll(x);
#endif
}
}
#endif
]=])
    message(STATUS "PATCH: fizzy/cxx20/bit.hpp - MSVC intrinsics (non-constexpr)")
  endif()
endif()
