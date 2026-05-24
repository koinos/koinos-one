#!/usr/bin/env node
'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const rootDir = path.resolve(__dirname, '..')
const defaultGenesisFiles = [
  path.join(rootDir, 'vendor/koinos/koinos/harbinger/config-example/genesis_data.json'),
  path.join(rootDir, 'vendor/koinos/koinos/config-example/genesis_data.json')
]

function usage() {
  console.error(`usage: ${path.basename(process.argv[1])} [--json|--markdown-fragment] [--require-ready] [GENESIS_JSON ...]`)
}

const options = {
  format: 'text',
  requireReady: false,
  files: []
}

for (const arg of process.argv.slice(2)) {
  if (arg === '--json') {
    options.format = 'json'
  } else if (arg === '--markdown-fragment') {
    options.format = 'markdown'
  } else if (arg === '--require-ready') {
    options.requireReady = true
  } else if (arg === '-h' || arg === '--help') {
    usage()
    process.exit(0)
  } else if (arg.startsWith('-')) {
    usage()
    process.exit(2)
  } else {
    options.files.push(path.resolve(arg))
  }
}

if (options.files.length === 0) {
  options.files = defaultGenesisFiles
}

function normalizeBase64(value) {
  return String(value || '').replace(/=+$/g, '')
}

function stateKeyBase64(name) {
  const digest = crypto.createHash('sha256').update(name).digest()
  return Buffer.concat([Buffer.from([0x12, 0x20]), digest]).toString('base64')
}

function systemCallKeyBase64(id) {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32BE(id)
  return bytes.toString('base64')
}

const metadataKeys = {
  genesis_key: stateKeyBase64('object_key::genesis_key'),
  resource_limit_data: stateKeyBase64('object_key::resource_limit_data'),
  max_account_resources: stateKeyBase64('object_key::max_account_resources'),
  protocol_descriptor: stateKeyBase64('object_key::protocol_descriptor'),
  compute_bandwidth_registry: stateKeyBase64('object_key::compute_bandwidth_registry'),
  block_hash_code: stateKeyBase64('object_key::block_hash_code')
}

const requiredSystemCalls = [
  [101, 'process_block_signature'],
  [201, 'get_account_rc'],
  [202, 'consume_account_rc'],
  [10000, 'get_contract_name'],
  [10001, 'get_contract_address']
]

const knownKoinZones = [
  // Legacy launch KOIN zone used by the full config-example genesis.
  'AQ==',
  // Release KOIN contract address; release token storage hard-codes this zone.
  'AC4z/RqpB7IkzpzmyUIokB0oOgLalW2nkQ=='
].map(normalizeBase64)

function normalizeSpace(space = {}) {
  return {
    system: Boolean(space.system),
    zone: space.zone || '',
    id: Number(space.id || 0)
  }
}

function isSpace(space, system, zone, id) {
  const normalized = normalizeSpace(space)
  return normalized.system === system && normalized.zone === zone && normalized.id === id
}

function isKnownKoinSpace(space, id) {
  const normalized = normalizeSpace(space)
  return normalized.system
    && knownKoinZones.includes(normalizeBase64(normalized.zone))
    && normalized.id === id
}

function spaceLabel(space) {
  const normalized = normalizeSpace(space)
  const zone = normalized.zone === '' ? '<kernel>' : normalized.zone
  return `system=${normalized.system} zone=${zone} id=${normalized.id}`
}

