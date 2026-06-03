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

#include <chrono>
#include <cstdlib>
#include <future>
#include <iostream>
#include <mutex>

#include <boost/asio/post.hpp>
#include <koinos/log.hpp>
#include <koinos/protocol/protocol.pb.h>

// cpp-libp2p
#include <boost/di.hpp>
#include <boost/di/extension/scopes/shared.hpp>
#include <libp2p/common/literals.hpp>
#include <libp2p/common/types.hpp>
#include <libp2p/crypto/key_marshaller/key_marshaller_impl.hpp>
#include <libp2p/injector/host_injector.hpp>
#include <libp2p/log/logger.hpp>
#include <libp2p/muxer/yamux/yamux.hpp>
#include <soralog/impl/fallback_configurator.hpp>

namespace {

void prepare_libp2p_logging()
{
  static std::once_flag initialized;
  std::call_once( initialized, [] {
    auto logging_system = std::make_shared< soralog::LoggingSystem >(
      std::make_shared< soralog::FallbackConfigurator >( soralog::Level::ERROR ) );
    auto result = logging_system->configure();
    if( result.has_error )
      throw std::runtime_error( "Failed to configure cpp-libp2p logging: " + result.message );
    if( !result.message.empty() )
      std::cerr << result.message << std::endl;

    libp2p::log::setLoggingSystem( logging_system );
  } );

  libp2p::log::setLevelOfGroup(
    libp2p::log::defaultGroupName,
    std::getenv( "KOINOS_LIBP2P_TRACE" ) ? soralog::Level::TRACE : soralog::Level::ERROR );
}

} // namespace

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
  prepare_libp2p_logging();

  // Create libp2p host via injector. QUIC is disabled in the Koinos-compatible
  // cpp-libp2p build, so bind the transport stack to TCP only.
  auto injector = libp2p::injector::makeHostInjector< boost::di::extension::shared_config >(
    boost::di::bind< boost::asio::io_context >.to( _io )[ boost::di::override ],
    libp2p::injector::useLibp2pClientVersion( libp2p::Libp2pClientVersion{ _config.protocol_version } ),
    libp2p::injector::useLayerAdaptors<>(),
    libp2p::injector::useMuxerAdaptors< libp2p::muxer::Yamux >(),
    libp2p::injector::useTransportAdaptors< libp2p::transport::TcpTransport >() );

  _host = injector.create< std::shared_ptr< libp2p::Host > >();

  LOG( info ) << "[p2p/transport] Host peer ID: " << _host->getId().toBase58();
  LOG( info ) << "[p2p/transport] Advertised protocol version: " << _config.protocol_version;

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
      std::string address;
      if( !peer_info.addresses.empty() )
        address = std::string( peer_info.addresses.front().getStringAddress() );
      PeerID peer{ id_str, address };
      {
        std::lock_guard lock( _peers_mutex );
        _connected[ id_str ] = peer;
      }
      if( _on_connected )
        _on_connected( peer );
    }
  );

  // Create GossipSub
  auto gossip_config = libp2p::protocol::gossip::Config{};
  gossip_config.sign_messages = true;

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

    _host->connect( peer_info, [this, seed, id = peer_id_str.value()]( auto&& result ) {
      if( result.has_value() )
      {
        PeerID peer{ id, seed };
        {
          std::lock_guard lock( _peers_mutex );
          _connected[ id ] = peer;
        }
        if( _on_connected )
          _on_connected( peer );
        LOG( info ) << "[p2p/transport] Connected to seed: " << seed;
      }
      else
        LOG( warning ) << "[p2p/transport] Failed to connect to seed: " << seed
                       << " error=" << result.error().message();
    } );
  }

  // cpp-libp2p connection and muxer state is not safe to drive from multiple
  // io_context runners; keep all libp2p callbacks serialized on one thread.
  unsigned int thread_count = 1;
  if( _config.requested_io_threads != thread_count )
  {
    LOG( info ) << "[p2p/transport] Requested " << _config.requested_io_threads
                << " IO threads; using serialized cpp-libp2p runner count "
                << thread_count;
  }
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
  {
    std::lock_guard lock( _peers_mutex );
    if( _connected.count( peer.id ) || _connecting.count( peer.id ) )
      return;
    _connecting.insert( peer.id );
  }

  auto ma = libp2p::multi::Multiaddress::create( peer.address );
  if( !ma.has_value() )
  {
    std::lock_guard lock( _peers_mutex );
    _connecting.erase( peer.id );
    throw std::runtime_error( "Invalid multiaddr: " + peer.address );
  }

  auto peer_id_str = ma.value().getPeerId();
  if( !peer_id_str.has_value() )
  {
    std::lock_guard lock( _peers_mutex );
    _connecting.erase( peer.id );
    throw std::runtime_error( "Multiaddr has no peer ID: " + peer.address );
  }

  auto peer_id = libp2p::peer::PeerId::fromBase58( peer_id_str.value() );
  if( !peer_id.has_value() )
  {
    std::lock_guard lock( _peers_mutex );
    _connecting.erase( peer.id );
    throw std::runtime_error( "Invalid peer ID in multiaddr: " + peer.address );
  }

  libp2p::peer::PeerInfo peer_info{ peer_id.value(), { ma.value() } };
  _host->connect( peer_info, [this, peer]( auto&& result ) {
    {
      std::lock_guard lock( _peers_mutex );
      _connecting.erase( peer.id );
    }

    if( result.has_value() )
    {
      {
        std::lock_guard lock( _peers_mutex );
        _connected[ peer.id ] = peer;
      }
      if( _on_connected )
        _on_connected( peer );
    }
    else
      LOG( warning ) << "[p2p/transport] Failed to connect to peer: " << peer.address
                     << " error=" << result.error().message();
  } );
}

