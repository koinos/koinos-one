import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Matrix4, Quaternion, Vector3 } from 'three'
import type { InstancedMesh } from 'three'

import { hash01, mempoolSlot, MEMPOOL_CENTER, type Explorer3DEvent, type Explorer3DState } from '../../../app/explorer3d'
import { CHAIN_BLOCK_POSITION, GATE_POSITION, MAX_RENDERED_PENDING_TX, SCENE_COLORS } from './sceneConstants'

const SPAWN_DURATION_S = 0.9
const ABSORB_DURATION_S = 0.45
const FADE_DURATION_S = 0.6

type ParticlePhase = 'spawning' | 'orbiting' | 'absorbing' | 'fading'

type Particle = {
  id: string
  phase: ParticlePhase
  phaseStart: number
  slot: { x: number; y: number; z: number }
  orbitAngle: number
  orbitRadius: number
  orbitSpeed: number
  orbitY: number
  from: Vector3
  to: Vector3
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function easeInCubic(t: number): number {
  return t * t * t
}

function makeParticle(id: string, now: number, spawnFromGate: boolean): Particle {
  const slot = mempoolSlot(id)
  const dx = slot.x - MEMPOOL_CENTER.x
  const dz = slot.z - MEMPOOL_CENTER.z
  return {
    id,
    phase: spawnFromGate ? 'spawning' : 'orbiting',
    phaseStart: now,
    slot,
    orbitAngle: Math.atan2(dz, dx),
    orbitRadius: Math.hypot(dx, dz),
    orbitSpeed: 0.25 + hash01(id, 4) * 0.35,
    orbitY: slot.y,
    from: new Vector3(GATE_POSITION.x, GATE_POSITION.y, GATE_POSITION.z),
    to: new Vector3(slot.x, slot.y, slot.z)
  }
}

/**
 * Animated transaction particles: spawn at the API gate when first seen in
 * the mempool, orbit the mempool center while pending, fly into the sealing
 * block when included, and fade out when dropped. All animation state lives
 * in refs; React re-renders only on feed revisions.
 */
export function TxParticles({
  state,
  revision,
  lastEvents,
  animate,
  maxParticles = MAX_RENDERED_PENDING_TX,
  onHoverTx
}: {
  state: Explorer3DState
  revision: number
  lastEvents: Explorer3DEvent[]
  animate: boolean
  maxParticles?: number
  onHoverTx?: (id: string | null) => void
}) {
  const meshRef = useRef<InstancedMesh>(null)
  const particlesRef = useRef<Map<string, Particle>>(new Map())
  const clockRef = useRef(0)
  const indexToIdRef = useRef<string[]>([])

  const matrix = useMemo(() => new Matrix4(), [])
  const quaternion = useMemo(() => new Quaternion(), [])
  const scaleVec = useMemo(() => new Vector3(), [])
  const positionVec = useMemo(() => new Vector3(), [])

  // Fold feed events into particle lifecycle changes.
  useEffect(() => {
    const particles = particlesRef.current
    const now = clockRef.current
    for (const event of lastEvents) {
      if (event.type === 'tx-seen') {
        if (!particles.has(event.id) && particles.size < maxParticles) {
          particles.set(event.id, makeParticle(event.id, now, animate))
        }
      } else if (event.type === 'tx-included') {
        const particle = particles.get(event.id)
        if (particle && particle.phase !== 'absorbing') {
          particle.phase = 'absorbing'
          particle.phaseStart = now
          particle.from.set(
            MEMPOOL_CENTER.x + Math.cos(particle.orbitAngle) * particle.orbitRadius,
            particle.orbitY,
            MEMPOOL_CENTER.z + Math.sin(particle.orbitAngle) * particle.orbitRadius
          )
          particle.to.set(CHAIN_BLOCK_POSITION.x, CHAIN_BLOCK_POSITION.y, CHAIN_BLOCK_POSITION.z)
        }
      } else if (event.type === 'tx-dropped') {
        const particle = particles.get(event.id)
        if (particle && particle.phase !== 'fading') {
          particle.phase = 'fading'
          particle.phaseStart = now
        }
      }
    }
    // Reconcile against the store in case events were missed (cache rebuilds,
    // first mount with existing pending transactions).
    for (const tx of state.txs.values()) {
      if (tx.stage === 'pending' && !particles.has(tx.id) && particles.size < maxParticles) {
        particles.set(tx.id, makeParticle(tx.id, now, false))
      }
    }
  }, [revision, lastEvents, state, animate, maxParticles])

  useFrame((_frameState, delta) => {
    const mesh = meshRef.current
    if (!mesh) return
    const dt = animate ? delta : 0
    clockRef.current += dt
    const now = clockRef.current
    const particles = particlesRef.current

    const indexToId = indexToIdRef.current
    indexToId.length = 0
    let index = 0
    for (const particle of particles.values()) {
      if (index >= maxParticles) break
      let scale = 1
      const elapsed = now - particle.phaseStart

      if (particle.phase === 'spawning') {
        const t = Math.min(1, elapsed / SPAWN_DURATION_S)
        const eased = easeOutCubic(t)
        positionVec.lerpVectors(particle.from, particle.to, eased)
        scale = 0.4 + eased * 0.6
        if (t >= 1) {
          particle.phase = 'orbiting'
          particle.phaseStart = now
        }
      } else if (particle.phase === 'orbiting') {
        particle.orbitAngle += particle.orbitSpeed * dt
        positionVec.set(
          MEMPOOL_CENTER.x + Math.cos(particle.orbitAngle) * particle.orbitRadius,
          particle.orbitY + Math.sin(now * 0.8 + particle.orbitRadius * 3) * 0.08,
          MEMPOOL_CENTER.z + Math.sin(particle.orbitAngle) * particle.orbitRadius
        )
      } else if (particle.phase === 'absorbing') {
        const t = Math.min(1, elapsed / ABSORB_DURATION_S)
        positionVec.lerpVectors(particle.from, particle.to, easeInCubic(t))
        scale = 1 - t * 0.7
        if (t >= 1) {
          particles.delete(particle.id)
          continue
        }
      } else {
        const t = Math.min(1, elapsed / FADE_DURATION_S)
        const slot = particle.slot
        positionVec.set(slot.x, slot.y - t * 1.4, slot.z)
        scale = 1 - t
        if (t >= 1) {
          particles.delete(particle.id)
          continue
        }
      }

      scaleVec.setScalar(Math.max(0.001, scale))
      matrix.compose(positionVec, quaternion, scaleVec)
      mesh.setMatrixAt(index, matrix)
      indexToId[index] = particle.id
      index += 1
    }

    mesh.count = index
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, MAX_RENDERED_PENDING_TX]}
      frustumCulled={false}
      onPointerMove={(event) => {
        event.stopPropagation()
        const id = event.instanceId !== undefined ? indexToIdRef.current[event.instanceId] ?? null : null
        onHoverTx?.(id)
      }}
      onPointerOut={() => onHoverTx?.(null)}
    >
      <sphereGeometry args={[0.09, 12, 12]} />
      <meshStandardMaterial
        color={SCENE_COLORS.pendingTx}
        emissive={SCENE_COLORS.pendingTx}
        emissiveIntensity={0.3}
        roughness={0.4}
      />
    </instancedMesh>
  )
}
