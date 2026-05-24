#!/usr/bin/env node
'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const rootDir = path.resolve(__dirname, '..')
const defaultSource = path.join(rootDir, 'vendor/koinos/koinos/harbinger/config-example/genesis_data.json')
const defaultContracts = path.join(rootDir, 'tools/private-testnet/contracts')
const defaultOutput = '/private/tmp/knodel-private-pob/genesis_data.json'
const protoModulePath = path.join(
  rootDir,
  'vendor/koinos/koinos-contracts-as/contracts/koin/node_modules/koinos-proto-js'
)

function usage() {
  console.error(`usage: ${path.basename(process.argv[1])} [options]

Options:
  --source FILE                         Source genesis JSON. Default: ${path.relative(rootDir, defaultSource)}
  --contracts-dir DIR                   Staged contract artifacts. Default: ${path.relative(rootDir, defaultContracts)}
  --output FILE                         Output genesis JSON. Default: ${defaultOutput}
  --summary FILE                        Output bootstrap summary JSON. Default: output directory/bootstrap-summary.json
  --producer-address ADDRESS            Producer address in base58. Required unless --producer-address-base64 is set.
  --producer-address-base64 BASE64      Producer address bytes in base64.
  --producer-public-key-base64 BASE64   Producer public key bytes in base64. Required.
  --genesis-address-base64 BASE64       Genesis/system authority address bytes. Defaults to producer address.
  --vhp AMOUNT                          Initial producer VHP. Default: 100000000000000
  --koin AMOUNT                         Initial producer KOIN/RC. Default: 100000000000000
  --pob-contract-id-base64 BASE64       Override deterministic PoB contract ID.
  --name-service-contract-id-base64 B64 Override deterministic name-service contract ID.
  --help                                Show this help.
`)
}

const options = {
  source: defaultSource,
  contractsDir: defaultContracts,
  output: defaultOutput,
  summary: '',
  producerAddress: '',
  producerAddressBase64: '',
  producerPublicKeyBase64: '',
  genesisAddressBase64: '',
  vhpAmount: '100000000000000',
  koinAmount: '100000000000000',
  pobContractIdBase64: '',
  nameServiceContractIdBase64: ''
}

for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i]
  const next = () => {
    i += 1
    if (i >= process.argv.length) {
      usage()
      process.exit(2)
    }
    return process.argv[i]
  }
  if (arg === '--source') options.source = next()
  else if (arg === '--contracts-dir') options.contractsDir = next()
  else if (arg === '--output') options.output = next()
  else if (arg === '--summary') options.summary = next()
  else if (arg === '--producer-address') options.producerAddress = next()
  else if (arg === '--producer-address-base64') options.producerAddressBase64 = next()
  else if (arg === '--producer-public-key-base64') options.producerPublicKeyBase64 = next()
  else if (arg === '--genesis-address-base64') options.genesisAddressBase64 = next()
  else if (arg === '--vhp') options.vhpAmount = next()
  else if (arg === '--koin') options.koinAmount = next()
  else if (arg === '--pob-contract-id-base64') options.pobContractIdBase64 = next()
  else if (arg === '--name-service-contract-id-base64') options.nameServiceContractIdBase64 = next()
  else if (arg === '-h' || arg === '--help') {
    usage()
    process.exit(0)
  } else {
    usage()
    process.exit(2)
  }
}

options.source = path.resolve(options.source)
options.contractsDir = path.resolve(options.contractsDir)
options.output = path.resolve(options.output)
if (!options.summary) {
  options.summary = path.join(path.dirname(options.output), 'bootstrap-summary.json')
} else {
  options.summary = path.resolve(options.summary)
}

function die(message) {
  console.error(`error: ${message}`)
  process.exit(1)
}

