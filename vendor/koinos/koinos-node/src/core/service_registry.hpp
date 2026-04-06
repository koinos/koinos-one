#pragma once

#include <functional>
#include <string>
#include <vector>

#include <koinos/log.hpp>

namespace koinos::node {

/**
 * Manages component lifecycle: init → start → stop (reverse order).
 */
class ServiceRegistry
{
public:
  struct Component
  {
    std::string name;
    std::function< void() > start;
    std::function< void() > stop;
  };

  void add( const std::string& name, std::function< void() > start_fn, std::function< void() > stop_fn )
  {
    _components.push_back( { name, std::move( start_fn ), std::move( stop_fn ) } );
  }

  void start_all()
  {
    for( auto& comp: _components )
    {
      LOG( info ) << "[" << comp.name << "] Starting...";
      comp.start();
      LOG( info ) << "[" << comp.name << "] Started";
    }
  }

  void stop_all()
  {
    for( auto it = _components.rbegin(); it != _components.rend(); ++it )
    {
      LOG( info ) << "[" << it->name << "] Stopping...";
      try
      {
        it->stop();
      }
      catch( const std::exception& e )
      {
        LOG( warning ) << "[" << it->name << "] Error during stop: " << e.what();
      }
      LOG( info ) << "[" << it->name << "] Stopped";
    }
  }

  const std::vector< Component >& components() const { return _components; }

private:
  std::vector< Component > _components;
};

} // namespace koinos::node
