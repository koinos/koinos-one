#pragma once

#include <cstdint>
#include <filesystem>
#include <map>
#include <string>
#include <vector>

namespace koinos::node {

/**
 * Unified configuration parsed from config.yml + CLI flags.
 * Replaces per-service config parsing.
 */
struct NodeConfig
{
  // ── Global ──
  std::string log_level    = "info";
  std::string instance_id  = "Koinos";
  std::string fork_algorithm = "pob";
  std::filesystem::path basedir;
  bool log_color    = true;
  bool log_datetime = true;

  // ── Chain ──
  uint64_t chain_jobs                    = 2;
  bool verify_blocks                     = false;
  uint64_t read_compute_bandwidth_limit  = 10'000'000;
  uint64_t pending_transaction_limit     = 10;
  bool disable_pending_transaction_limit = false;
  bool reset                             = false;

  // ── P2P ──
  std::string p2p_listen   = "/ip4/0.0.0.0/tcp/8888";
  std::vector< std::string > p2p_seeds;
  uint64_t p2p_jobs        = 4;
  uint64_t p2p_seed_reconnect_interval_seconds = 10;
  bool p2p_force_gossip   = false;
  bool p2p_disable_gossip = false;

  // ── JSON-RPC ──
  std::string jsonrpc_listen = "0.0.0.0:8080";
  uint64_t jsonrpc_jobs      = 4;

  // ── Block Producer ──
  std::string block_producer_algorithm = "pob";
  std::string block_producer_private_key_file;
  std::string block_producer_address;
  uint64_t block_producer_resources_lower_bound = 75;
  uint64_t block_producer_resources_upper_bound = 90;
  uint64_t block_producer_max_inclusion_attempts = 2'000;
  bool block_producer_gossip_production = true;
  std::vector< std::string > block_producer_approved_proposals;

  // ── Mempool ──
  uint64_t mempool_transaction_expiration = 120;

  // ── Feature flags ──
  std::map< std::string, bool > features = {
    { "chain",               true  },
    { "mempool",             true  },
    { "block_store",         true  },
    { "p2p",                 true  },
    { "jsonrpc",             true  },
    { "grpc",                false },
    { "block_producer",      false },
    { "contract_meta_store", true  },
    { "transaction_store",   true  },
    { "account_history",     false }
  };

  /** Check if a component is enabled. */
  bool is_enabled( const std::string& component ) const
  {
    auto it = features.find( component );
    return it != features.end() && it->second;
  }
};

/**
 * Load configuration from YAML file and merge CLI overrides.
 *
 * @param config_path  Path to config.yml
 * @param cli_enables  Components explicitly enabled via --enable
 * @param cli_disables Components explicitly disabled via --disable
 * @return Merged configuration
 */
NodeConfig load_config( const std::filesystem::path& config_path,
                        const std::vector< std::string >& cli_enables  = {},
                        const std::vector< std::string >& cli_disables = {} );

} // namespace koinos::node
