import fs from 'node:fs'

import { Contract, Provider, Signer, Transaction } from 'koilib'

import {
  DASHBOARD_PEER_LOG_TAIL,
  DASHBOARD_PRODUCER_WINDOW_BLOCKS_DEFAULT,
  DASHBOARD_PRODUCER_WINDOW_BLOCKS_MAX,
  DASHBOARD_PRODUCER_WINDOW_BLOCKS_MIN,
  KOIN_CONTRACT_ADDRESS,
  POB_CONTRACT_ADDRESS,
  PRODUCER_DAY_WINDOW_MS,
  PUBLIC_KOINOS_RPC_URL,
  VHP_CONTRACT_ADDRESS
} from './constants'
import type {
  ComposeServiceStatus,
  KoinosNodeDashboardPeerRow,
  KoinosNodeDashboardPeersInput,
  KoinosNodeDashboardPeersResult,
  KoinosNodeDashboardProducersInput,
  KoinosNodeDashboardProducersResult,
  KoinosNodeLogsInput,
  KoinosNodeLogsResult,
  KoinosNodeProducerAddressSource,
  KoinosNodeProducerDeleteResult,
  KoinosNodeProducerLocalInfoResult,
  KoinosNodeProducerOverviewInput,
  KoinosNodeProducerOverviewResult,
  KoinosNodeProducerProfileResult,
  KoinosNodeProducerRegisterInput,
  KoinosNodeProducerRegisterResult,
  KoinosNodeProducerRegisteredKeyInput,
  KoinosNodeProducerRegisteredKeyResult,
  KoinosNodeSettings,
  KoinosNodeSettingsInput,
  KoinosNodeStatus,
  KnodelEncryptedWallet,
  KnodelProducerProfile,
  KnodelUnlockedWallet
} from './main-types'

type ProducerServiceDeps = {
  normalizeNodeSettings: (input?: KoinosNodeSettingsInput) => KoinosNodeSettings
  producerAddressFromRuntimeConfig: (
    settings: KoinosNodeSettings
  ) => { producerAddress: string | null; configFilePath: string; configHasProducer: boolean }
  loadKnodelWalletFile: () => KnodelEncryptedWallet | null
  resolveLocalProducerPublicKey: (
    settings: KoinosNodeSettings
  ) => { publicKey: string | null; publicKeyPath: string | null; privateKeyPath: string | null }
  producerRpcTarget: (input?: { rpcUrl?: string }) => { rpcUrl: string; rpcSource: 'public' | 'local' }
  loadContractWithFetchedAbi: (provider: Provider, contractId: string) => Promise<Contract>
  fetchBlocksByHeightPaged: (
    provider: Provider,
    headBlockId: string,
    startHeight: number,
    endHeight: number
  ) => Promise<Array<Record<string, unknown>>>
  safeIsChecksumAddress: (value: string | null | undefined) => boolean
  formatWholeUnits: (value: bigint | string | number | null | undefined, decimals?: number) => string | null
  parseWholeUnits: (value: bigint | string | number | null | undefined, decimals?: number) => number | null
  currentUnlockedProducerWallet: () => KnodelUnlockedWallet | null
  unlockKnodelWalletSession: (password: string) => KnodelUnlockedWallet | null
  persistProducerRuntimeConfig: (settings: KoinosNodeSettings, producerAddress: string) => string
  saveProducerProfile: (profile: KnodelProducerProfile) => string
  clearProducerProfile: () => boolean
  loadProducerProfile: () => KnodelProducerProfile | null
  clearProducerRuntimeConfig: (settings: KoinosNodeSettings) => { configPath: string; cleared: boolean }
  knodelProducerProfileFilePath: () => string
  nativeComposeStatus: (input?: KoinosNodeSettingsInput) => Promise<KoinosNodeStatus>
  nativeComposeLogs: (input?: KoinosNodeLogsInput) => Promise<KoinosNodeLogsResult>
  isComposeServiceRunning: (service: ComposeServiceStatus) => boolean
  blockProducerPrivateKeyFilePath: (settings: KoinosNodeSettings) => string
}

export function isProducerOverviewTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : `${error ?? ''}`
  return /context deadline exceeded|timed out|timeout/i.test(message)
}

export function formatProducerOverviewActivityWarning(rpcUrl: string, error: unknown): string {
  return isProducerOverviewTimeoutError(error)
    ? `24h producer stats are temporarily unavailable from ${rpcUrl}.`
    : `24h producer stats could not be loaded from ${rpcUrl}.`
}