if (!fs.existsSync(options.source)) die(`missing source genesis: ${options.source}`)
if (!fs.existsSync(path.join(options.contractsDir, 'manifest.json'))) {
  die(`missing contract manifest: ${path.join(options.contractsDir, 'manifest.json')}`)
}
if (!fs.existsSync(protoModulePath)) {
  die(`missing koinos-proto-js dependency: ${protoModulePath}; run scripts/build-private-testnet-contracts.sh first`)
}
if (!options.producerAddress && !options.producerAddressBase64) {
  die('producer address is required')
}
if (!options.producerPublicKeyBase64) {
  die('producer public key is required')
}

const { koinos } = require(protoModulePath)

const base58Alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const base58Map = new Map([...base58Alphabet].map((char, index) => [char, BigInt(index)]))

function base58Decode(value) {
  let acc = 0n
  for (const char of value) {
    if (!base58Map.has(char)) die(`invalid base58 character in ${value}`)
    acc = acc * 58n + base58Map.get(char)
  }
  let hex = acc.toString(16)
  if (hex.length % 2) hex = `0${hex}`
  let bytes = hex ? Buffer.from(hex, 'hex') : Buffer.alloc(0)
  let leadingZeroes = 0
  for (const char of value) {
    if (char !== '1') break
    leadingZeroes += 1
  }
  if (leadingZeroes) bytes = Buffer.concat([Buffer.alloc(leadingZeroes), bytes])
  return bytes
}

function base58Encode(bytes) {
  let acc = 0n
  for (const byte of bytes) acc = (acc << 8n) + BigInt(byte)
  let encoded = ''
  while (acc > 0n) {
    const mod = Number(acc % 58n)
    encoded = base58Alphabet[mod] + encoded
    acc /= 58n
  }
  for (const byte of bytes) {
    if (byte !== 0) break
    encoded = `1${encoded}`
  }
  return encoded || '1'
}

function fromBase64(value, label) {
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length === 0) die(`${label} decoded to empty bytes`)
  return bytes
}

function toBase64(bytes) {
  return Buffer.from(bytes).toString('base64')
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest()
}

function multihashSha256(bytes) {
  return Buffer.concat([Buffer.from([0x12, 0x20]), sha256(bytes)])
}

function deterministicAddress(label) {
  const payload = Buffer.concat([
    Buffer.from([0x00]),
    sha256(Buffer.from(`knodel-private-testnet:${label}`)).subarray(0, 20)
  ])
  const checksum = sha256(sha256(payload)).subarray(0, 4)
  return Buffer.concat([payload, checksum])
}

function normalizeBase64(value) {
  return String(value || '').replace(/=+$/g, '')
}

function stateKey(name) {
  return multihashSha256(Buffer.from(name))
}

function putVarint(parts, value) {
  let n = BigInt(value)
  if (n < 0n) die(`cannot encode negative varint: ${value}`)
  while (n >= 0x80n) {
    parts.push(Buffer.from([Number((n & 0x7fn) | 0x80n)]))
    n >>= 7n
  }
  parts.push(Buffer.from([Number(n)]))
}

function varint(value) {
  const parts = []
  putVarint(parts, value)
  return Buffer.concat(parts)
}

function fixedUint32BigEndian(value) {
  const result = Buffer.alloc(4)
  result.writeUInt32BE(value)
  return result
}

function uint128BigEndian(value) {
  let n = BigInt(value)
  if (n < 0n || n > ((1n << 128n) - 1n)) die(`uint128 value out of range: ${value}`)
  const result = Buffer.alloc(16)
  for (let i = 15; i >= 0; i -= 1) {
    result[i] = Number(n & 0xffn)
    n >>= 8n
  }
  return result
}

function fieldVarint(number, value) {
  if (BigInt(value) === 0n) return Buffer.alloc(0)
  return Buffer.concat([varint((BigInt(number) << 3n) | 0n), varint(value)])
}

function fieldBytes(number, bytes) {
  if (!bytes || bytes.length === 0) return Buffer.alloc(0)
  return Buffer.concat([varint((BigInt(number) << 3n) | 2n), varint(bytes.length), Buffer.from(bytes)])
}

