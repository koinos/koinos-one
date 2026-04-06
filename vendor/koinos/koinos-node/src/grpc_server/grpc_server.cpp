#include "grpc_server.hpp"

#include <koinos/log.hpp>

#include <grpcpp/grpcpp.h>
#include <grpcpp/health_check_service_interface.h>
#include <grpcpp/generic/async_generic_service.h>

#include <koinos/rpc/chain/chain_rpc.pb.h>
#include <koinos/rpc/block_store/block_store_rpc.pb.h>
#include <koinos/rpc/mempool/mempool_rpc.pb.h>

#include <google/protobuf/util/json_util.h>

namespace koinos::node::grpc_server {

// ---------------------------------------------------------------------------
// gRPC generic service — routes serialized protobuf requests to interfaces
//
// The original koinos-grpc uses method names like:
//   /koinos.rpc.chain/chain_request
//   /koinos.rpc.block_store/block_store_request
//
// We use AsyncGenericService to handle any method, parse the protobuf
// envelope, dispatch to the right service, and return the response.
// ---------------------------------------------------------------------------

struct GRPCServer::Impl
{
  std::unique_ptr< grpc::Server > server;
  grpc::AsyncGenericService generic_service;
  std::unique_ptr< grpc::ServerCompletionQueue > cq;
  std::vector< std::thread > threads;
  std::atomic< bool > running{ true };

  IChain* chain;
  IMempool* mempool;
  IBlockStore* block_store;

  void handle_rpcs()
  {
    // Request a new generic call
    grpc::GenericServerContext ctx;
    grpc::GenericServerAsyncReaderWriter stream( &ctx );
    generic_service.RequestCall( &ctx, &stream, cq.get(), cq.get(), reinterpret_cast< void* >( 1 ) );

    while( running )
    {
      void* tag;
      bool ok;
      if( !cq->Next( &tag, &ok ) )
        break;

      if( !ok )
        continue;

      // Read the request
      grpc::ByteBuffer request_buf;
      stream.Read( &request_buf, reinterpret_cast< void* >( 2 ) );
      cq->Next( &tag, &ok );

      if( !ok )
        continue;

      // Deserialize request
      std::vector< grpc::Slice > slices;
      request_buf.Dump( &slices );
      std::string request_bytes;
      for( const auto& s: slices )
        request_bytes.append( reinterpret_cast< const char* >( s.begin() ), s.size() );

      // Route based on method path
      std::string method = ctx.method();
      std::string response_bytes;

      try
      {
        response_bytes = dispatch_method( method, request_bytes );
      }
      catch( const std::exception& e )
      {
        LOG( warning ) << "[grpc] Error handling " << method << ": " << e.what();
        stream.Finish( grpc::Status( grpc::StatusCode::INTERNAL, e.what() ),
                       reinterpret_cast< void* >( 3 ) );
        cq->Next( &tag, &ok );
        // Request next call
        generic_service.RequestCall( &ctx, &stream, cq.get(), cq.get(), reinterpret_cast< void* >( 1 ) );
        continue;
      }

      // Send response
      grpc::Slice response_slice( response_bytes.data(), response_bytes.size() );
      grpc::ByteBuffer response_buf( &response_slice, 1 );
      stream.WriteAndFinish( response_buf, grpc::WriteOptions(), grpc::Status::OK,
                              reinterpret_cast< void* >( 3 ) );
      cq->Next( &tag, &ok );

      // Request next call
      generic_service.RequestCall( &ctx, &stream, cq.get(), cq.get(), reinterpret_cast< void* >( 1 ) );
    }
  }

