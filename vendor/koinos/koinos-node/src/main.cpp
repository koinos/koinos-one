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

// Phase 1: chain controller (from koinos-chain library, minus AMQP)
// Only available when building with the chain library linked.
#ifdef KOINOS_HAS_CHAIN
#include <koinos/chain/controller.hpp>
#include <koinos/chain/indexer.hpp>
#endif

// Phase 2: C++ block store
#include "block_store/block_store.hpp"

// Phase 3: JSON-RPC gateway
#include "jsonrpc/jsonrpc_server.hpp"

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
#ifdef KOINOS_HAS_CHAIN
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
#endif // KOINOS_HAS_CHAIN

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
#ifdef KOINOS_HAS_CHAIN
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
#endif // KOINOS_HAS_CHAIN

    // ── Phase 2: RocksDB + Block Store ──
    rocksdb::DB* raw_db = nullptr;
    std::vector< rocksdb::ColumnFamilyHandle* > cf_handles;

    rocksdb::Options db_options;
    db_options.create_if_missing          = true;
    db_options.create_missing_column_families = true;

    auto db_path = basedir / "db";
    std::filesystem::create_directories( db_path );

    // Column families: default (chain state), blocks, block_meta
    std::vector< rocksdb::ColumnFamilyDescriptor > cf_descriptors = {
      { rocksdb::kDefaultColumnFamilyName, rocksdb::ColumnFamilyOptions() },
      { "blocks",     rocksdb::ColumnFamilyOptions() },
      { "block_meta", rocksdb::ColumnFamilyOptions() }
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

    // Chain adapter implements IChain
#ifdef KOINOS_HAS_CHAIN
    ChainAdapter chain_adapter( controller );
#endif

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

    // Register chain component
#ifdef KOINOS_HAS_CHAIN
    if( cfg.is_enabled( "chain" ) )
    {
      registry.add(
        "chain",
        [&]() {
          controller.open( state_dir, genesis, fork_algo, cfg.reset );
          LOG( info ) << "[chain] State DB opened at " << state_dir.string();
        },
        [&]() {
          controller.close();
        }
      );
    }
#else
    if( cfg.is_enabled( "chain" ) )
      LOG( warning ) << "[chain] Built without chain library — chain component disabled";
#endif

    // ── EventBus wiring ──

    // Block accepted → block store, mempool (future), p2p (future)
    event_bus.on_block_accepted.connect(
      [&block_store_impl]( const broadcast::block_accepted& ba ) {
        block_store_impl.handle_block_accepted( ba );
      }
    );

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

    // Chain interface: use adapter if chain is built, otherwise nullptr
    node::IChain* chain_ptr = nullptr;
#ifdef KOINOS_HAS_CHAIN
    chain_ptr = &chain_adapter;
#endif

    std::unique_ptr< node::jsonrpc::JSONRPCServer > jsonrpc_server;
    if( cfg.is_enabled( "jsonrpc" ) )
    {
      jsonrpc_server = std::make_unique< node::jsonrpc::JSONRPCServer >(
        chain_ptr,
        nullptr, // mempool: Phase 1 future
        &block_store_impl,
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
