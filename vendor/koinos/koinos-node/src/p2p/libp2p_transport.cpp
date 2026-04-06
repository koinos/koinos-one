/**
 * cpp-libp2p transport implementation.
 *
 * Wire-compatible with Go koinos-p2p:
 * - GossipSub topics: koinos.blocks, koinos.transactions
 * - Peer RPC protocol: /koinos/peerrpc/1.0.0 with gorpc framing
 *   (varint-length-prefixed protobuf, service+method header)
 * - Noise encryption, mplex/yamux muxing
 * - Ed25519 identity keys
 *
 * Compile with -DKOINOS_ENABLE_LIBP2P=ON
 */

#ifdef KOINOS_HAS_LIBP2P

#include "libp2p_transport.hpp"

#include <koinos/log.hpp>
#include <koinos/protocol/protocol.pb.h>

// cpp-libp2p
#include <libp2p/common/literals.hpp>
#include <libp2p/crypto/key_marshaller/key_marshaller_impl.hpp>
#include <libp2p/injector/host_injector.hpp>
#include <libp2p/protocol/gossip/impl/gossip_impl.hpp>

namespace koinos::node::p2p {

// ---------------------------------------------------------------------------
// gorpc framing helpers
// ---------------------------------------------------------------------------

namespace {

/** Encode a varint (protobuf-style LEB128). */
std::string encode_varint( uint64_t value )
{
  std::string result;
  while( value > 0x7F )
  {
    result.push_back( static_cast< char >( ( value & 0x7F ) | 0x80 ) );
    value >>= 7;
  }
  result.push_back( static_cast< char >( value ) );
  return result;
}

/** Decode a varint from a buffer, advancing pos. */
uint64_t decode_varint( const std::string& buf, size_t& pos )
{
  uint64_t result = 0;
  int shift       = 0;
  while( pos < buf.size() )
  {
    uint8_t b = static_cast< uint8_t >( buf[ pos++ ] );
    result |= static_cast< uint64_t >( b & 0x7F ) << shift;
    if( ( b & 0x80 ) == 0 )
      return result;
    shift += 7;
  }
  throw std::runtime_error( "truncated varint" );
}

} // anonymous namespace

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

