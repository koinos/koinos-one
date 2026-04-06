#include "p2p_node.hpp"

#include <chrono>

namespace koinos::node::p2p {

P2PNode::P2PNode( const P2POptions& opts,
                  IChain* chain,
                  IBlockStore* block_store,
                  EventBus* event_bus,
                  std::unique_ptr< ITransport > transport )
    : _opts( opts ),
      _chain( chain ),
      _block_store( block_store ),
      _event_bus( event_bus ),
      _transport( std::move( transport ) ),
      _error_handler( opts )
{
}

P2PNode::~P2PNode()
{
  stop();
}

void P2PNode::start()
{
  _running = true;

  // Get our chain ID
  if( _chain )
  {
    auto resp = _chain->get_chain_id();
    _chain_id = resp.chain_id();
    LOG( info ) << "[p2p] Chain ID: " << _chain_id.substr( 0, 16 ) << "...";
  }

  // Set up transport callbacks
  _transport->on_peer_connected( [this]( const PeerID& p ) { on_peer_connected( p ); } );
  _transport->on_peer_disconnected( [this]( const PeerID& p ) { on_peer_disconnected( p ); } );
  _transport->on_block_received( [this]( const PeerID& p, const protocol::block& b ) { on_gossip_block( p, b ); } );
  _transport->on_transaction_received(
    [this]( const PeerID& p, const protocol::transaction& t ) { on_gossip_transaction( p, t ); } );

  // Set up gossip toggle
  _gossip_toggle = std::make_unique< GossipToggle >(
    _opts,
    [this]( bool enabled ) {
      if( _event_bus )
        _event_bus->on_gossip_status( enabled );
    },
    [this]() -> uint32_t { return _transport->connected_peer_count(); } );

  // Subscribe to EventBus
  if( _event_bus )
  {
    _event_bus->on_block_accepted.connect( [this]( const broadcast::block_accepted& ba ) { on_block_accepted( ba ); } );
    _event_bus->on_block_irreversible.connect(
      [this]( const broadcast::block_irreversible& bi ) { on_block_irreversible( bi ); } );
  }

  // Start transport
  _transport->start();

  // Start gossip toggle
  _gossip_toggle->start();

  // Start seed peer reconnection loop
  _reconnect_thread = std::thread( [this]() {
    while( _running )
    {
      for( const auto& seed: _seed_peers )
      {
        if( !_running )
          break;
        if( !_error_handler.can_connect( seed.address ) )
          continue;

        // Check if already connected
        bool found = false;
        {
          std::lock_guard lock( _peers_mutex );
          found = _peers.count( seed.id ) > 0;
        }
        if( !found )
        {
          try
          {
            _transport->connect_peer( seed );
          }
          catch( const std::exception& e )
          {
            LOG( debug ) << "[p2p] Seed reconnect failed for " << seed.id << ": " << e.what();
          }
        }
      }

      // Sleep 10s between reconnect attempts
      for( int i = 0; i < 100 && _running; ++i )
        std::this_thread::sleep_for( std::chrono::milliseconds( 100 ) );
    }
  } );

  LOG( info ) << "[p2p] Started with " << _seed_peers.size() << " seed peers";
}

void P2PNode::stop()
{
  if( !_running.exchange( false ) )
    return;

  if( _gossip_toggle )
    _gossip_toggle->stop();

  // Cancel all peer sync threads
  {
    std::lock_guard lock( _peers_mutex );
    for( auto& [id, state]: _peers )
    {
      if( state->sync_thread.joinable() )
        state->sync_thread.detach(); // Will exit via _running check
    }
    _peers.clear();
  }

  if( _reconnect_thread.joinable() )
    _reconnect_thread.join();

  _transport->stop();
}

uint32_t P2PNode::connected_peer_count() const
{
  return _transport->connected_peer_count();
}

// ---------------------------------------------------------------------------
// Peer lifecycle
// ---------------------------------------------------------------------------

void P2PNode::on_peer_connected( const PeerID& peer )
{
  std::lock_guard lock( _peers_mutex );

  if( _peers.count( peer.id ) )
    return; // Already connected

  auto state = std::make_unique< PeerState >();
  state->peer = peer;

  // Start sync loop in dedicated thread
  auto* raw_state = state.get();
  state->sync_thread = std::thread( [this, p = peer]() { peer_sync_loop( p ); } );

  _peers[ peer.id ] = std::move( state );
  LOG( info ) << "[p2p] Peer connected: " << peer.id;
}

void P2PNode::on_peer_disconnected( const PeerID& peer )
{
  std::lock_guard lock( _peers_mutex );

  auto it = _peers.find( peer.id );
  if( it == _peers.end() )
    return;

  if( it->second->sync_thread.joinable() )
    it->second->sync_thread.detach();

  _peers.erase( it );
  LOG( info ) << "[p2p] Peer disconnected: " << peer.id;
}

// ---------------------------------------------------------------------------
// Sync protocol (per-peer thread)
// ---------------------------------------------------------------------------

void P2PNode::peer_sync_loop( PeerID peer )
{
  // Handshake with retries
  while( _running )
  {
    try
    {
      if( peer_handshake( peer ) )
        break;
    }
    catch( const std::exception& e )
    {
      report_peer_error( peer, e.what(), _opts.score_peer_rpc_error );
    }

    // Backoff
    for( int i = 0; i < 60 && _running; ++i )
      std::this_thread::sleep_for( std::chrono::milliseconds( 100 ) );
  }

  // Sync loop
  bool is_synced = false;
  while( _running )
  {
    try
    {
      request_sync_blocks( peer, is_synced );
    }
    catch( const std::exception& e )
    {
      report_peer_error( peer, e.what(), _opts.score_peer_rpc_error );
    }

    auto sleep_time = is_synced ? _opts.sync_check_interval : _opts.syncing_check_interval;
    auto sleep_ms = std::chrono::duration_cast< std::chrono::milliseconds >( sleep_time ).count();
    for( int64_t i = 0; i < sleep_ms / 100 && _running; ++i )
      std::this_thread::sleep_for( std::chrono::milliseconds( 100 ) );
  }
}

bool P2PNode::peer_handshake( const PeerID& peer )
{
  // Verify chain ID matches
  auto peer_chain_id = _transport->peer_get_chain_id( peer );
  if( peer_chain_id != _chain_id )
  {
    report_peer_error( peer, "chain ID mismatch", _opts.score_chain_id_mismatch );
    return false;
  }

  LOG( info ) << "[p2p] Handshake complete with " << peer.id;
  return true;
}

bool P2PNode::request_sync_blocks( const PeerID& peer, bool& is_synced )
{
  if( !_chain || !_block_store )
    return false;

  uint64_t lib = _lib_height.load();

  // Get peer's head
  auto peer_head = _transport->peer_get_head_block( peer );
  if( peer_head.height <= lib )
  {
    is_synced = true;
    return true;
  }

  // Verify chain connectivity
  if( lib > 0 )
  {
    auto head_info = _chain->get_head_info();
    auto lib_id = head_info.head_topology().id(); // Simplified — should use LIB ID

    auto ancestor_id = _transport->peer_get_ancestor_block_id( peer, peer_head.block_id, lib );
    if( ancestor_id != lib_id )
    {
      report_peer_error( peer, "chain not connected", _opts.score_chain_not_connected );
      return false;
    }
  }

  // Calculate batch
  uint64_t blocks_needed = peer_head.height - lib;
  uint32_t batch = std::min( static_cast< uint64_t >( _opts.block_request_batch_size ), blocks_needed );

  // Fetch blocks
  auto blocks = _transport->peer_get_blocks( peer, peer_head.block_id, lib + 1, batch );

  if( blocks.empty() )
    return true;

  // Apply sequentially
  for( const auto& block: blocks )
  {
    if( !_running )
      return false;

    // Fork bomb check
    if( _fork_watchdog.check( block.id(), block.signature(), block.header().previous(), block.header().height() ) )
    {
      report_peer_error( peer, "fork bomb detected", _opts.score_fork_bomb );
      return false;
    }

    // Apply block via chain
    try
    {
      rpc::chain::submit_block_request req;
      *req.mutable_block() = block;
      _chain->submit_block( req );
    }
    catch( const std::exception& e )
    {
      LOG( warning ) << "[p2p] Block application failed at height "
                     << block.header().height() << ": " << e.what();
      report_peer_error( peer, std::string( "block application: " ) + e.what(), _opts.score_block_application );
      return false;
    }
  }

  // Update sync state
  uint64_t last_applied = blocks.back().header().height();
  is_synced = ( peer_head.height - last_applied ) < _opts.synced_block_delta;

  if( !is_synced )
  {
    LOG( info ) << "[p2p] Syncing from " << peer.id << " — applied "
                << blocks.size() << " blocks (height " << last_applied
                << "/" << peer_head.height << ")";
  }

  return true;
}

// ---------------------------------------------------------------------------
// Gossip handlers
// ---------------------------------------------------------------------------

void P2PNode::on_gossip_block( const PeerID& from, const protocol::block& block )
{
  if( block.id().empty() || !block.has_header() )
  {
    report_peer_error( from, "invalid gossiped block", _opts.score_deserialization );
    return;
  }

  // Check fork bomb
  if( _fork_watchdog.check( block.id(), block.signature(), block.header().previous(), block.header().height() ) )
  {
    report_peer_error( from, "fork bomb via gossip", _opts.score_fork_bomb );
    return;
  }

  // Check height >= LIB
  if( block.header().height() <= _lib_height.load() )
    return;

  // Apply
  if( _chain )
  {
    try
    {
      rpc::chain::submit_block_request req;
      *req.mutable_block() = block;
      _chain->submit_block( req );
    }
    catch( const std::exception& e )
    {
      report_peer_error( from, std::string( "gossip block: " ) + e.what(), _opts.score_block_application );
    }
  }
}

void P2PNode::on_gossip_transaction( const PeerID& from, const protocol::transaction& tx )
{
  if( tx.id().empty() )
  {
    report_peer_error( from, "invalid gossiped transaction", _opts.score_deserialization );
    return;
  }

  if( _chain )
  {
    try
    {
      rpc::chain::submit_transaction_request req;
      *req.mutable_transaction() = tx;
      _chain->submit_transaction( req );
    }
    catch( const std::exception& e )
    {
      report_peer_error( from, std::string( "gossip tx: " ) + e.what(), _opts.score_transaction_application );
    }
  }
}

// ---------------------------------------------------------------------------
// EventBus handlers
// ---------------------------------------------------------------------------

void P2PNode::on_block_accepted( const broadcast::block_accepted& ba )
{
  if( !ba.has_block() )
    return;

  // Update gossip toggle head time
  if( _gossip_toggle && ba.block().has_header() )
    _gossip_toggle->update_head_time( ba.block().header().timestamp() );

  // Gossip to peers if live block
  if( ba.live() && _gossip_toggle && _gossip_toggle->is_enabled() )
    _transport->publish_block( ba.block() );
}

void P2PNode::on_block_irreversible( const broadcast::block_irreversible& bi )
{
  _lib_height.store( bi.topology().height() );
  _fork_watchdog.purge_below( bi.topology().height() );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

void P2PNode::report_peer_error( const PeerID& peer, const std::string& error, uint64_t score )
{
  LOG( debug ) << "[p2p] Peer error from " << peer.id << ": " << error << " (score: " << score << ")";

  if( _error_handler.record_error( peer.address, score ) )
  {
    LOG( warning ) << "[p2p] Disconnecting peer " << peer.id << " (score threshold exceeded)";
    _transport->disconnect_peer( peer );
  }
}

} // namespace koinos::node::p2p