function fieldString(number, value) {
  return fieldBytes(number, Buffer.from(value, 'utf8'))
}

function fieldMessage(number, bytes) {
  return fieldBytes(number, bytes)
}

function encodeNameRecord(name) {
  return fieldString(1, name)
}

function encodeAddressRecord(address) {
  return fieldBytes(1, address)
}

function encodePobPublicKeyRecord(publicKey, setBlockHeight) {
  return Buffer.concat([fieldBytes(1, publicKey), fieldVarint(2, setBlockHeight)])
}

function encodePobConsensusParameters() {
  return Buffer.concat([
    fieldVarint(1, 19802),
    fieldVarint(2, 501000),
    fieldVarint(3, 3000),
    fieldVarint(4, 10)
  ])
}

function encodePobMetadata(seed) {
  return Buffer.concat([
    fieldBytes(1, seed),
    fieldBytes(2, uint128BigEndian(1n)),
    fieldVarint(3, 0)
  ])
}

function encodeVhpEffectiveBalance(amount) {
  return fieldVarint(1, amount)
}

function encodeBalanceObject(amount) {
  return fieldVarint(1, amount)
}

function allowanceKey(owner, spender) {
  return Buffer.concat([Buffer.from(owner), Buffer.from(spender)])
}

function encodeKoinManaBalance(amount) {
  return Buffer.from(
    koinos.contracts.token.mana_balance_object
      .encode({ balance: amount, mana: amount, last_mana_update: 0 })
      .finish()
  )
}

function encodeSystemCallTarget(contractId, entryPoint) {
  return Buffer.from(
    koinos.protocol.system_call_target
      .encode({
        system_call_bundle: {
          contract_id: contractId,
          entry_point: entryPoint
        }
      })
      .finish()
  )
}

function encodeContractMetadata(wasm) {
  return Buffer.from(
    koinos.chain.contract_metadata_object
      .encode({
        hash: multihashSha256(wasm),
        system: true,
        authorizes_call_contract: false,
        authorizes_transaction_application: false,
        authorizes_upload_contract: false
      })
      .finish()
  )
}

function space(system, zone, id) {
  const result = { system }
  if (zone && zone.length) result.zone = toBase64(zone)
  if (id !== 0) result.id = id
  return result
}

function entry(objectSpace, key, value) {
  return {
    space: objectSpace,
    key: toBase64(key),
    value: toBase64(value)
  }
}

function sameSpace(a = {}, b = {}) {
  return Boolean(a.system) === Boolean(b.system)
    && normalizeBase64(a.zone || '') === normalizeBase64(b.zone || '')
    && Number(a.id || 0) === Number(b.id || 0)
}

function upsertEntry(entries, nextEntry) {
  const key = normalizeBase64(nextEntry.key)
  const index = entries.findIndex((item) => sameSpace(item.space, nextEntry.space) && normalizeBase64(item.key) === key)
  if (index === -1) entries.push(nextEntry)
  else entries[index] = nextEntry
}

function readContract(name) {
  const wasm = fs.readFileSync(path.join(options.contractsDir, name, 'contract.wasm'))
  return { name, wasm }
}

const manifest = JSON.parse(fs.readFileSync(path.join(options.contractsDir, 'manifest.json'), 'utf8'))
const genesis = JSON.parse(fs.readFileSync(options.source, 'utf8'))
if (!Array.isArray(genesis.entries)) genesis.entries = []

const producerAddress = options.producerAddressBase64
  ? fromBase64(options.producerAddressBase64, 'producer address')
  : base58Decode(options.producerAddress)
if (producerAddress.length !== 25) die(`producer address must be 25 bytes, got ${producerAddress.length}`)
const producerPublicKey = fromBase64(options.producerPublicKeyBase64, 'producer public key')
const genesisAddress = options.genesisAddressBase64
  ? fromBase64(options.genesisAddressBase64, 'genesis address')
  : producerAddress
