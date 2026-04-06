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

# ── VM Manager library (from koinos-chain, no AMQP deps) ──
add_library(vm_manager
  koinos/vm_manager/host_api.cpp
  koinos/vm_manager/vm_backend.cpp
  koinos/vm_manager/fizzy/fizzy_vm_backend.cpp
  koinos/vm_manager/fizzy/module_cache.cpp
  koinos/vm_manager/host_api.hpp
  koinos/vm_manager/vm_backend.hpp
  koinos/vm_manager/fizzy/exceptions.hpp
  koinos/vm_manager/fizzy/fizzy_vm_backend.hpp
  koinos/vm_manager/fizzy/module_cache.hpp)

target_include_directories(vm_manager PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>)

target_link_libraries(vm_manager PUBLIC
  Koinos::exception Koinos::log Koinos::util fizzy::fizzy)

# ── Mempool library (from koinos-mempool, no AMQP deps) ──
add_library(mempool_lib
  koinos/mempool/mempool.cpp
  koinos/mempool/block_applicator.cpp
  koinos/mempool/state.cpp
  koinos/mempool/mempool.hpp
  koinos/mempool/block_applicator.hpp
  koinos/mempool/state.hpp)

target_include_directories(mempool_lib PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>)

target_link_libraries(mempool_lib PUBLIC
  Koinos::state_db Koinos::exception Koinos::crypto Koinos::log Koinos::proto)

# ── Chain library (from koinos-chain, with MonolithClient replacing AMQP) ──
add_library(chain
  koinos/chain/chronicler.cpp
  koinos/chain/controller.cpp
  koinos/chain/execution_context.cpp
  koinos/chain/host_api.cpp
  koinos/chain/indexer.cpp
  koinos/chain/proto_utils.cpp
  koinos/chain/rectify.cpp
  koinos/chain/resource_meter.cpp
  koinos/chain/session.cpp
  koinos/chain/state.cpp
  koinos/chain/system_calls.cpp
  koinos/chain/thunk_dispatcher.cpp)

target_include_directories(chain PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>)

target_link_libraries(chain PUBLIC
  koinos_node_core koinos_node_interfaces
  Koinos::state_db Koinos::exception Koinos::crypto Koinos::log
  Koinos::util Koinos::proto vm_manager)

# ── Account History library (Phase 6) ──
add_library(koinos_account_history_lib
  account_history/account_history.cpp
  account_history/account_history.hpp)

target_include_directories(koinos_account_history_lib PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>)

target_link_libraries(koinos_account_history_lib PUBLIC
  Koinos::log Koinos::proto RocksDB::rocksdb)

# ── gRPC server library (Phase 6) ──
add_library(koinos_grpc_server_lib
  grpc_server/grpc_server.cpp
  grpc_server/grpc_server.hpp)

target_include_directories(koinos_grpc_server_lib PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>)

target_link_libraries(koinos_grpc_server_lib PUBLIC
  koinos_node_interfaces
  Koinos::log Koinos::proto
  gRPC::grpc++ protobuf::libprotobuf)

# ── P2P library (Phase 5: sync, gossip, error scoring — transport abstracted) ──
set(P2P_SOURCES
  p2p/p2p_node.cpp
  p2p/p2p_node.hpp
  p2p/transport.hpp
  p2p/error_handler.hpp
  p2p/fork_watchdog.hpp
  p2p/gossip_toggle.hpp
  p2p/types.hpp
  p2p/libp2p_transport.hpp
  p2p/libp2p_transport.cpp)

add_library(koinos_p2p_lib ${P2P_SOURCES})

target_include_directories(koinos_p2p_lib PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>)

target_link_libraries(koinos_p2p_lib PUBLIC
  koinos_node_core koinos_node_interfaces
  Koinos::log Koinos::proto Boost::thread)

# cpp-libp2p integration (optional — enable with -DKOINOS_ENABLE_LIBP2P=ON)
option(KOINOS_ENABLE_LIBP2P "Enable cpp-libp2p transport for P2P networking" OFF)
if(KOINOS_ENABLE_LIBP2P)
  include(FetchContent)
  FetchContent_Declare(
    cpp_libp2p
    GIT_REPOSITORY https://github.com/libp2p/cpp-libp2p.git
    GIT_TAG        28e4abcea0bf3fb1b04e51febfea38305f101fe7)
  FetchContent_MakeAvailable(cpp_libp2p)

  target_link_libraries(koinos_p2p_lib PUBLIC libp2p)
  target_compile_definitions(koinos_p2p_lib PUBLIC KOINOS_HAS_LIBP2P)
  message(STATUS "koinos_node: cpp-libp2p enabled")
else()
  message(STATUS "koinos_node: cpp-libp2p disabled (use -DKOINOS_ENABLE_LIBP2P=ON to enable)")
endif()

# ── Contract Meta Store library (Phase 4) ──
add_library(koinos_contract_meta_store_lib
  contract_meta_store/contract_meta_store.cpp
  contract_meta_store/contract_meta_store.hpp)

target_include_directories(koinos_contract_meta_store_lib PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>)

target_link_libraries(koinos_contract_meta_store_lib PUBLIC
  Koinos::log Koinos::proto RocksDB::rocksdb)

# ── Transaction Store library (Phase 4) ──
add_library(koinos_transaction_store_lib
  transaction_store/transaction_store.cpp
  transaction_store/transaction_store.hpp)

target_include_directories(koinos_transaction_store_lib PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>)

target_link_libraries(koinos_transaction_store_lib PUBLIC
  Koinos::log Koinos::proto RocksDB::rocksdb)

# ── JSON-RPC server library (Phase 3: C++ port of Go jsonrpc) ──
add_library(koinos_jsonrpc_lib
  jsonrpc/jsonrpc_server.cpp
  jsonrpc/jsonrpc_server.hpp)

target_include_directories(
  koinos_jsonrpc_lib
    PUBLIC
      $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>)

target_link_libraries(
  koinos_jsonrpc_lib
    PUBLIC
      koinos_node_interfaces
      koinos_contract_meta_store_lib
      koinos_transaction_store_lib
      koinos_account_history_lib
      Koinos::log
      Koinos::proto
      Boost::system
      Boost::thread
      nlohmann_json::nlohmann_json
      protobuf::libprotobuf)

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
      mempool_lib
      koinos_p2p_lib
      koinos_account_history_lib
      koinos_grpc_server_lib
      koinos_contract_meta_store_lib
      koinos_transaction_store_lib
      koinos_jsonrpc_lib
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

# Chain library is now built internally — always available
target_link_libraries(koinos_node PRIVATE chain)
target_compile_definitions(koinos_node PRIVATE KOINOS_HAS_CHAIN)

koinos_install(TARGETS koinos_node)
