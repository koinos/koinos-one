/// <reference types="vite/client" />
import { useEffect, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import type { Group } from 'three'

import { useExplorer3DFeed } from './useExplorer3DFeed'
import type { BlockRow } from '../../../app/types'
import type { AppLanguage } from '../../../i18n'

type Explorer3DViewProps = {
  t: (key: string, values?: Record<string, string | number>) => string
  language: AppLanguage
  rpcUrl: string
  rows: BlockRow[]
}

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

/**
 * Phase 0 placeholder scene: a slowly rotating wire torus in the assistant
 * palette proves the GPU pipeline (lazy chunk, WebGL2 context, animation
 * clock, pause-on-hidden) before any real data is wired in later phases.
 */
function PlaceholderScene({ animate }: { animate: boolean }) {
  const groupRef = useRef<Group>(null)

  useFrame((_state, delta) => {
    if (!animate || !groupRef.current) return
    groupRef.current.rotation.y += delta * 0.25
    groupRef.current.rotation.x += delta * 0.08
  })

  return (
    <>
      <color attach="background" args={['#fbfcfe']} />
      <fog attach="fog" args={['#fbfcfe', 8, 22]} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[4, 6, 3]} intensity={0.7} />
      <group ref={groupRef}>
        <mesh>
          <torusGeometry args={[2.2, 0.6, 24, 96]} />
          <meshStandardMaterial color="#5d00b3" wireframe opacity={0.5} transparent />
        </mesh>
        <mesh>
          <icosahedronGeometry args={[0.9, 1]} />
          <meshStandardMaterial color="#8c3ff0" roughness={0.35} metalness={0.15} />
        </mesh>
      </group>
    </>
  )
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

export default function Explorer3DView({ t, language, rpcUrl, rows }: Explorer3DViewProps) {
  const [webGlOk] = useState(supportsWebGl2)
  const feed = useExplorer3DFeed({ language, rpcUrl, rows })
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
        camera={{ position: [0, 2.4, 8], fov: 45 }}
        frameloop={animate ? 'always' : 'demand'}
        dpr={[1, 1.75]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <PlaceholderScene animate={animate} />
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
    </div>
  )
}
