#include <array>
#include <cstdint>
#include <filesystem>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

#include <rocksdb/db.h>
#include <rocksdb/options.h>

namespace {

constexpr const char* magic = "KBS1\n";
const std::string meta_key( 1, '\x01' );

uint32_t read_le32( const std::array< char, 12 >& header )
{
  return static_cast< uint32_t >( static_cast< unsigned char >( header[ 0 ] ) )
       | ( static_cast< uint32_t >( static_cast< unsigned char >( header[ 1 ] ) ) << 8 )
       | ( static_cast< uint32_t >( static_cast< unsigned char >( header[ 2 ] ) ) << 16 )
       | ( static_cast< uint32_t >( static_cast< unsigned char >( header[ 3 ] ) ) << 24 );
}

uint64_t read_le64( const std::array< char, 12 >& header )
{
  uint64_t value = 0;
  for( int i = 0; i < 8; ++i )
    value |= static_cast< uint64_t >( static_cast< unsigned char >( header[ 4 + i ] ) ) << ( i * 8 );
  return value;
}

bool read_exact( std::istream& in, char* data, std::size_t size )
{
  in.read( data, static_cast< std::streamsize >( size ) );
  return static_cast< std::size_t >( in.gcount() ) == size;
}

void usage( const char* argv0 )
{
  std::cerr << "Usage: " << argv0 << " --db /path/to/monolith/basedir/db [--progress-every N]\n";
}

} // namespace

int main( int argc, char** argv )
{
  std::filesystem::path db_path;
  uint64_t progress_every = 100000;

  for( int i = 1; i < argc; ++i )
  {
    std::string arg = argv[ i ];
    if( arg == "--db" && i + 1 < argc )
    {
      db_path = argv[ ++i ];
    }
    else if( arg == "--progress-every" && i + 1 < argc )
    {
      progress_every = std::stoull( argv[ ++i ] );
    }
    else if( arg == "-h" || arg == "--help" )
    {
      usage( argv[ 0 ] );
      return 0;
    }
    else
    {
      usage( argv[ 0 ] );
      return 2;
    }
  }

  if( db_path.empty() )
  {
    usage( argv[ 0 ] );
    return 2;
  }

  std::filesystem::create_directories( db_path );

  rocksdb::Options options;
  options.create_if_missing = true;
  options.create_missing_column_families = true;
  options.max_background_jobs = 4;
  options.bytes_per_sync = 1048576;

  std::vector< rocksdb::ColumnFamilyDescriptor > descriptors = {
    { rocksdb::kDefaultColumnFamilyName, rocksdb::ColumnFamilyOptions() },
    { "blocks", rocksdb::ColumnFamilyOptions() },
    { "block_meta", rocksdb::ColumnFamilyOptions() },
    { "contract_meta", rocksdb::ColumnFamilyOptions() },
    { "transaction_index", rocksdb::ColumnFamilyOptions() },
    { "account_history", rocksdb::ColumnFamilyOptions() }
  };

  rocksdb::DB* raw_db = nullptr;
  std::vector< rocksdb::ColumnFamilyHandle* > handles;
  auto status = rocksdb::DB::Open( options, db_path.string(), descriptors, &handles, &raw_db );
  if( !status.ok() )
  {
    std::cerr << "open rocksdb: " << status.ToString() << "\n";
    return 1;
  }
  std::unique_ptr< rocksdb::DB > db( raw_db );

  std::array< char, 5 > got_magic{};
  if( !read_exact( std::cin, got_magic.data(), got_magic.size() ) || std::string( got_magic.data(), got_magic.size() ) != magic )
  {
    std::cerr << "invalid stream magic\n";
    return 1;
  }

  std::array< char, 12 > header{};
  uint64_t records = 0;
  uint64_t block_records = 0;
  uint64_t meta_records = 0;
  uint64_t bytes = 0;

  rocksdb::WriteOptions write_options;
  write_options.sync = false;

  while( true )
  {
    std::cin.read( header.data(), static_cast< std::streamsize >( header.size() ) );
    auto read_count = std::cin.gcount();
    if( read_count == 0 && std::cin.eof() )
      break;
    if( read_count != static_cast< std::streamsize >( header.size() ) )
    {
      std::cerr << "truncated stream header\n";
      return 1;
    }

    auto key_size = read_le32( header );
    auto value_size = read_le64( header );
    std::string key( key_size, '\0' );
    std::string value( value_size, '\0' );
    if( !read_exact( std::cin, key.data(), key.size() ) || !read_exact( std::cin, value.data(), value.size() ) )
    {
      std::cerr << "truncated stream record\n";
      return 1;
    }

    auto* cf = key == meta_key ? handles[ 2 ] : handles[ 1 ];
    status = db->Put( write_options, cf, key, value );
    if( !status.ok() )
    {
      std::cerr << "rocksdb put: " << status.ToString() << "\n";
      return 1;
    }

    records++;
    bytes += key.size() + value.size();
    if( key == meta_key )
      meta_records++;
    else
      block_records++;

    if( progress_every > 0 && records % progress_every == 0 )
    {
      std::cerr << "imported records=" << records
                << " blocks=" << block_records
                << " meta=" << meta_records
                << " bytes=" << bytes << "\n";
    }
  }

  for( auto* handle: handles )
    db->Flush( rocksdb::FlushOptions(), handle );

  for( auto* handle: handles )
    delete handle;

  std::cerr << "import complete records=" << records
            << " blocks=" << block_records
            << " meta=" << meta_records
            << " bytes=" << bytes << "\n";

  return 0;
}
