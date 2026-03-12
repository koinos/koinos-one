import fs from 'node:fs'

import { parse as parseYaml } from 'yaml'

import { composeFilePath, envFilePath } from './node-paths'

export type ComposeReadSettings = {
  repoPath: string
  composeFile: string
  envFile: string
  baseDir: string
  profiles: string[]
}

export type ComposePort = {
  host: string | null
  publishedPort: number | null
  targetPort: number | null
  protocol: string
  label: string
}

export type ComposeServiceDefinitionLike = {
  profiles: string[]
  dependsOn: string[]
  ports: ComposePort[]
  image: string | null
}

export function parsePortNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function normalizeComposeProfiles(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean)
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()]
  }
  return []
}

export function normalizeComposeDependsOn(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean)
  }
  if (typeof value === 'object' && value !== null) {
    return Object.keys(value as Record<string, unknown>).map((entry) => entry.trim()).filter(Boolean)
  }
  return []
}

export function readEnvFileValues(settings: ComposeReadSettings): Record<string, string> {
  const envPath = envFilePath(settings)
  if (!fs.existsSync(envPath)) return {}

  const values: Record<string, string> = {}
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex <= 0) continue

    const key = trimmed.slice(0, separatorIndex).trim()
    const rawValue = trimmed.slice(separatorIndex + 1).trim()
    if (!key) continue
    values[key] = rawValue.replace(/^['"]|['"]$/g, '')
  }

  return values
}

export function resolveComposeEnvTemplate(input: string, envValues: Record<string, string>): string {
  return input.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?])([^}]*))?\}/g, (_match, variableName, operator, fallback) => {
    const currentValue = envValues[String(variableName)]

    if (operator === ':-' || operator === '-' || operator === ':?' || operator === '?') {
      return currentValue && currentValue.length > 0 ? currentValue : String(fallback ?? '')
    }

    return currentValue ?? ''
  })
}

export function normalizeComposeImage(value: unknown, envValues: Record<string, string>): string | null {
  if (typeof value !== 'string') return null
  const resolved = resolveComposeEnvTemplate(value, envValues).trim()
  return resolved || null
}

export function normalizeComposePortDefinition(entry: unknown, envValues: Record<string, string>): ComposePort | null {
  if (typeof entry === 'string') {
    const resolved = resolveComposeEnvTemplate(entry, envValues).trim()
    if (!resolved) return null

    const [addressPart, protocolPart] = resolved.split('/', 2)
    const protocol = protocolPart?.trim() || 'tcp'
    const segments = addressPart.split(':').map((segment) => segment.trim()).filter(Boolean)
    if (segments.length === 0) return null

    const targetValue = segments[segments.length - 1] ?? ''
    const publishedValue = segments.length >= 2 ? segments[segments.length - 2] ?? '' : ''
    const hostValue = segments.length >= 3 ? segments.slice(0, -2).join(':') : ''
    const targetPort = parsePortNumber(targetValue)
    const publishedPort = parsePortNumber(publishedValue)
    const host = hostValue || null

    return {
      host,
      publishedPort,
      targetPort,
      protocol,
      label:
        publishedPort !== null && targetPort !== null
          ? `${host ? `${host}:` : ''}${publishedPort}->${targetPort}/${protocol}`
          : targetPort !== null
            ? `${targetPort}/${protocol}`
            : resolved
    }
  }

  if (typeof entry === 'object' && entry !== null) {
    const portDefinition = entry as Record<string, unknown>
    const host =
      typeof portDefinition.host_ip === 'string' && portDefinition.host_ip.trim()
        ? resolveComposeEnvTemplate(portDefinition.host_ip.trim(), envValues)
        : null
    const publishedPort = parsePortNumber(
      typeof portDefinition.published === 'string'
        ? resolveComposeEnvTemplate(portDefinition.published, envValues)
        : portDefinition.published
    )
    const targetPort = parsePortNumber(
      typeof portDefinition.target === 'string' ? resolveComposeEnvTemplate(portDefinition.target, envValues) : portDefinition.target
    )
    const protocol =
      typeof portDefinition.protocol === 'string' && portDefinition.protocol.trim() ? portDefinition.protocol.trim() : 'tcp'

    return {
      host,
      publishedPort,
      targetPort,
      protocol,
      label:
        publishedPort !== null && targetPort !== null
          ? `${host ? `${host}:` : ''}${publishedPort}->${targetPort}/${protocol}`
          : targetPort !== null
            ? `${targetPort}/${protocol}`
            : protocol
    }
  }

  return null
}

export function normalizeComposePorts(value: unknown, envValues: Record<string, string>): ComposePort[] {
  if (!Array.isArray(value)) return []

  return value
    .map((entry) => normalizeComposePortDefinition(entry, envValues))
    .filter((entry): entry is ComposePort => entry !== null)
}

export function readComposeServiceDefinitions(settings: ComposeReadSettings): Map<string, ComposeServiceDefinitionLike> {
  const composePath = composeFilePath(settings)
  if (!fs.existsSync(composePath)) {
    throw new Error(`Compose file not found: ${composePath}`)
  }

  const raw = fs.readFileSync(composePath, 'utf8')
  const parsed = parseYaml(raw) as { services?: Record<string, Record<string, unknown>> } | null
  const services = parsed?.services
  if (!services || typeof services !== 'object') {
    return new Map()
  }
  const envValues = {
    BASEDIR: settings.baseDir,
    COMPOSE_PROFILES: settings.profiles.join(','),
    ...readEnvFileValues(settings)
  }

  const definitions = new Map<string, ComposeServiceDefinitionLike>()
  for (const [serviceName, serviceConfig] of Object.entries(services)) {
    const definition = serviceConfig && typeof serviceConfig === 'object' ? serviceConfig : {}
    definitions.set(serviceName, {
      profiles: normalizeComposeProfiles((definition as Record<string, unknown>).profiles),
      dependsOn: normalizeComposeDependsOn((definition as Record<string, unknown>).depends_on),
      ports: normalizeComposePorts((definition as Record<string, unknown>).ports, envValues),
      image: normalizeComposeImage((definition as Record<string, unknown>).image, envValues)
    })
  }

  return definitions
}

export function formatComposePresetLabel(profile: string): string {
  return profile
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
