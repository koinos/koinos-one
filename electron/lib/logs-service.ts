import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

import type { WebContents } from 'electron'

import type {
  KoinosNodeLogsFollowEvent,
  KoinosNodeLogsFollowStartInput,
  KoinosNodeLogsFollowStartResult,
  KoinosNodeLogsFollowStopResult,
  KoinosNodeLogsInput,
  KoinosNodeLogsResult,
  KoinosNodeSettings,
  KoinosNodeSettingsInput,
  KoinosNodeStatus,
  LogsFollowSession,
  NativeServiceProcessState
} from './main-types'

type LogsServiceDeps = {
  logsFollowEventChannel: string
  maxNativeServiceLogBytes: number
  normalizeNodeSettings: (input?: KoinosNodeSettingsInput) => KoinosNodeSettings
  assertRepoReady: (settings: KoinosNodeSettings) => void
  nativeAmqpHomebrewLogFiles: () => string[]
  nativeComposeStatus: (input?: KoinosNodeSettingsInput) => Promise<KoinosNodeStatus>
  toManagedServiceId: (service: string) => string
  nativeAmqpUsesBrewService: () => boolean
  sortManagedServiceIds: (serviceIds: Iterable<string>) => string[]
  nativeServiceProcesses: Map<string, NativeServiceProcessState>
  logsFollowSessions: Map<string, LogsFollowSession>
  nativeLogsStreamIdsByService: Map<string, Set<string>>
  nextStreamId: () => string
}

export function normalizeLogsTail(inputTail: unknown, fallback = 200): number {
  const tailRaw =
    typeof inputTail === 'number' ? inputTail : Number.parseInt(String(inputTail ?? String(fallback)), 10)
  return Number.isFinite(tailRaw) ? Math.min(2000, Math.max(20, Math.trunc(tailRaw))) : fallback
}

function sendLogsFollowEvent(sender: WebContents, channel: string, payload: KoinosNodeLogsFollowEvent): void {
  if (sender.isDestroyed()) return
  sender.send(channel, payload)
}

function tailTextLines(text: string, tail: number): string {
  if (!text.trim()) return ''
  const lines = text.split(/\r?\n/)
  return lines.slice(Math.max(0, lines.length - tail)).join('\n').trim()
}

function tailFileLines(filePath: string, tail: number): string {
  if (!fs.existsSync(filePath)) return ''
  return tailTextLines(fs.readFileSync(filePath, 'utf8'), tail)
}

function trimNativeLogBuffer(text: string, maxBytes: number): string {
  if (text.length <= maxBytes) return text
  return text.slice(text.length - maxBytes)
}

/**
 * Filter log lines by component prefix for monolith mode.
 * The monolith outputs lines like: [chain] INFO message...
 * When service='chain', only lines starting with [chain] are returned.
 */
export function filterLogsByComponent(logs: string, component: string): string {
  if (!component || !logs) return logs
  const prefix = `[${component}]`
  return logs
    .split('\n')
    .filter((line) => line.includes(prefix))
    .join('\n')
}

