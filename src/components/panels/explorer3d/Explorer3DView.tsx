/// <reference types="vite/client" />
import { useEffect, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'

import Scene3D from './Scene3D'
import { useExplorer3DFeed } from './useExplorer3DFeed'
import type { Block3D } from '../../../app/explorer3d'
import type { BlockRow, ExplorerSettings } from '../../../app/types'
import type { AppLanguage } from '../../../i18n'
import { shortHash } from '../../../app/utils'

type Explorer3DViewProps = {
  t: (key: string, values?: Record<string, string | number>) => string
  language: AppLanguage
  rpcUrl: string
  rows: BlockRow[]
  ownProducerAddress?: string | null
  quality?: ExplorerSettings['explorer3dQuality']
  onBlockClick?: (row: BlockRow) => void
}

const QUALITY_PRESETS = {
  low: { dpr: [1, 1] as [number, number], maxParticles: 200, antialias: false, autoOrbit: false },
  medium: { dpr: [1, 1.75] as [number, number], maxParticles: 500, antialias: true, autoOrbit: true },
  high: { dpr: [1, 2] as [number, number], maxParticles: 500, antialias: true, autoOrbit: true }
} as const

function supportsWebGl2(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('webgl2')
    return Boolean(context)
  } catch {
    return false
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Dev-only FPS meter driven by the render loop itself. */
function FpsProbe({ onSample }: { onSample: (fps: number) => void }) {
  const frames = useRef(0)
  const windowStart = useRef(0)

  useFrame(({ clock }) => {
    frames.current += 1
    const elapsed = clock.elapsedTime - windowStart.current
    if (elapsed >= 1) {
      onSample(Math.round(frames.current / elapsed))
      frames.current = 0
      windowStart.current = clock.elapsedTime
    }
  })

  return null
}

export default function Explorer3DView({
  t,
  language,
  rpcUrl,
  rows,
  ownProducerAddress,
  quality = 'medium',
  onBlockClick
}: Explorer3DViewProps) {
  const [webGlOk] = useState(supportsWebGl2)
  const feed = useExplorer3DFeed({ language, rpcUrl, rows })
  const [hoveredTxId, setHoveredTxId] = useState<string | null>(null)
  const [hoveredBlock, setHoveredBlock] = useState<Block3D | null>(null)
  const preset = QUALITY_PRESETS[quality === 'off' ? 'medium' : quality]

  const handleBlockClick = (block: Block3D) => {
    if (!onBlockClick) return
    const row = rows.find((candidate) => candidate.blockId === block.id)
    onBlockClick(
      row ?? {
        height: block.height,
        blockId: block.id,
        previousId: '',
        signer: block.signer,
        timestampMs: block.timestampMs,
        txIds: block.txIds
      }
    )
  }

  const hoveredTx = hoveredTxId ? feed.state.txs.get(hoveredTxId) ?? null : null
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden')
  const [fps, setFps] = useState<number | null>(null)
  const reducedMotion = prefersReducedMotion()

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  if (!webGlOk) {
    return (
      <div className="explorer3d-fallback" role="note">
        <strong>{t('explorer3d.unavailableTitle')}</strong>
        <p>{t('explorer3d.unavailableBody')}</p>
      </div>
    )
  }

  const animate = visible && !reducedMotion

  return (
    <div className="explorer3d-stage" aria-label={t('explorer3d.stageAria')}>
      <Canvas
        camera={{ position: [0, 4.2, 13], fov: 45 }}
        frameloop={animate ? 'always' : 'demand'}
        dpr={preset.dpr}
        gl={{ antialias: preset.antialias, powerPreference: 'high-performance' }}
      >
        <Scene3D
          state={feed.state}
          revision={feed.revision}
          lastEvents={feed.lastEvents}
          ownProducerAddress={`${ownProducerAddress ?? ''}`}
          animate={animate && preset.autoOrbit}
          maxParticles={preset.maxParticles}
          onHoverTx={setHoveredTxId}
          onBlockClick={handleBlockClick}
          onHoverBlock={setHoveredBlock}
        />
        {import.meta.env.DEV && <FpsProbe onSample={setFps} />}
      </Canvas>
      <div className="explorer3d-hud">
        <span className="explorer3d-badge">{t('explorer3d.experimentalBadge')}</span>
        <span className="explorer3d-hint">
          {feed.mempoolAvailable
            ? t('explorer3d.feedCounts', {
                pending: feed.counts.pending,
                blocks: feed.counts.blocks
              })
            : t('explorer3d.blocksOnlyMode')}
        </span>
        {import.meta.env.DEV && fps !== null && (
          <span className="explorer3d-fps mono">{fps} fps</span>
        )}
      </div>
      {(hoveredTx || hoveredBlock) && (
        <div className="explorer3d-tooltip mono" role="status">
          {hoveredTx
            ? t('explorer3d.hoverTx', {
                id: shortHash(hoveredTx.id, 10, 6),
                payer: hoveredTx.payer ? shortHash(hoveredTx.payer, 8, 6) : t('common.na'),
                ops: hoveredTx.opCount ?? 0
              })
            : hoveredBlock
              ? t('explorer3d.hoverBlock', {
                  height: hoveredBlock.height.toLocaleString(),
                  signer: shortHash(hoveredBlock.signer, 10, 6)
                })
              : null}
        </div>
      )}
    </div>
  )
}
