# yaml-cpp Hunter target is "yaml-cpp", not "yaml-cpp::yaml-cpp"
if(TARGET yaml-cpp AND NOT TARGET yaml-cpp::yaml-cpp)
  add_library(yaml-cpp::yaml-cpp ALIAS yaml-cpp)
endif()

# ── Core library (config, event_bus, service_registry) ──
add_library(koinos_node_core
  core/config.cpp
  core/config.hpp
  core/event_bus.hpp
  core/service_registry.hpp)

target_include_directories(
  koinos_node_core
    PUBLIC
      $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>)

target_link_libraries(
  koinos_node_core
    PUBLIC
      Koinos::log
      Koinos::proto
      yaml-cpp::yaml-cpp
      Boost::system
      Boost::log)

# ── Interface headers (header-only) ──
add_library(koinos_node_interfaces INTERFACE)
target_include_directories(
  koinos_node_interfaces
    INTERFACE
      $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>)
target_link_libraries(
  koinos_node_interfaces
    INTERFACE
      Koinos::proto)

# ── Block Store library (Phase 2: C++ port of Go block_store) ──
add_library(koinos_block_store_lib
  block_store/block_store.cpp
  block_store/block_store.hpp
  block_store/skip_list.hpp)

target_include_directories(
  koinos_block_store_lib
    PUBLIC
      $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>)

target_link_libraries(
  koinos_block_store_lib
    PUBLIC
      koinos_node_interfaces
      Koinos::log
      Koinos::proto
      Koinos::exception
      RocksDB::rocksdb)

# ── Main executable ──
#
# Phase 1: Links the existing chain library directly.
# The chain library is built from the koinos-chain submodule but used
# as a library target (no AMQP main). The monolith provides its own main().
#
# NOTE: For this to build, the koinos-chain library target must be available.
# In development, add koinos-chain as a subdirectory or link the pre-built lib.

add_executable(koinos_node main.cpp)

target_link_libraries(
  koinos_node
    PRIVATE
      koinos_node_core
      koinos_node_interfaces
      koinos_block_store_lib
      Koinos::log
      Koinos::proto
      Koinos::util
      Koinos::exception
      Koinos::crypto
      Koinos::state_db
      RocksDB::rocksdb
      Boost::program_options
      Boost::thread
      yaml-cpp::yaml-cpp)

# Phase 1: Link the chain library (from koinos-chain submodule)
# This requires either:
#   a) add_subdirectory(${KOINOS_CHAIN_SOURCE_DIR}/src) in parent CMake, or
#   b) find_package(koinos_chain) if installed
# For now, use a conditional check:
if(TARGET chain)
  target_link_libraries(koinos_node PRIVATE chain)
  target_compile_definitions(koinos_node PRIVATE KOINOS_HAS_CHAIN)
  message(STATUS "koinos_node: linking chain library from koinos-chain")
else()
  message(WARNING "koinos_node: chain library target not found — chain integration disabled")
endif()

koinos_install(TARGETS koinos_node)