export function createLogsService(deps: LogsServiceDeps) {
  function resolveLogTarget(status: KoinosNodeStatus, service: string): { service: string; nativeServiceId: string; component: string | null } | null {
    if (!service) return null

    const serviceId = deps.toManagedServiceId(service)
    const targetService = status.services.find((candidate) => candidate.service === service || candidate.id === serviceId)
    if (targetService) {
      return {
        service: targetService.service,
        nativeServiceId: targetService.id,
        component: null
      }
    }

    const monolithService = status.services.find((candidate) => candidate.id === 'koinos-node')
    const targetComponent = status.components.find((candidate) => candidate.name === serviceId)
    if (monolithService && targetComponent) {
      return {
        service: targetComponent.name,
        nativeServiceId: monolithService.id,
        component: targetComponent.name
      }
    }

    return null
  }

  function tailNativeAmqpHomebrewLogs(tail: number): string {
    return deps.nativeAmqpHomebrewLogFiles()
      .map((filePath) => {
        const content = tailFileLines(filePath, tail)
        if (!content) return ''
        return [`== ${path.basename(filePath)} ==`, content].join('\n')
      })
      .filter(Boolean)
      .join('\n\n')
  }

  function stopLogsFollowStream(streamId: string): KoinosNodeLogsFollowStopResult {
    const session = deps.logsFollowSessions.get(streamId)
    if (!session) {
      return { ok: false, streamId: null }
    }

    deps.logsFollowSessions.delete(streamId)
    session.ended = true
    session.stop()
    return { ok: true, streamId }
  }

  function appendNativeServiceOutput(serviceId: string, chunk: Buffer | string): void {
    const state = deps.nativeServiceProcesses.get(serviceId)
    if (!state) return

    const text = String(chunk)
    if (!text) return

    state.output = trimNativeLogBuffer(`${state.output}${text}`, deps.maxNativeServiceLogBytes)
    state.lastOutputAt = Date.now()

    const streamIds = deps.nativeLogsStreamIdsByService.get(serviceId)
    if (!streamIds || streamIds.size === 0) return

    for (const streamId of [...streamIds]) {
      const session = deps.logsFollowSessions.get(streamId)
      if (!session || session.ended) {
        streamIds.delete(streamId)
        continue
      }

      const output = serviceId === 'koinos-node' && session.service && session.service !== serviceId
        ? filterLogsByComponent(text, session.service)
        : text
      if (!output) continue

      sendLogsFollowEvent(session.sender, deps.logsFollowEventChannel, {
        streamId,
        type: 'chunk',
        chunk: output
      })
    }

    if (streamIds.size === 0) {
      deps.nativeLogsStreamIdsByService.delete(serviceId)
    }
  }

  function closeNativeLogStreamsForService(serviceId: string, code?: number | null): void {
    const streamIds = deps.nativeLogsStreamIdsByService.get(serviceId)
    if (!streamIds || streamIds.size === 0) return

    deps.nativeLogsStreamIdsByService.delete(serviceId)

    for (const streamId of [...streamIds]) {
      const session = deps.logsFollowSessions.get(streamId)
      if (!session || session.ended) continue
      session.ended = true
      deps.logsFollowSessions.delete(streamId)
      sendLogsFollowEvent(session.sender, deps.logsFollowEventChannel, {
        streamId,
        type: 'end',
        code: code ?? 0
      })
    }
  }

  function nativeAmqpHomebrewLogsFollowStart(
    sender: WebContents,
    service: string,
    tail: number,
    streamId: string
  ): KoinosNodeLogsFollowStartResult {
    const logFiles = deps.nativeAmqpHomebrewLogFiles()
    if (logFiles.length === 0) {
      sendLogsFollowEvent(sender, deps.logsFollowEventChannel, {
        streamId,
        type: 'start',
        service,
        tail
      })
      sendLogsFollowEvent(sender, deps.logsFollowEventChannel, {
        streamId,
        type: 'end',
        code: 0
      })
      return {
        ok: true,
        streamId,
        service,
        tail
      }
    }

    const child = spawn('tail', ['-n', String(tail), '-F', ...logFiles], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const session: LogsFollowSession = {
      sender,
      service,
      tail,
      ended: false,
      stop: () => {
        if (!child.killed) {
          try {
            child.kill('SIGTERM')
          } catch {
            // ignore kill errors
          }
        }
      }
    }
    deps.logsFollowSessions.set(streamId, session)

    const onChunk = (chunk: Buffer | string) => {
      sendLogsFollowEvent(sender, deps.logsFollowEventChannel, {
        streamId,
        type: 'chunk',
        chunk: String(chunk)
      })
    }

    child.stdout.on('data', onChunk)
    child.stderr.on('data', onChunk)

    child.on('error', (error) => {
      if (session.ended) return
      session.ended = true
      deps.logsFollowSessions.delete(streamId)
      sendLogsFollowEvent(sender, deps.logsFollowEventChannel, {
        streamId,
        type: 'error',
        message: error.message
      })
    })

    child.on('close', (code) => {
      if (session.ended) return
      session.ended = true
      deps.logsFollowSessions.delete(streamId)
      sendLogsFollowEvent(sender, deps.logsFollowEventChannel, {
        streamId,
        type: 'end',
        code
      })
    })

    sendLogsFollowEvent(sender, deps.logsFollowEventChannel, {
      streamId,
      type: 'start',
      service,
      tail
    })

    return {
      ok: true,
      streamId,
      service,
      tail
    }
  }

  async function nativeComposeLogs(input?: KoinosNodeLogsInput): Promise<KoinosNodeLogsResult> {
    const settings = deps.normalizeNodeSettings(input)
    const service = input?.service?.trim() || ''
    const tail = normalizeLogsTail(input?.tail)
    const status = await deps.nativeComposeStatus(settings)

    if (service) {
      const logTarget = resolveLogTarget(status, service)
      if (!logTarget) {
        return {
          ok: false,
          service: service || null,
          tail,
          output: `Servicio no gestionado en el perfil actual: ${service}`
        }
      }

      if (logTarget.nativeServiceId === 'amqp' && deps.nativeAmqpUsesBrewService()) {
        return {
          ok: true,
          service: logTarget.service,
          tail,
          output: tailNativeAmqpHomebrewLogs(tail)
        }
      }

      const state = deps.nativeServiceProcesses.get(logTarget.nativeServiceId)
      const output = logTarget.component
        ? filterLogsByComponent(state?.output ?? '', logTarget.component)
        : state?.output ?? ''
      return {
        ok: true,
        service: logTarget.service,
        tail,
        output: tailTextLines(output, tail)
      }
    }

    const output = deps.sortManagedServiceIds(deps.nativeServiceProcesses.keys())
      .map((serviceId) => {
        const state = deps.nativeServiceProcesses.get(serviceId)
        if (!state?.output.trim()) return ''
        return [`== ${serviceId} ==`, tailTextLines(state.output, tail)].filter(Boolean).join('\n')
      })
      .filter(Boolean)
      .join('\n\n')

    const amqpLogs = deps.nativeAmqpUsesBrewService() ? tailNativeAmqpHomebrewLogs(tail) : ''

    return {
      ok: true,
      service: null,
      tail,
      output: [amqpLogs, output].filter(Boolean).join('\n\n')
    }
  }

  async function nativeComposeLogsFollowStart(
    sender: WebContents,
    input?: KoinosNodeLogsFollowStartInput
  ): Promise<KoinosNodeLogsFollowStartResult> {
    const settings = deps.normalizeNodeSettings(input)
    const service = input?.service?.trim() || ''
    const tail = normalizeLogsTail(input?.tail)
    const status = await deps.nativeComposeStatus(settings)

    const streamId = deps.nextStreamId()
    const logTarget = resolveLogTarget(status, service)

    if (!logTarget) {
      return {
        ok: false,
        streamId,
        service: service || null,
        tail,
        output: `Servicio no gestionado en el perfil actual: ${service || '(vacio)'}`
      }
    }

    if (logTarget.nativeServiceId === 'amqp' && deps.nativeAmqpUsesBrewService()) {
      return nativeAmqpHomebrewLogsFollowStart(sender, logTarget.service, tail, streamId)
    }

    const nativeServiceId = logTarget.nativeServiceId
    const session: LogsFollowSession = {
      sender,
      service: logTarget.service,
      tail,
      ended: false,
      stop: () => {
        const streamIds = deps.nativeLogsStreamIdsByService.get(nativeServiceId)
        if (!streamIds) return
        streamIds.delete(streamId)
        if (streamIds.size === 0) deps.nativeLogsStreamIdsByService.delete(nativeServiceId)
      }
    }
    deps.logsFollowSessions.set(streamId, session)

    const streamIds = deps.nativeLogsStreamIdsByService.get(nativeServiceId) ?? new Set<string>()
    streamIds.add(streamId)
    deps.nativeLogsStreamIdsByService.set(nativeServiceId, streamIds)

    sendLogsFollowEvent(sender, deps.logsFollowEventChannel, {
      streamId,
      type: 'start',
      service: logTarget.service,
      tail
    })

    const state = deps.nativeServiceProcesses.get(nativeServiceId)
    const initialOutput = logTarget.component
      ? filterLogsByComponent(state?.output ?? '', logTarget.component)
      : state?.output ?? ''
    const initialChunk = tailTextLines(initialOutput, tail)
    if (initialChunk) {
      sendLogsFollowEvent(sender, deps.logsFollowEventChannel, {
        streamId,
        type: 'chunk',
        chunk: `${initialChunk}\n`
      })
    }

    if (!state || state.closed) {
      stopLogsFollowStream(streamId)
      sendLogsFollowEvent(sender, deps.logsFollowEventChannel, {
        streamId,
        type: 'end',
        code: state?.exitCode ?? 0
      })
    }

    return {
      ok: true,
      streamId,
      service: logTarget.service,
      tail
    }
  }

  return {
    appendNativeServiceOutput,
    closeNativeLogStreamsForService,
    nativeComposeLogs,
    nativeComposeLogsFollowStart,
    normalizeLogsTail,
    stopLogsFollowStream,
    tailTextLines,
    tailNativeAmqpHomebrewLogs
  }
}
