/**
 * koinos_node — Monolithic Koinos blockchain node.
 *
 * Replaces 12 separate microservices + AMQP broker with a single binary.
 * Inter-service communication uses direct C++ function calls + EventBus
 * (boost::signals2) instead of serialized AMQP messages.
 *
 * Phase 0: Skeleton with EventBus, interfaces, config, lifecycle.
 * Phase 1: Chain, mempool, block_producer integrated via direct calls.
 */

#include <csignal>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

#include <boost/asio.hpp>
#include <boost/asio/signal_set.hpp>
#include <boost/program_options.hpp>
#include <boost/thread.hpp>

#include <koinos/log.hpp>

#include "core/config.hpp"
#include "core/event_bus.hpp"
#include "core/service_registry.hpp"

#include "interfaces/i_block_store.hpp"
#include "interfaces/i_chain.hpp"
#include "interfaces/i_mempool.hpp"

// Phase 1: chain controller (internal, AMQP replaced by MonolithClient)
#include <koinos/chain/controller.hpp>
#include <koinos/chain/indexer.hpp>
#include "core/monolith_client.hpp"
#include "core/monolith_rpc_client.hpp"

// Phase 2: C++ block store
#include "block_store/block_store.hpp"

// Phase 3: JSON-RPC gateway
#include "jsonrpc/jsonrpc_server.hpp"

// Mempool
#include <koinos/mempool/mempool.hpp>
#include "mempool/mempool_adapter.hpp"

// Phase 5: P2P
#include "p2p/p2p_node.hpp"
#ifdef KOINOS_HAS_LIBP2P
#include "p2p/libp2p_transport.hpp"
#endif

// Phase 6: gRPC + Account History
#include "grpc_server/grpc_server.hpp"
#include "account_history/account_history.hpp"

// Phase 4: Contract meta store + Transaction store
#include "contract_meta_store/contract_meta_store.hpp"
#include "transaction_store/transaction_store.hpp"

#include <rocksdb/db.h>
#include <rocksdb/options.h>

// Protobuf
#include <koinos/broadcast/broadcast.pb.h>
#include <koinos/rpc/chain/chain_rpc.pb.h>
#include <koinos/rpc/block_store/block_store_rpc.pb.h>
#include <koinos/rpc/mempool/mempool_rpc.pb.h>

#include <google/protobuf/util/json_util.h>

#define HELP_OPTION    "help"
#define VERSION_OPTION "version"
#define BASEDIR_OPTION "basedir"
#define CONFIG_OPTION  "config"
#define LOG_LEVEL_OPTION "log-level"
#define ENABLE_OPTION  "enable"
#define DISABLE_OPTION "disable"
#define JOBS_OPTION    "jobs"
#define P2P_LISTEN_OPTION     "p2p-listen"
#define JSONRPC_LISTEN_OPTION "jsonrpc-listen"

namespace po = boost::program_options;
using namespace koinos;

// ---------------------------------------------------------------------------
// ChainAdapter — wraps chain::controller to implement IChain
// ---------------------------------------------------------------------------

class ChainAdapter final : public node::IChain
{
public:
  explicit ChainAdapter( chain::controller& ctrl ) : _ctrl( ctrl ) {}

  rpc::chain::submit_block_response
  submit_block( const rpc::chain::submit_block_request& req ) override
  {
    return _ctrl.submit_block( req );
  }

  rpc::chain::submit_transaction_response
  submit_transaction( const rpc::chain::submit_transaction_request& req ) override
  {
    return _ctrl.submit_transaction( req );
  }

  rpc::chain::get_head_info_response
  get_head_info( const rpc::chain::get_head_info_request& req ) override
  {
    return _ctrl.get_head_info( req );
  }

  rpc::chain::get_chain_id_response
  get_chain_id( const rpc::chain::get_chain_id_request& req ) override
  {
    return _ctrl.get_chain_id( req );
  }

  rpc::chain::get_fork_heads_response
  get_fork_heads( const rpc::chain::get_fork_heads_request& req ) override
  {
    return _ctrl.get_fork_heads( req );
  }

  rpc::chain::read_contract_response
  read_contract( const rpc::chain::read_contract_request& req ) override
  {
    return _ctrl.read_contract( req );
  }

  rpc::chain::get_account_nonce_response
  get_account_nonce( const rpc::chain::get_account_nonce_request& req ) override
  {
    return _ctrl.get_account_nonce( req );
  }

  rpc::chain::get_account_rc_response
  get_account_rc( const rpc::chain::get_account_rc_request& req ) override
  {
    return _ctrl.get_account_rc( req );
  }