  std::string dispatch_method( const std::string& method, const std::string& request_bytes )
  {
    // Method format: /koinos.rpc.chain/chain_request
    // or: /koinos.rpc.block_store/block_store_request

    if( method.find( "chain" ) != std::string::npos && chain )
    {
      rpc::chain::chain_request req;
      req.ParseFromString( request_bytes );
      rpc::chain::chain_response resp;

      if( req.has_get_head_info() )
        *resp.mutable_get_head_info() = chain->get_head_info( req.get_head_info() );
      else if( req.has_get_chain_id() )
        *resp.mutable_get_chain_id() = chain->get_chain_id( req.get_chain_id() );
      else if( req.has_get_fork_heads() )
        *resp.mutable_get_fork_heads() = chain->get_fork_heads( req.get_fork_heads() );
      else if( req.has_submit_block() )
        *resp.mutable_submit_block() = chain->submit_block( req.submit_block() );
      else if( req.has_submit_transaction() )
        *resp.mutable_submit_transaction() = chain->submit_transaction( req.submit_transaction() );
      else if( req.has_read_contract() )
        *resp.mutable_read_contract() = chain->read_contract( req.read_contract() );
      else if( req.has_get_account_nonce() )
        *resp.mutable_get_account_nonce() = chain->get_account_nonce( req.get_account_nonce() );
      else if( req.has_get_account_rc() )
        *resp.mutable_get_account_rc() = chain->get_account_rc( req.get_account_rc() );
      else if( req.has_get_resource_limits() )
        *resp.mutable_get_resource_limits() = chain->get_resource_limits( req.get_resource_limits() );

      return resp.SerializeAsString();
    }

    if( method.find( "block_store" ) != std::string::npos && block_store )
    {
      rpc::block_store::block_store_request req;
      req.ParseFromString( request_bytes );
      rpc::block_store::block_store_response resp;

      if( req.has_get_blocks_by_height() )
        *resp.mutable_get_blocks_by_height() = block_store->get_blocks_by_height( req.get_blocks_by_height() );
      else if( req.has_get_blocks_by_id() )
        *resp.mutable_get_blocks_by_id() = block_store->get_blocks_by_id( req.get_blocks_by_id() );
      else if( req.has_get_highest_block() )
        *resp.mutable_get_highest_block() = block_store->get_highest_block( req.get_highest_block() );

      return resp.SerializeAsString();
    }

    if( method.find( "mempool" ) != std::string::npos && mempool )
    {
      rpc::mempool::mempool_request req;
      req.ParseFromString( request_bytes );
      rpc::mempool::mempool_response resp;

      if( req.has_get_pending_transactions() )
        *resp.mutable_get_pending_transactions() = mempool->get_pending_transactions( req.get_pending_transactions() );
      else if( req.has_check_pending_account_resources() )
        *resp.mutable_check_pending_account_resources() =
          mempool->check_pending_account_resources( req.check_pending_account_resources() );

      return resp.SerializeAsString();
    }

    throw std::runtime_error( "Unknown gRPC method: " + method );
  }
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

GRPCServer::GRPCServer( IChain* chain,
                        IMempool* mempool,
                        IBlockStore* block_store,
                        const std::string& listen_address,
                        unsigned int threads )
    : _chain( chain ),
      _mempool( mempool ),
      _block_store( block_store ),
      _listen_address( listen_address ),
      _thread_count( std::max( threads, 2u ) )
{
}

GRPCServer::~GRPCServer()
{
  stop();
}

void GRPCServer::start()
{
  _running = true;
  _impl    = std::make_unique< Impl >();

  _impl->chain       = _chain;
  _impl->mempool     = _mempool;
  _impl->block_store = _block_store;

  grpc::EnableDefaultHealthCheckService( true );

  grpc::ServerBuilder builder;
  builder.AddListeningPort( _listen_address, grpc::InsecureServerCredentials() );
  builder.RegisterAsyncGenericService( &_impl->generic_service );
  _impl->cq = builder.AddCompletionQueue();

  _impl->server = builder.BuildAndStart();

  if( _impl->server )
  {
    // Start handler threads
    for( unsigned int i = 0; i < _thread_count; ++i )
      _impl->threads.emplace_back( [this]() { _impl->handle_rpcs(); } );

    LOG( info ) << "[grpc] Listening on " << _listen_address
                << " with " << _thread_count << " threads (chain + block_store + mempool)";
  }
  else
  {
    LOG( error ) << "[grpc] Failed to start on " << _listen_address;
  }
}

void GRPCServer::stop()
{
  if( !_running.exchange( false ) )
    return;

  if( _impl )
  {
    _impl->running = false;
    if( _impl->server )
    {
      _impl->server->Shutdown();
      _impl->cq->Shutdown();
    }
    for( auto& t: _impl->threads )
      if( t.joinable() )
        t.join();
  }
  _impl.reset();
}

} // namespace koinos::node::grpc_server
