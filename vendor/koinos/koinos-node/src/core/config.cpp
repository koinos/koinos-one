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
      cfg.p2p_seed_reconnect_interval_seconds =
        yaml_get< uint64_t >( p, "seed-reconnect-interval-seconds", cfg.p2p_seed_reconnect_interval_seconds );
      cfg.p2p_force_gossip = yaml_get< bool >( p, "force-gossip", cfg.p2p_force_gossip );
      cfg.p2p_disable_gossip = yaml_get< bool >( p, "disable-gossip", cfg.p2p_disable_gossip );

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

    // ── gRPC ──
    if( auto g = root[ "grpc" ] )
    {
      cfg.grpc_listen = yaml_get< std::string >( g, "listen", cfg.grpc_listen );
      cfg.grpc_listen = yaml_get< std::string >( g, "endpoint", cfg.grpc_listen );
      cfg.grpc_jobs   = yaml_get< uint64_t >( g, "jobs", cfg.grpc_jobs );
    }

    // ── Block Producer ──
    if( auto bp = root[ "block_producer" ] )
    {
      cfg.block_producer_algorithm         = yaml_get< std::string >( bp, "algorithm", cfg.block_producer_algorithm );
      cfg.block_producer_private_key_file  = yaml_get< std::string >( bp, "private-key-file", cfg.block_producer_private_key_file );
      cfg.block_producer_address           = yaml_get< std::string >( bp, "producer", cfg.block_producer_address );
      cfg.block_producer_resources_lower_bound = yaml_get< uint64_t >( bp, "resources-lower-bound", cfg.block_producer_resources_lower_bound );
      cfg.block_producer_resources_upper_bound = yaml_get< uint64_t >( bp, "resources-upper-bound", cfg.block_producer_resources_upper_bound );
      cfg.block_producer_max_inclusion_attempts =
        yaml_get< uint64_t >( bp, "max-inclusion-attempts", cfg.block_producer_max_inclusion_attempts );
      cfg.block_producer_gossip_production =
        yaml_get< bool >( bp, "gossip-production", cfg.block_producer_gossip_production );
      cfg.block_producer_approved_proposals = yaml_get_string_list( bp, "approve-proposals" );
    }

    // ── Mempool ──
    if( auto m = root[ "mempool" ] )
    {
      cfg.mempool_transaction_expiration = yaml_get< uint64_t >( m, "transaction-expiration", cfg.mempool_transaction_expiration );
    }

    // ── RocksDB ──
    if( auto r = root[ "rocksdb" ] )
    {
      cfg.rocksdb_block_cache_mb           = yaml_get< uint64_t >( r, "block-cache-mb", cfg.rocksdb_block_cache_mb );
      cfg.rocksdb_max_background_jobs      = yaml_get< uint64_t >( r, "max-background-jobs", cfg.rocksdb_max_background_jobs );
      cfg.rocksdb_bytes_per_sync           = yaml_get< uint64_t >( r, "bytes-per-sync", cfg.rocksdb_bytes_per_sync );
      cfg.rocksdb_default_block_size       = yaml_get< uint64_t >( r, "default-block-size", cfg.rocksdb_default_block_size );
      cfg.rocksdb_blocks_block_size        = yaml_get< uint64_t >( r, "blocks-block-size", cfg.rocksdb_blocks_block_size );
      cfg.rocksdb_target_file_size_base    = yaml_get< uint64_t >( r, "target-file-size-base", cfg.rocksdb_target_file_size_base );
      cfg.rocksdb_max_bytes_for_level_base = yaml_get< uint64_t >( r, "max-bytes-for-level-base", cfg.rocksdb_max_bytes_for_level_base );
      cfg.rocksdb_write_buffer_size        = yaml_get< uint64_t >( r, "write-buffer-size", cfg.rocksdb_write_buffer_size );
      cfg.rocksdb_db_write_buffer_size     = yaml_get< uint64_t >( r, "db-write-buffer-size", cfg.rocksdb_db_write_buffer_size );
      cfg.rocksdb_max_write_buffer_number  = yaml_get< uint64_t >( r, "max-write-buffer-number", cfg.rocksdb_max_write_buffer_number );
      cfg.rocksdb_blocks_compression       = yaml_get< std::string >( r, "blocks-compression", cfg.rocksdb_blocks_compression );
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
