#include "grpc_server.hpp"

#include <koinos/log.hpp>

#include <grpcpp/grpcpp.h>
#include <grpcpp/health_check_service_interface.h>

#include <koinos/rpc/chain/chain_rpc.pb.h>

#include <google/protobuf/util/json_util.h>

namespace koinos::node::grpc_server {

// ---------------------------------------------------------------------------
// gRPC service — generic unary handler that routes to internal interfaces
// The original koinos-grpc uses a custom service with manual routing.
// We implement a similar pattern: single generic method per service.
// ---------------------------------------------------------------------------

struct GRPCServer::Impl
{
  std::unique_ptr< grpc::Server > server;
  std::vector< std::thread > threads;
};

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
  _impl = std::make_unique< Impl >();

  // The koinos proto doesn't define gRPC service methods in the .proto files —
  // the original koinos-grpc implements a custom service handler.
  // For the monolith, we use grpc::AsyncGenericService or a simple health endpoint.
  // Full gRPC service registration requires the koinos-grpc service definition macros.
  //
  // For now, start the server with a health check endpoint so gRPC clients
  // can verify the node is alive.

  grpc::EnableDefaultHealthCheckService( true );

  grpc::ServerBuilder builder;
  builder.AddListeningPort( _listen_address, grpc::InsecureServerCredentials() );

  _impl->server = builder.BuildAndStart();

  if( _impl->server )
    LOG( info ) << "[grpc] Listening on " << _listen_address
                << " (health check only — full service pending koinos-grpc macro integration)";
  else
    LOG( error ) << "[grpc] Failed to start on " << _listen_address;
}

void GRPCServer::stop()
{
  if( !_running.exchange( false ) )
    return;

  if( _impl && _impl->server )
  {
    _impl->server->Shutdown();
    _impl->server->Wait();
  }
  _impl.reset();
}

} // namespace koinos::node::grpc_server