if (genesisAddress.length !== 25) die(`genesis address must be 25 bytes, got ${genesisAddress.length}`)

const contractIds = {
  // The release KOIN/VHP contracts hard-code these production storage zones.
  koin: base58Decode('15DJN4a8SgrbGhhGksSBASiSYjGnMU8dGL'),
  vhp: base58Decode('1AdzuXSpC6K9qtXdCBgD5NUpDNwHjMgrc9'),
  name_service: options.nameServiceContractIdBase64
    ? fromBase64(options.nameServiceContractIdBase64, 'name-service contract ID')
    : deterministicAddress('name-service-contract'),
  pob: options.pobContractIdBase64
    ? fromBase64(options.pobContractIdBase64, 'pob contract ID')
    : deterministicAddress('pob-contract'),
  governance: deterministicAddress('governance-contract')
}

for (const [name, value] of Object.entries(contractIds)) {
  if (value.length !== 25) die(`${name} contract ID must be 25 bytes, got ${value.length}`)
}

const contracts = ['koin', 'name_service', 'pob', 'vhp'].map(readContract)

const metadataSpace = space(true, Buffer.alloc(0), 0)
const dispatchSpace = space(true, Buffer.alloc(0), 1)
const bytecodeSpace = space(true, Buffer.alloc(0), 2)
const contractMetadataSpace = space(true, Buffer.alloc(0), 3)
const genesisKey = stateKey('object_key::genesis_key')

upsertEntry(genesis.entries, entry(metadataSpace, genesisKey, genesisAddress))

for (const contract of contracts) {
  const id = contractIds[contract.name]
  upsertEntry(genesis.entries, entry(bytecodeSpace, id, contract.wasm))
  upsertEntry(genesis.entries, entry(contractMetadataSpace, id, encodeContractMetadata(contract.wasm)))
}

const systemCalls = [
  { id: 101, contract: 'pob', entryPoint: 0xe0adbeab, name: 'process_block_signature' },
  { id: 201, contract: 'koin', entryPoint: 0x2d464aab, name: 'get_account_rc' },
  { id: 202, contract: 'koin', entryPoint: 0x80e3f5c9, name: 'consume_account_rc' },
  { id: 10000, contract: 'name_service', entryPoint: 0xe5070a16, name: 'get_contract_name' },
  { id: 10001, contract: 'name_service', entryPoint: 0xa61ae5e8, name: 'get_contract_address' }
]

for (const call of systemCalls) {
  upsertEntry(
    genesis.entries,
    entry(dispatchSpace, fixedUint32BigEndian(call.id), encodeSystemCallTarget(contractIds[call.contract], call.entryPoint))
  )
}

const nameServiceNameToAddress = space(true, contractIds.name_service, 0)
const nameServiceAddressToName = space(true, contractIds.name_service, 1)
const names = [
  ['koin', contractIds.koin],
  ['vhp', contractIds.vhp],
  ['pob', contractIds.pob],
  ['name_service', contractIds.name_service],
  ['governance', contractIds.governance]
]

for (const [name, address] of names) {
  upsertEntry(genesis.entries, entry(nameServiceNameToAddress, Buffer.from(name, 'utf8'), encodeAddressRecord(address)))
  upsertEntry(genesis.entries, entry(nameServiceAddressToName, address, encodeNameRecord(name)))
}

const vhpAmount = BigInt(options.vhpAmount)
const koinAmount = BigInt(options.koinAmount)
if (vhpAmount <= 0n) die('VHP amount must be positive')
if (koinAmount < 0n) die('KOIN amount cannot be negative')

upsertEntry(genesis.entries, entry(space(true, contractIds.vhp, 0), Buffer.alloc(0), encodeBalanceObject(vhpAmount)))
upsertEntry(genesis.entries, entry(space(true, contractIds.vhp, 1), producerAddress, encodeVhpEffectiveBalance(vhpAmount)))
upsertEntry(
  genesis.entries,
  entry(space(true, contractIds.vhp, 2), allowanceKey(producerAddress, contractIds.pob), encodeBalanceObject(vhpAmount))
)

