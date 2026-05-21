/**
 * cpp-libp2p transport implementation.
 *
 * Wire-compatible with Go koinos-p2p:
 * - GossipSub topics: koinos.blocks, koinos.transactions
 * - Peer RPC protocol: /koinos/peerrpc/1.0.0 with gorpc framing
 *   (two MessagePack objects: ServiceID header followed by args/body)
 * - Noise encryption, mplex/yamux muxing
 * - Ed25519 identity keys
 *
 * Compile with -DKOINOS_ENABLE_LIBP2P=ON
 */

#ifdef KOINOS_HAS_LIBP2P

#include "p2p/gorpc_codec.hpp"
#include "libp2p_transport.hpp"

#include <future>

#include <koinos/log.hpp>
#include <koinos/protocol/protocol.pb.h>

// cpp-libp2p
#include <libp2p/common/literals.hpp>
#include <libp2p/common/types.hpp>
#include <libp2p/crypto/key_marshaller/key_marshaller_impl.hpp>
#include <libp2p/injector/host_injector.hpp>

namespace koinos::node::p2p {

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

Libp2pTransport::Libp2pTransport( const Config& config ) : _config( config )
{
  _io = std::make_shared< boost::asio::io_context >();
}

Libp2pTransport::~Libp2pTransport()
{
  stop();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

void Libp2pTransport::start()
{
  _running = true;

  // Create libp2p host via injector. QUIC is disabled in the Koinos-compatible
  // cpp-libp2p build, so bind the transport stack to TCP only.
  auto injector = libp2p::injector::makeHostInjector(
    libp2p::injector::useTransportAdaptors< libp2p::transport::TcpTransport >() );

  _host = injector.create< std::shared_ptr< libp2p::Host > >();

  // Parse listen address
  auto listen_ma = libp2p::multi::Multiaddress::create( _config.listen_address );
  if( listen_ma.has_value() )
  {
    _host->listen( listen_ma.value() );
    LOG( info ) << "[p2p/transport] Listening on " << _config.listen_address;
  }

  // Register peer RPC protocol handler (server side)
  _host->setProtocolHandler(
    { PEER_RPC_PROTOCOL },
    [this]( libp2p::StreamAndProtocol stream_and_proto ) {
      handle_incoming_rpc( std::move( stream_and_proto.stream ) );
    }
  );

  // Set up connection handler via Host
  _host->setOnNewConnectionHandler(
    [this]( libp2p::peer::PeerInfo&& peer_info ) {
      auto id_str = peer_info.id.toBase58();
      {
        std::lock_guard lock( _peers_mutex );
        _connected.emplace( id_str, peer_info.id );
      }
      if( _on_connected )
        _on_connected( PeerID{ id_str, "" } );
    }
  );

  // Create GossipSub
  auto gossip_config = libp2p::protocol::gossip::Config{};

  _gossip = libp2p::protocol::gossip::create(
    injector.create< std::shared_ptr< libp2p::basic::Scheduler > >(),
    _host,
    injector.create< std::shared_ptr< libp2p::peer::IdentityManager > >(),
    injector.create< std::shared_ptr< libp2p::crypto::CryptoProvider > >(),
    injector.create< std::shared_ptr< libp2p::crypto::marshaller::KeyMarshaller > >(),
    gossip_config );

  // Subscribe to block topic
  _block_sub = _gossip->subscribe(
    { BLOCK_TOPIC },
    [this]( libp2p::protocol::gossip::Gossip::SubscriptionData msg ) {
      if( msg )
      {
        auto& m = msg.value();
        auto peer_id = libp2p::peer::PeerId::fromBytes( m.from );
        if( peer_id.has_value() )
          on_gossip_message( std::string( m.topic ),
                             std::string( m.data.begin(), m.data.end() ),
                             peer_id.value() );
      }
    }
  );

  // Subscribe to transaction topic
  _tx_sub = _gossip->subscribe(
    { TRANSACTION_TOPIC },
    [this]( libp2p::protocol::gossip::Gossip::SubscriptionData msg ) {
      if( msg )
      {
        auto& m = msg.value();
        auto peer_id = libp2p::peer::PeerId::fromBytes( m.from );
        if( peer_id.has_value() )
          on_gossip_message( std::string( m.topic ),
                             std::string( m.data.begin(), m.data.end() ),
                             peer_id.value() );
      }
    }
  );

  _gossip->start();

  // Start host
  _host->start();

  // Connect to seed peers
  for( const auto& seed: _config.seed_peers )
  {
    auto ma = libp2p::multi::Multiaddress::create( seed );
    if( !ma.has_value() )
      continue;

    auto peer_id_str = ma.value().getPeerId();
    if( !peer_id_str.has_value() )
      continue;

    auto peer_id = libp2p::peer::PeerId::fromBase58( peer_id_str.value() );
    if( !peer_id.has_value() )
      continue;

    libp2p::peer::PeerInfo peer_info{ peer_id.value(), { ma.value() } };

    _host->connect( peer_info, [seed]( auto&& result ) {
      if( result.has_value() )
        LOG( info ) << "[p2p/transport] Connected to seed: " << seed;
      else
        LOG( warning ) << "[p2p/transport] Failed to connect to seed: " << seed;
    } );
  }

  // Run IO threads
  unsigned int thread_count = std::max( 2u, std::thread::hardware_concurrency() / 2 );
  for( unsigned int i = 0; i < thread_count; ++i )
    _io_threads.emplace_back( [this]() { _io->run(); } );

  LOG( info ) << "[p2p/transport] Started with " << thread_count << " IO threads";
}

void Libp2pTransport::stop()
{
  if( !_running.exchange( false ) )
    return;

  _block_sub.reset();
  _tx_sub.reset();

  if( _gossip )
    _gossip->stop();

  if( _host )
    _host->stop();

  _io->stop();
  for( auto& t: _io_threads )
    if( t.joinable() )
      t.join();
  _io_threads.clear();
}

// ---------------------------------------------------------------------------
// Peer management
// ---------------------------------------------------------------------------

void Libp2pTransport::connect_peer( const PeerID& peer )
{
  auto ma = libp2p::multi::Multiaddress::create( peer.address );
  if( !ma.has_value() )
    throw std::runtime_error( "Invalid multiaddr: " + peer.address );

  auto peer_id_str = ma.value().getPeerId();
  if( !peer_id_str.has_value() )
    throw std::runtime_error( "Multiaddr has no peer ID: " + peer.address );

  auto peer_id = libp2p::peer::PeerId::fromBase58( peer_id_str.value() );
  if( !peer_id.has_value() )
    throw std::runtime_error( "Invalid peer ID in multiaddr: " + peer.address );

  libp2p::peer::PeerInfo peer_info{ peer_id.value(), { ma.value() } };
  _host->connect( peer_info, []( auto&& ) {} );
}

void Libp2pTransport::disconnect_peer( const PeerID& peer )
{
  auto pid = libp2p::peer::PeerId::fromBase58( peer.id );
  if( pid.has_value() )
    _host->disconnect( pid.value() );
}

uint32_t Libp2pTransport::connected_peer_count() const
{
  std::lock_guard lock( _peers_mutex );
  return static_cast< uint32_t >( _connected.size() );
}

std::vector< PeerID > Libp2pTransport::connected_peers() const
{
  std::lock_guard lock( _peers_mutex );
  std::vector< PeerID > result;
  for( const auto& [id, pid]: _connected )
    result.push_back( { id, "" } );
  return result;
}

// ---------------------------------------------------------------------------
// GossipSub publish
// ---------------------------------------------------------------------------

void Libp2pTransport::publish_block( const protocol::block& block )
{
  if( !_gossip || !_running )
    return;

  std::string data;
  if( block.SerializeToString( &data ) )
    _gossip->publish( BLOCK_TOPIC, libp2p::Bytes( data.begin(), data.end() ) );
}

void Libp2pTransport::publish_transaction( const protocol::transaction& tx )
{
  if( !_gossip || !_running )
    return;

  std::string data;
  if( tx.SerializeToString( &data ) )
    _gossip->publish( TRANSACTION_TOPIC, libp2p::Bytes( data.begin(), data.end() ) );
}

void Libp2pTransport::on_gossip_message( const std::string& topic,
                                          const std::string& data,
                                          const libp2p::peer::PeerId& from )
{
  PeerID pid = to_peer_id( from );

  if( topic == BLOCK_TOPIC && _on_block )
  {
    ::koinos::protocol::block block;
    if( block.ParseFromString( data ) )
      _on_block( pid, block );
  }
  else if( topic == TRANSACTION_TOPIC && _on_tx )
  {
    ::koinos::protocol::transaction tx;
    if( tx.ParseFromString( data ) )
      _on_tx( pid, tx );
  }
}

// ---------------------------------------------------------------------------
// GossipSub setup (now inlined into start())
// ---------------------------------------------------------------------------

void Libp2pTransport::setup_gossipsub()
{
  // Intentionally empty — gossip is set up in start() where injector is available
}

// ---------------------------------------------------------------------------
// Peer RPC (gorpc-compatible framing over libp2p streams)
// ---------------------------------------------------------------------------

std::string Libp2pTransport::send_peer_rpc( const PeerID& peer,
                                              const std::string& service,
                                              const std::string& method,
                                              const std::string& msgpack_args )
{
  auto pid = libp2p::peer::PeerId::fromBase58( peer.id );
  if( !pid.has_value() )
    throw std::runtime_error( "Invalid peer ID: " + peer.id );

  // Open stream (async — block via promise)
  std::promise< libp2p::StreamAndProtocolOrError > stream_promise;
  auto stream_future = stream_promise.get_future();

  _host->newStream(
    pid.value(),
    { PEER_RPC_PROTOCOL },
    [&stream_promise]( libp2p::StreamAndProtocolOrError result ) {
      stream_promise.set_value( std::move( result ) );
    }
  );

  auto stream_result = stream_future.get();
  if( !stream_result.has_value() )
    throw std::runtime_error( "Failed to open stream to peer: " + peer.id );

  auto stream = std::move( stream_result.value().stream );

  // Write request
  auto request = gorpc::encode_request( service, method, msgpack_args );
  libp2p::Bytes req_bytes( request.begin(), request.end() );

  std::promise< outcome::result< size_t > > write_promise;
  auto write_future = write_promise.get_future();

  stream->writeSome( req_bytes, req_bytes.size(),
    [&write_promise]( outcome::result< size_t > result ) {
      write_promise.set_value( std::move( result ) );
    }
  );

  auto write_result = write_future.get();
  if( !write_result.has_value() )
    throw std::runtime_error( "Failed to write RPC request" );

  // Read response
  std::string response_raw;
  constexpr size_t read_chunk_size = 64 * 1024;
  constexpr size_t max_response_size = 64 * 1024 * 1024;
  gorpc::Response decoded_response;

  while( true )
  {
    auto response_buf = std::make_shared< libp2p::Bytes >( read_chunk_size );
    std::promise< outcome::result< size_t > > read_promise;
    auto read_future = read_promise.get_future();

    stream->readSome( *response_buf, response_buf->size(),
      [&read_promise]( outcome::result< size_t > result ) {
        read_promise.set_value( std::move( result ) );
      }
    );

    auto read_result = read_future.get();
    if( !read_result.has_value() )
      throw std::runtime_error( "Failed to read RPC response" );

    auto bytes_read = read_result.value();
    if( bytes_read == 0 )
      throw std::runtime_error( "Peer RPC stream closed before complete response" );

    response_raw.append( response_buf->begin(), response_buf->begin() + bytes_read );

    try
    {
      decoded_response = gorpc::decode_response( response_raw );
      break;
    }
    catch( const gorpc::DecodeError& e )
    {
      if( !e.truncated() )
        throw;
      if( response_raw.size() >= max_response_size )
        throw std::runtime_error( "Peer RPC response exceeds maximum size" );
    }
  }

  stream->close( []( auto&& ) {} );

  if( !decoded_response.header.error.empty() )
    throw std::runtime_error( "Peer RPC error: " + decoded_response.header.error );

  return decoded_response.payload;
}

void Libp2pTransport::handle_incoming_rpc(
  std::shared_ptr< libp2p::connection::Stream > stream )
{
  auto buf = std::make_shared< libp2p::Bytes >( 64 * 1024 );
  stream->readSome( *buf, buf->size(),
    [this, stream, buf]( outcome::result< size_t > read_result ) {
      if( !read_result.has_value() )
        return;

      std::string raw( buf->begin(), buf->begin() + read_result.value() );
      gorpc::DecodedRequest request;
      try
      {
        request = gorpc::decode_request( raw );
      }
      catch( const std::exception& e )
      {
        gorpc::ServiceID unknown{ "unknown", "unknown" };
        auto error = gorpc::encode_error_response( unknown, e.what(), gorpc::ErrorType::server );
        auto error_bytes = std::make_shared< libp2p::Bytes >( error.begin(), error.end() );
        stream->writeSome( *error_bytes, error_bytes->size(),
          [stream, error_bytes]( auto&& ) {
            stream->close( []( auto&& ) {} );
          }
        );
        return;
      }

      LOG( debug ) << "[p2p/transport] Incoming RPC: "
                   << request.service.name << "." << request.service.method;

      // Respond with empty success (P2PNode will provide real routing later)
      auto response = gorpc::encode_success_response(
        request.service,
        gorpc::encode_empty_request() );

      auto resp_bytes = std::make_shared< libp2p::Bytes >( response.begin(), response.end() );

      stream->writeSome( *resp_bytes, resp_bytes->size(),
        [stream, resp_bytes]( auto&& ) {
          stream->close( []( auto&& ) {} );
        }
      );
    }
  );
}

// ---------------------------------------------------------------------------
// Peer RPC methods
// ---------------------------------------------------------------------------

std::string Libp2pTransport::peer_get_chain_id( const PeerID& peer )
{
  auto payload = send_peer_rpc( peer, "PeerRPCService", "GetChainID", gorpc::encode_empty_request() );
  return gorpc::decode_id_response( payload );
}

PeerHeadInfo Libp2pTransport::peer_get_head_block( const PeerID& peer )
{
  auto payload = send_peer_rpc( peer, "PeerRPCService", "GetHeadBlock", gorpc::encode_empty_request() );
  auto decoded = gorpc::decode_head_block_response( payload );

  PeerHeadInfo info;
  info.block_id = std::move( decoded.id );
  info.height = decoded.height;
  return info;
}

std::string Libp2pTransport::peer_get_ancestor_block_id( const PeerID& peer,
                                                          const std::string& head_id,
                                                          uint64_t height )
{
  auto request = gorpc::encode_get_ancestor_block_id_request( head_id, height );
  auto payload = send_peer_rpc( peer, "PeerRPCService", "GetAncestorBlockID", request );
  return gorpc::decode_id_response( payload );
}

std::vector< ::koinos::protocol::block >
Libp2pTransport::peer_get_blocks( const PeerID& peer,
                                   const std::string& head_id,
                                   uint64_t start_height,
                                   uint32_t count )
{
  auto request = gorpc::encode_get_blocks_request( head_id, start_height, count );
  auto payload = send_peer_rpc( peer, "PeerRPCService", "GetBlocks", request );
  auto block_payloads = gorpc::decode_blocks_response( payload );
  if( block_payloads.size() != count )
    throw std::runtime_error( "Peer returned unexpected number of blocks" );

  std::vector< ::koinos::protocol::block > blocks;
  blocks.reserve( block_payloads.size() );
  for( const auto& block_payload: block_payloads )
  {
    ::koinos::protocol::block block;
    if( !block.ParseFromString( block_payload ) )
      throw std::runtime_error( "Failed to deserialize peer RPC block response" );
    blocks.push_back( std::move( block ) );
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

void Libp2pTransport::on_peer_connected( PeerConnectedCallback cb ) { _on_connected = std::move( cb ); }
void Libp2pTransport::on_peer_disconnected( PeerDisconnectedCallback cb ) { _on_disconnected = std::move( cb ); }
void Libp2pTransport::on_block_received( BlockReceivedCallback cb ) { _on_block = std::move( cb ); }
void Libp2pTransport::on_transaction_received( TxReceivedCallback cb ) { _on_tx = std::move( cb ); }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

PeerID Libp2pTransport::to_peer_id( const libp2p::peer::PeerId& pid )
{
  return { pid.toBase58(), "" };
}

} // namespace koinos::node::p2p

#endif // KOINOS_HAS_LIBP2P