export function normalizeDashboardProducerWindowBlocks(value: unknown): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : DASHBOARD_PRODUCER_WINDOW_BLOCKS_DEFAULT

  return Math.min(
    DASHBOARD_PRODUCER_WINDOW_BLOCKS_MAX,
    Math.max(
      DASHBOARD_PRODUCER_WINDOW_BLOCKS_MIN,
      Number.isFinite(numeric) ? Math.round(numeric) : DASHBOARD_PRODUCER_WINDOW_BLOCKS_DEFAULT
    )
  )
}

function parseKoinosLogTimestampMs(line: string): number | null {
  const match = line.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?:\.(\d+))?/)
  if (!match) return null
  const fraction = `${match[2] || ''}`.slice(0, 3).padEnd(match[2] ? 3 : 0, '0')
  const iso = `${match[1].replace(' ', 'T')}${fraction ? `.${fraction}` : ''}`
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? parsed : null
}

function parsePeerAddressDetails(address: string): { peerId: string | null; host: string | null; port: number | null } {
  const peerIdMatch = address.match(/\/p2p\/([^/]+)$/)
  const hostMatch = address.match(/\/(?:ip4|ip6|dns4|dns6)\/([^/]+)/)
  const portMatch = address.match(/\/tcp\/(\d+)/)
  const port = portMatch ? Number.parseInt(portMatch[1], 10) : NaN

  return {
    peerId: peerIdMatch?.[1] ?? null,
    host: hostMatch?.[1] ?? null,
    port: Number.isFinite(port) ? port : null
  }
}

export function parseLatestP2pPeersSnapshot(logOutput: string): {
  snapshotAt: number | null
  selfAddress: string | null
  omittedPeerCount: number
  rows: KoinosNodeDashboardPeerRow[]
} | null {
  const lines = logOutput.split(/\r?\n/)
  let connectedPeersIndex = -1

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].includes('Connected peers:')) {
      connectedPeersIndex = index
      break
    }
  }

  if (connectedPeersIndex < 0) return null

  let selfAddress: string | null = null
  for (let index = connectedPeersIndex - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (line.includes('Connected peers:')) break
    if (line.includes('My address:')) {
      const nextLine = lines[index + 1] ?? ''
      const addressMatch = nextLine.match(/\s-\s(.+)$/)
      selfAddress = addressMatch?.[1]?.trim() || null
      break
    }
  }

  const rows: KoinosNodeDashboardPeerRow[] = []
  let omittedPeerCount = 0
  for (let index = connectedPeersIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    const peerMatch = line.match(/\s-\s(.+)$/)
    if (peerMatch) {
      const address = peerMatch[1].trim()
      const details = parsePeerAddressDetails(address)
      rows.push({
        address,
        peerId: details.peerId,
        host: details.host,
        port: details.port
      })
      continue
    }

    const omittedMatch = line.match(/and\s+(\d+)\s+more/i)
    if (omittedMatch) {
      omittedPeerCount = Number.parseInt(omittedMatch[1], 10) || 0
      break
    }

    if (rows.length > 0 || line.includes('My address:')) break
  }

  return {
    snapshotAt: parseKoinosLogTimestampMs(lines[connectedPeersIndex]),
    selfAddress,
    omittedPeerCount,
    rows
  }
}

async function fetchCoinMarketCapKoinPriceUsd(): Promise<number | null> {
  try {
    const response = await fetch('https://coinmarketcap.com/currencies/koinos/', {
      headers: {
        'user-agent': 'Mozilla/5.0'
      }
    })
    if (!response.ok) return null
    const html = await response.text()
    const match = html.match(/"price"\s*:\s*([0-9]+(?:\.[0-9]+)?)/)
    return match?.[1] ? Number.parseFloat(match[1]) : null
  } catch {
    return null
  }
}

function isMissingProducerPublicKeyRecordError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : `${error ?? ''}`
  return /given address has no public key record/i.test(message)
}

