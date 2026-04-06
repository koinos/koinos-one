#include "config.hpp"

#include <yaml-cpp/yaml.h>

namespace koinos::node {

namespace {

template< typename T >
T yaml_get( const YAML::Node& node, const std::string& key, const T& fallback )
{
  if( node[ key ] )
  {
    try
    {
      return node[ key ].as< T >();
    }
    catch( ... )
    {}
  }
  return fallback;
}

std::vector< std::string > yaml_get_string_list( const YAML::Node& node, const std::string& key )
{
  std::vector< std::string > result;
  if( node[ key ] && node[ key ].IsSequence() )
  {
    for( const auto& item: node[ key ] )
    {
      try
      {
        result.push_back( item.as< std::string >() );
      }
      catch( ... )
      {}
    }
  }
  return result;
}

} // anonymous namespace

NodeConfig load_config( const std::filesystem::path& config_path,
                        const std::vector< std::string >& cli_enables,
                        const std::vector< std::string >& cli_disables )
{
  NodeConfig cfg;

  if( std::filesystem::exists( config_path ) )
  {
    YAML::Node root = YAML::LoadFile( config_path.string() );

    // ── Global ──
    if( auto g = root[ "global" ] )
    {
      cfg.log_level      = yaml_get< std::string >( g, "log-level", cfg.log_level );
      cfg.instance_id    = yaml_get< std::string >( g, "instance-id", cfg.instance_id );
      cfg.fork_algorithm = yaml_get< std::string >( g, "fork-algorithm", cfg.fork_algorithm );
      cfg.log_color      = yaml_get< bool >( g, "log-color", cfg.log_color );
      cfg.log_datetime   = yaml_get< bool >( g, "log-datetime", cfg.log_datetime );
      cfg.reset          = yaml_get< bool >( g, "reset", cfg.reset );

      if( g[ "jobs" ] )
        cfg.chain_jobs = yaml_get< uint64_t >( g, "jobs", cfg.chain_jobs );
    }

    // ── Chain ──
    if( auto c = root[ "chain" ] )
    {
      cfg.chain_jobs                    = yaml_get< uint64_t >( c, "jobs", cfg.chain_jobs );
      cfg.verify_blocks                 = yaml_get< bool >( c, "verify-blocks", cfg.verify_blocks );
      cfg.read_compute_bandwidth_limit  = yaml_get< uint64_t >( c, "read-compute-bandwidth-limit", cfg.read_compute_bandwidth_limit );
      cfg.pending_transaction_limit     = yaml_get< uint64_t >( c, "pending-transaction-limit", cfg.pending_transaction_limit );
      cfg.disable_pending_transaction_limit = yaml_get< bool >( c, "disable-pending-transaction-limit", cfg.disable_pending_transaction_limit );
    }

    // ── P2P ──
    if( auto p = root[ "p2p" ] )
    {
      cfg.p2p_listen = yaml_get< std::string >( p, "listen", cfg.p2p_listen );
      cfg.p2p_jobs   = yaml_get< uint64_t >( p, "jobs", cfg.p2p_jobs );

      auto seeds = yaml_get_string_list( p, "seed" );
      if( !seeds.empty() )
        cfg.p2p_seeds = std::move( seeds );

      auto peers = yaml_get_string_list( p, "peer" );
      if( !peers.empty() )
        cfg.p2p_seeds.insert( cfg.p2p_seeds.end(), peers.begin(), peers.end() );
    }

    // ── JSON-RPC ──
    if( auto j = root[ "jsonrpc" ] )
    {
      cfg.jsonrpc_listen = yaml_get< std::string >( j, "listen", cfg.jsonrpc_listen );
      cfg.jsonrpc_jobs   = yaml_get< uint64_t >( j, "jobs", cfg.jsonrpc_jobs );
    }

    // ── Block Producer ──
    if( auto bp = root[ "block_producer" ] )
    {
      cfg.block_producer_algorithm         = yaml_get< std::string >( bp, "algorithm", cfg.block_producer_algorithm );
      cfg.block_producer_private_key_file  = yaml_get< std::string >( bp, "private-key-file", cfg.block_producer_private_key_file );
      cfg.block_producer_address           = yaml_get< std::string >( bp, "producer", cfg.block_producer_address );
      cfg.block_producer_resources_lower_bound = yaml_get< uint64_t >( bp, "resources-lower-bound", cfg.block_producer_resources_lower_bound );
      cfg.block_producer_resources_upper_bound = yaml_get< uint64_t >( bp, "resources-upper-bound", cfg.block_producer_resources_upper_bound );
    }

    // ── Mempool ──
    if( auto m = root[ "mempool" ] )
    {
      cfg.mempool_transaction_expiration = yaml_get< uint64_t >( m, "transaction-expiration", cfg.mempool_transaction_expiration );
    }

    // ── Feature flags ──
    if( auto f = root[ "features" ] )
    {
      for( auto it = f.begin(); it != f.end(); ++it )
      {
        try
        {
          cfg.features[ it->first.as< std::string >() ] = it->second.as< bool >();
        }
        catch( ... )
        {}
      }
    }
  }

  // Apply CLI overrides
  for( const auto& comp: cli_enables )
    cfg.features[ comp ] = true;
  for( const auto& comp: cli_disables )
    cfg.features[ comp ] = false;

  return cfg;
}

} // namespace koinos::node