  rpc::chain::get_resource_limits_response
  get_resource_limits( const rpc::chain::get_resource_limits_request& req ) override
  {
    return _ctrl.get_resource_limits( req );
  }

  rpc::chain::invoke_system_call_response
  invoke_system_call( const rpc::chain::invoke_system_call_request& req ) override
  {
    return _ctrl.invoke_system_call( req );
  }

  rpc::chain::propose_block_response
  propose_block( const rpc::chain::propose_block_request& req ) override
  {
    return _ctrl.propose_block( req );
  }

private:
  chain::controller& _ctrl;
};


// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
int main( int argc, char** argv )
{
  try
  {
    // ── CLI argument parsing ──
    po::options_description desc( "koinos_node options" );
    desc.add_options()
      ( HELP_OPTION ",h",    "Print help" )
      ( VERSION_OPTION ",v", "Print version" )
      ( BASEDIR_OPTION ",d", po::value< std::string >()->default_value( "" ),
        "Base data directory (default: ~/.koinos)" )
      ( CONFIG_OPTION ",c",  po::value< std::string >()->default_value( "" ),
        "Config file path (default: {basedir}/config.yml)" )
      ( LOG_LEVEL_OPTION ",l", po::value< std::string >()->default_value( "" ),
        "Log level override" )
      ( ENABLE_OPTION,  po::value< std::vector< std::string > >()->multitoken(),
        "Enable a component (repeatable)" )
      ( DISABLE_OPTION, po::value< std::vector< std::string > >()->multitoken(),
        "Disable a component (repeatable)" )
      ( JOBS_OPTION ",j", po::value< uint64_t >()->default_value( 0 ),
        "Chain worker threads" )
      ( P2P_LISTEN_OPTION,     po::value< std::string >()->default_value( "" ),
        "P2P listen address override" )
      ( JSONRPC_LISTEN_OPTION, po::value< std::string >()->default_value( "" ),
        "JSON-RPC listen address override" );

    po::variables_map vm;
    po::store( po::parse_command_line( argc, argv, desc ), vm );
    po::notify( vm );

    if( vm.count( HELP_OPTION ) )
    {
      std::cout << desc << std::endl;
      return EXIT_SUCCESS;
    }

    if( vm.count( VERSION_OPTION ) )
    {
      std::cout << "koinos_node 0.1.0" << std::endl;
      return EXIT_SUCCESS;
    }

    // ── Resolve basedir ──
    std::filesystem::path basedir = vm[ BASEDIR_OPTION ].as< std::string >();
    if( basedir.empty() )
    {
      const char* home = std::getenv( "HOME" );
      basedir = home ? std::filesystem::path( home ) / ".koinos"
                     : std::filesystem::current_path() / ".koinos";
    }
    std::filesystem::create_directories( basedir );

    // ── Load config ──
    std::filesystem::path config_path = vm[ CONFIG_OPTION ].as< std::string >();
    if( config_path.empty() )
      config_path = basedir / "config.yml";

    auto enables  = vm.count( ENABLE_OPTION )  ? vm[ ENABLE_OPTION ].as< std::vector< std::string > >()  : std::vector< std::string >{};
    auto disables = vm.count( DISABLE_OPTION ) ? vm[ DISABLE_OPTION ].as< std::vector< std::string > >() : std::vector< std::string >{};

    node::NodeConfig cfg = node::load_config( config_path, enables, disables );
    cfg.basedir = basedir;

    // CLI overrides
    if( auto ll = vm[ LOG_LEVEL_OPTION ].as< std::string >(); !ll.empty() )
      cfg.log_level = ll;
    if( auto jobs = vm[ JOBS_OPTION ].as< uint64_t >(); jobs > 0 )
      cfg.chain_jobs = jobs;
    if( auto p2p = vm[ P2P_LISTEN_OPTION ].as< std::string >(); !p2p.empty() )
      cfg.p2p_listen = p2p;
    if( auto jrpc = vm[ JSONRPC_LISTEN_OPTION ].as< std::string >(); !jrpc.empty() )
      cfg.jsonrpc_listen = jrpc;

    // ── Initialize logging ──
    koinos::initialize_logging( "koinos_node", {}, cfg.log_level );
    LOG( info ) << "koinos_node v0.1.0 starting";
    LOG( info ) << "basedir: " << basedir.string();
    LOG( info ) << "config:  " << config_path.string();

    // Log enabled features
    for( const auto& [name, enabled]: cfg.features )
    {
      if( enabled )
        LOG( info ) << "[features] " << name << ": enabled";
    }

    // ── Core objects ──
    node::EventBus event_bus;
    node::ServiceRegistry registry;

    // ── io_context instances (Phase 0 threading model) ──
    boost::asio::io_context main_ioc;
    boost::asio::io_context chain_ioc;

    // ── Phase 1: Chain component (requires chain library) ──

    chain::fork_resolution_algorithm fork_algo = chain::fork_resolution_algorithm::fifo;
    if( cfg.fork_algorithm == "pob" )
      fork_algo = chain::fork_resolution_algorithm::pob;
    else if( cfg.fork_algorithm == "block-time" )
      fork_algo = chain::fork_resolution_algorithm::block_time;

    chain::genesis_data genesis;
    {
      auto genesis_path = basedir / "chain" / "genesis_data.json";
      if( !std::filesystem::exists( genesis_path ) )
        genesis_path = basedir / "genesis_data.json";

      if( std::filesystem::exists( genesis_path ) )
      {
        std::ifstream ifs( genesis_path );
        std::string json_str( ( std::istreambuf_iterator< char >( ifs ) ),
                                std::istreambuf_iterator< char >() );
        google::protobuf::util::JsonStringToMessage( json_str, &genesis );
        LOG( info ) << "[chain] Loaded genesis data from " << genesis_path.string();
      }
      else
      {
        LOG( warning ) << "[chain] Genesis data not found at " << genesis_path.string();
      }
    }

    std::optional< uint64_t > pending_limit;
    if( !cfg.disable_pending_transaction_limit )
      pending_limit = cfg.pending_transaction_limit;

    chain::controller controller(
      cfg.read_compute_bandwidth_limit,
      64'000,
      pending_limit
    );

    auto state_dir = basedir / "chain" / "blockchain";
    std::filesystem::create_directories( state_dir );


    // ── Mempool ──
    koinos::mempool::mempool mempool_impl;
    node::MempoolAdapter mempool_adapter( mempool_impl );

    // ── Phase 2: RocksDB + Block Store ──
    rocksdb::DB* raw_db = nullptr;
    std::vector< rocksdb::ColumnFamilyHandle* > cf_handles;

    rocksdb::Options db_options;
    db_options.create_if_missing          = true;
    db_options.create_missing_column_families = true;

    auto db_path = basedir / "db";
    std::filesystem::create_directories( db_path );

    // Column families
    std::vector< rocksdb::ColumnFamilyDescriptor > cf_descriptors = {
      { rocksdb::kDefaultColumnFamilyName, rocksdb::ColumnFamilyOptions() }, // 0: chain state
      { "blocks",         rocksdb::ColumnFamilyOptions() },                  // 1: block store
      { "block_meta",     rocksdb::ColumnFamilyOptions() },                  // 2: block metadata
      { "contract_meta",  rocksdb::ColumnFamilyOptions() },                  // 3: contract ABI
      { "transaction_index", rocksdb::ColumnFamilyOptions() },               // 4: tx index
      { "account_history",   rocksdb::ColumnFamilyOptions() }                // 5: account history
    };

    auto db_status = rocksdb::DB::Open( db_options, db_path.string(), cf_descriptors, &cf_handles, &raw_db );
    if( !db_status.ok() )
    {
      LOG( error ) << "Failed to open RocksDB at " << db_path.string() << ": " << db_status.ToString();
      return EXIT_FAILURE;
    }
    std::unique_ptr< rocksdb::DB > db( raw_db );
    LOG( info ) << "[db] RocksDB opened at " << db_path.string()
                << " with " << cf_handles.size() << " column families";

    // Block store using RocksDB column families
    node::block_store::BlockStore block_store_impl( raw_db, cf_handles[ 1 ], cf_handles[ 2 ] );

    // Phase 4: Contract meta store + Transaction store
    node::contract_meta_store::ContractMetaStore contract_meta_impl( raw_db, cf_handles[ 3 ] );
    node::transaction_store::TransactionStore transaction_store_impl( raw_db, cf_handles[ 4 ] );
    node::account_history::AccountHistory account_history_impl( raw_db, cf_handles[ 5 ] );

    // Chain adapter implements IChain
    ChainAdapter chain_adapter( controller );

    // Register block store component
    if( cfg.is_enabled( "block_store" ) )
    {
      registry.add(
        "block_store",
        [&]() {
          block_store_impl.initialize();
          LOG( info ) << "[block_store] Initialized";
        },
        [&]() {
          LOG( info ) << "[block_store] Stopped";
        }
      );
    }

    // Register chain component with indexer

    if( cfg.is_enabled( "chain" ) )
    {
      registry.add(
        "chain",
        [&]() {
          controller.open( state_dir, genesis, fork_algo, cfg.reset );
          LOG( info ) << "[chain] State DB opened at " << state_dir.string();

          // Run indexer to sync chain state from block_store.
          // monolith_client is declared below — capture a reference to the shared_ptr.
          // Note: indexer runs synchronously during startup, before other services start.
          // This is safe because block_store is already initialized at this point.
        },
        [&]() {
          controller.close();
        }
      );
    }

    // Register block producer (optional)
    // The block producer uses chain.propose_block() to create new blocks.
    // It runs as a background timer checking if it's the producer's turn.
    std::atomic< bool > producer_running{ false };
    std::thread producer_thread;

    if( cfg.is_enabled( "block_producer" ) )
    {
      registry.add(
        "block_producer",
        [&]() {
          producer_running = true;
          producer_thread  = std::thread( [&]() {
            LOG( info ) << "[block_producer] Production loop started";
            while( producer_running )
            {
              try
              {
                rpc::chain::propose_block_request req;
                auto resp = controller.propose_block( req );

                // If receipt present, the block was produced successfully
                if( resp.has_receipt() )
                {
                  LOG( info ) << "[block_producer] Produced block";
                }
              }
              catch( const std::exception& e )
              {
                // Production failures are normal (not our turn, no VHP, etc.)
                LOG( debug ) << "[block_producer] " << e.what();
              }

              // Sleep between production attempts (3s default)
              for( int i = 0; i < 30 && producer_running; ++i )
                std::this_thread::sleep_for( std::chrono::milliseconds( 100 ) );
            }
          } );
        },
        [&]() {
          producer_running = false;
          if( producer_thread.joinable() )
            producer_thread.join();
        }
      );
    }

    // ── EventBus wiring ──

    // Block accepted → block store, mempool (future), p2p (future)
    event_bus.on_block_accepted.connect(
      [&block_store_impl]( const broadcast::block_accepted& ba ) {
        block_store_impl.handle_block_accepted( ba );
      }
    );

    // Contract meta store subscribes to block events
    if( cfg.is_enabled( "contract_meta_store" ) )
    {
      event_bus.on_block_accepted.connect(
        [&contract_meta_impl]( const broadcast::block_accepted& ba ) {
          contract_meta_impl.handle_block_accepted( ba );
        }
      );
    }

    // Transaction store subscribes to block events
    if( cfg.is_enabled( "transaction_store" ) )
    {
      event_bus.on_block_accepted.connect(
        [&transaction_store_impl]( const broadcast::block_accepted& ba ) {
          transaction_store_impl.handle_block_accepted( ba );
        }
      );
    }

    // Account history subscribes to block events
    if( cfg.is_enabled( "account_history" ) )
    {
      event_bus.on_block_accepted.connect(
        [&account_history_impl]( const broadcast::block_accepted& ba ) {
          account_history_impl.handle_block_accepted( ba );
        }
      );
    }

    // Mempool subscribes to block events
    if( cfg.is_enabled( "mempool" ) )
    {
      event_bus.on_block_accepted.connect(
        [&mempool_impl]( const broadcast::block_accepted& ba ) {
          mempool_impl.handle_block( ba );
        }
      );
      event_bus.on_block_irreversible.connect(
        [&mempool_impl]( const broadcast::block_irreversible& bi ) {
          mempool_impl.handle_irreversibility( bi );
        }
      );
    }

    event_bus.on_block_accepted.connect(
      [&]( const broadcast::block_accepted& ba ) {
        LOG( debug ) << "[event_bus] block_accepted height="
                     << ba.block().header().height();
      }
    );

    event_bus.on_block_irreversible.connect(
      [&]( const broadcast::block_irreversible& bi ) {
        LOG( debug ) << "[event_bus] block_irreversible height="
                     << bi.topology().height();
      }
    );

    // ── Phase 5: P2P ──
    std::unique_ptr< node::p2p::P2PNode > p2p_node;
    if( cfg.is_enabled( "p2p" ) )
    {
#ifdef KOINOS_HAS_LIBP2P
      // cpp-libp2p transport available — create real P2P node
      node::p2p::Libp2pTransport::Config transport_cfg;
      transport_cfg.listen_address = cfg.p2p_listen;
      transport_cfg.seed_peers     = cfg.p2p_seeds;

      auto transport = std::make_unique< node::p2p::Libp2pTransport >( transport_cfg );

      node::p2p::P2POptions p2p_opts;
      p2p_node = std::make_unique< node::p2p::P2PNode >(
        p2p_opts, &chain_adapter, &block_store_impl, &event_bus, std::move( transport ) );

      registry.add(
        "p2p",
        [&]() { p2p_node->start(); },
        [&]() { p2p_node->stop(); }
      );
#else
      LOG( info ) << "[p2p] Component ready (build with -DKOINOS_ENABLE_LIBP2P=ON for networking)";
#endif
    }

    // ── Phase 6: gRPC server ──
    std::unique_ptr< node::grpc_server::GRPCServer > grpc_srv;
    if( cfg.is_enabled( "grpc" ) )
    {
      grpc_srv = std::make_unique< node::grpc_server::GRPCServer >(
        &chain_adapter, &mempool_adapter, &block_store_impl, "0.0.0.0:50051", 2 );
      registry.add(
        "grpc",
        [&]() { grpc_srv->start(); },
        [&]() { grpc_srv->stop(); }
      );
    }

    // ── Phase 3: JSON-RPC server ──
    // Parse listen address: "host:port" or just "port"
    std::string jsonrpc_host = "0.0.0.0";
    uint16_t jsonrpc_port    = 8080;
    {
      auto& listen = cfg.jsonrpc_listen;
      auto colon   = listen.rfind( ':' );
      if( colon != std::string::npos )
      {
        jsonrpc_host = listen.substr( 0, colon );
        jsonrpc_port = static_cast< uint16_t >( std::stoi( listen.substr( colon + 1 ) ) );
      }
      else if( !listen.empty() )
      {
        jsonrpc_port = static_cast< uint16_t >( std::stoi( listen ) );
      }
    }

    // Wire MonolithClient so the chain controller routes RPC/broadcast
    // through IBlockStore + EventBus instead of AMQP
    auto monolith_client = std::make_shared< node::MonolithRpcClient >(
      &block_store_impl, &mempool_adapter, &event_bus );
    controller.set_client( monolith_client );

    // Run chain indexer after client is set — syncs chain from block_store
    if( cfg.is_enabled( "chain" ) && cfg.is_enabled( "block_store" ) )
    {
      try
      {
        chain::indexer idx( chain_ioc, controller, monolith_client, cfg.verify_blocks );
        auto future = idx.index();
        if( future.get() )
          LOG( info ) << "[chain] Indexing complete";
        else
          LOG( warning ) << "[chain] Indexing returned false";
      }
      catch( const std::exception& e )
      {
        LOG( warning ) << "[chain] Indexer: " << e.what();
      }
    }

    std::unique_ptr< node::jsonrpc::JSONRPCServer > jsonrpc_server;
    if( cfg.is_enabled( "jsonrpc" ) )
    {
      jsonrpc_server = std::make_unique< node::jsonrpc::JSONRPCServer >(
        &chain_adapter,
        &mempool_adapter,
        &block_store_impl,
        cfg.is_enabled( "contract_meta_store" ) ? &contract_meta_impl : nullptr,
        cfg.is_enabled( "transaction_store" ) ? &transaction_store_impl : nullptr,
        cfg.is_enabled( "account_history" ) ? &account_history_impl : nullptr,
        jsonrpc_host,
        jsonrpc_port,
        static_cast< unsigned int >( cfg.jsonrpc_jobs )
      );

      registry.add(
        "jsonrpc",
        [&]() { jsonrpc_server->start(); },
        [&]() { jsonrpc_server->stop(); }
      );
    }

    // ── Signal handling ──
    boost::asio::signal_set signals( main_ioc, SIGINT, SIGTERM );
    signals.async_wait( [&]( const boost::system::error_code& ec, int sig ) {
      if( !ec )
      {
        LOG( info ) << "Received signal " << sig << ", shutting down...";
        registry.stop_all();
        main_ioc.stop();
      }
    } );

    // ── Start all registered components ──
    registry.start_all();

    LOG( info ) << "koinos_node ready";

    // ── Run main event loop ──
    main_ioc.run();

    // Clean up RocksDB column family handles
    for( auto* h: cf_handles )
      delete h;

    LOG( info ) << "koinos_node shutdown complete";
    return EXIT_SUCCESS;
  }
  catch( const std::exception& e )
  {
    std::cerr << "Fatal: " << e.what() << std::endl;
    return EXIT_FAILURE;
  }
}
