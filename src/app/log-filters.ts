export type LogLevelFilter = 'all' | 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

export const LOG_LEVEL_FILTERS: LogLevelFilter[] = ['all', 'trace', 'debug', 'info', 'warn', 'error', 'fatal']

export const DEFAULT_LOG_COMPONENT_FILTERS = [
  'chain',
  'mempool',
  'block_store',
  'p2p',
  'block_producer',
  'jsonrpc',
  'grpc',
  'transaction_store',
  'contract_meta_store',
  'account_history',
  'controller',
  'db',
  'metrics',
  'node'
]

const logLevelPattern = /<\s*(trace|debug|info|warn|warning|error|fatal|critical)\s*>\s*:?\s*/i
const componentTagPattern = /\[([A-Za-z][A-Za-z0-9_-]{0,63})\]/g
const processComponentPattern = /\(([A-Za-z][A-Za-z0-9_-]{0,63})(?:\.[^)]+)?\)/
const ansiEscapePattern = /\x1b\[[0-?]*[ -/]*[@-~]/g
const logLevelRank: Record<LogLevelFilter, number> = {
  all: 0,
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
  fatal: 6
}

function stripAnsi(input: string): string {
  return input.replace(ansiEscapePattern, '')
}

function normalizeLevel(value: string): LogLevelFilter {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'warning') return 'warn'
  if (normalized === 'critical') return 'fatal'
  if (LOG_LEVEL_FILTERS.includes(normalized as LogLevelFilter)) return normalized as LogLevelFilter
  return 'info'
}

function normalizeComponent(value: string): string {
  return value.trim().toLowerCase()
}

export function parseLogLineLevel(line: string): LogLevelFilter | null {
  const match = stripAnsi(line).match(logLevelPattern)
  return match?.[1] ? normalizeLevel(match[1]) : null
}

export function parseLogLineComponent(line: string): string | null {
  const plainLine = stripAnsi(line)
  const levelMatch = plainLine.match(logLevelPattern)
  const searchText = levelMatch?.index !== undefined
    ? plainLine.slice(levelMatch.index + levelMatch[0].length)
    : plainLine

  for (const match of searchText.matchAll(componentTagPattern)) {
    const component = match[1]
    if (component.includes('.') || component.includes(':')) continue
    return normalizeComponent(component)
  }

  const processMatch = plainLine.match(processComponentPattern)
  const processComponent = processMatch?.[1] ? normalizeComponent(processMatch[1]) : ''
  if (processComponent && processComponent !== 'koinos_node' && processComponent !== 'teleno_node') {
    return processComponent
  }

  return null
}

function lineMatchesFilters(
  line: string,
  levelFilter: LogLevelFilter,
  componentFilter: string
): { matches: boolean; hasMetadata: boolean } {
  const level = parseLogLineLevel(line)
  const component = parseLogLineComponent(line)
  const plainLine = stripAnsi(line)
  const hasMetadata = Boolean(level || component || /^\d{4}-\d{2}-\d{2}\b/.test(plainLine))
  const levelMatches = levelFilter === 'all' || Boolean(level && logLevelRank[level] >= logLevelRank[levelFilter])
  const componentMatches = componentFilter === 'all' || component === componentFilter

  return {
    matches: levelMatches && componentMatches,
    hasMetadata
  }
}

export function filterLogOutput(
  output: string,
  filters: { level: LogLevelFilter; component: string }
): string {
  const levelFilter = filters.level
  const componentFilter = normalizeComponent(filters.component || 'all')
  if (!output || (levelFilter === 'all' && componentFilter === 'all')) return output

  let previousLineMatched = false
  return output
    .split(/\r?\n/)
    .filter((line) => {
      const { matches, hasMetadata } = lineMatchesFilters(line, levelFilter, componentFilter)
      if (matches) {
        previousLineMatched = true
        return true
      }
      if (!hasMetadata && previousLineMatched) return true
      previousLineMatched = false
      return false
    })
    .join('\n')
}

export function listLogComponents(output: string, knownComponents: string[] = []): string[] {
  const known = knownComponents
    .map((component) => normalizeComponent(component))
    .filter((component) => component && component !== 'all')
  const knownSet = new Set(known)
  const discovered = new Set<string>()

  for (const line of output.split(/\r?\n/)) {
    const component = parseLogLineComponent(line)
    if (component && !knownSet.has(component)) discovered.add(component)
  }

  return ['all', ...Array.from(knownSet), ...Array.from(discovered).sort()]
}
