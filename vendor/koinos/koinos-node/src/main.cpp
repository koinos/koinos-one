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
#include <koinos/chain/controller.hpp>
#include <koinos/chain/indexer.hpp>

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
// Stub IBlockStore — placeholder until Phase 2 (C++ block store)
// ---------------------------------------------------------------------------
class StubBlockStore final : public node::IBlockStore
{
public:
  rpc::block_store::get_blocks_by_height_response
  get_blocks_by_height( const rpc::block_store::get_blocks_by_height_request& ) override
  {
    return {};
  }

  rpc::block_store::get_blocks_by_id_response
  get_blocks_by_id( const rpc::block_store::get_blocks_by_id_request& ) override
  {
    return {};
  }

  rpc::block_store::get_highest_block_response
  get_highest_block( const rpc::block_store::get_highest_block_request& ) override
  {
    return {};
  }

  rpc::block_store::add_block_response
  add_block( const rpc::block_store::add_block_request& ) override
  {
    return {};
  }
};

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

    // ── Phase 1: Chain component ──
    // Resolve fork algorithm
    chain::fork_resolution_algorithm fork_algo = chain::fork_resolution_algorithm::fifo;
    if( cfg.fork_algorithm == "pob" )
      fork_algo = chain::fork_resolution_algorithm::pob;
    else if( cfg.fork_algorithm == "block-time" )
      fork_algo = chain::fork_resolution_algorithm::block_time;

    // Load genesis data
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

    // Construct chain controller (reuses existing koinos-chain library)
    std::optional< uint64_t > pending_limit;
    if( !cfg.disable_pending_transaction_limit )
      pending_limit = cfg.pending_transaction_limit;

    chain::controller controller(
      cfg.read_compute_bandwidth_limit,
      64'000, // syscall buffer size
      pending_limit
    );

    auto state_dir = basedir / "chain" / "blockchain";
    std::filesystem::create_directories( state_dir );

    // NOTE: controller.set_client() is NOT called — no AMQP client needed.
    // In monolith mode, the chain calls IBlockStore directly via the adapter.

    // Stub block store for Phase 1 (replaced by C++ implementation in Phase 2)
    StubBlockStore stub_block_store;

    // Chain adapter implements IChain
    ChainAdapter chain_adapter( controller );

    // Register chain component
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

    // ── EventBus wiring ──
    // When a block is accepted, notify all subscribers
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

    LOG( info ) << "koinos_node shutdown complete";
    return EXIT_SUCCESS;
  }
  catch( const std::exception& e )
  {
    std::cerr << "Fatal: " << e.what() << std::endl;
    return EXIT_FAILURE;
  }
}
