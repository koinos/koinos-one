#pragma once

#include <chrono>
#include <cstdint>
#include <string>
#include <vector>

#include <koinos/protocol/protocol.pb.h>

namespace koinos::node::p2p {

struct PeerID
{
  std::string id;
  std::string address; // multiaddr
};

struct PeerError
{
  PeerID peer;
  std::string error;
  int score = 0;
};

struct PeerHeadInfo
{
  std::string block_id;
  uint64_t height = 0;
};

struct P2POptions
{
  // Sync
  uint32_t block_request_batch_size = 500;
  uint32_t synced_block_delta       = 5;
  std::chrono::seconds sync_check_interval{ 10 };
  std::chrono::seconds syncing_check_interval{ 1 };
  std::chrono::seconds handshake_retry_interval{ 6 };

  // Gossip toggle
  std::chrono::seconds gossip_head_threshold{ 45 };
  bool always_enable_gossip  = false;
  bool always_disable_gossip = false;

  // Applicator
  uint32_t max_pending_blocks       = 2500;
  uint32_t max_pending_transactions = 100000;
  std::chrono::seconds block_future_threshold{ 4 };
  std::chrono::seconds block_apply_timeout{ 60 };

  // Error scoring
  std::chrono::minutes error_score_halflife{ 30 };
  uint64_t error_score_disconnect_threshold = 100000;
  uint64_t error_score_reconnect_threshold  = 50000;

  // Error score values
  uint64_t score_transaction_application = 100;
  uint64_t score_block_application       = 5000;
  uint64_t score_unknown_previous        = 2500;
  uint64_t score_deserialization         = 5000;
  uint64_t score_peer_rpc_error          = 5000;
  uint64_t score_peer_rpc_timeout        = 3500;
  uint64_t score_fork_bomb               = 200000;
  uint64_t score_chain_id_mismatch       = 200000;
  uint64_t score_chain_not_connected     = 200000;
  uint64_t score_checkpoint_mismatch     = 200000;
};

} // namespace koinos::node::p2p