function analyzeGenesis(file) {
  const genesis = JSON.parse(fs.readFileSync(file, 'utf8'))
  const entries = Array.isArray(genesis.entries) ? genesis.entries : []
  const counts = new Map()

  for (const entry of entries) {
    const label = spaceLabel(entry.space)
    counts.set(label, (counts.get(label) || 0) + 1)
  }

  const metadataEntries = entries.filter((entry) => isSpace(entry.space, true, '', 0))
  const dispatchEntries = entries.filter((entry) => isSpace(entry.space, true, '', 1))
  const bytecodeEntries = entries.filter((entry) => isSpace(entry.space, true, '', 2))
  const contractMetadataEntries = entries.filter((entry) => isSpace(entry.space, true, '', 3))
  const transactionNonceEntries = entries.filter((entry) => isSpace(entry.space, true, '', 4))
  const koinMetadataEntries = entries.filter((entry) => isKnownKoinSpace(entry.space, 0))
  const koinBalanceEntries = entries.filter((entry) => isKnownKoinSpace(entry.space, 1))
  const nonKernelStateEntries = entries.filter((entry) => {
    const space = normalizeSpace(entry.space)
    return space.system && space.zone !== ''
  })

  const metadataKeyPresence = Object.fromEntries(
    Object.entries(metadataKeys).map(([name, key]) => [
      name,
      metadataEntries.some((entry) => normalizeBase64(entry.key) === normalizeBase64(key))
    ])
  )
  const dispatchKeyPresence = Object.fromEntries(
    requiredSystemCalls.map(([id, name]) => [
      name,
      dispatchEntries.some((entry) => normalizeBase64(entry.key) === normalizeBase64(systemCallKeyBase64(id)))
    ])
  )

  const missing = []
  if (!metadataKeyPresence.genesis_key) {
    missing.push('missing metadata genesis_key entry')
  }
  if (dispatchEntries.length === 0) {
    missing.push('missing kernel system-call dispatch entries for post-genesis contract-backed calls')
  }
  if (bytecodeEntries.length === 0) {
    missing.push('missing kernel contract bytecode entries')
  }
  if (contractMetadataEntries.length === 0) {
    missing.push('missing kernel contract metadata entries')
  }
  for (const [id, name] of requiredSystemCalls) {
    if (!dispatchKeyPresence[name]) {
      missing.push(`missing system-call dispatch key ${id} (${name})`)
    }
  }

  const warnings = []
  if (koinMetadataEntries.length === 0 || koinBalanceEntries.length === 0) {
    warnings.push('no launch KOIN metadata/balance state detected')
  }
  if (nonKernelStateEntries.length > 0 && bytecodeEntries.length === 0) {
    warnings.push('contract storage exists without matching checked-in contract bytecode entries')
  }
  if (transactionNonceEntries.length === 0) {
    warnings.push('no transaction nonce entries detected; bootstrap transactions must initialize nonce state through chain execution')
  }

  const spaceCounts = Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([space, count]) => ({ space, count }))

  return {
    file,
    entries: entries.length,
    spaceCounts,
    metadataEntries: metadataEntries.length,
    metadataKeyPresence,
    dispatchKeyPresence,
    systemCallDispatchEntries: dispatchEntries.length,
    contractBytecodeEntries: bytecodeEntries.length,
    contractMetadataEntries: contractMetadataEntries.length,
    transactionNonceEntries: transactionNonceEntries.length,
    koinMetadataEntries: koinMetadataEntries.length,
    koinBalanceEntries: koinBalanceEntries.length,
    nonKernelStateEntries: nonKernelStateEntries.length,
    federatedReady: metadataKeyPresence.genesis_key && metadataEntries.length >= 6,
    pobReady: missing.length === 0,
    missing,
    warnings
  }
}

function printText(results) {
  for (const result of results) {
    console.log(`${result.file}`)
    console.log(`  entries: ${result.entries}`)
    console.log(`  federated_ready: ${result.federatedReady}`)
    console.log(`  pob_ready: ${result.pobReady}`)
    console.log(`  metadata_entries: ${result.metadataEntries}`)
    console.log(`  system_call_dispatch_entries: ${result.systemCallDispatchEntries}`)
    console.log(`  contract_bytecode_entries: ${result.contractBytecodeEntries}`)
    console.log(`  contract_metadata_entries: ${result.contractMetadataEntries}`)
    console.log(`  koin_metadata_entries: ${result.koinMetadataEntries}`)
    console.log(`  koin_balance_entries: ${result.koinBalanceEntries}`)
    if (result.missing.length) {
      console.log(`  missing: ${result.missing.join('; ')}`)
    }
    if (result.warnings.length) {
      console.log(`  warnings: ${result.warnings.join('; ')}`)
    }
  }
}

function printMarkdown(results) {
  console.log('## Phase B Genesis Readiness Probe')
  console.log('')
  console.log('| Genesis | Entries | Federated-ready | PoB-ready | System dispatch | Contract bytecode | Contract metadata | KOIN balances |')
  console.log('|---------|---------|-----------------|-----------|-----------------|-------------------|-------------------|---------------|')
  for (const result of results) {
    const label = displayPath(result.file)
    console.log(`| \`${label}\` | ${result.entries} | ${result.federatedReady ? 'yes' : 'no'} | ${result.pobReady ? 'yes' : 'no'} | ${result.systemCallDispatchEntries} | ${result.contractBytecodeEntries} | ${result.contractMetadataEntries} | ${result.koinBalanceEntries} |`)
  }
  console.log('')
  for (const result of results) {
    const label = displayPath(result.file)
    console.log(`- \`${label}\`: ${result.pobReady ? 'static PoB prerequisites detected' : `not PoB-ready: ${result.missing.join('; ')}`}.`)
    for (const warning of result.warnings) {
      console.log(`  Warning: ${warning}.`)
    }
  }
}

function displayPath(file) {
  const relative = path.relative(rootDir, file)
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : file
}

let results
try {
  results = options.files.map(analyzeGenesis)
} catch (error) {
  console.error(`error: ${error.message}`)
  process.exit(1)
}

if (options.format === 'json') {
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2))
} else if (options.format === 'markdown') {
  printMarkdown(results)
} else {
  printText(results)
}

if (options.requireReady && results.some((result) => !result.pobReady)) {
  process.exit(3)
}