if (koinAmount > 0n) {
  upsertEntry(genesis.entries, entry(space(true, contractIds.koin, 0), Buffer.alloc(0), encodeBalanceObject(koinAmount)))
  upsertEntry(genesis.entries, entry(space(true, contractIds.koin, 1), producerAddress, encodeKoinManaBalance(options.koinAmount)))
}

upsertEntry(genesis.entries, entry(space(true, contractIds.pob, 0), producerAddress, encodePobPublicKeyRecord(producerPublicKey, 0)))
upsertEntry(genesis.entries, entry(space(true, contractIds.pob, 1), Buffer.alloc(0), encodePobMetadata(sha256(Buffer.from('knodel-private-testnet-pob-seed')))))
upsertEntry(genesis.entries, entry(space(true, contractIds.pob, 1), Buffer.alloc(1), encodePobConsensusParameters()))

fs.mkdirSync(path.dirname(options.output), { recursive: true })
fs.writeFileSync(options.output, `${JSON.stringify(genesis, null, 2)}\n`)

const genesisDataMessage = koinos.chain.genesis_data.create({
  entries: genesis.entries.map((item) => ({
    space: {
      system: Boolean(item.space && item.space.system),
      zone: item.space && item.space.zone ? Buffer.from(item.space.zone, 'base64') : Buffer.alloc(0),
      id: Number(item.space && item.space.id ? item.space.id : 0)
    },
    key: Buffer.from(item.key, 'base64'),
    value: Buffer.from(item.value, 'base64')
  }))
})
// This is an offline digest of the JS-encoded genesis protobuf. The running
// chain's JSON-RPC chain.get_chain_id value is authoritative because it is
// produced after the C++ JSON parser materializes the genesis_data message.
const offlineGenesisDigest = multihashSha256(Buffer.from(koinos.chain.genesis_data.encode(genesisDataMessage).finish()))

const summary = {
  generatedAt: new Date().toISOString(),
  sourceGenesis: path.relative(rootDir, options.source),
  outputGenesis: options.output,
  contractManifest: path.relative(rootDir, path.join(options.contractsDir, 'manifest.json')),
  sourceRepository: manifest.sourceRepository || 'unknown',
  sourceCommit: manifest.sourceCommit || 'unknown',
  offlineGenesisDigestBase64: toBase64(offlineGenesisDigest),
  producer: {
    address: base58Encode(producerAddress),
    addressBase64: toBase64(producerAddress),
    publicKeyBase64: toBase64(producerPublicKey),
    initialKoin: options.koinAmount,
    initialVhp: options.vhpAmount,
    pobBurnAllowance: options.vhpAmount
  },
  genesisAuthority: {
    address: base58Encode(genesisAddress),
    addressBase64: toBase64(genesisAddress)
  },
  contracts: Object.fromEntries(
    Object.entries(contractIds).map(([name, id]) => [
      name,
      {
        address: base58Encode(id),
        addressBase64: toBase64(id),
        wasmSha256: manifest.contracts && manifest.contracts[name] ? manifest.contracts[name].wasmSha256 : undefined
      }
    ])
  ),
  systemCalls: systemCalls.map((call) => ({
    id: call.id,
    name: call.name,
    contract: call.contract,
    entryPoint: `0x${call.entryPoint.toString(16)}`
  }))
}

fs.mkdirSync(path.dirname(options.summary), { recursive: true })
fs.writeFileSync(options.summary, `${JSON.stringify(summary, null, 2)}\n`)

console.log(`private PoB genesis built: output=${options.output}`)
console.log(`summary=${options.summary}`)
console.log(`offline_genesis_digest=${summary.offlineGenesisDigestBase64}`)
console.log(`producer=${summary.producer.address}`)
console.log(`pob=${summary.contracts.pob.address}`)
console.log(`vhp=${summary.contracts.vhp.address}`)