export function createProducerService(deps: ProducerServiceDeps) {
  async function koinosNodeProducerOverview(
    input?: KoinosNodeProducerOverviewInput
  ): Promise<KoinosNodeProducerOverviewResult> {
    const settings = deps.normalizeNodeSettings(input)
    const configProducer = deps.producerAddressFromRuntimeConfig(settings)
    const wallet = deps.loadKnodelWalletFile()
    const localProducerKey = deps.resolveLocalProducerPublicKey(settings)
    const { rpcUrl, rpcSource } = deps.producerRpcTarget(input)
    const requestedProducerAddress = `${input?.producerAddress || ''}`.trim()
    const producerAddress = requestedProducerAddress || configProducer.producerAddress || null
    const producerAddressSource: KoinosNodeProducerAddressSource = requestedProducerAddress
      ? wallet?.address && requestedProducerAddress.toLowerCase() === wallet.address.toLowerCase()
        ? 'vault'
        : 'config'
      : configProducer.producerAddress
        ? 'config'
        : 'none'

    const baseResult: KoinosNodeProducerOverviewResult = {
      ok: true,
      output: '',
      rpcUrl,
      rpcSource,
      priceSourceUrl: 'https://coinmarketcap.com/currencies/koinos/',
      producerAddress,
      producerAddressSource,
      configFilePath: configProducer.configFilePath,
      configHasProducer: configProducer.configHasProducer,
      walletAddress: wallet?.address ?? null,
      walletExists: Boolean(wallet),
      localPublicKey: localProducerKey.publicKey,
      localPublicKeyPath: localProducerKey.publicKeyPath,
      localPrivateKeyPath: localProducerKey.privateKeyPath,
      registeredPublicKey: null,
      registrationStatus: !producerAddress
        ? 'missing-address'
        : !localProducerKey.publicKey
          ? 'missing-local-key'
          : 'unregistered',
      koinBalance: null,
      vhpBalance: null,
      mana: null,
      totalKoinSupply: null,
      totalVhpSupply: null,
      totalVirtualSupply: null,
      targetBlockIntervalMs: null,
      analysisWindowBlocks: 0,
      activeProducerCount: null,
      producedLast24h: null,
      shareLast24hPercent: null,
      projectedBlocksPerMonth: null,
      estimatedApyPercent: null,
      estimatedKoinPerDay: null,
      estimatedKoinPerMonth: null,
      koinPriceUsd: null,
      estimatedUsdPerMonth: null,
      lastProducedBlockAt: null
    }

    try {
      const provider = new Provider([rpcUrl])
      const [koin, vhp, pob, priceUsd] = await Promise.all([
        deps.loadContractWithFetchedAbi(provider, KOIN_CONTRACT_ADDRESS),
        deps.loadContractWithFetchedAbi(provider, VHP_CONTRACT_ADDRESS),
        deps.loadContractWithFetchedAbi(provider, POB_CONTRACT_ADDRESS),
        fetchCoinMarketCapKoinPriceUsd()
      ])

      baseResult.koinPriceUsd = priceUsd

      const [headInfo, consensusParams] = await Promise.all([
        provider.getHeadInfo(),
        pob.functions.get_consensus_parameters({})
      ])

      const headHeight = Number.parseInt(`${headInfo.head_topology?.height ?? '0'}`, 10)
      const headBlockId = `${headInfo.head_topology?.id ?? ''}`.trim()
      const targetBlockIntervalMs = Number.parseInt(
        `${(consensusParams.result as { value?: { target_block_interval?: number } } | undefined)?.value?.target_block_interval ?? 3000}`,
        10
      )
      const blocksPerDay = Math.max(1, Math.round(PRODUCER_DAY_WINDOW_MS / Math.max(1, targetBlockIntervalMs || 3000)))
      baseResult.targetBlockIntervalMs = Number.isFinite(targetBlockIntervalMs) ? targetBlockIntervalMs : 3000

      if (!headHeight || !headBlockId) {
        baseResult.ok = false
        baseResult.output = `Could not retrieve the chain head from ${rpcUrl}.`
        return baseResult
      }

      const startHeight = Math.max(1, headHeight - blocksPerDay + 1)
      const producerStats = new Map<string, { count: number; lastTimestamp: number }>()
      let producerActivityAvailable = false
      let producerActivityWarning: string | null = null

      try {
        const items = await deps.fetchBlocksByHeightPaged(provider, headBlockId, startHeight, headHeight)
        baseResult.analysisWindowBlocks = items.length

        for (const item of items) {
          const block = item.block as { header?: { signer?: string; timestamp?: string | number } } | undefined
          const signer = `${block?.header?.signer ?? ''}`.trim()
          if (!signer) continue
          const timestamp = Number.parseInt(`${block?.header?.timestamp ?? '0'}`, 10)
          const current = producerStats.get(signer)
          if (current) {
            current.count += 1
            if (timestamp > current.lastTimestamp) current.lastTimestamp = timestamp
          } else {
            producerStats.set(signer, { count: 1, lastTimestamp: timestamp })
          }
        }
        baseResult.activeProducerCount = producerStats.size
        producerActivityAvailable = true
      } catch (error) {
        if (rpcSource === 'local' && isProducerOverviewTimeoutError(error)) {
          return koinosNodeProducerOverview({
            ...settings,
            producerAddress: requestedProducerAddress || undefined,
            rpcUrl: PUBLIC_KOINOS_RPC_URL
          })
        }
        producerActivityWarning = formatProducerOverviewActivityWarning(rpcUrl, error)
      }

      if (producerAddress) {
        try {
          const { result } = await pob.functions.get_public_key({ producer: producerAddress })
          const registeredPublicKey = `${(result as { value?: string } | undefined)?.value ?? ''}`.trim() || null
          baseResult.registeredPublicKey = registeredPublicKey
          if (!baseResult.localPublicKey) {
            baseResult.registrationStatus = 'missing-local-key'
          } else if (!registeredPublicKey) {
            baseResult.registrationStatus = 'unregistered'
          } else {
            baseResult.registrationStatus = registeredPublicKey === baseResult.localPublicKey ? 'match' : 'mismatch'
          }
        } catch {
          baseResult.registeredPublicKey = null
        }
      }

      const producerRanking = Array.from(producerStats.entries()).sort((a, b) => {
        if (b[1].count !== a[1].count) return b[1].count - a[1].count
        return b[1].lastTimestamp - a[1].lastTimestamp
      })

      const [koinSupply, vhpSupply] = await Promise.all([
        koin.functions.total_supply({}),
        vhp.functions.total_supply({})
      ])

      const koinSupplyRaw = BigInt(`${(koinSupply.result as { value?: string } | undefined)?.value ?? '0'}`)
      const vhpSupplyRaw = BigInt(`${(vhpSupply.result as { value?: string } | undefined)?.value ?? '0'}`)
      const virtualSupplyRaw = koinSupplyRaw + vhpSupplyRaw

      baseResult.totalKoinSupply = deps.formatWholeUnits(koinSupplyRaw)
      baseResult.totalVhpSupply = deps.formatWholeUnits(vhpSupplyRaw)
      baseResult.totalVirtualSupply = deps.formatWholeUnits(virtualSupplyRaw)

      const activeVhpByProducer = new Map<string, bigint>()
      if (producerActivityAvailable) {
        await Promise.all(
          producerRanking.map(async ([activeProducer]) => {
            if (!deps.safeIsChecksumAddress(activeProducer)) {
              activeVhpByProducer.set(activeProducer, BigInt(0))
              return
            }
            try {
              const { result } = await vhp.functions.balance_of({ owner: activeProducer })
              activeVhpByProducer.set(activeProducer, BigInt(`${(result as { value?: string } | undefined)?.value ?? '0'}`))
            } catch {
              activeVhpByProducer.set(activeProducer, BigInt(0))
            }
          })
        )
      }

      const activeVhpRaw = Array.from(activeVhpByProducer.values()).reduce((acc, value) => acc + value, BigInt(0))

      if (producerAddress && deps.safeIsChecksumAddress(producerAddress)) {
        const [koinBalance, vhpBalance, mana] = await Promise.all([
          koin.functions.balance_of({ owner: producerAddress }),
          vhp.functions.balance_of({ owner: producerAddress }),
          provider.getAccountRc(producerAddress)
        ])
        const koinBalanceRaw = BigInt(`${(koinBalance.result as { value?: string } | undefined)?.value ?? '0'}`)
        const vhpBalanceRaw = BigInt(`${(vhpBalance.result as { value?: string } | undefined)?.value ?? '0'}`)

        baseResult.koinBalance = deps.formatWholeUnits(koinBalanceRaw)
        baseResult.vhpBalance = deps.formatWholeUnits(vhpBalanceRaw)
        baseResult.mana = deps.formatWholeUnits(mana) || '0'

        if (producerActivityAvailable) {
          const ownStats = producerStats.get(producerAddress)
          const producedLast24h = ownStats?.count ?? 0
          baseResult.producedLast24h = producedLast24h
          baseResult.lastProducedBlockAt = ownStats?.lastTimestamp ?? null
          baseResult.shareLast24hPercent =
            baseResult.analysisWindowBlocks > 0
              ? Number.parseFloat(((producedLast24h / baseResult.analysisWindowBlocks) * 100).toFixed(2))
              : 0
          baseResult.projectedBlocksPerMonth = producedLast24h * 30

          const activeVhp = deps.parseWholeUnits(activeVhpRaw)
          const virtualSupply = deps.parseWholeUnits(virtualSupplyRaw)
          const ownVhp = deps.parseWholeUnits(vhpBalanceRaw)
          if (activeVhp && virtualSupply && ownVhp) {
            const estimatedApyPercent = Number.parseFloat(((2 * virtualSupply) / activeVhp).toFixed(2))
            const estimatedKoinPerMonth = Number.parseFloat(((ownVhp * (estimatedApyPercent / 100)) / 12).toFixed(4))
            const estimatedKoinPerDay = Number.parseFloat(((ownVhp * (estimatedApyPercent / 100)) / 365).toFixed(4))
            baseResult.estimatedApyPercent = estimatedApyPercent
            baseResult.estimatedKoinPerMonth = `${estimatedKoinPerMonth}`
            baseResult.estimatedKoinPerDay = `${estimatedKoinPerDay}`
            if (priceUsd !== null) {
              baseResult.estimatedUsdPerMonth = Number.parseFloat((estimatedKoinPerMonth * priceUsd).toFixed(2))
            }
          }
        }
      }

      const outputNotes = [
        producerAddress ? `Producer address: ${producerAddress}` : 'No producer address configured',
        baseResult.localPublicKey ? 'Local producer key detected' : 'Local producer public key not found',
        producerActivityAvailable ? `Active producers (24h): ${baseResult.activeProducerCount}` : 'Active producers (24h): unavailable',
        baseResult.koinPriceUsd !== null ? `KOIN price: $${baseResult.koinPriceUsd}` : 'KOIN price unavailable'
      ]
      if (producerActivityWarning) outputNotes.push(producerActivityWarning)
      baseResult.output = outputNotes.join('\n')
      return baseResult
    } catch (error) {
      baseResult.ok = false
      const message = error instanceof Error ? error.message : 'Could not load producer overview'
      if (rpcSource === 'local' && isProducerOverviewTimeoutError(error)) {
        return koinosNodeProducerOverview({
          ...settings,
          producerAddress: requestedProducerAddress || undefined,
          rpcUrl: PUBLIC_KOINOS_RPC_URL
        })
      }
      baseResult.output =
        isProducerOverviewTimeoutError(error)
          ? `Timed out while loading producer overview from ${rpcUrl}.`
          : message
      return baseResult
    }
  }

  async function koinosNodeProducerRegisteredKey(
    input?: KoinosNodeProducerRegisteredKeyInput
  ): Promise<KoinosNodeProducerRegisteredKeyResult> {
    const settings = deps.normalizeNodeSettings(input)
    const { rpcUrl, rpcSource } = deps.producerRpcTarget(input)
    const producerAddress = `${input?.producerAddress || ''}`.trim() || null
    const respond = (
      ok: boolean,
      output: string,
      registeredPublicKey: string | null = null
    ): KoinosNodeProducerRegisteredKeyResult => ({
      ok,
      output,
      rpcUrl,
      rpcSource,
      producerAddress,
      registeredPublicKey
    })

    if (!producerAddress) {
      return respond(true, 'No producer address configured.', null)
    }

    try {
      const provider = new Provider([rpcUrl])
      const pob = await deps.loadContractWithFetchedAbi(provider, POB_CONTRACT_ADDRESS)
      const { result } = await pob.functions.get_public_key({ producer: producerAddress })
      const registeredPublicKey = `${(result as { value?: string } | undefined)?.value ?? ''}`.trim() || null
      return respond(true, `Registered producer key loaded for ${producerAddress}.`, registeredPublicKey)
    } catch (error) {
      if (rpcSource === 'local' && isProducerOverviewTimeoutError(error)) {
        return koinosNodeProducerRegisteredKey({
          ...settings,
          producerAddress: producerAddress || undefined,
          rpcUrl: PUBLIC_KOINOS_RPC_URL
        })
      }

      if (isMissingProducerPublicKeyRecordError(error)) {
        return respond(true, `No registered producer key found for ${producerAddress}.`, null)
      }

      return respond(
        false,
        isProducerOverviewTimeoutError(error)
          ? `Timed out while loading registered producer key from ${rpcUrl}.`
          : error instanceof Error
            ? error.message
            : 'Could not load registered producer key',
        null
      )
    }
  }

  async function koinosNodeDashboardProducers(
    input?: KoinosNodeDashboardProducersInput
  ): Promise<KoinosNodeDashboardProducersResult> {
    const settings = deps.normalizeNodeSettings(input)
    const { rpcUrl, rpcSource } = deps.producerRpcTarget(input)
    const windowBlocks = normalizeDashboardProducerWindowBlocks(input?.windowBlocks)
    const empty = (output: string, headHeight: number | null = null): KoinosNodeDashboardProducersResult => ({
      ok: false,
      output,
      rpcUrl,
      rpcSource,
      windowBlocks,
      analyzedBlocks: 0,
      headHeight,
      rows: []
    })

    try {
      const provider = new Provider([rpcUrl])
      const headInfo = await provider.getHeadInfo()
      const headHeight = Number.parseInt(`${headInfo.head_topology?.height ?? '0'}`, 10)
      const headBlockId = `${headInfo.head_topology?.id ?? ''}`.trim()

      if (!headHeight || !headBlockId) {
        return empty(`Could not retrieve the chain head from ${rpcUrl}.`, null)
      }

      const startHeight = Math.max(1, headHeight - windowBlocks + 1)
      let items: Array<Record<string, unknown>> = []

      try {
        items = await deps.fetchBlocksByHeightPaged(provider, headBlockId, startHeight, headHeight)
      } catch (error) {
        if (rpcSource === 'local' && isProducerOverviewTimeoutError(error)) {
          return koinosNodeDashboardProducers({
            ...settings,
            rpcUrl: PUBLIC_KOINOS_RPC_URL,
            windowBlocks
          })
        }
        throw error
      }

      const producerStats = new Map<string, { count: number; lastTimestamp: number; lastHeight: number }>()
      for (const item of items) {
        const block = item.block as { header?: { signer?: string; timestamp?: string | number; height?: string | number } } | undefined
        const signer = `${block?.header?.signer ?? ''}`.trim()
        if (!signer) continue
        const timestamp = Number.parseInt(`${block?.header?.timestamp ?? '0'}`, 10)
        const height = Number.parseInt(`${block?.header?.height ?? item.block_height ?? '0'}`, 10)
        const current = producerStats.get(signer)
        if (current) {
          current.count += 1
          if (timestamp > current.lastTimestamp) current.lastTimestamp = timestamp
          if (height > current.lastHeight) current.lastHeight = height
        } else {
          producerStats.set(signer, {
            count: 1,
            lastTimestamp: Number.isFinite(timestamp) ? timestamp : 0,
            lastHeight: Number.isFinite(height) ? height : 0
          })
        }
      }

      const rows = Array.from(producerStats.entries())
        .map(([signer, stats]) => ({
          signer,
          blocks: stats.count,
          sharePercent: items.length > 0 ? Number.parseFloat(((stats.count / items.length) * 100).toFixed(2)) : 0,
          lastBlockHeight: stats.lastHeight,
          lastProducedBlockAt: stats.lastTimestamp || null
        }))
        .sort((left, right) => {
          if (right.blocks !== left.blocks) return right.blocks - left.blocks
          return right.lastBlockHeight - left.lastBlockHeight
        })

      return {
        ok: true,
        output: `Loaded ${rows.length} producers from the last ${items.length} blocks via ${rpcUrl}.`,
        rpcUrl,
        rpcSource,
        windowBlocks,
        analyzedBlocks: items.length,
        headHeight,
        rows
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load dashboard producers'
      return empty(
        isProducerOverviewTimeoutError(error)
          ? `Timed out while loading dashboard producers from ${rpcUrl}.`
          : message
      )
    }
  }

  async function koinosNodeDashboardPeers(input?: KoinosNodeDashboardPeersInput): Promise<KoinosNodeDashboardPeersResult> {
    const empty = (output: string): KoinosNodeDashboardPeersResult => ({
      ok: false,
      output,
      service: 'p2p',
      source: 'p2p-log',
      snapshotAt: null,
      selfAddress: null,
      omittedPeerCount: 0,
      rows: []
    })

    try {
      const settings = deps.normalizeNodeSettings(input)
      const status = await deps.nativeComposeStatus(settings)
      const p2pService = status.services.find((service) => service.id === 'p2p') ?? null
      const logs = await deps.nativeComposeLogs({
        ...settings,
        service: 'p2p',
        tail: DASHBOARD_PEER_LOG_TAIL
      })

      if (!logs.ok) return empty(logs.output || 'Could not read p2p logs.')

      const snapshot = parseLatestP2pPeersSnapshot(logs.output)
      if (!snapshot) {
        const runningSuffix =
          p2pService && !deps.isComposeServiceRunning(p2pService) ? ' The p2p service is not currently running.' : ''
        return empty(`No connected peers snapshot was found in the p2p logs yet.${runningSuffix}`)
      }

      const runningNote =
        p2pService && !deps.isComposeServiceRunning(p2pService) ? ' Showing the last known snapshot.' : ''
      const omittedNote = snapshot.omittedPeerCount > 0
        ? ` ${snapshot.omittedPeerCount} additional peer(s) were omitted by the p2p log snapshot.`
        : ''

      return {
        ok: true,
        output: `Loaded ${snapshot.rows.length} peer(s) from the latest p2p log snapshot.${runningNote}${omittedNote}`,
        service: 'p2p',
        source: 'p2p-log',
        snapshotAt: snapshot.snapshotAt,
        selfAddress: snapshot.selfAddress,
        omittedPeerCount: snapshot.omittedPeerCount,
        rows: snapshot.rows
      }
    } catch (error) {
      return empty(error instanceof Error ? error.message : 'Could not load dashboard peers')
    }
  }

  async function koinosNodeProducerProfileGet(): Promise<KoinosNodeProducerProfileResult> {
    const profile = deps.loadProducerProfile()
    return {
      ok: true,
      output: profile ? `Producer profile loaded for ${profile.producerAddress}.` : 'No producer profile configured yet.',
      profileFilePath: deps.knodelProducerProfileFilePath(),
      profile
    }
  }

  async function koinosNodeProducerProfileClear(): Promise<KoinosNodeProducerProfileResult> {
    try {
      const cleared = deps.clearProducerProfile()
      return {
        ok: true,
        output: cleared ? 'Producer profile cleared.' : 'No producer profile file was found.',
        profileFilePath: deps.knodelProducerProfileFilePath(),
        profile: null
      }
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Could not clear producer profile',
        profileFilePath: deps.knodelProducerProfileFilePath(),
        profile: deps.loadProducerProfile()
      }
    }
  }

  async function koinosNodeProducerLocalInfo(input?: KoinosNodeSettingsInput): Promise<KoinosNodeProducerLocalInfoResult> {
    try {
      const settings = deps.normalizeNodeSettings(input)
      const localProducerKey = deps.resolveLocalProducerPublicKey(settings)
      return {
        ok: true,
        output: localProducerKey.publicKey
          ? 'Local producer public key detected.'
          : 'Local producer public key not found in BASEDIR/block_producer.',
        localPublicKey: localProducerKey.publicKey,
        localPublicKeyPath: localProducerKey.publicKeyPath,
        localPrivateKeyPath: localProducerKey.privateKeyPath
      }
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Could not inspect local producer keys',
        localPublicKey: null,
        localPublicKeyPath: null,
        localPrivateKeyPath: null
      }
    }
  }

  async function koinosNodeProducerDelete(input?: KoinosNodeSettingsInput): Promise<KoinosNodeProducerDeleteResult> {
    const settings = deps.normalizeNodeSettings(input)
    const notes: string[] = []
    let ok = true

    try {
      const clearedProfile = deps.clearProducerProfile()
      notes.push(clearedProfile ? 'Producer profile cleared.' : 'No producer profile file was found.')
    } catch (error) {
      ok = false
      notes.push(error instanceof Error ? error.message : 'Could not clear producer profile')
    }

    try {
      const configResult = deps.clearProducerRuntimeConfig(settings)
      notes.push(
        configResult.cleared
          ? `Cleared block_producer.producer from ${configResult.configPath}.`
          : `No runtime producer address was configured in ${configResult.configPath}.`
      )
    } catch (error) {
      ok = false
      notes.push(error instanceof Error ? error.message : 'Could not clear producer runtime config')
    }

    return {
      ok,
      output: notes.join('\n'),
      overview: await koinosNodeProducerOverview({ ...settings, producerAddress: '' }),
      profile: ok ? null : deps.loadProducerProfile()
    }
  }

  async function koinosNodeProducerRegister(
    input?: KoinosNodeProducerRegisterInput
  ): Promise<KoinosNodeProducerRegisterResult> {
    const settings = deps.normalizeNodeSettings(input)
    const { rpcUrl } = deps.producerRpcTarget(input)
    const configuredProducer = deps.producerAddressFromRuntimeConfig(settings).producerAddress
    const producerAddress = `${input?.producerAddress || configuredProducer || ''}`.trim()
    const password = `${input?.password || ''}`
    const signerAccountId = `${input?.signerAccountId || ''}`.trim()
    const allowDelegatedSigner = input?.allowDelegatedSigner === true
    const persistConfig = input?.persistConfig !== false
    const persistProfile = input?.persistProfile !== false
    const localProducerKey = deps.resolveLocalProducerPublicKey(settings)

    const fail = async (message: string): Promise<KoinosNodeProducerRegisterResult> => ({
      ok: false,
      producerAddress,
      output: message,
      overview: await koinosNodeProducerOverview({ ...settings, producerAddress, rpcUrl })
    })

    if (!producerAddress) {
      return fail('No producer address available. Configure one in the Producer tab or import an account into Knodel.')
    }

    if (!deps.safeIsChecksumAddress(producerAddress)) {
      return fail('Invalid producer address format.')
    }

    if (!localProducerKey.publicKey) {
      return fail('No local producer public key was found in BASEDIR/block_producer.')
    }

    let wallet: KnodelUnlockedWallet | null = deps.currentUnlockedProducerWallet()
    if (!wallet && password.trim()) {
      try {
        wallet = deps.unlockKnodelWalletSession(password)
      } catch {
        return fail('Invalid producer account password.')
      }
    }

    if (!wallet) {
      return fail('Producer account is locked. Unlock it in the Producer tab.')
    }

    if (signerAccountId && signerAccountId.toLowerCase() !== wallet.address.toLowerCase()) {
      return fail('The selected signer account is not unlocked in this Knodel session.')
    }

    if (!allowDelegatedSigner && wallet.address.toLowerCase() !== producerAddress.toLowerCase()) {
      return fail('Signer account must match producer address unless delegated signer is explicitly enabled.')
    }

    try {
      const provider = new Provider([rpcUrl])
      const pobReadContract = await deps.loadContractWithFetchedAbi(provider, POB_CONTRACT_ADDRESS)
      let registeredPublicKey = ''
      try {
        const existingRegistration = await pobReadContract.functions.get_public_key({ producer: producerAddress })
        registeredPublicKey = `${(existingRegistration.result as { value?: string } | undefined)?.value ?? ''}`.trim()
      } catch (error) {
        if (!isMissingProducerPublicKeyRecordError(error)) throw error
      }

      const notes: string[] = []

      let registrationTxId: string | null = null
      if (registeredPublicKey && registeredPublicKey === localProducerKey.publicKey) {
        notes.push('The producer public key is already registered on-chain.')
      } else {
        const signer = Signer.fromWif(wallet.privateKey)
        signer.provider = provider
        const manaRaw = await provider.getAccountRc(wallet.address)
        const manaValue = manaRaw ? BigInt(manaRaw) : BigInt(0)
        if (manaValue < BigInt(50_000_000)) {
          return fail('Insufficient mana to execute producer registration.')
        }

        const pobWriteContract = new Contract({
          id: POB_CONTRACT_ADDRESS,
          provider,
          signer,
          abi: pobReadContract.abi
        })
        pobWriteContract.updateFunctionsFromAbi()

        const { operation } = await pobWriteContract.functions.register_public_key(
          {
            producer: producerAddress,
            public_key: localProducerKey.publicKey
          },
          { onlyOperation: true }
        )

        const transaction = new Transaction({
          signer,
          provider,
          options: {
            rcLimit: ((manaValue * BigInt(10)) / BigInt(100)).toString()
          }
        })
        await transaction.pushOperation(operation)
        await transaction.prepare()
        await transaction.sign()
        await transaction.send()
        registrationTxId = transaction.transaction.id || null
        notes.push(`Registration transaction submitted for producer ${producerAddress}.`)

        try {
          await transaction.wait('byTransactionId', 60000)
          notes.push('Registration transaction confirmed on-chain.')
        } catch {
          notes.push('Registration transaction submitted, but confirmation timed out.')
        }
      }

      if (persistConfig) {
        const configPath = deps.persistProducerRuntimeConfig(settings, producerAddress)
        notes.push(`Updated ${configPath} with block_producer.producer = ${producerAddress}.`)
        if (fs.existsSync(deps.blockProducerPrivateKeyFilePath(settings))) {
          notes.push('Ensured block_producer.private-key-file = private.key in runtime config.')
        }
      }

      if (wallet.address !== producerAddress) {
        notes.push(`Wallet address used for signing: ${wallet.address}`)
      }

      if (persistProfile) {
        const profilePath = deps.saveProducerProfile({
          producerAddress,
          registrationSignerAccountId: wallet.address,
          burnAccountId: wallet.address,
          localPublicKey: localProducerKey.publicKey,
          localPublicKeyPath: localProducerKey.publicKeyPath || 'BASEDIR/block_producer/public.key',
          registeredPublicKey: localProducerKey.publicKey,
          lastRegistrationTxId: registrationTxId,
          updatedAt: new Date().toISOString()
        })
        notes.push(`Updated producer profile at ${profilePath}.`)
      }

      return {
        ok: true,
        producerAddress,
        output: notes.join('\n'),
        overview: await koinosNodeProducerOverview({ ...settings, producerAddress })
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Could not register the producer public key')
    }
  }

  return {
    koinosNodeDashboardPeers,
    koinosNodeDashboardProducers,
    koinosNodeProducerDelete,
    koinosNodeProducerLocalInfo,
    koinosNodeProducerOverview,
    koinosNodeProducerProfileClear,
    koinosNodeProducerProfileGet,
    koinosNodeProducerRegister,
    koinosNodeProducerRegisteredKey
  }
}
