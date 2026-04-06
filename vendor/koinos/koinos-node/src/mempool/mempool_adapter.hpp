#pragma once

#include "interfaces/i_mempool.hpp"
#include <koinos/mempool/mempool.hpp>

namespace koinos::node {

/**
 * Adapter that wraps koinos::mempool::mempool behind the IMempool interface.
 * Translates protobuf RPC request/response types to mempool library calls.
 */
class MempoolAdapter final : public IMempool
{
public:
  explicit MempoolAdapter( koinos::mempool::mempool& impl ) : _impl( impl ) {}

  rpc::mempool::get_pending_transactions_response
  get_pending_transactions( const rpc::mempool::get_pending_transactions_request& req ) override
  {
    rpc::mempool::get_pending_transactions_response resp;

    auto limit = req.limit() > 0 ? req.limit() : koinos::mempool::constants::max_request_limit;
    auto txns  = _impl.get_pending_transactions( limit );

    for( auto& ptx: txns )
      *resp.add_pending_transactions() = std::move( ptx );

    return resp;
  }

  rpc::mempool::check_pending_account_resources_response
  check_pending_account_resources(
    const rpc::mempool::check_pending_account_resources_request& req ) override
  {
    rpc::mempool::check_pending_account_resources_response resp;

    bool ok = _impl.check_pending_account_resources(
      req.payer(),
      req.max_payer_rc(),
      req.rc_limit() );

    resp.set_success( ok );
    return resp;
  }

  rpc::mempool::get_reserved_account_rc_response
  get_reserved_account_rc( const rpc::mempool::get_reserved_account_rc_request& req ) override
  {
    rpc::mempool::get_reserved_account_rc_response resp;
    resp.set_rc( _impl.get_reserved_account_rc( req.account() ) );
    return resp;
  }

private:
  koinos::mempool::mempool& _impl;
};

} // namespace koinos::node
