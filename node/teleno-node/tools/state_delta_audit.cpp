#include "block_store/block_store.hpp"
#include "core/config.hpp"
#include "storage/rocksdb_manager.hpp"

#include <koinos/chain/controller.hpp>
#include <koinos/chain/state.hpp>
#include <koinos/log.hpp>
#include <koinos/rpc/block_store/block_store_rpc.pb.h>
#include <koinos/rpc/chain/chain_rpc.pb.h>
#include <koinos/state_db/backends/rocksdb/rocksdb_backend.hpp>
#include <koinos/state_db/state_db.hpp>
#include <koinos/util/conversion.hpp>
#include <koinos/util/hex.hpp>

#include <google/protobuf/util/json_util.h>
#include <nlohmann/json.hpp>
#include <openssl/sha.h>

#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <map>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace fs = std::filesystem;
using json   = nlohmann::json;
using namespace koinos;

namespace {

struct Args
{
  fs::path source_basedir = "/Volumes/external/knodel-monolith-restore/basedir";
  fs::path audit_basedir;
  fs::path report_dir;
  fs::path progress_file;
  fs::path checkpoint_file;
  uint64_t start_height = 1;
  uint64_t end_height   = 0;
  uint64_t block_count  = 100;
  uint32_t batch_size   = 1000;
  bool full             = false;
  bool reuse_audit      = false;
  bool stored_only      = false;
  bool delta_replay     = false;
  bool delta_replay_force_remove_tombstones = true;
  bool memory_state     = false;
  bool inspect_height   = false;
  bool compare_replay_strategies = false;
  uint64_t inspect_target_height = 0;
  uint64_t compare_target_height = 0;
};

std::string utc_timestamp()
{
  auto now = std::chrono::system_clock::now();
  auto tt  = std::chrono::system_clock::to_time_t( now );
  std::tm tm{};
  gmtime_r( &tt, &tm );
  std::ostringstream out;
  out << std::put_time( &tm, "%Y-%m-%dT%H:%M:%SZ" );
  return out.str();
}

std::string safe_timestamp()
{
  auto now = std::chrono::system_clock::now();
  auto tt  = std::chrono::system_clock::to_time_t( now );
  std::tm tm{};
  gmtime_r( &tt, &tm );
  std::ostringstream out;
  out << std::put_time( &tm, "%Y%m%dT%H%M%SZ" );
  return out.str();
}

std::string read_file( const fs::path& path )
{
  std::ifstream input( path, std::ios::binary );
  if( !input )
    throw std::runtime_error( "failed to read " + path.string() );
  return { std::istreambuf_iterator< char >( input ), std::istreambuf_iterator< char >() };
}

void write_file( const fs::path& path, const std::string& content )
{
  fs::create_directories( path.parent_path() );
  std::ofstream output( path, std::ios::binary | std::ios::trunc );
  if( !output )
    throw std::runtime_error( "failed to write " + path.string() );
  output << content;
}

void append_jsonl( const fs::path& path, const json& value )
{
  fs::create_directories( path.parent_path() );
  std::ofstream output( path, std::ios::binary | std::ios::app );
  if( !output )
    throw std::runtime_error( "failed to append " + path.string() );
  output << value.dump() << "\n";
}

std::string sha256_hex( const std::string& input )
{
  unsigned char digest[ SHA256_DIGEST_LENGTH ];
  SHA256( reinterpret_cast< const unsigned char* >( input.data() ), input.size(), digest );
  std::ostringstream out;
  out << std::hex << std::setfill( '0' );
  for( unsigned char byte: digest )
    out << std::setw( 2 ) << static_cast< int >( byte );
  return out.str();
}

template< typename Repeated >
std::string repeated_message_hash( const Repeated& values )
{
  std::string data;
  for( const auto& value: values )
  {
    auto serialized = value.SerializeAsString();
    uint64_t size   = serialized.size();
    data.append( reinterpret_cast< const char* >( &size ), sizeof( size ) );
    data.append( serialized );
  }
  return sha256_hex( data );
}

std::string operation_type( const protocol::operation& op )
{
  switch( op.op_case() )
  {
    case protocol::operation::kUploadContract:
      return "upload_contract";
    case protocol::operation::kCallContract:
      return "call_contract";
    case protocol::operation::kSetSystemCall:
      return "set_system_call";
    case protocol::operation::kSetSystemContract:
      return "set_system_contract";
    case protocol::operation::OP_NOT_SET:
      return "not_set";
  }
  return "unknown";
}

json operation_summary( const protocol::operation& op )
{
  json summary = { { "type", operation_type( op ) } };
  switch( op.op_case() )
  {
    case protocol::operation::kUploadContract:
      summary[ "contract_id" ] = util::to_hex( op.upload_contract().contract_id() );
      summary[ "bytecode_size" ] = op.upload_contract().bytecode().size();
      summary[ "bytecode_sha256" ] = sha256_hex( op.upload_contract().bytecode() );
      summary[ "abi_size" ] = op.upload_contract().abi().size();
      summary[ "authorizes_call_contract" ] = op.upload_contract().authorizes_call_contract();
      summary[ "authorizes_transaction_application" ] =
        op.upload_contract().authorizes_transaction_application();
      summary[ "authorizes_upload_contract" ] = op.upload_contract().authorizes_upload_contract();
      break;
    case protocol::operation::kCallContract:
      summary[ "contract_id" ] = util::to_hex( op.call_contract().contract_id() );
      summary[ "entry_point" ] = op.call_contract().entry_point();
      summary[ "args_size" ] = op.call_contract().args().size();
      summary[ "args_sha256" ] = sha256_hex( op.call_contract().args() );
      break;
    case protocol::operation::kSetSystemCall:
      summary[ "call_id" ] = op.set_system_call().call_id();
      if( op.set_system_call().target().has_thunk_id() )
      {
        summary[ "target_type" ] = "thunk_id";
        summary[ "thunk_id" ] = op.set_system_call().target().thunk_id();
      }
      else if( op.set_system_call().target().has_system_call_bundle() )
      {
        summary[ "target_type" ] = "system_call_bundle";
        summary[ "contract_id" ] =
          util::to_hex( op.set_system_call().target().system_call_bundle().contract_id() );
        summary[ "entry_point" ] =
          op.set_system_call().target().system_call_bundle().entry_point();
      }
      break;
    case protocol::operation::kSetSystemContract:
      summary[ "contract_id" ] = util::to_hex( op.set_system_contract().contract_id() );
      summary[ "system_contract" ] = op.set_system_contract().system_contract();
      break;
    case protocol::operation::OP_NOT_SET:
      break;
  }
  return summary;
}

std::string delta_key_id( const protocol::state_delta_entry& entry )
{
  std::ostringstream out;
  out << ( entry.object_space().system() ? "system" : "user" )
      << ":" << entry.object_space().id()
      << ":" << util::to_hex( entry.object_space().zone() )
      << ":" << util::to_hex( entry.key() );
  return out.str();
}

json object_space_summary( const protocol::object_space& space )
{
  return {
    { "system", space.system() },
    { "id", space.id() },
    { "zone", util::to_hex( space.zone() ) },
  };
}

json delta_entry_summary( const protocol::state_delta_entry& entry, int index )
{
  json summary = {
    { "index", index },
    { "object_space", object_space_summary( entry.object_space() ) },
    { "key", util::to_hex( entry.key() ) },
    { "key_size", entry.key().size() },
    { "action", entry.has_value() ? "put" : "remove" },
  };
  if( entry.has_value() )
  {
    summary[ "value_size" ] = entry.value().size();
    summary[ "value_sha256" ] = sha256_hex( entry.value() );
    summary[ "value_prefix_hex" ] = util::to_hex( entry.value().substr( 0, std::min< size_t >( entry.value().size(), 48 ) ) );
  }
  return summary;
}

json delta_stats( const google::protobuf::RepeatedPtrField< protocol::state_delta_entry >& entries )
{
  json spaces = json::object();
  json duplicates = json::array();
  std::map< std::string, json > seen;

  uint64_t puts = 0;
  uint64_t removes = 0;
  uint64_t total_value_bytes = 0;
  uint64_t max_value_size = 0;
  int max_value_index = -1;

  for( int i = 0; i < entries.size(); ++i )
  {
    const auto& entry = entries.Get( i );
    const auto key = delta_key_id( entry );
    const auto space_key =
      ( entry.object_space().system() ? std::string( "system" ) : std::string( "user" ) )
      + ":" + std::to_string( entry.object_space().id() )
      + ":" + util::to_hex( entry.object_space().zone() );

    if( !spaces.contains( space_key ) )
    {
      spaces[ space_key ] = {
        { "object_space", object_space_summary( entry.object_space() ) },
        { "count", 0 },
        { "puts", 0 },
        { "removes", 0 },
        { "value_bytes", 0 },
      };
    }
    spaces[ space_key ][ "count" ] = spaces[ space_key ][ "count" ].get< uint64_t >() + 1;

    if( entry.has_value() )
    {
      ++puts;
      total_value_bytes += entry.value().size();
      spaces[ space_key ][ "puts" ] = spaces[ space_key ][ "puts" ].get< uint64_t >() + 1;
      spaces[ space_key ][ "value_bytes" ] = spaces[ space_key ][ "value_bytes" ].get< uint64_t >() + entry.value().size();
      if( entry.value().size() > max_value_size )
      {
        max_value_size = entry.value().size();
        max_value_index = i;
      }
    }
    else
    {
      ++removes;
      spaces[ space_key ][ "removes" ] = spaces[ space_key ][ "removes" ].get< uint64_t >() + 1;
    }

    if( seen.contains( key ) )
    {
      seen[ key ][ "count" ] = seen[ key ][ "count" ].get< uint64_t >() + 1;
      seen[ key ][ "last_index" ] = i;
      seen[ key ][ "last_action" ] = entry.has_value() ? "put" : "remove";
    }
    else
    {
      seen[ key ] = {
        { "object_space", object_space_summary( entry.object_space() ) },
        { "key", util::to_hex( entry.key() ) },
        { "count", 1 },
        { "first_index", i },
        { "last_index", i },
        { "first_action", entry.has_value() ? "put" : "remove" },
        { "last_action", entry.has_value() ? "put" : "remove" },
      };
    }
  }

  for( const auto& [ _, value ]: seen )
  {
    if( value.value( "count", 0 ) > 1 )
      duplicates.push_back( value );
  }

  return {
    { "count", entries.size() },
    { "puts", puts },
    { "removes", removes },
    { "total_value_bytes", total_value_bytes },
    { "max_value_size", max_value_size },
    { "max_value_index", max_value_index },
    { "delta_hash", repeated_message_hash( entries ) },
    { "object_spaces", spaces },
    { "duplicate_keys", duplicates },
  };
}

template< typename Repeated >
bool repeated_messages_equal( const Repeated& lhs, const Repeated& rhs )
{
  if( lhs.size() != rhs.size() )
    return false;
  for( int i = 0; i < lhs.size(); ++i )
  {
    if( lhs.Get( i ).SerializeAsString() != rhs.Get( i ).SerializeAsString() )
      return false;
  }
  return true;
}

template< typename Repeated >
int first_repeated_message_difference( const Repeated& lhs, const Repeated& rhs )
{
  const int limit = std::min( lhs.size(), rhs.size() );
  for( int i = 0; i < limit; ++i )
  {
    if( lhs.Get( i ).SerializeAsString() != rhs.Get( i ).SerializeAsString() )
      return i;
  }
  return lhs.size() == rhs.size() ? -1 : limit;
}

json topology_to_json( const koinos::block_topology& topology )
{
  return {
    { "id", util::to_hex( topology.id() ) },
    { "height", topology.height() },
    { "previous", util::to_hex( topology.previous() ) },
  };
}

json receipt_summary( const protocol::block_receipt& receipt )
{
  json tx_hashes = json::array();
  for( int i = 0; i < receipt.transaction_receipts_size(); ++i )
  {
    const auto& tx = receipt.transaction_receipts( i );
    tx_hashes.push_back( {
      { "index", i },
      { "id", util::to_hex( tx.id() ) },
      { "delta_count", tx.state_delta_entries_size() },
      { "delta_hash", repeated_message_hash( tx.state_delta_entries() ) },
    } );
  }

  return {
    { "id", util::to_hex( receipt.id() ) },
    { "state_merkle_root", util::to_hex( receipt.state_merkle_root() ) },
    { "delta_count", receipt.state_delta_entries_size() },
    { "delta_hash", repeated_message_hash( receipt.state_delta_entries() ) },
    { "transaction_receipt_count", receipt.transaction_receipts_size() },
    { "transaction_delta_hashes", tx_hashes },
  };
}

uint64_t receipt_delta_entry_count( const protocol::block_receipt& receipt )
{
  uint64_t count = static_cast< uint64_t >( receipt.state_delta_entries_size() );
  for( int i = 0; i < receipt.transaction_receipts_size(); ++i )
    count += static_cast< uint64_t >( receipt.transaction_receipts( i ).state_delta_entries_size() );
  return count;
}

using delta_entry_list = std::vector< const protocol::state_delta_entry* >;

void append_block_delta_entries( delta_entry_list& entries, const protocol::block_receipt& receipt )
{
  for( const auto& entry: receipt.state_delta_entries() )
    entries.push_back( &entry );
}

void append_transaction_delta_entries( delta_entry_list& entries, const protocol::block_receipt& receipt )
{
  for( const auto& tx_receipt: receipt.transaction_receipts() )
  {
    for( const auto& entry: tx_receipt.state_delta_entries() )
      entries.push_back( &entry );
  }
}

delta_entry_list block_delta_entries_not_in_transaction_receipts( const protocol::block_receipt& receipt )
{
  std::map< std::string, uint64_t > remaining_tx_entries;
  for( const auto& tx_receipt: receipt.transaction_receipts() )
  {
    for( const auto& entry: tx_receipt.state_delta_entries() )
      ++remaining_tx_entries[ entry.SerializeAsString() ];
  }

  delta_entry_list entries;
  for( const auto& entry: receipt.state_delta_entries() )
  {
    auto itr = remaining_tx_entries.find( entry.SerializeAsString() );
    if( itr != remaining_tx_entries.end() && itr->second > 0 )
    {
      --itr->second;
      continue;
    }
    entries.push_back( &entry );
  }
  return entries;
}

delta_entry_list transaction_delta_entries_not_in_block_receipt( const protocol::block_receipt& receipt )
{
  std::map< std::string, uint64_t > remaining_block_entries;
  for( const auto& entry: receipt.state_delta_entries() )
    ++remaining_block_entries[ entry.SerializeAsString() ];

  delta_entry_list entries;
  for( const auto& tx_receipt: receipt.transaction_receipts() )
  {
    for( const auto& entry: tx_receipt.state_delta_entries() )
    {
      auto itr = remaining_block_entries.find( entry.SerializeAsString() );
      if( itr != remaining_block_entries.end() && itr->second > 0 )
      {
        --itr->second;
        continue;
      }
      entries.push_back( &entry );
    }
  }
  return entries;
}

uint64_t exact_block_transaction_delta_overlap_count( const protocol::block_receipt& receipt )
{
  std::map< std::string, uint64_t > remaining_tx_entries;
  for( const auto& tx_receipt: receipt.transaction_receipts() )
  {
    for( const auto& entry: tx_receipt.state_delta_entries() )
      ++remaining_tx_entries[ entry.SerializeAsString() ];
  }

  uint64_t overlap = 0;
  for( const auto& entry: receipt.state_delta_entries() )
  {
    auto itr = remaining_tx_entries.find( entry.SerializeAsString() );
    if( itr != remaining_tx_entries.end() && itr->second > 0 )
    {
      --itr->second;
      ++overlap;
    }
  }
  return overlap;
}

chain::object_space to_chain_object_space( const protocol::object_space& protocol_space )
{
  chain::object_space object_space;
  object_space.set_system( protocol_space.system() );
  object_space.set_zone( protocol_space.zone() );
  object_space.set_id( protocol_space.id() );
  return object_space;
}

bool node_has_delta_entry_object( state_db::abstract_state_node_ptr node,
                                  const protocol::state_delta_entry& delta_entry )
{
  const auto object_space = to_chain_object_space( delta_entry.object_space() );
  return node->get_object( object_space, delta_entry.key() ) != nullptr;
}

void apply_delta_entry_to_node( state_db::abstract_state_node_ptr node,
                                const protocol::state_delta_entry& delta_entry,
                                bool force_remove_tombstone = false )
{
  const auto object_space = to_chain_object_space( delta_entry.object_space() );

  if( delta_entry.has_value() )
  {
    node->put_object( object_space, delta_entry.key(), &delta_entry.value() );
  }
  else
  {
    if( force_remove_tombstone && !node_has_delta_entry_object( node, delta_entry ) )
    {
      static const std::string empty_value;
      node->put_object( object_space, delta_entry.key(), &empty_value );
    }
    node->remove_object( object_space, delta_entry.key() );
  }
}

json replay_strategy_result( const std::string& name,
                             const std::string& description,
                             state_db::state_node_ptr parent_node,
                             const delta_entry_list& entries,
                             const std::string& expected_root,
                             bool force_remove_tombstones = false )
{
  auto replay_node = parent_node->create_anonymous_node();
  for( const auto* entry: entries )
    apply_delta_entry_to_node( replay_node, *entry, force_remove_tombstones );

  const auto root = util::converter::as< std::string >( replay_node->pending_merkle_root() );
  return {
    { "name", name },
    { "description", description },
    { "entry_count", entries.size() },
    { "force_remove_tombstones", force_remove_tombstones },
    { "computed_state_merkle_root", util::to_hex( root ) },
    { "matches_expected_next_previous_state_merkle_root", !expected_root.empty() && root == expected_root },
  };
}

json remove_entry_parent_checks( const std::string& source,
                                 state_db::state_node_ptr parent_node,
                                 const delta_entry_list& entries )
{
  json checks = json::array();
  for( size_t i = 0; i < entries.size(); ++i )
  {
    const auto* entry = entries[ i ];
    if( entry->has_value() )
      continue;
    checks.push_back( {
      { "source", source },
      { "entry_index", i },
      { "object_space", object_space_summary( entry->object_space() ) },
      { "key", util::to_hex( entry->key() ) },
      { "parent_has_object", node_has_delta_entry_object( parent_node, *entry ) },
    } );
  }
  return checks;
}

json compare_receipts( const protocol::block_receipt& stored, const protocol::block_receipt& regenerated )
{
  const bool merkle_comparable = !stored.state_merkle_root().empty() && !regenerated.state_merkle_root().empty();
  const bool merkle_match      = merkle_comparable && stored.state_merkle_root() == regenerated.state_merkle_root();
  const bool block_deltas_match = repeated_messages_equal( stored.state_delta_entries(), regenerated.state_delta_entries() );

  bool tx_deltas_match = stored.transaction_receipts_size() == regenerated.transaction_receipts_size();
  json tx_delta_difference;
  for( int i = 0; tx_deltas_match && i < stored.transaction_receipts_size(); ++i )
  {
    const auto& stored_tx      = stored.transaction_receipts( i );
    const auto& regenerated_tx = regenerated.transaction_receipts( i );
    if( !repeated_messages_equal( stored_tx.state_delta_entries(), regenerated_tx.state_delta_entries() ) )
    {
      tx_deltas_match = false;
      tx_delta_difference = {
        { "index", i },
        { "stored_id", util::to_hex( stored_tx.id() ) },
        { "regenerated_id", util::to_hex( regenerated_tx.id() ) },
        { "stored_delta_count", stored_tx.state_delta_entries_size() },
        { "regenerated_delta_count", regenerated_tx.state_delta_entries_size() },
        { "stored_delta_hash", repeated_message_hash( stored_tx.state_delta_entries() ) },
        { "regenerated_delta_hash", repeated_message_hash( regenerated_tx.state_delta_entries() ) },
        { "first_delta_difference", first_repeated_message_difference( stored_tx.state_delta_entries(), regenerated_tx.state_delta_entries() ) },
      };
    }
  }

  if( stored.transaction_receipts_size() != regenerated.transaction_receipts_size() )
  {
    tx_delta_difference = {
      { "reason", "transaction receipt count differs" },
      { "stored_count", stored.transaction_receipts_size() },
      { "regenerated_count", regenerated.transaction_receipts_size() },
    };
  }

  const bool ok = ( !merkle_comparable || merkle_match ) && block_deltas_match && tx_deltas_match;
  return {
    { "status", ok ? "ok" : "mismatch" },
    { "merkle_comparable", merkle_comparable },
    { "merkle_match", merkle_match },
    { "missing_stored_state_merkle_root", stored.state_merkle_root().empty() },
    { "missing_regenerated_state_merkle_root", regenerated.state_merkle_root().empty() },
    { "block_deltas_match", block_deltas_match },
    { "transaction_deltas_match", tx_deltas_match },
    { "stored", receipt_summary( stored ) },
    { "regenerated", receipt_summary( regenerated ) },
    { "first_block_delta_difference", block_deltas_match ? -1 : first_repeated_message_difference( stored.state_delta_entries(), regenerated.state_delta_entries() ) },
    { "transaction_delta_difference", tx_delta_difference.is_null() ? json::object() : tx_delta_difference },
  };
}

chain::genesis_data load_genesis( const fs::path& basedir )
{
  auto path = basedir / "chain" / "genesis_data.json";
  if( !fs::exists( path ) )
    path = basedir / "genesis_data.json";
  if( !fs::exists( path ) )
    throw std::runtime_error( "missing genesis_data.json under " + basedir.string() );

  chain::genesis_data genesis;
  auto status = google::protobuf::util::JsonStringToMessage( read_file( path ), &genesis );
  if( !status.ok() )
    throw std::runtime_error( "failed to parse genesis_data.json: " + status.ToString() );
  return genesis;
}

state_db::genesis_init_function make_audit_genesis_initializer( const chain::genesis_data& data )
{
  return [ data ]( state_db::state_node_ptr root )
  {
    for( const auto& entry: data.entries() )
    {
      if( root->get_object( entry.space(), entry.key() ) )
        throw std::runtime_error( "encountered unexpected object while initializing genesis state" );

      root->put_object( entry.space(), entry.key(), &entry.value() );
    }

    if( !root->get_object( chain::state::space::metadata(), chain::state::key::genesis_key ) )
      throw std::runtime_error( "could not find genesis public key in initialized state" );

    auto chain_id     = crypto::hash( crypto::multicodec::sha2_256, data );
    auto chain_id_str = util::converter::as< std::string >( chain_id );
    if( root->get_object( chain::state::space::metadata(), chain::state::key::chain_id ) )
      throw std::runtime_error( "encountered unexpected chain id while initializing genesis state" );

    root->put_object( chain::state::space::metadata(), chain::state::key::chain_id, &chain_id_str );
  };
}

void usage()
{
  std::cerr
    << "Usage: koinos_state_delta_audit --source-basedir <path> --audit-basedir <path> [--full|--block-count N]\n"
    << "       [--start-height N] [--end-height N] [--batch-size N] [--report-dir <path>] [--reuse-audit-basedir]\n"
    << "       [--stored-only|--delta-replay] [--memory-state] [--delta-replay-drop-absent-removes]\n"
    << "       [--inspect-height N]\n"
    << "       [--compare-replay-strategies-height N --audit-basedir <prestate-basedir>]\n";
}

Args parse_args( int argc, char** argv )
{
  Args args;
  for( int i = 1; i < argc; ++i )
  {
    std::string arg = argv[ i ];
    auto need_value = [&]( const std::string& name ) -> std::string {
      if( i + 1 >= argc )
        throw std::runtime_error( name + " requires a value" );
      return argv[ ++i ];
    };

    if( arg == "--help" || arg == "-h" )
    {
      usage();
      std::exit( 0 );
    }
    else if( arg == "--source-basedir" )
      args.source_basedir = need_value( arg );
    else if( arg == "--audit-basedir" )
      args.audit_basedir = need_value( arg );
    else if( arg == "--report-dir" )
      args.report_dir = need_value( arg );
    else if( arg == "--progress-file" )
      args.progress_file = need_value( arg );
    else if( arg == "--checkpoint-file" )
      args.checkpoint_file = need_value( arg );
    else if( arg == "--start-height" )
      args.start_height = std::stoull( need_value( arg ) );
    else if( arg == "--end-height" )
      args.end_height = std::stoull( need_value( arg ) );
    else if( arg == "--block-count" )
      args.block_count = std::stoull( need_value( arg ) );
    else if( arg == "--batch-size" )
      args.batch_size = static_cast< uint32_t >( std::stoul( need_value( arg ) ) );
    else if( arg == "--full" )
      args.full = true;
    else if( arg == "--reuse-audit-basedir" )
      args.reuse_audit = true;
    else if( arg == "--stored-only" )
      args.stored_only = true;
    else if( arg == "--delta-replay" )
      args.delta_replay = true;
    else if( arg == "--delta-replay-force-remove-tombstones" )
      args.delta_replay_force_remove_tombstones = true;
    else if( arg == "--delta-replay-drop-absent-removes" )
      args.delta_replay_force_remove_tombstones = false;
    else if( arg == "--memory-state" )
      args.memory_state = true;
    else if( arg == "--inspect-height" )
    {
      args.inspect_height = true;
      args.inspect_target_height = std::stoull( need_value( arg ) );
    }
    else if( arg == "--compare-replay-strategies-height" )
    {
      args.compare_replay_strategies = true;
      args.compare_target_height = std::stoull( need_value( arg ) );
    }
    else
      throw std::runtime_error( "unknown argument: " + arg );
  }

  if( args.stored_only && args.delta_replay )
    throw std::runtime_error( "--stored-only and --delta-replay are mutually exclusive" );
  if( args.inspect_height && args.compare_replay_strategies )
    throw std::runtime_error( "--inspect-height and --compare-replay-strategies-height are mutually exclusive" );
  if( args.compare_replay_strategies && ( args.stored_only || args.delta_replay || args.memory_state ) )
    throw std::runtime_error( "--compare-replay-strategies-height cannot be combined with scan/replay modes" );
  if( args.inspect_height && ( args.stored_only || args.delta_replay || args.memory_state ) )
    throw std::runtime_error( "--inspect-height cannot be combined with scan/replay modes" );
  if( args.memory_state && !args.delta_replay )
    throw std::runtime_error( "--memory-state requires --delta-replay" );
  if( !args.delta_replay_force_remove_tombstones && !args.delta_replay )
    throw std::runtime_error( "--delta-replay-drop-absent-removes requires --delta-replay" );
  if( args.memory_state && args.reuse_audit )
    throw std::runtime_error( "--memory-state cannot be resumed with --reuse-audit-basedir" );

  if( args.report_dir.empty() )
    args.report_dir = fs::path( "/Volumes/external/teleno-state-delta-audit/native-" + safe_timestamp() );
  if( args.audit_basedir.empty() )
    args.audit_basedir = args.report_dir / "audit-basedir";
  if( args.progress_file.empty() )
    args.progress_file = args.report_dir / "progress.jsonl";
  if( args.checkpoint_file.empty() )
    args.checkpoint_file = args.report_dir / "checkpoint.json";
  if( args.start_height == 0 )
    throw std::runtime_error( "--start-height must be positive" );
  if( args.inspect_height && args.inspect_target_height == 0 )
    throw std::runtime_error( "--inspect-height must be positive" );
  if( args.compare_replay_strategies && args.compare_target_height == 0 )
    throw std::runtime_error( "--compare-replay-strategies-height must be positive" );
  if( args.batch_size == 0 || args.batch_size > node::block_store::BlockStore::max_block_request )
    throw std::runtime_error( "--batch-size must be between 1 and 1000" );
  if( !args.stored_only && !args.memory_state && !args.inspect_height && !args.compare_replay_strategies
      && fs::exists( args.audit_basedir ) && !args.reuse_audit )
    throw std::runtime_error( "audit basedir already exists; pass --reuse-audit-basedir or choose a new path: " + args.audit_basedir.string() );
  if( !args.stored_only && !args.inspect_height && !args.compare_replay_strategies
      && args.start_height != 1 && !args.reuse_audit )
    throw std::runtime_error( "fresh audit basedirs must start at height 1" );
  return args;
}

json block_header_summary( const protocol::block& block )
{
  json approved = json::array();
  for( const auto& proposal: block.header().approved_proposals() )
    approved.push_back( util::to_hex( proposal ) );

  return {
    { "id", util::to_hex( block.id() ) },
    { "height", block.header().height() },
    { "previous", util::to_hex( block.header().previous() ) },
    { "timestamp", block.header().timestamp() },
    { "previous_state_merkle_root", util::to_hex( block.header().previous_state_merkle_root() ) },
    { "transaction_merkle_root", util::to_hex( block.header().transaction_merkle_root() ) },
    { "signer", util::to_hex( block.header().signer() ) },
    { "approved_proposals", approved },
    { "transaction_count", block.transactions_size() },
    { "signature_size", block.signature().size() },
  };
}

json transaction_summary( const protocol::transaction& tx, int index )
{
  json operations = json::array();
  for( int i = 0; i < tx.operations_size(); ++i )
  {
    auto op = operation_summary( tx.operations( i ) );
    op[ "index" ] = i;
    operations.push_back( op );
  }

  return {
    { "index", index },
    { "id", util::to_hex( tx.id() ) },
    { "payer", util::to_hex( tx.header().payer() ) },
    { "payee", util::to_hex( tx.header().payee() ) },
    { "rc_limit", tx.header().rc_limit() },
    { "nonce", util::to_hex( tx.header().nonce() ) },
    { "operation_merkle_root", util::to_hex( tx.header().operation_merkle_root() ) },
    { "operation_count", tx.operations_size() },
    { "signature_count", tx.signatures_size() },
    { "operations", operations },
  };
}

json transaction_receipt_detail( const protocol::transaction_receipt& receipt, int index )
{
  json logs = json::array();
  for( const auto& log: receipt.logs() )
    logs.push_back( log );

  return {
    { "index", index },
    { "id", util::to_hex( receipt.id() ) },
    { "payer", util::to_hex( receipt.payer() ) },
    { "max_payer_rc", receipt.max_payer_rc() },
    { "rc_limit", receipt.rc_limit() },
    { "rc_used", receipt.rc_used() },
    { "disk_storage_used", receipt.disk_storage_used() },
    { "network_bandwidth_used", receipt.network_bandwidth_used() },
    { "compute_bandwidth_used", receipt.compute_bandwidth_used() },
    { "reverted", receipt.reverted() },
    { "event_count", receipt.events_size() },
    { "logs", logs },
    { "state_delta_stats", delta_stats( receipt.state_delta_entries() ) },
  };
}

json block_receipt_detail( const protocol::block_receipt& receipt )
{
  json tx_receipts = json::array();
  for( int i = 0; i < receipt.transaction_receipts_size(); ++i )
    tx_receipts.push_back( transaction_receipt_detail( receipt.transaction_receipts( i ), i ) );

  json logs = json::array();
  for( const auto& log: receipt.logs() )
    logs.push_back( log );

  json entries = json::array();
  constexpr int max_entries_to_dump = 500;
  const int entries_to_dump = std::min( receipt.state_delta_entries_size(), max_entries_to_dump );
  for( int i = 0; i < entries_to_dump; ++i )
    entries.push_back( delta_entry_summary( receipt.state_delta_entries( i ), i ) );

  return {
    { "summary", receipt_summary( receipt ) },
    { "height", receipt.height() },
    { "disk_storage_used", receipt.disk_storage_used() },
    { "network_bandwidth_used", receipt.network_bandwidth_used() },
    { "compute_bandwidth_used", receipt.compute_bandwidth_used() },
    { "disk_storage_charged", receipt.disk_storage_charged() },
    { "network_bandwidth_charged", receipt.network_bandwidth_charged() },
    { "compute_bandwidth_charged", receipt.compute_bandwidth_charged() },
    { "event_count", receipt.events_size() },
    { "logs", logs },
    { "block_state_delta_stats", delta_stats( receipt.state_delta_entries() ) },
    { "block_state_delta_entries_dumped", entries_to_dump },
    { "block_state_delta_entries_truncated", receipt.state_delta_entries_size() > max_entries_to_dump },
    { "block_state_delta_entries", entries },
    { "transaction_receipts", tx_receipts },
  };
}

json block_item_detail( const koinos::block_store::block_item& item )
{
  json transactions = json::array();
  if( item.has_block() )
  {
    for( int i = 0; i < item.block().transactions_size(); ++i )
      transactions.push_back( transaction_summary( item.block().transactions( i ), i ) );
  }

  json detail = {
    { "has_block", item.has_block() },
    { "has_receipt", item.has_receipt() },
  };
  if( item.has_block() )
  {
    detail[ "block" ] = block_header_summary( item.block() );
    detail[ "transactions" ] = transactions;
  }
  if( item.has_receipt() )
    detail[ "receipt" ] = block_receipt_detail( item.receipt() );
  return detail;
}

int run_inspect_height(
  const Args& args,
  const std::string& started_at,
  node::block_store::BlockStore& source_block_store,
  const koinos::block_topology& source_topology )
{
  const uint64_t start_height = args.inspect_target_height > 1 ? args.inspect_target_height - 1 : args.inspect_target_height;
  const uint64_t end_height = std::min< uint64_t >( source_topology.height(), args.inspect_target_height + 1 );
  const uint32_t count = static_cast< uint32_t >( end_height - start_height + 1 );

  rpc::block_store::get_blocks_by_height_request by_height;
  by_height.set_head_block_id( source_topology.id() );
  by_height.set_ancestor_start_height( start_height );
  by_height.set_num_blocks( count );
  by_height.set_return_block( true );
  by_height.set_return_receipt( true );

  auto batch = source_block_store.get_blocks_by_height( by_height );
  if( static_cast< uint32_t >( batch.block_items_size() ) != count )
  {
    std::ostringstream msg;
    msg << "expected " << count << " block items at height " << start_height
        << ", got " << batch.block_items_size();
    throw std::runtime_error( msg.str() );
  }

  json blocks = json::object();
  const protocol::block* previous_block = nullptr;
  const protocol::block* target_block = nullptr;
  const protocol::block* next_block = nullptr;
  const protocol::block_receipt* target_receipt = nullptr;

  for( const auto& item: batch.block_items() )
  {
    if( !item.has_block() )
      continue;
    const auto height = item.block().header().height();
    blocks[ std::to_string( height ) ] = block_item_detail( item );
    if( height + 1 == args.inspect_target_height )
      previous_block = &item.block();
    else if( height == args.inspect_target_height )
    {
      target_block = &item.block();
      if( item.has_receipt() )
        target_receipt = &item.receipt();
    }
    else if( height == args.inspect_target_height + 1 )
      next_block = &item.block();
  }

  if( !target_block )
    throw std::runtime_error( "target block not found at height " + std::to_string( args.inspect_target_height ) );
  if( !target_receipt )
    throw std::runtime_error( "target receipt not found at height " + std::to_string( args.inspect_target_height ) );

  json report = {
    { "kind", "koinos-state-delta-block-inspection" },
    { "started_at", started_at },
    { "finished_at", utc_timestamp() },
    { "source_basedir", args.source_basedir.string() },
    { "source_topology", topology_to_json( source_topology ) },
    { "report_dir", args.report_dir.string() },
    { "target_height", args.inspect_target_height },
    { "target_block_id", util::to_hex( target_block->id() ) },
    { "target_previous_state_merkle_root", util::to_hex( target_block->header().previous_state_merkle_root() ) },
    { "target_stored_receipt_state_merkle_root", util::to_hex( target_receipt->state_merkle_root() ) },
    { "target_stored_receipt_missing_state_merkle_root", target_receipt->state_merkle_root().empty() },
    { "target_block_delta_count", target_receipt->state_delta_entries_size() },
    { "target_block_delta_hash", repeated_message_hash( target_receipt->state_delta_entries() ) },
    { "target_total_delta_entries_including_tx_receipts", receipt_delta_entry_count( *target_receipt ) },
    { "blocks", blocks },
  };

  if( previous_block )
  {
    report[ "previous_height" ] = previous_block->header().height();
    report[ "previous_block_id" ] = util::to_hex( previous_block->id() );
  }
  if( next_block )
  {
    report[ "next_height" ] = next_block->header().height();
    report[ "next_block_id" ] = util::to_hex( next_block->id() );
    report[ "next_block_previous_state_merkle_root" ] =
      util::to_hex( next_block->header().previous_state_merkle_root() );
    report[ "target_receipt_root_matches_next_previous_root" ] =
      !target_receipt->state_merkle_root().empty()
      && target_receipt->state_merkle_root() == next_block->header().previous_state_merkle_root();
  }

  const auto report_file = args.report_dir / ( "block-" + std::to_string( args.inspect_target_height ) + "-inspection.json" );
  write_file( report_file, report.dump( 2 ) + "\n" );
  write_file( args.report_dir / "result.json", report.dump( 2 ) + "\n" );
  std::cout << report.dump( 2 ) << std::endl;
  return 0;
}

int run_compare_replay_strategies(
  const Args& args,
  const std::string& started_at,
  node::block_store::BlockStore& source_block_store,
  const koinos::block_topology& source_topology,
  const node::NodeConfig& audit_cfg )
{
  if( !fs::exists( args.audit_basedir / "db" ) )
    throw std::runtime_error( "compare prestate audit basedir is missing db/: " + args.audit_basedir.string() );

  const auto validation_basedir = args.report_dir / "validation-prestate-copy";
  if( fs::exists( validation_basedir ) )
    fs::remove_all( validation_basedir );
  fs::create_directories( validation_basedir.parent_path() );
  fs::copy( args.audit_basedir,
            validation_basedir,
            fs::copy_options::recursive | fs::copy_options::copy_symlinks );

  rpc::block_store::get_blocks_by_height_request by_height;
  by_height.set_head_block_id( source_topology.id() );
  by_height.set_ancestor_start_height( args.compare_target_height );
  by_height.set_num_blocks( args.compare_target_height < source_topology.height() ? 2 : 1 );
  by_height.set_return_block( true );
  by_height.set_return_receipt( true );
  auto batch = source_block_store.get_blocks_by_height( by_height );
  if( batch.block_items_size() == 0 )
    throw std::runtime_error( "target block not found at height " + std::to_string( args.compare_target_height ) );

  const auto& target_item = batch.block_items( 0 );
  if( !target_item.has_block() )
    throw std::runtime_error( "target block payload missing at height " + std::to_string( args.compare_target_height ) );
  if( !target_item.has_receipt() )
    throw std::runtime_error( "target receipt missing at height " + std::to_string( args.compare_target_height ) );

  const auto& target_block = target_item.block();
  const auto& target_receipt = target_item.receipt();
  const protocol::block* next_block = nullptr;
  if( batch.block_items_size() > 1 && batch.block_items( 1 ).has_block() )
    next_block = &batch.block_items( 1 ).block();

  node::storage::RocksDBManager audit_storage;
  audit_storage.open( args.audit_basedir, audit_cfg );
  auto backend = std::make_shared< state_db::backends::rocksdb::rocksdb_backend >();
  backend->open(
    *audit_storage.db(),
    *audit_storage.handle( node::storage::ColumnFamily::default_state ),
    *audit_storage.handle( node::storage::ColumnFamily::chain_state ),
    *audit_storage.handle( node::storage::ColumnFamily::chain_metadata ) );

  state_db::database audit_db;
  audit_db.open(
    std::move( backend ),
    make_audit_genesis_initializer( load_genesis( args.source_basedir ) ),
    &state_db::pob_comparator,
    audit_db.get_unique_lock() );

  auto parent_node = audit_db.get_head( audit_db.get_shared_lock() );
  if( parent_node->revision() + 1 != target_block.header().height() )
  {
    std::ostringstream msg;
    msg << "prestate audit DB is at height " << parent_node->revision()
        << " but target block height is " << target_block.header().height();
    throw std::runtime_error( msg.str() );
  }

  const auto parent_id = util::converter::as< std::string >( parent_node->id() );
  const auto parent_root = util::converter::as< std::string >( parent_node->merkle_root() );
  const auto expected_root = next_block ? next_block->header().previous_state_merkle_root() : std::string();

  delta_entry_list block_entries;
  append_block_delta_entries( block_entries, target_receipt );
  delta_entry_list tx_entries;
  append_transaction_delta_entries( tx_entries, target_receipt );
  auto block_only_extra_entries = block_delta_entries_not_in_transaction_receipts( target_receipt );
  auto tx_only_extra_entries = transaction_delta_entries_not_in_block_receipt( target_receipt );

  delta_entry_list tx_then_block_entries = tx_entries;
  tx_then_block_entries.insert( tx_then_block_entries.end(), block_entries.begin(), block_entries.end() );

  delta_entry_list block_then_tx_entries = block_entries;
  block_then_tx_entries.insert( block_then_tx_entries.end(), tx_entries.begin(), tx_entries.end() );

  json strategies = json::array();
  strategies.push_back( replay_strategy_result(
    "block_receipt_state_delta_entries",
    "Apply only block_receipt.state_delta_entries, which is what apply_block_delta currently does.",
    parent_node,
    block_entries,
    expected_root ) );
  strategies.push_back( replay_strategy_result(
    "block_receipt_state_delta_entries_force_remove_tombstones",
    "Apply only block_receipt.state_delta_entries, but force a remove tombstone even when the parent state does not contain the removed key.",
    parent_node,
    block_entries,
    expected_root,
    true ) );
  strategies.push_back( replay_strategy_result(
    "transaction_receipt_state_delta_entries",
    "Apply only transaction_receipts[].state_delta_entries in receipt order.",
    parent_node,
    tx_entries,
    expected_root ) );
  strategies.push_back( replay_strategy_result(
    "transaction_receipt_state_delta_entries_force_remove_tombstones",
    "Apply only transaction_receipts[].state_delta_entries, but force absent-key removes to remain tombstones.",
    parent_node,
    tx_entries,
    expected_root,
    true ) );
  strategies.push_back( replay_strategy_result(
    "transaction_then_block",
    "Apply all transaction deltas first, then all block receipt deltas.",
    parent_node,
    tx_then_block_entries,
    expected_root ) );
  strategies.push_back( replay_strategy_result(
    "transaction_then_block_force_remove_tombstones",
    "Apply all transaction deltas first, then all block receipt deltas, forcing absent-key removes to remain tombstones.",
    parent_node,
    tx_then_block_entries,
    expected_root,
    true ) );
  strategies.push_back( replay_strategy_result(
    "block_then_transaction",
    "Apply all block receipt deltas first, then all transaction deltas.",
    parent_node,
    block_then_tx_entries,
    expected_root ) );
  strategies.push_back( replay_strategy_result(
    "block_then_transaction_force_remove_tombstones",
    "Apply all block receipt deltas first, then all transaction deltas, forcing absent-key removes to remain tombstones.",
    parent_node,
    block_then_tx_entries,
    expected_root,
    true ) );
  strategies.push_back( replay_strategy_result(
    "block_entries_not_in_transaction_receipts",
    "Apply exact block receipt entries that do not also occur in transaction receipts.",
    parent_node,
    block_only_extra_entries,
    expected_root ) );
  strategies.push_back( replay_strategy_result(
    "transaction_entries_not_in_block_receipt",
    "Apply exact transaction receipt entries that do not also occur in the block receipt.",
    parent_node,
    tx_only_extra_entries,
    expected_root ) );

  json block_prefixes = json::array();
  for( size_t i = 1; i <= block_entries.size(); ++i )
  {
    delta_entry_list prefix( block_entries.begin(), block_entries.begin() + static_cast< long >( i ) );
    auto prefix_result = replay_strategy_result(
      "block_receipt_prefix_" + std::to_string( i ),
      "Apply the first N block receipt state_delta_entries.",
      parent_node,
      prefix,
      expected_root );
    prefix_result[ "prefix_count" ] = i;
    block_prefixes.push_back( prefix_result );
  }

  json transaction_prefixes = json::array();
  for( size_t i = 1; i <= tx_entries.size(); ++i )
  {
    delta_entry_list prefix( tx_entries.begin(), tx_entries.begin() + static_cast< long >( i ) );
    auto prefix_result = replay_strategy_result(
      "transaction_receipt_prefix_" + std::to_string( i ),
      "Apply the first N transaction receipt state_delta_entries.",
      parent_node,
      prefix,
      expected_root );
    prefix_result[ "prefix_count" ] = i;
    transaction_prefixes.push_back( prefix_result );
  }

  json matching_strategies = json::array();
  for( const auto& strategy: strategies )
  {
    if( strategy.value( "matches_expected_next_previous_state_merkle_root", false ) )
      matching_strategies.push_back( strategy.value( "name", std::string() ) );
  }
  for( const auto& prefix: block_prefixes )
  {
    if( prefix.value( "matches_expected_next_previous_state_merkle_root", false ) )
      matching_strategies.push_back( prefix.value( "name", std::string() ) );
  }

  auto block_remove_parent_checks = remove_entry_parent_checks(
    "block_receipt.state_delta_entries",
    parent_node,
    block_entries );
  auto transaction_remove_parent_checks = remove_entry_parent_checks(
    "transaction_receipts.state_delta_entries",
    parent_node,
    tx_entries );
  for( const auto& prefix: transaction_prefixes )
  {
    if( prefix.value( "matches_expected_next_previous_state_merkle_root", false ) )
      matching_strategies.push_back( prefix.value( "name", std::string() ) );
  }

  node::storage::RocksDBManager validation_storage;
  validation_storage.open( validation_basedir, audit_cfg );
  auto validation_backend = std::make_shared< state_db::backends::rocksdb::rocksdb_backend >();
  validation_backend->open(
    *validation_storage.db(),
    *validation_storage.handle( node::storage::ColumnFamily::default_state ),
    *validation_storage.handle( node::storage::ColumnFamily::chain_state ),
    *validation_storage.handle( node::storage::ColumnFamily::chain_metadata ) );

  chain::controller controller;
  controller.open(
    std::move( validation_backend ),
    load_genesis( args.source_basedir ),
    chain::fork_resolution_algorithm::pob,
    false );

  const auto validation_head = controller.get_head_info();
  if( validation_head.head_topology().height() + 1 != target_block.header().height() )
  {
    std::ostringstream msg;
    msg << "validation prestate controller is at height " << validation_head.head_topology().height()
        << " but target block height is " << target_block.header().height();
    throw std::runtime_error( msg.str() );
  }

  rpc::chain::submit_block_request submit;
  *submit.mutable_block() = target_block;
  auto submitted = controller.submit_block( submit );
  if( !submitted.has_receipt() )
    throw std::runtime_error( "submit_block returned no receipt at height " + std::to_string( target_block.header().height() ) );

  const auto regenerated_receipt_comparison = compare_receipts( target_receipt, submitted.receipt() );
  json full_validation_baseline = {
    { "status", "pass" },
    { "computed_state_merkle_root", util::to_hex( submitted.receipt().state_merkle_root() ) },
    { "matches_expected_next_previous_state_merkle_root",
      !expected_root.empty() && submitted.receipt().state_merkle_root() == expected_root },
    { "receipt_comparison", regenerated_receipt_comparison },
  };

  json report = {
    { "kind", "koinos-state-delta-replay-strategy-comparison" },
    { "started_at", started_at },
    { "finished_at", utc_timestamp() },
    { "source_basedir", args.source_basedir.string() },
    { "prestate_audit_basedir", args.audit_basedir.string() },
    { "validation_prestate_basedir", validation_basedir.string() },
    { "report_dir", args.report_dir.string() },
    { "source_topology", topology_to_json( source_topology ) },
    { "target_height", target_block.header().height() },
    { "target_block_id", util::to_hex( target_block.id() ) },
    { "target_block_previous_state_merkle_root", util::to_hex( target_block.header().previous_state_merkle_root() ) },
    { "target_stored_receipt_state_merkle_root", util::to_hex( target_receipt.state_merkle_root() ) },
    { "target_stored_receipt_missing_state_merkle_root", target_receipt.state_merkle_root().empty() },
    { "expected_next_previous_state_merkle_root", util::to_hex( expected_root ) },
    { "prestate",
      {
        { "height", parent_node->revision() },
        { "id", util::to_hex( parent_id ) },
        { "state_merkle_root", util::to_hex( parent_root ) },
        { "matches_target_previous_id", parent_id == target_block.header().previous() },
        { "matches_target_previous_state_merkle_root", parent_root == target_block.header().previous_state_merkle_root() },
      } },
    { "delta_counts",
      {
        { "block_receipt_state_delta_entries", block_entries.size() },
        { "transaction_receipt_state_delta_entries", tx_entries.size() },
        { "total_entries_if_concatenated", block_entries.size() + tx_entries.size() },
        { "exact_block_transaction_overlap_count", exact_block_transaction_delta_overlap_count( target_receipt ) },
        { "block_entries_not_in_transaction_receipts", block_only_extra_entries.size() },
        { "transaction_entries_not_in_block_receipt", tx_only_extra_entries.size() },
        { "block_receipt_remove_entries", block_remove_parent_checks.size() },
        { "transaction_receipt_remove_entries", transaction_remove_parent_checks.size() },
      } },
    { "remove_entry_parent_checks",
      {
        { "block_receipt", block_remove_parent_checks },
        { "transaction_receipts", transaction_remove_parent_checks },
      } },
    { "receipt_summary", receipt_summary( target_receipt ) },
    { "strategies", strategies },
    { "block_receipt_prefixes", block_prefixes },
    { "transaction_receipt_prefixes", transaction_prefixes },
    { "full_validation_baseline", full_validation_baseline },
    { "matching_strategies", matching_strategies },
  };

  write_file( args.report_dir / "result.json", report.dump( 2 ) + "\n" );
  std::cout << report.dump( 2 ) << std::endl;
  return 0;
}

int run_stored_only_scan(
  const Args& args,
  const std::string& started_at,
  node::block_store::BlockStore& source_block_store,
  const koinos::block_topology& source_topology )
{
  append_jsonl( args.progress_file,
                {
                  { "event", "started" },
                  { "timestamp", utc_timestamp() },
                  { "mode", "stored-only" },
                  { "start_height", args.start_height },
                  { "end_height", args.end_height },
                  { "batch_size", args.batch_size },
                  { "source_topology", topology_to_json( source_topology ) },
                } );

  std::optional< std::string > previous_receipt_merkle;
  bool previous_anchor_missing_receipt = false;
  bool previous_anchor_missing_state_merkle_root = false;
  if( args.start_height > 1 )
  {
    rpc::block_store::get_blocks_by_height_request anchor_req;
    anchor_req.set_head_block_id( source_topology.id() );
    anchor_req.set_ancestor_start_height( args.start_height - 1 );
    anchor_req.set_num_blocks( 1 );
    anchor_req.set_return_block( true );
    anchor_req.set_return_receipt( true );
    auto anchor = source_block_store.get_blocks_by_height( anchor_req );
    if( anchor.block_items_size() == 1 && anchor.block_items( 0 ).has_receipt() )
    {
      previous_receipt_merkle = anchor.block_items( 0 ).receipt().state_merkle_root();
      previous_anchor_missing_state_merkle_root = previous_receipt_merkle->empty();
    }
    else
    {
      previous_anchor_missing_receipt = true;
    }
  }

  uint64_t checked = 0;
  uint64_t missing_source_receipts = 0;
  uint64_t missing_source_merkle_roots = 0;
  uint64_t previous_state_root_mismatches = 0;
  uint64_t nonempty_delta_payloads = 0;
  uint64_t empty_delta_payloads = 0;
  uint64_t total_delta_entries = 0;
  uint64_t total_transaction_receipts = 0;
  uint64_t blocks_with_transaction_receipts = 0;
  uint64_t blocks_with_transaction_deltas = 0;
  json first_problem = nullptr;
  std::vector< json > recent_batches;
  const auto started = std::chrono::steady_clock::now();

  for( uint64_t height = args.start_height; height <= args.end_height; )
  {
    const auto count = static_cast< uint32_t >( std::min< uint64_t >( args.batch_size, args.end_height - height + 1 ) );
    const auto batch_started = std::chrono::steady_clock::now();

    rpc::block_store::get_blocks_by_height_request by_height;
    by_height.set_head_block_id( source_topology.id() );
    by_height.set_ancestor_start_height( height );
    by_height.set_num_blocks( count );
    by_height.set_return_block( true );
    by_height.set_return_receipt( true );
    auto batch = source_block_store.get_blocks_by_height( by_height );
    if( static_cast< uint32_t >( batch.block_items_size() ) != count )
    {
      std::ostringstream msg;
      msg << "expected " << count << " block items at height " << height
          << ", got " << batch.block_items_size();
      throw std::runtime_error( msg.str() );
    }

    for( const auto& item: batch.block_items() )
    {
      const auto& block = item.block();
      const auto block_height = block.header().height();
      const auto& previous_state_root = block.header().previous_state_merkle_root();

      if( previous_receipt_merkle.has_value()
          && !previous_state_root.empty()
          && previous_receipt_merkle.value() != previous_state_root )
      {
        ++previous_state_root_mismatches;
        if( first_problem.is_null() )
        {
          first_problem = {
            { "height", block_height },
            { "block_id", util::to_hex( block.id() ) },
            { "status", "previous_state_root_mismatch" },
            { "previous_receipt_state_merkle_root", util::to_hex( previous_receipt_merkle.value() ) },
            { "block_header_previous_state_merkle_root", util::to_hex( previous_state_root ) },
            { "previous_receipt_missing_state_merkle_root", previous_receipt_merkle.value().empty() },
          };
        }
      }

      if( !item.has_receipt() )
      {
        ++missing_source_receipts;
        previous_receipt_merkle.reset();
        if( first_problem.is_null() )
        {
          first_problem = {
            { "height", block_height },
            { "block_id", util::to_hex( block.id() ) },
            { "status", "missing_source_receipt" },
          };
        }
      }
      else
      {
        const auto& receipt = item.receipt();
        if( receipt.state_merkle_root().empty() )
          ++missing_source_merkle_roots;

        const auto delta_count = receipt_delta_entry_count( receipt );
        total_delta_entries += delta_count;
        if( delta_count == 0 )
          ++empty_delta_payloads;
        else
          ++nonempty_delta_payloads;

        total_transaction_receipts += static_cast< uint64_t >( receipt.transaction_receipts_size() );
        if( receipt.transaction_receipts_size() > 0 )
          ++blocks_with_transaction_receipts;

        bool has_transaction_delta = false;
        for( int i = 0; i < receipt.transaction_receipts_size(); ++i )
        {
          if( receipt.transaction_receipts( i ).state_delta_entries_size() > 0 )
          {
            has_transaction_delta = true;
            break;
          }
        }
        if( has_transaction_delta )
          ++blocks_with_transaction_deltas;

        previous_receipt_merkle = receipt.state_merkle_root();
      }

      ++checked;
    }

    const auto batch_elapsed = std::chrono::duration< double >( std::chrono::steady_clock::now() - batch_started ).count();
    const auto end_height = height + count - 1;
    json batch_record = {
      { "event", "batch" },
      { "timestamp", utc_timestamp() },
      { "mode", "stored-only" },
      { "start_height", height },
      { "end_height", end_height },
      { "count", count },
      { "elapsed_seconds", batch_elapsed },
      { "blocks_per_second", count / batch_elapsed },
      { "checked_so_far", checked },
      { "previous_state_root_mismatches_so_far", previous_state_root_mismatches },
      { "missing_source_merkle_roots_so_far", missing_source_merkle_roots },
      { "missing_source_receipts_so_far", missing_source_receipts },
      { "nonempty_delta_payloads_so_far", nonempty_delta_payloads },
      { "empty_delta_payloads_so_far", empty_delta_payloads },
    };
    append_jsonl( args.progress_file, batch_record );
    write_file( args.checkpoint_file,
                json{
                  { "timestamp", utc_timestamp() },
                  { "mode", "stored-only" },
                  { "last_completed_height", end_height },
                  { "next_start_height", end_height + 1 },
                  { "end_height", args.end_height },
                  { "checked_blocks", checked },
                  { "previous_state_root_mismatches", previous_state_root_mismatches },
                  { "missing_source_receipts", missing_source_receipts },
                  { "missing_source_merkle_roots", missing_source_merkle_roots },
                  { "nonempty_delta_payloads", nonempty_delta_payloads },
                  { "empty_delta_payloads", empty_delta_payloads },
                  { "total_delta_entries", total_delta_entries },
                  { "total_transaction_receipts", total_transaction_receipts },
                  { "blocks_with_transaction_receipts", blocks_with_transaction_receipts },
                  { "blocks_with_transaction_deltas", blocks_with_transaction_deltas },
                  { "first_problem", first_problem.is_null() ? json::object() : first_problem },
                }.dump( 2 ) + "\n" );
    recent_batches.push_back( batch_record );
    if( recent_batches.size() > 500 )
      recent_batches.erase( recent_batches.begin(), recent_batches.begin() + static_cast< long >( recent_batches.size() - 500 ) );

    std::cout << "stored height " << height << "-" << end_height
              << ": checked=" << checked
              << " prev_root_mismatches=" << previous_state_root_mismatches
              << " missing_roots=" << missing_source_merkle_roots
              << " nonempty_deltas=" << nonempty_delta_payloads
              << " bps=" << std::fixed << std::setprecision( 1 ) << ( count / batch_elapsed )
              << std::endl;
    height = end_height + 1;
  }

  const auto elapsed = std::chrono::duration< double >( std::chrono::steady_clock::now() - started ).count();
  json result = {
    { "kind", "koinos-state-delta-audit-native" },
    { "mode", "stored-only" },
    { "status", previous_state_root_mismatches == 0 && missing_source_receipts == 0 ? "pass" : "mismatch" },
    { "started_at", started_at },
    { "finished_at", utc_timestamp() },
    { "source_basedir", args.source_basedir.string() },
    { "report_dir", args.report_dir.string() },
    { "progress_file", args.progress_file.string() },
    { "checkpoint_file", args.checkpoint_file.string() },
    { "source_topology", topology_to_json( source_topology ) },
    { "audit",
      {
        { "range", { { "start_height", args.start_height }, { "end_height", args.end_height } } },
        { "checked_blocks", checked },
        { "previous_anchor_missing_receipt", previous_anchor_missing_receipt },
        { "previous_anchor_missing_state_merkle_root", previous_anchor_missing_state_merkle_root },
        { "previous_state_root_mismatches", previous_state_root_mismatches },
        { "missing_source_receipts", missing_source_receipts },
        { "missing_source_merkle_roots", missing_source_merkle_roots },
        { "nonempty_delta_payloads", nonempty_delta_payloads },
        { "empty_delta_payloads", empty_delta_payloads },
        { "total_delta_entries", total_delta_entries },
        { "total_transaction_receipts", total_transaction_receipts },
        { "blocks_with_transaction_receipts", blocks_with_transaction_receipts },
        { "blocks_with_transaction_deltas", blocks_with_transaction_deltas },
        { "elapsed_seconds", elapsed },
        { "blocks_per_second", checked / elapsed },
        { "first_problem", first_problem.is_null() ? json::object() : first_problem },
        { "recent_batches", recent_batches },
      } },
  };
  write_file( args.report_dir / "result.json", result.dump( 2 ) + "\n" );
  std::cout << result.dump( 2 ) << std::endl;
  return 0;
}

int run_delta_replay_audit(
  const Args& args,
  const std::string& started_at,
  node::block_store::BlockStore& source_block_store,
  const koinos::block_topology& source_topology,
  const node::NodeConfig& audit_cfg )
{
  state_db::database audit_db;
  std::optional< node::storage::RocksDBManager > audit_storage;
  if( args.memory_state )
  {
    audit_db.open(
      std::nullopt,
      make_audit_genesis_initializer( load_genesis( args.source_basedir ) ),
      &state_db::pob_comparator,
      audit_db.get_unique_lock() );
  }
  else
  {
    audit_storage.emplace();
    audit_storage->open( args.audit_basedir, audit_cfg );
    auto backend = std::make_shared< state_db::backends::rocksdb::rocksdb_backend >();
    backend->open(
      *audit_storage->db(),
      *audit_storage->handle( node::storage::ColumnFamily::default_state ),
      *audit_storage->handle( node::storage::ColumnFamily::chain_state ),
      *audit_storage->handle( node::storage::ColumnFamily::chain_metadata ) );

    audit_db.open(
      std::move( backend ),
      make_audit_genesis_initializer( load_genesis( args.source_basedir ) ),
      &state_db::pob_comparator,
      audit_db.get_unique_lock() );
  }

  auto initial_head = audit_db.get_head( audit_db.get_unique_lock() );
  if( args.start_height != initial_head->revision() + 1 )
  {
    std::ostringstream msg;
    msg << "audit state is at height " << initial_head->revision()
        << " but requested start height is " << args.start_height
        << " (expected start=head+1)";
    throw std::runtime_error( msg.str() );
  }

  append_jsonl( args.progress_file,
                {
                  { "event", "started" },
                  { "timestamp", utc_timestamp() },
                  { "mode", "delta-replay" },
                  { "state_backend", args.memory_state ? "memory" : "rocksdb" },
                  { "force_remove_tombstones", args.delta_replay_force_remove_tombstones },
                  { "start_height", args.start_height },
                  { "end_height", args.end_height },
                  { "batch_size", args.batch_size },
                  { "audit_start_head",
                    {
                      { "height", initial_head->revision() },
                      { "id", util::to_hex( util::converter::as< std::string >( initial_head->id() ) ) },
                      { "state_merkle_root", util::to_hex( util::converter::as< std::string >( initial_head->merkle_root() ) ) },
                    } },
                  { "source_topology", topology_to_json( source_topology ) },
                } );

  uint64_t checked = 0;
  uint64_t missing_source_receipts = 0;
  uint64_t empty_block_delta_payloads = 0;
  uint64_t nonempty_block_delta_payloads = 0;
  uint64_t total_block_delta_entries = 0;
  uint64_t receipt_root_checks = 0;
  uint64_t receipt_root_mismatches = 0;
  json first_problem = nullptr;
  std::vector< json > recent_batches;
  const auto started = std::chrono::steady_clock::now();

  auto write_failure_result = [&]( const json& problem, uint64_t checked_blocks ) {
    auto failure_head_lock = audit_db.get_unique_lock();
    auto head = audit_db.get_head( failure_head_lock );
    const auto elapsed = std::chrono::duration< double >( std::chrono::steady_clock::now() - started ).count();
    json result = {
      { "kind", "koinos-state-delta-audit-native" },
      { "mode", "delta-replay" },
      { "state_backend", args.memory_state ? "memory" : "rocksdb" },
      { "force_remove_tombstones", args.delta_replay_force_remove_tombstones },
      { "status", "mismatch" },
      { "started_at", started_at },
      { "finished_at", utc_timestamp() },
      { "source_basedir", args.source_basedir.string() },
      { "audit_basedir", args.memory_state ? "" : args.audit_basedir.string() },
      { "report_dir", args.report_dir.string() },
      { "progress_file", args.progress_file.string() },
      { "checkpoint_file", args.checkpoint_file.string() },
      { "source_topology", topology_to_json( source_topology ) },
      { "audit",
        {
          { "range", { { "start_height", args.start_height }, { "end_height", args.end_height } } },
          { "checked_blocks", checked_blocks },
          { "missing_source_receipts", missing_source_receipts },
          { "empty_block_delta_payloads", empty_block_delta_payloads },
          { "nonempty_block_delta_payloads", nonempty_block_delta_payloads },
          { "total_block_delta_entries", total_block_delta_entries },
          { "receipt_root_checks", receipt_root_checks },
          { "receipt_root_mismatches", receipt_root_mismatches },
          { "elapsed_seconds", elapsed },
          { "blocks_per_second", elapsed > 0.0 ? checked_blocks / elapsed : 0.0 },
          { "audit_head",
            {
              { "height", head->revision() },
              { "id", util::to_hex( util::converter::as< std::string >( head->id() ) ) },
              { "state_merkle_root", util::to_hex( util::converter::as< std::string >( head->merkle_root() ) ) },
            } },
          { "first_problem", problem },
          { "recent_batches", recent_batches },
        } },
    };
    write_file( args.report_dir / "result.json", result.dump( 2 ) + "\n" );
  };

  for( uint64_t height = args.start_height; height <= args.end_height; )
  {
    const auto count = static_cast< uint32_t >( std::min< uint64_t >( args.batch_size, args.end_height - height + 1 ) );
    const auto batch_started = std::chrono::steady_clock::now();
    uint64_t batch_checked = 0;
    crypto::multihash last_block_id;

    rpc::block_store::get_blocks_by_height_request by_height;
    by_height.set_head_block_id( source_topology.id() );
    by_height.set_ancestor_start_height( height );
    by_height.set_num_blocks( count );
    by_height.set_return_block( true );
    by_height.set_return_receipt( true );
    auto batch = source_block_store.get_blocks_by_height( by_height );
    if( static_cast< uint32_t >( batch.block_items_size() ) != count )
    {
      std::ostringstream msg;
      msg << "expected " << count << " block items at height " << height
          << ", got " << batch.block_items_size();
      throw std::runtime_error( msg.str() );
    }

    for( const auto& item: batch.block_items() )
    {
      const auto& block = item.block();
      const auto block_height = block.header().height();
      if( !item.has_receipt() )
      {
        ++missing_source_receipts;
        first_problem = {
          { "height", block_height },
          { "block_id", util::to_hex( block.id() ) },
          { "status", "missing_source_receipt" },
        };
        write_failure_result( first_problem, checked );
        return 2;
      }

      auto unique_lock = audit_db.get_unique_lock();
      auto parent_node = audit_db.get_head( unique_lock );
      if( parent_node->revision() + 1 != block_height )
      {
        first_problem = {
          { "height", block_height },
          { "block_id", util::to_hex( block.id() ) },
          { "status", "audit_height_gap" },
          { "audit_head_height", parent_node->revision() },
        };
        unique_lock.reset();
        write_failure_result( first_problem, checked );
        return 2;
      }

      const auto parent_root = util::converter::as< std::string >( parent_node->merkle_root() );
      if( block.header().previous_state_merkle_root() != parent_root )
      {
        first_problem = {
          { "height", block_height },
          { "failed_delta_height", block_height == 0 ? 0 : block_height - 1 },
          { "block_id", util::to_hex( block.id() ) },
          { "status", "previous_state_root_mismatch_before_delta" },
          { "audit_parent_height", parent_node->revision() },
          { "audit_parent_id", util::to_hex( util::converter::as< std::string >( parent_node->id() ) ) },
          { "audit_parent_state_merkle_root", util::to_hex( parent_root ) },
          { "block_header_previous_state_merkle_root", util::to_hex( block.header().previous_state_merkle_root() ) },
        };
        unique_lock.reset();
        write_failure_result( first_problem, checked );
        return 2;
      }

      const auto parent_id = util::converter::to< crypto::multihash >( block.header().previous() );
      const auto block_id = util::converter::to< crypto::multihash >( block.id() );
      auto block_node = audit_db.create_writable_node( parent_id, block_id, block.header(), unique_lock );
      unique_lock.reset();
      if( !block_node )
      {
        first_problem = {
          { "height", block_height },
          { "block_id", util::to_hex( block.id() ) },
          { "status", "failed_to_create_writable_state_node" },
          { "parent_id", util::to_hex( block.header().previous() ) },
        };
        write_failure_result( first_problem, checked );
        return 2;
      }

      const auto& receipt = item.receipt();
      if( receipt.state_delta_entries_size() == 0 )
        ++empty_block_delta_payloads;
      else
        ++nonempty_block_delta_payloads;
      total_block_delta_entries += static_cast< uint64_t >( receipt.state_delta_entries_size() );

      for( const auto& delta_entry: receipt.state_delta_entries() )
        apply_delta_entry_to_node( block_node, delta_entry, args.delta_replay_force_remove_tombstones );

      if( !receipt.state_merkle_root().empty() )
      {
        ++receipt_root_checks;
        const auto pending_root = util::converter::as< std::string >( block_node->pending_merkle_root() );
        if( receipt.state_merkle_root() != pending_root )
        {
          ++receipt_root_mismatches;
          first_problem = {
            { "height", block_height },
            { "failed_delta_height", block_height },
            { "block_id", util::to_hex( block.id() ) },
            { "status", "receipt_state_root_mismatch_after_delta" },
            { "computed_state_merkle_root", util::to_hex( pending_root ) },
            { "stored_receipt_state_merkle_root", util::to_hex( receipt.state_merkle_root() ) },
          };
          write_failure_result( first_problem, checked );
          return 2;
        }
      }

      auto finalize_lock = audit_db.get_unique_lock();
      audit_db.finalize_node( block_id, finalize_lock );

      last_block_id = block_id;
      ++checked;
      ++batch_checked;
    }

    {
      auto unique_lock = audit_db.get_unique_lock();
      audit_db.commit_node( last_block_id, unique_lock );
    }

    auto committed_head = audit_db.get_head( audit_db.get_shared_lock() );
    const auto batch_elapsed = std::chrono::duration< double >( std::chrono::steady_clock::now() - batch_started ).count();
    const auto end_height = height + batch_checked - 1;
    json batch_record = {
      { "event", "batch" },
      { "timestamp", utc_timestamp() },
      { "mode", "delta-replay" },
      { "state_backend", args.memory_state ? "memory" : "rocksdb" },
      { "force_remove_tombstones", args.delta_replay_force_remove_tombstones },
      { "start_height", height },
      { "end_height", end_height },
      { "count", batch_checked },
      { "elapsed_seconds", batch_elapsed },
      { "blocks_per_second", batch_checked / batch_elapsed },
      { "checked_so_far", checked },
      { "missing_source_receipts_so_far", missing_source_receipts },
      { "empty_block_delta_payloads_so_far", empty_block_delta_payloads },
      { "nonempty_block_delta_payloads_so_far", nonempty_block_delta_payloads },
      { "total_block_delta_entries_so_far", total_block_delta_entries },
      { "receipt_root_checks_so_far", receipt_root_checks },
      { "receipt_root_mismatches_so_far", receipt_root_mismatches },
      { "computed_state_merkle_root", util::to_hex( util::converter::as< std::string >( committed_head->merkle_root() ) ) },
    };
    append_jsonl( args.progress_file, batch_record );
    write_file( args.checkpoint_file,
                json{
                  { "timestamp", utc_timestamp() },
                  { "mode", "delta-replay" },
                  { "state_backend", args.memory_state ? "memory" : "rocksdb" },
                  { "force_remove_tombstones", args.delta_replay_force_remove_tombstones },
                  { "last_completed_height", end_height },
                  { "next_start_height", end_height + 1 },
                  { "end_height", args.end_height },
                  { "checked_blocks", checked },
                  { "missing_source_receipts", missing_source_receipts },
                  { "empty_block_delta_payloads", empty_block_delta_payloads },
                  { "nonempty_block_delta_payloads", nonempty_block_delta_payloads },
                  { "total_block_delta_entries", total_block_delta_entries },
                  { "receipt_root_checks", receipt_root_checks },
                  { "receipt_root_mismatches", receipt_root_mismatches },
                  { "audit_head",
                    {
                      { "height", committed_head->revision() },
                      { "id", util::to_hex( util::converter::as< std::string >( committed_head->id() ) ) },
                      { "state_merkle_root", util::to_hex( util::converter::as< std::string >( committed_head->merkle_root() ) ) },
                    } },
                }.dump( 2 ) + "\n" );
    recent_batches.push_back( batch_record );
    if( recent_batches.size() > 500 )
      recent_batches.erase( recent_batches.begin(), recent_batches.begin() + static_cast< long >( recent_batches.size() - 500 ) );

    std::cout << "delta height " << height << "-" << end_height
              << ": checked=" << checked
              << " deltas=" << total_block_delta_entries
              << " receipt_root_checks=" << receipt_root_checks
              << " bps=" << std::fixed << std::setprecision( 1 ) << ( batch_checked / batch_elapsed )
              << std::endl;
    height = end_height + 1;
  }

  const auto elapsed = std::chrono::duration< double >( std::chrono::steady_clock::now() - started ).count();
  auto final_head = audit_db.get_head( audit_db.get_shared_lock() );
  json result = {
    { "kind", "koinos-state-delta-audit-native" },
    { "mode", "delta-replay" },
    { "state_backend", args.memory_state ? "memory" : "rocksdb" },
    { "force_remove_tombstones", args.delta_replay_force_remove_tombstones },
    { "status", "pass" },
    { "started_at", started_at },
    { "finished_at", utc_timestamp() },
    { "source_basedir", args.source_basedir.string() },
    { "audit_basedir", args.memory_state ? "" : args.audit_basedir.string() },
    { "report_dir", args.report_dir.string() },
    { "progress_file", args.progress_file.string() },
    { "checkpoint_file", args.checkpoint_file.string() },
    { "source_topology", topology_to_json( source_topology ) },
    { "audit",
      {
        { "range", { { "start_height", args.start_height }, { "end_height", args.end_height } } },
        { "checked_blocks", checked },
        { "missing_source_receipts", missing_source_receipts },
        { "empty_block_delta_payloads", empty_block_delta_payloads },
        { "nonempty_block_delta_payloads", nonempty_block_delta_payloads },
        { "total_block_delta_entries", total_block_delta_entries },
        { "receipt_root_checks", receipt_root_checks },
        { "receipt_root_mismatches", receipt_root_mismatches },
        { "elapsed_seconds", elapsed },
        { "blocks_per_second", checked / elapsed },
        { "audit_head",
          {
            { "height", final_head->revision() },
            { "id", util::to_hex( util::converter::as< std::string >( final_head->id() ) ) },
            { "state_merkle_root", util::to_hex( util::converter::as< std::string >( final_head->merkle_root() ) ) },
          } },
        { "recent_batches", recent_batches },
      } },
  };
  write_file( args.report_dir / "result.json", result.dump( 2 ) + "\n" );
  std::cout << result.dump( 2 ) << std::endl;
  return 0;
}

} // namespace

