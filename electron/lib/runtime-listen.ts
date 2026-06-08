import fs from 'node:fs'
import path from 'node:path'

import { parseDocument } from 'yaml'

import { resolveNetworkProfile, type KoinosNetworkId } from './network-profiles'

export interface RuntimeListenEndpoint {
  host: string | null
  port: number | null
  protocol: string
  raw: string
}

export interface RuntimeListenPorts {
  jsonrpc: RuntimeListenEndpoint
  p2p: RuntimeListenEndpoint
}

function parsePort(value: unknown): number | null {
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric <= 0 || numeric > 65535) return null
  return numeric
}

export function parseListenEndpoint(
  value: unknown,
  fallbackRaw: string,
  fallbackHost: string | null,
  protocol = 'tcp'
): RuntimeListenEndpoint {
  const raw = `${typeof value === 'string' && value.trim() ? value.trim() : fallbackRaw}`.trim()
  const multiaddrParts = raw.split('/').filter(Boolean)
  const tcpIndex = multiaddrParts.findIndex((part) => part === 'tcp')
  if (tcpIndex >= 0) {
    const port = parsePort(multiaddrParts[tcpIndex + 1])
    const hostKey = multiaddrParts.findIndex((part) => ['ip4', 'ip6', 'dns4', 'dns6'].includes(part))
    const host = hostKey >= 0 ? multiaddrParts[hostKey + 1] ?? fallbackHost : fallbackHost
    return { host, port, protocol, raw }
  }

  const hostPortMatch = raw.match(/^\[?([^\]]+)\]?:(\d+)$/)
  if (hostPortMatch) {
    return {
      host: hostPortMatch[1] || fallbackHost,
      port: parsePort(hostPortMatch[2]),
      protocol,
      raw,
    }
  }

  return { host: fallbackHost, port: parsePort(raw), protocol, raw }
}

function readConfigValue(configPath: string, pathParts: string[]): unknown {
  if (!fs.existsSync(configPath)) return undefined
  try {
    const doc = parseDocument(fs.readFileSync(configPath, 'utf8'))
    let node: unknown = doc.toJS()
    for (const part of pathParts) {
      if (!node || typeof node !== 'object') return undefined
      node = (node as Record<string, unknown>)[part]
    }
    return node
  } catch {
    return undefined
  }
}

export function normalizeConnectHost(host: string | null | undefined): string {
  if (!host || host === '0.0.0.0' || host === '::') return '127.0.0.1'
  return host
}

export function resolveRuntimeListenPorts(settings: {
  baseDir: string
  network?: KoinosNetworkId
}): RuntimeListenPorts {
  const profile = resolveNetworkProfile(settings.network)
  const configPath = path.join(settings.baseDir, 'config.yml')
  const jsonrpcListen = readConfigValue(configPath, ['jsonrpc', 'listen'])
  const p2pListen = readConfigValue(configPath, ['p2p', 'listen'])

  return {
    jsonrpc: parseListenEndpoint(jsonrpcListen, profile.jsonrpcListen, '127.0.0.1', 'tcp'),
    p2p: parseListenEndpoint(p2pListen, profile.p2pListen, '0.0.0.0', 'tcp'),
  }
}