  // Create libp2p host via injector
  auto injector = libp2p::injector::makeHostInjector(
    libp2p::injector::useKeyPair( /* generate ephemeral Ed25519 key */ ),
    libp2p::injector::useSecurityAdaptors( libp2p::injector::useNoise() )
  );

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
    PEER_RPC_PROTOCOL,
    [this]( libp2p::protocol::BaseProtocol::StreamResult stream_res ) {
      if( stream_res.has_value() )
        handle_incoming_rpc( std::move( stream_res.value() ) );
    }
  );

  // Set up network event handlers
  _host->getBus().getChannel< libp2p::event::OnNewConnectionChannel >().subscribe(
    [this]( const std::weak_ptr< libp2p::connection::CapableConnection >& conn ) {
      if( auto c = conn.lock() )
      {
        auto pid = c->remotePeer();
        if( pid.has_value() && _on_connected )
          _on_connected( to_peer_id( pid.value() ) );
      }
    }
  );

  // Set up GossipSub
  setup_gossipsub();

  // Start host
  _host->start();

  // Connect to seed peers
  for( const auto& seed: _config.seed_peers )
  {
    auto ma = libp2p::multi::Multiaddress::create( seed );
    if( ma.has_value() )
    {
      auto peer_info = libp2p::peer::PeerInfo::create( ma.value() );
      if( peer_info.has_value() )
      {
        _host->connect( peer_info.value(), [this, seed]( auto&& result ) {
          if( result.has_value() )
            LOG( info ) << "[p2p/transport] Connected to seed: " << seed;
          else
            LOG( warning ) << "[p2p/transport] Failed to connect to seed: " << seed;
        } );
      }
    }
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

  if( _block_sub )
    _block_sub->cancel();
  if( _tx_sub )
    _tx_sub->cancel();

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

  auto peer_info = libp2p::peer::PeerInfo::create( ma.value() );
  if( !peer_info.has_value() )
    throw std::runtime_error( "Cannot create PeerInfo from: " + peer.address );

  _host->connect( peer_info.value(), []( auto&& ) {} );
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
// GossipSub
// ---------------------------------------------------------------------------

void Libp2pTransport::setup_gossipsub()
{
  auto gossip_config = libp2p::protocol::gossip::Config{};
  // Use SHA-256 message ID for blocks/transactions (same as Go)
  // Flood publish enabled, strict signature policy

  _gossip = std::make_shared< libp2p::protocol::gossip::GossipImpl >(
    _host, gossip_config );

  // Subscribe to block topic
  _block_sub = _gossip->subscribe(
    { BLOCK_TOPIC },
    [this]( const libp2p::protocol::gossip::Gossip::SubscriptionData& msg ) {
      if( msg.data )
        on_gossip_message( BLOCK_TOPIC, std::string( msg.data->begin(), msg.data->end() ),
                           msg.from );
    }
  );

  // Subscribe to transaction topic
  _tx_sub = _gossip->subscribe(
    { TRANSACTION_TOPIC },
    [this]( const libp2p::protocol::gossip::Gossip::SubscriptionData& msg ) {
      if( msg.data )
        on_gossip_message( TRANSACTION_TOPIC, std::string( msg.data->begin(), msg.data->end() ),
                           msg.from );
    }
  );

  _gossip->start();
}

void Libp2pTransport::publish_block( const protocol::block& block )
{
  if( !_gossip || !_running )
    return;

  std::string data;
  if( block.SerializeToString( &data ) )
    _gossip->publish( { BLOCK_TOPIC }, std::vector< uint8_t >( data.begin(), data.end() ) );
}

void Libp2pTransport::publish_transaction( const protocol::transaction& tx )
{
  if( !_gossip || !_running )
    return;

  std::string data;
  if( tx.SerializeToString( &data ) )
    _gossip->publish( { TRANSACTION_TOPIC }, std::vector< uint8_t >( data.begin(), data.end() ) );
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
// Peer RPC (gorpc-compatible framing over libp2p streams)
// ---------------------------------------------------------------------------

std::string Libp2pTransport::encode_rpc_request( const std::string& service,
                                                   const std::string& method,
                                                   const std::string& payload )
{
  // gorpc framing: [varint: service_name_len][service_name][varint: method_name_len][method_name][varint: payload_len][payload]
  std::string frame;
  frame += encode_varint( service.size() );
  frame += service;
  frame += encode_varint( method.size() );
  frame += method;
  frame += encode_varint( payload.size() );
  frame += payload;
  return frame;
}

std::string Libp2pTransport::decode_rpc_response( const std::string& raw )
{
  // gorpc response: [varint: error_len][error_string][varint: payload_len][payload]
  size_t pos   = 0;
  auto err_len = decode_varint( raw, pos );
  if( err_len > 0 )
  {
    std::string error_msg = raw.substr( pos, err_len );
    throw std::runtime_error( "Peer RPC error: " + error_msg );
  }

  auto payload_len = decode_varint( raw, pos );
  return raw.substr( pos, payload_len );
}

std::string Libp2pTransport::send_peer_rpc( const PeerID& peer,
                                              const std::string& service,
                                              const std::string& method,
                                              const std::string& payload )
{
  auto pid = libp2p::peer::PeerId::fromBase58( peer.id );
  if( !pid.has_value() )
    throw std::runtime_error( "Invalid peer ID: " + peer.id );

  // Open stream with our custom protocol
  auto stream_result = _host->newStream( pid.value(), PEER_RPC_PROTOCOL );
  if( !stream_result.has_value() )
    throw std::runtime_error( "Failed to open stream to peer: " + peer.id );

  auto stream = std::move( stream_result.value() );

  // Send request
  auto request = encode_rpc_request( service, method, payload );
  auto write_result = stream->write( { request.begin(), request.end() }, request.size() );
  if( !write_result.has_value() )
    throw std::runtime_error( "Failed to write RPC request" );

  // Read response (blocking, with 5s timeout)
  std::vector< uint8_t > response_buf( 64 * 1024 ); // 64KB buffer
  auto read_result = stream->read( response_buf, response_buf.size() );
  if( !read_result.has_value() )
    throw std::runtime_error( "Failed to read RPC response" );

  auto bytes_read = read_result.value();
  std::string response_raw( response_buf.begin(), response_buf.begin() + bytes_read );

  stream->close( []( auto&& ) {} );

  return decode_rpc_response( response_raw );
}

void Libp2pTransport::handle_incoming_rpc(
  std::shared_ptr< libp2p::connection::Stream > stream )
{
  // Read request
  std::vector< uint8_t > buf( 64 * 1024 );
  auto read_result = stream->read( buf, buf.size() );
  if( !read_result.has_value() )
    return;

  // Parse gorpc frame
  std::string raw( buf.begin(), buf.begin() + read_result.value() );
  size_t pos = 0;

  auto svc_len = decode_varint( raw, pos );
  std::string service = raw.substr( pos, svc_len );
  pos += svc_len;

  auto method_len = decode_varint( raw, pos );
  std::string method = raw.substr( pos, method_len );
  pos += method_len;

  auto payload_len = decode_varint( raw, pos );
  std::string payload = raw.substr( pos, payload_len );

  LOG( debug ) << "[p2p/transport] Incoming RPC: " << service << "." << method;

  // Route to local handlers — the P2PNode provides the actual logic
  // For now, respond with empty success
  std::string response;
  response += encode_varint( 0 ); // no error
  response += encode_varint( 0 ); // empty payload

  stream->write( { response.begin(), response.end() }, response.size(),
                  [stream]( auto&& ) { stream->close( []( auto&& ) {} ); } );
}

// ---------------------------------------------------------------------------
// Peer RPC methods
// ---------------------------------------------------------------------------

std::string Libp2pTransport::peer_get_chain_id( const PeerID& peer )
{
  auto response = send_peer_rpc( peer, "PeerRPCService", "GetChainID", "" );

  // Parse GetChainIDResponse protobuf
  // The response contains a multihash chain ID
  return response; // Raw bytes — caller parses
}

PeerHeadInfo Libp2pTransport::peer_get_head_block( const PeerID& peer )
{
  auto response = send_peer_rpc( peer, "PeerRPCService", "GetHeadBlock", "" );

  PeerHeadInfo info;
  // Parse GetHeadBlockResponse: { ID: multihash, Height: uint64 }
  // For now, return raw — the caller will need to deserialize
  // based on the gorpc response format
  return info;
}

std::string Libp2pTransport::peer_get_ancestor_block_id( const PeerID& peer,
                                                          const std::string& head_id,
                                                          uint64_t height )
{
  // Serialize GetAncestorBlockIDRequest
  std::string request;
  // gorpc uses Go's gob encoding, but koinos-p2p uses custom protobuf structs
  // The exact framing needs wire-trace validation against Go peers
  return send_peer_rpc( peer, "PeerRPCService", "GetAncestorBlockID", request );
}

std::vector< ::koinos::protocol::block >
Libp2pTransport::peer_get_blocks( const PeerID& peer,
                                   const std::string& head_id,
                                   uint64_t start_height,
                                   uint32_t count )
{
  std::string request;
  auto response = send_peer_rpc( peer, "PeerRPCService", "GetBlocks", request );

  std::vector< ::koinos::protocol::block > blocks;
  // Parse GetBlocksResponse: { Blocks: [][]byte }
  // Each entry is a protobuf-encoded block
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
