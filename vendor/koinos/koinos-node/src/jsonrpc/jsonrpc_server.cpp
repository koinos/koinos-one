#include "jsonrpc_server.hpp"

#include <sstream>

#include <google/protobuf/util/json_util.h>

#include <koinos/log.hpp>

namespace koinos::node::jsonrpc {

// ---------------------------------------------------------------------------
// Construction / destruction
// ---------------------------------------------------------------------------

JSONRPCServer::JSONRPCServer( IChain* chain,
                              IMempool* mempool,
                              IBlockStore* block_store,
                              contract_meta_store::ContractMetaStore* contract_meta,
                              transaction_store::TransactionStore* tx_store,
                              account_history::AccountHistory* acct_history,
                              const std::string& listen_address,
                              uint16_t port,
                              unsigned int threads )
    : _chain( chain ),
      _mempool( mempool ),
      _block_store( block_store ),
      _contract_meta( contract_meta ),
      _tx_store( tx_store ),
      _acct_history( acct_history ),
      _ioc( threads ),
      _acceptor( _ioc, { net::ip::make_address( listen_address ), port } ),
      _thread_count( threads )
{
}

JSONRPCServer::~JSONRPCServer()
{
  stop();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

void JSONRPCServer::start()
{
  _running = true;
  do_accept();

  _threads.reserve( _thread_count );
  for( unsigned int i = 0; i < _thread_count; ++i )
  {
    _threads.emplace_back( [this]() { _ioc.run(); } );
  }

  LOG( info ) << "[jsonrpc] Listening on "
              << _acceptor.local_endpoint().address().to_string()
              << ":" << _acceptor.local_endpoint().port()
              << " with " << _thread_count << " threads";
}

void JSONRPCServer::stop()
{
  if( !_running.exchange( false ) )
    return;

  _ioc.stop();
  for( auto& t: _threads )
  {
    if( t.joinable() )
      t.join();
  }
  _threads.clear();
}

// ---------------------------------------------------------------------------
// Accept loop
// ---------------------------------------------------------------------------

void JSONRPCServer::do_accept()
{
  _acceptor.async_accept( [this]( beast::error_code ec, tcp::socket socket ) {
    if( !ec && _running )
    {
      // Detach session to a strand (each connection handled independently)
      std::thread( [this, s = std::move( socket )]() mutable { handle_session( std::move( s ) ); } ).detach();
    }

    if( _running )
      do_accept();
  } );
}

// ---------------------------------------------------------------------------
// HTTP session
// ---------------------------------------------------------------------------

void JSONRPCServer::handle_session( tcp::socket socket )
{
  try
  {
    beast::flat_buffer buffer;
    http::request< http::string_body > req;
    http::read( socket, buffer, req );

    http::response< http::string_body > res;
    res.version( req.version() );
    res.set( http::field::content_type, "application/json" );
    res.set( http::field::access_control_allow_origin, "*" );
    res.set( http::field::access_control_allow_methods, "POST, OPTIONS" );
    res.set( http::field::access_control_allow_headers, "Content-Type" );

    // Handle CORS preflight
    if( req.method() == http::verb::options )
    {
      res.result( http::status::no_content );
      res.prepare_payload();
      http::write( socket, res );
      return;
    }

    // GET /health — simple health check for load balancers and Knodel
    if( req.method() == http::verb::get )
    {
      auto target = req.target();
      if( target == "/health" || target == "/healthz" || target == "/" )
      {
        res.result( http::status::ok );
        res.body() = R"({"status":"ok","node":"koinos_node","version":"0.1.0"})";
        res.prepare_payload();
        http::write( socket, res );
        return;
      }
    }

    if( req.method() != http::verb::post )
    {
      res.result( http::status::method_not_allowed );
      res.body() = R"({"jsonrpc":"2.0","error":{"code":-32600,"message":"Only POST allowed"},"id":null})";
      res.prepare_payload();
      http::write( socket, res );
      return;
    }

    res.result( http::status::ok );
    res.body() = process_body( req.body() );
    res.prepare_payload();
    http::write( socket, res );
  }
  catch( const beast::system_error& se )
  {
    if( se.code() != http::error::end_of_stream )
      LOG( debug ) << "[jsonrpc] Session error: " << se.code().message();
  }
  catch( const std::exception& e )
  {
    LOG( warning ) << "[jsonrpc] Session exception: " << e.what();
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC processing
// ---------------------------------------------------------------------------

std::string JSONRPCServer::process_body( const std::string& body )
{
  nlohmann::json parsed;
  try
  {
    parsed = nlohmann::json::parse( body );
  }
  catch( ... )
  {
    return make_error( PARSE_ERROR, "Parse error" ).dump();
  }

  // Batch request (JSON array)
  if( parsed.is_array() )
  {
    nlohmann::json batch_resp = nlohmann::json::array();
    for( const auto& item: parsed )
      batch_resp.push_back( process_single_request( item ) );
    return batch_resp.dump();
  }

  // Single request
  return process_single_request( parsed ).dump();
}

nlohmann::json JSONRPCServer::process_single_request( const nlohmann::json& request )
{
  // Extract ID (default null)
  nlohmann::json id = nullptr;
  if( request.contains( "id" ) )
    id = request[ "id" ];

  // Validate jsonrpc version
  if( !request.contains( "jsonrpc" ) || request[ "jsonrpc" ] != "2.0" )
    return make_error( INVALID_REQUEST, "Invalid JSON-RPC version", id );

  // Validate method
  if( !request.contains( "method" ) || !request[ "method" ].is_string() )
    return make_error( INVALID_REQUEST, "Missing or invalid method", id );

  std::string method_str = request[ "method" ].get< std::string >();

  // Parse method → service + method
  auto [service, method] = parse_method( method_str );
  if( service.empty() || method.empty() )
    return make_error( METHOD_NOT_FOUND, "Malformed method: " + method_str, id );

  // Extract params (default empty object)
  nlohmann::json params = nlohmann::json::object();
  if( request.contains( "params" ) && !request[ "params" ].is_null() )
    params = request[ "params" ];

  // Dispatch to service
  try
  {
    auto result = dispatch( service, method, params );
    return make_result( result, id );
  }
  catch( const std::exception& e )
  {
    return make_error( INTERNAL_ERROR, e.what(), id );
  }
}

// ---------------------------------------------------------------------------
// Method parsing
// ---------------------------------------------------------------------------

std::pair< std::string, std::string > JSONRPCServer::parse_method( const std::string& method_str )
{
  // Split on '.'
  std::vector< std::string > parts;
  std::istringstream ss( method_str );
  std::string part;
  while( std::getline( ss, part, '.' ) )
    parts.push_back( part );

  if( parts.size() < 2 )
    return { "", "" };

  // "chain.get_head_info" → ("chain", "get_head_info")
  // "koinos.rpc.chain.get_head_info" → ("chain", "get_head_info")
  std::string service = parts[ parts.size() - 2 ];
  std::string method  = parts[ parts.size() - 1 ];

  return { service, method };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

nlohmann::json JSONRPCServer::dispatch( const std::string& service,
                                         const std::string& method,
                                         const nlohmann::json& params )
{
  if( service == "chain" )
    return dispatch_chain( method, params );
  if( service == "block_store" )
    return dispatch_block_store( method, params );
  if( service == "mempool" )
    return dispatch_mempool( method, params );
  if( service == "contract_meta_store" )
    return dispatch_contract_meta_store( method, params );
  if( service == "transaction_store" )
    return dispatch_transaction_store( method, params );
  if( service == "account_history" )
    return dispatch_account_history( method, params );

  // Health / status endpoint
  if( service == "node" && method == "get_status" )
  {
    nlohmann::json status;
    status[ "node" ]    = "koinos_node";
    status[ "version" ] = "0.1.0";
    status[ "mode" ]    = "monolith";

    if( _chain )
    {
      try
      {
        auto head = _chain->get_head_info();
        status[ "head_height" ] = head.head_topology().height();
        status[ "last_irreversible_block" ] = head.last_irreversible_block();
      }
      catch( ... )
      {
        status[ "head_height" ] = nullptr;
      }
    }

    status[ "services" ] = nlohmann::json::object();
    status[ "services" ][ "chain" ]       = _chain != nullptr;
    status[ "services" ][ "block_store" ] = _block_store != nullptr;
    status[ "services" ][ "mempool" ]     = _mempool != nullptr;
    status[ "services" ][ "contract_meta_store" ] = _contract_meta != nullptr;
    status[ "services" ][ "transaction_store" ]   = _tx_store != nullptr;
    status[ "services" ][ "account_history" ]     = _acct_history != nullptr;

    return status;
  }

  throw std::runtime_error( "Unknown service: " + service );
}

// ---------------------------------------------------------------------------
// Chain dispatch
// ---------------------------------------------------------------------------

nlohmann::json JSONRPCServer::dispatch_chain( const std::string& method,
                                               const nlohmann::json& params )
{
  if( !_chain )
    throw std::runtime_error( "chain service not available" );

  if( method == "get_head_info" )
  {
    rpc::chain::get_head_info_request req;
    json_to_proto( params, req );
    auto resp = _chain->get_head_info( req );
    return nlohmann::json::parse( proto_to_json( resp ) );
  }
  if( method == "get_chain_id" )
  {
    rpc::chain::get_chain_id_request req;
    json_to_proto( params, req );
    auto resp = _chain->get_chain_id( req );
    return nlohmann::json::parse( proto_to_json( resp ) );
  }
  if( method == "get_fork_heads" )
  {
    rpc::chain::get_fork_heads_request req;
    json_to_proto( params, req );
    auto resp = _chain->get_fork_heads( req );
    return nlohmann::json::parse( proto_to_json( resp ) );
  }
  if( method == "get_account_nonce" )
  {
    rpc::chain::get_account_nonce_request req;
    json_to_proto( params, req );
    auto resp = _chain->get_account_nonce( req );
    return nlohmann::json::parse( proto_to_json( resp ) );
  }
  if( method == "get_account_rc" )
  {
    rpc::chain::get_account_rc_request req;
    json_to_proto( params, req );
    auto resp = _chain->get_account_rc( req );
    return nlohmann::json::parse( proto_to_json( resp ) );
  }
  if( method == "get_resource_limits" )
  {
    rpc::chain::get_resource_limits_request req;
    json_to_proto( params, req );
    auto resp = _chain->get_resource_limits( req );
    return nlohmann::json::parse( proto_to_json( resp ) );
  }
  if( method == "read_contract" )
  {
    rpc::chain::read_contract_request req;
    json_to_proto( params, req );
    auto resp = _chain->read_contract( req );
    return nlohmann::json::parse( proto_to_json( resp ) );
  }
  if( method == "submit_block" )
  {
    rpc::chain::submit_block_request req;
    json_to_proto( params, req );
    auto resp = _chain->submit_block( req );
    return nlohmann::json::parse( proto_to_json( resp ) );
  }
  if( method == "submit_transaction" )
  {
    rpc::chain::submit_transaction_request req;
    json_to_proto( params, req );
    auto resp = _chain->submit_transaction( req );
    return nlohmann::json::parse( proto_to_json( resp ) );
  }
  if( method == "invoke_system_call" )
  {
    rpc::chain::invoke_system_call_request req;
    json_to_proto( params, req );
    auto resp = _chain->invoke_system_call( req );
    return nlohmann::json::parse( proto_to_json( resp ) );
  }
  if( method == "propose_block" )
  {
    rpc::chain::propose_block_request req;
    json_to_proto( params, req );
    auto resp = _chain->propose_block( req );
    return nlohmann::json::parse( proto_to_json( resp ) );
  }

  throw std::runtime_error( "Unknown chain method: " + method );
}

// ---------------------------------------------------------------------------
// Block store dispatch
// ---------------------------------------------------------------------------

nlohmann::json JSONRPCServer::dispatch_block_store( const std::string& method,
                                                     const nlohmann::json& params )
{
  if( !_block_store )
    throw std::runtime_error( "block_store service not available" );

  if( method == "get_blocks_by_height" )
  {
    rpc::block_store::get_blocks_by_height_request req;
    json_to_proto( params, req );
    auto resp = _block_store->get_blocks_by_height( req );
    return nlohmann::json::parse( proto_to_json( resp ) );
  }
  if( method == "get_blocks_by_id" )
  {
    rpc::block_store::get_blocks_by_id_request req;
    json_to_proto( params, req );
    auto resp = _block_store->get_blocks_by_id( req );
    return nlohmann::json::parse( proto_to_json( resp ) );
  }
  if( method == "get_highest_block" )
  {
    rpc::block_store::get_highest_block_request req;
    json_to_proto( params, req );
    auto resp = _block_store->get_highest_block( req );
    return nlohmann::json::parse( proto_to_json( resp ) );
  }
  if( method == "add_block" )
  {
    rpc::block_store::add_block_request req;
    json_to_proto( params, req );
    auto resp = _block_store->add_block( req );
    return nlohmann::json::parse( proto_to_json( resp ) );
  }

  throw std::runtime_error( "Unknown block_store method: " + method );
}

// ---------------------------------------------------------------------------
// Mempool dispatch
// ---------------------------------------------------------------------------

nlohmann::json JSONRPCServer::dispatch_mempool( const std::string& method,
                                                 const nlohmann::json& params )
{
  if( !_mempool )
    throw std::runtime_error( "mempool service not available" );

  if( method == "get_pending_transactions" )
  {
    rpc::mempool::get_pending_transactions_request req;
    json_to_proto( params, req );
    auto resp = _mempool->get_pending_transactions( req );
    return nlohmann::json::parse( proto_to_json( resp ) );
  }
  if( method == "check_pending_account_resources" )
  {
    rpc::mempool::check_pending_account_resources_request req;
    json_to_proto( params, req );
    auto resp = _mempool->check_pending_account_resources( req );
    return nlohmann::json::parse( proto_to_json( resp ) );
  }
  if( method == "get_reserved_account_rc" )
  {
    rpc::mempool::get_reserved_account_rc_request req;
    json_to_proto( params, req );
    auto resp = _mempool->get_reserved_account_rc( req );
    return nlohmann::json::parse( proto_to_json( resp ) );
  }

  throw std::runtime_error( "Unknown mempool method: " + method );
}

// ---------------------------------------------------------------------------
// Contract meta store dispatch
// ---------------------------------------------------------------------------

nlohmann::json JSONRPCServer::dispatch_contract_meta_store( const std::string& method,
                                                             const nlohmann::json& params )
{
  if( !_contract_meta )
    throw std::runtime_error( "contract_meta_store service not available" );

  if( method == "get_contract_meta" )
  {
    rpc::contract_meta_store::get_contract_meta_request req;
    json_to_proto( params, req );
    auto resp = _contract_meta->get_contract_meta( req );
    return nlohmann::json::parse( proto_to_json( resp ) );
  }

  throw std::runtime_error( "Unknown contract_meta_store method: " + method );
}

// ---------------------------------------------------------------------------
// Transaction store dispatch
// ---------------------------------------------------------------------------

nlohmann::json JSONRPCServer::dispatch_transaction_store( const std::string& method,
                                                           const nlohmann::json& params )
{
  if( !_tx_store )
    throw std::runtime_error( "transaction_store service not available" );

  if( method == "get_transactions_by_id" )
  {
    rpc::transaction_store::get_transactions_by_id_request req;
    json_to_proto( params, req );
    auto resp = _tx_store->get_transactions_by_id( req );
    return nlohmann::json::parse( proto_to_json( resp ) );
  }

  throw std::runtime_error( "Unknown transaction_store method: " + method );
}

// ---------------------------------------------------------------------------
// Account history dispatch
// ---------------------------------------------------------------------------

nlohmann::json JSONRPCServer::dispatch_account_history( const std::string& method,
                                                         const nlohmann::json& params )
{
  if( !_acct_history )
    throw std::runtime_error( "account_history service not available" );

  if( method == "get_account_history" )
  {
    rpc::account_history::get_account_history_request req;
    json_to_proto( params, req );
    auto resp = _acct_history->get_account_history( req );
    return nlohmann::json::parse( proto_to_json( resp ) );
  }

  throw std::runtime_error( "Unknown account_history method: " + method );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

nlohmann::json JSONRPCServer::make_error( int code, const std::string& message, const nlohmann::json& id )
{
  return {
    { "jsonrpc", "2.0" },
    { "error", { { "code", code }, { "message", message } } },
    { "id", id }
  };
}

nlohmann::json JSONRPCServer::make_result( const nlohmann::json& result, const nlohmann::json& id )
{
  return {
    { "jsonrpc", "2.0" },
    { "result", result },
    { "id", id }
  };
}

std::string JSONRPCServer::proto_to_json( const google::protobuf::Message& msg )
{
  std::string json_str;
  google::protobuf::util::JsonPrintOptions opts;
  opts.preserve_proto_field_names   = true;
  opts.always_print_primitive_fields = false;
  auto status = google::protobuf::util::MessageToJsonString( msg, &json_str, opts );
  if( !status.ok() )
    return "{}";
  return json_str;
}

bool JSONRPCServer::json_to_proto( const nlohmann::json& params, google::protobuf::Message& msg )
{
  if( params.is_null() || ( params.is_object() && params.empty() ) )
    return true; // Empty params → default-initialized message

  auto json_str = params.dump();
  auto status   = google::protobuf::util::JsonStringToMessage( json_str, &msg );
  return status.ok();
}

} // namespace koinos::node::jsonrpc
