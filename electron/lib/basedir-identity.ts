import fs from 'fs';
import path from 'path';

export interface BaseDirIdentity {
  exactNodeLayout: boolean;
  hasConfig: boolean;
  hasChainGenesis: boolean;
  hasJsonrpcDescriptors: boolean;
  hasBlockStore: boolean;
  hasChainStore: boolean;
}

function exists(targetPath: string): boolean {
  try {
    return fs.existsSync(targetPath);
  } catch {
    return false;
  }
}

export function inspectBaseDirIdentity(baseDir: string): BaseDirIdentity {
  const hasConfig = exists(path.join(baseDir, 'config.yml'));
  const hasChainGenesis = exists(path.join(baseDir, 'chain', 'genesis_data.json'));
  const hasJsonrpcDescriptors = exists(path.join(baseDir, 'jsonrpc', 'descriptors', 'koinos_descriptors.pb'));
  const hasBlockStore = exists(path.join(baseDir, 'block_store', 'db')) || exists(path.join(baseDir, 'db'));
  const hasChainStore = exists(path.join(baseDir, 'chain', 'blockchain')) || exists(path.join(baseDir, 'chain', 'db'));
  return {
    exactNodeLayout: hasConfig || hasChainGenesis || hasJsonrpcDescriptors || hasBlockStore || hasChainStore,
    hasConfig,
    hasChainGenesis,
    hasJsonrpcDescriptors,
    hasBlockStore,
    hasChainStore,
  };
}

export function isExistingTelenoNodeBaseDir(baseDir: string): boolean {
  return inspectBaseDirIdentity(baseDir).exactNodeLayout;
}