int main( int argc, char** argv )
{
  const auto started_at = utc_timestamp();
  try
  {
    auto args = parse_args( argc, argv );
    koinos::initialize_logging( "koinos_state_delta_audit", {}, "warning" );
    fs::create_directories( args.report_dir );
    if( !args.stored_only && !args.memory_state && !args.inspect_height && !args.compare_replay_strategies )
      fs::create_directories( args.audit_basedir );

    auto source_cfg = node::load_config( args.source_basedir / "config.yml" );
    auto audit_cfg  = source_cfg;
    audit_cfg.features[ "block_producer" ] = false;
    audit_cfg.features[ "p2p" ]            = false;
    audit_cfg.features[ "jsonrpc" ]        = false;
    audit_cfg.features[ "grpc" ]           = false;
    audit_cfg.features[ "mempool" ]        = false;
    audit_cfg.verify_blocks                = true;

    node::storage::RocksDBManager source_storage;
    source_storage.open( args.source_basedir, source_cfg );
    node::block_store::BlockStore source_block_store(
      source_storage.db(),
      source_storage.handle( node::storage::ColumnFamily::blocks ),
      source_storage.handle( node::storage::ColumnFamily::block_meta ) );

    rpc::block_store::get_highest_block_request highest_req;
    auto highest_resp = source_block_store.get_highest_block( highest_req );
    if( !highest_resp.has_topology() || highest_resp.topology().id().empty() )
      throw std::runtime_error( "source block store returned no highest block" );

    const auto source_topology = highest_resp.topology();
    if( args.full )
      args.end_height = source_topology.height();
    else if( args.end_height == 0 )
      args.end_height = std::min< uint64_t >( source_topology.height(), args.start_height + args.block_count - 1 );
    if( args.end_height > source_topology.height() )
      throw std::runtime_error( "requested end height exceeds source block store height" );

    if( args.inspect_height )
      return run_inspect_height( args, started_at, source_block_store, source_topology );
    if( args.compare_replay_strategies )
      return run_compare_replay_strategies( args, started_at, source_block_store, source_topology, audit_cfg );
    if( args.stored_only )
      return run_stored_only_scan( args, started_at, source_block_store, source_topology );
    if( args.delta_replay )
      return run_delta_replay_audit( args, started_at, source_block_store, source_topology, audit_cfg );

    node::storage::RocksDBManager audit_storage;
    audit_storage.open( args.audit_basedir, audit_cfg );
    auto backend = std::make_shared< state_db::backends::rocksdb::rocksdb_backend >();
    backend->open(
      *audit_storage.db(),
      *audit_storage.handle( node::storage::ColumnFamily::default_state ),
      *audit_storage.handle( node::storage::ColumnFamily::chain_state ),
      *audit_storage.handle( node::storage::ColumnFamily::chain_metadata ) );

    chain::controller controller;
    controller.open( std::move( backend ), load_genesis( args.source_basedir ), chain::fork_resolution_algorithm::pob, false );

    auto head_info = controller.get_head_info();
    if( args.start_height != head_info.head_topology().height() + 1 )
    {
      std::ostringstream msg;
      msg << "audit head height " << head_info.head_topology().height()
          << " does not match requested start height " << args.start_height
          << " (expected start=head+1)";
      throw std::runtime_error( msg.str() );
    }

    append_jsonl( args.progress_file,
                  {
                    { "event", "started" },
                    { "timestamp", utc_timestamp() },
                    { "start_height", args.start_height },
                    { "end_height", args.end_height },
                    { "batch_size", args.batch_size },
                    { "source_topology", topology_to_json( source_topology ) },
                  } );

    uint64_t checked = 0;
    uint64_t mismatches = 0;
    uint64_t missing_source_receipts = 0;
    uint64_t missing_source_merkle_roots = 0;
    uint64_t submit_failures = 0;
    json first_problem;
    std::vector< json > recent_batches;
    const auto started = std::chrono::steady_clock::now();
    auto audit_root = head_info.head_state_merkle_root();
    auto audit_topology = head_info.head_topology();

    for( uint64_t height = args.start_height; height <= args.end_height; )
    {
      const auto count = static_cast< uint32_t >( std::min< uint64_t >( args.batch_size, args.end_height - height + 1 ) );
      const auto batch_started = std::chrono::steady_clock::now();

      rpc::block_store::get_blocks_by_height_request by_height;
      by_height.set_head_block_id( source_topology.id() );
      by_height.set_ancestor_start_height( height );
      by_height.set_num_blocks( count );
      by_height.set_return_block( true );
      by_height.set_return_receipt( true );
      auto batch = source_block_store.get_blocks_by_height( by_height );
      if( static_cast< uint32_t >( batch.block_items_size() ) != count )
      {
        std::ostringstream msg;
        msg << "expected " << count << " block items at height " << height
            << ", got " << batch.block_items_size();
        throw std::runtime_error( msg.str() );
      }

      for( const auto& item: batch.block_items() )
      {
        const auto& block = item.block();
        const auto block_height = block.header().height();
        if( !item.has_receipt() )
        {
          ++missing_source_receipts;
          first_problem = first_problem.is_null() ? json{
            { "height", block_height },
            { "block_id", util::to_hex( block.id() ) },
            { "status", "missing_source_receipt" },
          } : first_problem;
          throw std::runtime_error( "missing source receipt at height " + std::to_string( block_height ) );
        }

        if( !block.header().previous_state_merkle_root().empty()
            && block.header().previous_state_merkle_root() != audit_root )
        {
          ++mismatches;
          first_problem = {
            { "height", block_height },
            { "block_id", util::to_hex( block.id() ) },
            { "status", "previous_state_root_mismatch_before_submit" },
            { "expected_previous_state_merkle_root", util::to_hex( block.header().previous_state_merkle_root() ) },
            { "audit_head_state_merkle_root", util::to_hex( audit_root ) },
            { "audit_head", topology_to_json( audit_topology ) },
          };
          throw std::runtime_error( "previous state root mismatch at height " + std::to_string( block_height ) );
        }

        rpc::chain::submit_block_request submit;
        *submit.mutable_block() = block;
        rpc::chain::submit_block_response submitted;
        try
        {
          submitted = controller.submit_block( submit );
        }
        catch( const std::exception& e )
        {
          ++submit_failures;
          first_problem = {
            { "height", block_height },
            { "block_id", util::to_hex( block.id() ) },
            { "status", "submit_block_failed" },
            { "error", e.what() },
            { "stored", receipt_summary( item.receipt() ) },
          };
          throw;
        }

        if( !submitted.has_receipt() )
          throw std::runtime_error( "submit_block returned no receipt at height " + std::to_string( block_height ) );

        const auto comparison = compare_receipts( item.receipt(), submitted.receipt() );
        ++checked;
        if( comparison.value( "missing_stored_state_merkle_root", false ) )
          ++missing_source_merkle_roots;
        if( comparison.value( "status", std::string() ) != "ok" )
        {
          ++mismatches;
          first_problem = comparison;
          first_problem[ "height" ] = block_height;
          first_problem[ "block_id" ] = util::to_hex( block.id() );
          first_problem[ "block_header_previous_state_merkle_root" ] = util::to_hex( block.header().previous_state_merkle_root() );
          throw std::runtime_error( "state delta mismatch at height " + std::to_string( block_height ) );
        }

        audit_root = submitted.receipt().state_merkle_root();
        audit_topology.set_height( block_height );
        audit_topology.set_id( block.id() );
        audit_topology.set_previous( block.header().previous() );
      }

      const auto batch_elapsed = std::chrono::duration< double >( std::chrono::steady_clock::now() - batch_started ).count();
      const auto end_height = height + count - 1;
      json batch_record = {
        { "event", "batch" },
        { "timestamp", utc_timestamp() },
        { "start_height", height },
        { "end_height", end_height },
        { "count", count },
        { "elapsed_seconds", batch_elapsed },
        { "blocks_per_second", count / batch_elapsed },
        { "checked_so_far", checked },
        { "mismatches_so_far", mismatches },
        { "missing_source_merkle_roots_so_far", missing_source_merkle_roots },
        { "missing_source_receipts_so_far", missing_source_receipts },
        { "submit_failures_so_far", submit_failures },
      };
      append_jsonl( args.progress_file, batch_record );
      write_file( args.checkpoint_file,
                  json{
                    { "timestamp", utc_timestamp() },
                    { "last_completed_height", end_height },
                    { "next_start_height", end_height + 1 },
                    { "end_height", args.end_height },
                    { "checked_blocks", checked },
                    { "mismatches", mismatches },
                    { "missing_source_receipts", missing_source_receipts },
                    { "missing_source_merkle_roots", missing_source_merkle_roots },
                    { "submit_failures", submit_failures },
                    { "audit_head_state_merkle_root", util::to_hex( audit_root ) },
                    { "audit_head", topology_to_json( audit_topology ) },
                  }.dump( 2 ) + "\n" );
      recent_batches.push_back( batch_record );
      if( recent_batches.size() > 500 )
        recent_batches.erase( recent_batches.begin(), recent_batches.begin() + static_cast< long >( recent_batches.size() - 500 ) );

      std::cout << "height " << height << "-" << end_height
                << ": checked=" << checked
                << " mismatches=" << mismatches
                << " bps=" << std::fixed << std::setprecision( 1 ) << ( count / batch_elapsed )
                << std::endl;
      height = end_height + 1;
    }

    const auto elapsed = std::chrono::duration< double >( std::chrono::steady_clock::now() - started ).count();
    json result = {
      { "kind", "koinos-state-delta-audit-native" },
      { "status", "pass" },
      { "started_at", started_at },
      { "finished_at", utc_timestamp() },
      { "source_basedir", args.source_basedir.string() },
      { "audit_basedir", args.audit_basedir.string() },
      { "report_dir", args.report_dir.string() },
      { "progress_file", args.progress_file.string() },
      { "checkpoint_file", args.checkpoint_file.string() },
      { "source_topology", topology_to_json( source_topology ) },
      { "audit",
        {
          { "range", { { "start_height", args.start_height }, { "end_height", args.end_height } } },
          { "checked_blocks", checked },
          { "mismatches", mismatches },
          { "missing_source_receipts", missing_source_receipts },
          { "missing_source_merkle_roots", missing_source_merkle_roots },
          { "submit_failures", submit_failures },
          { "elapsed_seconds", elapsed },
          { "blocks_per_second", checked / elapsed },
          { "recent_batches", recent_batches },
        } },
    };
    write_file( args.report_dir / "result.json", result.dump( 2 ) + "\n" );
    std::cout << result.dump( 2 ) << std::endl;
    return 0;
  }
  catch( const std::exception& e )
  {
    std::cerr << "error: " << e.what() << std::endl;
    return 1;
  }
}