void Libp2pTransport::disconnect_peer( const PeerID& peer )
{
  auto pid = libp2p::peer::PeerId::fromBase58( peer.id );
  if( pid.has_value() )
    _host->disconnect( pid.value() );

  PeerID disconnected_peer = peer;
  bool was_connected       = false;
  {
    std::lock_guard lock( _peers_mutex );
    auto it = _connected.find( peer.id );
    if( it != _connected.end() )
    {
      disconnected_peer = it->second;
      _connected.erase( it );
      was_connected = true;
    }
  }

  if( was_connected && _on_disconnected )
    _on_disconnected( disconnected_peer );
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
  for( const auto& [id, peer]: _connected )
    result.push_back( peer );
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

  auto ma = libp2p::multi::Multiaddress::create( peer.address );
  if( !ma.has_value() )
    throw std::runtime_error( "Invalid multiaddr: " + peer.address );

  libp2p::peer::PeerInfo peer_info{ pid.value(), { ma.value() } };

  const auto timeout = std::chrono::seconds( 6 );

  // Open stream (async — block via promise)
  auto stream_promise = std::make_shared< std::promise< libp2p::StreamAndProtocolOrError > >();
  auto stream_future = stream_promise->get_future();

  boost::asio::post( *_io, [host = _host, peer_info, stream_promise]() {
    host->newStream(
      peer_info,
      { PEER_RPC_PROTOCOL },
      [stream_promise]( libp2p::StreamAndProtocolOrError result ) {
        stream_promise->set_value( std::move( result ) );
      }
    );
  } );

  if( stream_future.wait_for( timeout ) != std::future_status::ready )
    throw std::runtime_error( "Timed out opening Peer RPC stream to peer: " + peer.id );

  auto stream_result = stream_future.get();
  if( !stream_result.has_value() )
    throw std::runtime_error( "Failed to open stream to peer " + peer.id + ": "
                              + stream_result.error().message() );

  auto stream = std::move( stream_result.value().stream );

  // Write request
  auto request = gorpc::encode_request( service, method, msgpack_args );
  auto req_bytes = std::make_shared< libp2p::Bytes >( request.begin(), request.end() );

  auto write_promise = std::make_shared< std::promise< outcome::result< size_t > > >();
  auto write_future = write_promise->get_future();

  boost::asio::post( *_io, [stream, req_bytes, write_promise]() {
    stream->writeSome( *req_bytes, req_bytes->size(),
      [req_bytes, write_promise]( outcome::result< size_t > result ) {
        write_promise->set_value( std::move( result ) );
      }
    );
  } );

  if( write_future.wait_for( timeout ) != std::future_status::ready )
    throw std::runtime_error( "Timed out writing Peer RPC request" );

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
    auto read_promise = std::make_shared< std::promise< outcome::result< size_t > > >();
    auto read_future = read_promise->get_future();

    boost::asio::post( *_io, [stream, response_buf, read_promise]() {
      stream->readSome( *response_buf, response_buf->size(),
        [response_buf, read_promise]( outcome::result< size_t > result ) {
          read_promise->set_value( std::move( result ) );
        }
      );
    } );

    if( read_future.wait_for( timeout ) != std::future_status::ready )
      throw std::runtime_error( "Timed out reading Peer RPC response" );

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

  boost::asio::post( *_io, [stream]() {
    stream->close( []( auto&& ) {} );
  } );

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

      std::string response;
      try
      {
        if( !_on_peer_rpc_request )
          throw std::runtime_error( "peer RPC handler is not configured" );

        auto payload = _on_peer_rpc_request( request.service.name, request.service.method, request.args );
        response = gorpc::encode_success_response( request.service, payload );
      }
      catch( const std::exception& e )
      {
        response = gorpc::encode_error_response( request.service, e.what(), gorpc::ErrorType::server );
      }
      catch( ... )
      {
        response = gorpc::encode_error_response(
          request.service, "unknown peer RPC handler exception", gorpc::ErrorType::server );
      }

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
void Libp2pTransport::on_peer_rpc_request( PeerRpcRequestCallback cb ) { _on_peer_rpc_request = std::move( cb ); }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

PeerID Libp2pTransport::to_peer_id( const libp2p::peer::PeerId& pid )
{
  return { pid.toBase58(), "" };
}

} // namespace koinos::node::p2p

#endif // KOINOS_HAS_LIBP2P
