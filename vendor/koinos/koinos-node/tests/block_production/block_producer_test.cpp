#include "block_production/block_producer.hpp"

#include <koinos/crypto/elliptic.hpp>
#include <koinos/crypto/multihash.hpp>
#include <koinos/mempool/mempool.pb.h>
#include <koinos/protocol/protocol.pb.h>
#include <koinos/util/conversion.hpp>

#include <cassert>
#include <chrono>
#include <string>
#include <vector>

using namespace koinos;
using namespace koinos::node;
using namespace koinos::node::block_production;

namespace {

uint64_t now_ms()
{
  return uint64_t( std::chrono::duration_cast< std::chrono::milliseconds >(
                     std::chrono::system_clock::now().time_since_epoch() )
                     .count() );
}

protocol::transaction make_transaction( const std::string& id, uint64_t rc_limit = 1'000 )
{
  protocol::transaction transaction;
  transaction.set_id( id );
  transaction.mutable_header()->set_rc_limit( rc_limit );
  transaction.mutable_header()->set_chain_id( "chain-id" );
  transaction.mutable_header()->set_payer( "payer-" + id );
  transaction.add_signatures( "signature-" + id );
  return transaction;
}

mempool::pending_transaction make_pending_transaction( const std::string& id,
                                                       uint64_t disk,
                                                       uint64_t network,
                                                       uint64_t compute,
                                                       uint64_t rc_limit = 1'000 )
{
  mempool::pending_transaction pending;
  *pending.mutable_transaction() = make_transaction( id, rc_limit );
  pending.set_disk_storage_used( disk );
  pending.set_network_bandwidth_used( network );
  pending.set_compute_bandwidth_used( compute );
  return pending;
}

class FakeMempool final : public IMempool
{
public:
  rpc::mempool::get_pending_transactions_response
  get_pending_transactions( const rpc::mempool::get_pending_transactions_request& req ) override
  {
    last_requested_block_id = req.block_id();
    last_requested_limit    = req.limit();

    rpc::mempool::get_pending_transactions_response resp;
    for( const auto& pending: pending_transactions )
      *resp.add_pending_transactions() = pending;
    return resp;
  }

  rpc::mempool::check_pending_account_resources_response
  check_pending_account_resources( const rpc::mempool::check_pending_account_resources_request& ) override
  {
    return {};
  }

  rpc::mempool::check_account_nonce_response
  check_account_nonce( const rpc::mempool::check_account_nonce_request& ) override
  {
    return {};
  }

  rpc::mempool::get_pending_nonce_response
  get_pending_nonce( const rpc::mempool::get_pending_nonce_request& ) override
  {
    return {};
  }

  rpc::mempool::get_pending_transaction_count_response
  get_pending_transaction_count( const rpc::mempool::get_pending_transaction_count_request& ) override
  {
    return {};
  }

  rpc::mempool::get_reserved_account_rc_response
  get_reserved_account_rc( const rpc::mempool::get_reserved_account_rc_request& ) override
  {
    return {};
  }

  std::vector< mempool::pending_transaction > pending_transactions;
  std::string last_requested_block_id;
  uint64_t last_requested_limit = 0;
};

class FakeChain final : public IChain
{
public:
  FakeChain()
  {
    head.mutable_head_topology()->set_id( "previous-block" );
    head.mutable_head_topology()->set_height( 41 );
    head.set_head_state_merkle_root( "previous-root" );
    head.set_head_block_time( now_ms() - 1'000 );

    resource_limits.mutable_resource_limit_data()->set_disk_storage_limit( 1'000 );
    resource_limits.mutable_resource_limit_data()->set_network_bandwidth_limit( 1'000 );
    resource_limits.mutable_resource_limit_data()->set_compute_bandwidth_limit( 1'000 );
  }

  rpc::chain::submit_block_response submit_block( const rpc::chain::submit_block_request& ) override { return {}; }
  rpc::chain::submit_transaction_response submit_transaction( const rpc::chain::submit_transaction_request& ) override
  {
    return {};
  }

  rpc::chain::get_head_info_response get_head_info( const rpc::chain::get_head_info_request& = {} ) override
  {
    return head;
  }

  rpc::chain::get_chain_id_response get_chain_id( const rpc::chain::get_chain_id_request& = {} ) override
  {
    return {};
  }

  rpc::chain::get_fork_heads_response get_fork_heads( const rpc::chain::get_fork_heads_request& = {} ) override
  {
    return {};
  }

  rpc::chain::read_contract_response read_contract( const rpc::chain::read_contract_request& ) override { return {}; }
  rpc::chain::get_account_nonce_response get_account_nonce( const rpc::chain::get_account_nonce_request& ) override
  {
    return {};
  }
  rpc::chain::get_account_rc_response get_account_rc( const rpc::chain::get_account_rc_request& ) override
  {
    return {};
  }

  rpc::chain::get_resource_limits_response
  get_resource_limits( const rpc::chain::get_resource_limits_request& ) override
  {
    return resource_limits;
  }

  rpc::chain::invoke_system_call_response
  invoke_system_call( const rpc::chain::invoke_system_call_request& ) override
  {
    return {};
  }

  rpc::chain::propose_block_response
  propose_block( const rpc::chain::propose_block_request& req ) override
  {
    proposed_blocks.push_back( req.block() );

    rpc::chain::propose_block_response resp;
    if( fail_first_proposal && proposed_blocks.size() == 1 )
    {
      for( auto index: failed_indices )
        resp.add_failed_transaction_indices( index );
      return resp;
    }

    auto* receipt = resp.mutable_receipt();
    receipt->set_id( req.block().id() );
    receipt->set_height( req.block().header().height() );
    for( int i = 0; i < req.block().transactions_size(); ++i )
      receipt->add_transaction_receipts();
    return resp;
  }

  rpc::chain::get_head_info_response head;
  rpc::chain::get_resource_limits_response resource_limits;
  bool fail_first_proposal = false;
  std::vector< uint32_t > failed_indices;
  std::vector< protocol::block > proposed_blocks;
};

crypto::private_key test_private_key()
{
  return crypto::private_key::regenerate( crypto::hash( crypto::multicodec::sha2_256, std::string( "producer-test" ) ) );
}

void test_federated_block_assembly_and_acceptance()
{
  FakeChain chain;
  FakeMempool mempool;
  mempool.pending_transactions.push_back( make_pending_transaction( "a", 100, 100, 100 ) );
  mempool.pending_transactions.push_back( make_pending_transaction( "b", 100, 100, 100 ) );
  mempool.pending_transactions.push_back( make_pending_transaction( "too-large", 950, 100, 100 ) );

  ProducerConfig config;
  config.algorithm              = "federated";
  config.max_inclusion_attempts = 2'000;
  config.resources_lower_bound  = 75;
  config.resources_upper_bound  = 90;

  auto key = test_private_key();
  auto signer = key.get_public_key().to_address_bytes();
  BlockProducer producer( chain, mempool, key, config );

  auto result = producer.produce_once();

  assert( result.status == ProductionResult::Status::produced );
  assert( result.height == 42 );
  assert( result.transaction_count == 2 );
  assert( mempool.last_requested_block_id == "previous-block" );
  assert( mempool.last_requested_limit == 2'000 );
  assert( chain.proposed_blocks.size() == 1 );

  const auto& block = chain.proposed_blocks.front();
  assert( block.header().height() == 42 );
  assert( block.header().previous() == "previous-block" );
  assert( block.header().previous_state_merkle_root() == "previous-root" );
  assert( block.header().signer() == signer );
  assert( block.header().transaction_merkle_root().size() > 0 );
  assert( block.id().size() > 0 );
  assert( block.signature().size() > 0 );
  assert( block.transactions_size() == 2 );
}

void test_failed_transactions_are_pruned_and_retried()
{
  FakeChain chain;
  chain.fail_first_proposal = true;
  chain.failed_indices.push_back( 1 );

  FakeMempool mempool;
  mempool.pending_transactions.push_back( make_pending_transaction( "a", 100, 100, 100 ) );
  mempool.pending_transactions.push_back( make_pending_transaction( "bad", 100, 100, 100 ) );
  mempool.pending_transactions.push_back( make_pending_transaction( "c", 100, 100, 100 ) );

  ProducerConfig config;
  config.algorithm = "federated";

  BlockProducer producer( chain, mempool, test_private_key(), config );
  auto result = producer.produce_once();

  assert( result.status == ProductionResult::Status::produced );
  assert( result.removed_failed_transactions == 1 );
  assert( chain.proposed_blocks.size() == 2 );
  assert( chain.proposed_blocks[ 0 ].transactions_size() == 3 );
  assert( chain.proposed_blocks[ 1 ].transactions_size() == 2 );
  assert( chain.proposed_blocks[ 1 ].transactions( 0 ).id() == "a" );
  assert( chain.proposed_blocks[ 1 ].transactions( 1 ).id() == "c" );
}

} // anonymous namespace

int main()
{
  test_federated_block_assembly_and_acceptance();
  test_failed_transactions_are_pruned_and_retried();
  return 0;
}
