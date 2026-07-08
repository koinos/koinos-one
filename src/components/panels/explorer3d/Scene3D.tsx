import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Color, MathUtils } from 'three'
import type { Mesh, MeshStandardMaterial } from 'three'

import type { Block3D, Explorer3DEvent, Explorer3DState } from '../../../app/explorer3d'
import { CHAIN_SPACING, CHAIN_START_X, GATE_POSITION, SCENE_COLORS } from './sceneConstants'
import { TxParticles } from './TxParticles'

/** API gate: a portal ring where transactions enter the scene. */
function ApiGate({ animate }: { animate: boolean }) {
  const ringRef = useRef<Mesh>(null)

  useFrame((state) => {
    if (!animate || !ringRef.current) return
    const material = ringRef.current.material as MeshStandardMaterial
    material.emissiveIntensity = 0.3 + Math.sin(state.clock.elapsedTime * 1.4) * 0.12
  })

  return (
    <group position={[GATE_POSITION.x, GATE_POSITION.y, GATE_POSITION.z]} rotation={[0, 0, Math.PI / 2]}>
      <mesh ref={ringRef}>
        <torusGeometry args={[1.15, 0.08, 20, 72]} />
        <meshStandardMaterial
          color={SCENE_COLORS.gate}
          emissive={SCENE_COLORS.gateEmissive}
          emissiveIntensity={0.35}
          roughness={0.3}
          metalness={0.2}
        />
      </mesh>
      <mesh>
        <torusGeometry args={[1.35, 0.02, 12, 72]} />
        <meshStandardMaterial color={SCENE_COLORS.gate} transparent opacity={0.35} />
      </mesh>
    </group>
  )
}

/**
 * One block cube on the chain track. Slides smoothly to its slot when newer
 * blocks arrive and flashes on arrival (the seal moment). Own-producer blocks
 * keep a persistent purple accent and a stronger arrival pulse.
 */
function BlockCube({
  block,
  index,
  isOwn,
  animate,
  onClick,
  onHover
}: {
  block: Block3D
  index: number
  isOwn: boolean
  animate: boolean
  onClick?: (block: Block3D) => void
  onHover?: (block: Block3D | null) => void
}) {
  const meshRef = useRef<Mesh>(null)
  const spawnedAt = useRef<number | null>(null)
  const size = 0.72
  const targetX = CHAIN_START_X + index * CHAIN_SPACING
  const baseEmissive = isOwn ? 0.3 : 0
  const y = 0.55 + size / 2 + 0.05

  useFrame((state, delta) => {
    const mesh = meshRef.current
    if (!mesh) return
    if (spawnedAt.current === null) {
      spawnedAt.current = state.clock.elapsedTime
      mesh.position.set(targetX, y, 0)
    }
    if (!animate) {
      mesh.position.x = targetX
      const material = mesh.material as MeshStandardMaterial
      material.emissiveIntensity = baseEmissive
      mesh.scale.setScalar(1)
      return
    }
    // Slide toward the current slot as newer blocks push this one down the track.
    mesh.position.x = MathUtils.damp(mesh.position.x, targetX, 6, delta)

    // Seal flash: strong emissive pulse decaying over ~1.2s after arrival.
    const age = state.clock.elapsedTime - spawnedAt.current
    const flash = Math.max(0, 1 - age / 1.2)
    const material = mesh.material as MeshStandardMaterial
    material.emissiveIntensity = baseEmissive + flash * (isOwn ? 1.1 : 0.7)
    mesh.scale.setScalar(1 + flash * 0.25)
  })

  return (
    <mesh
      ref={meshRef}
      position={[targetX, y, 0]}
      onClick={(event) => {
        event.stopPropagation()
        onClick?.(block)
      }}
      onPointerOver={(event) => {
        event.stopPropagation()
        document.body.style.cursor = 'pointer'
        onHover?.(block)
      }}
      onPointerOut={() => {
        document.body.style.cursor = ''
        onHover?.(null)
      }}
    >
      <boxGeometry args={[size, size, size]} />
      <meshStandardMaterial
        color={isOwn ? SCENE_COLORS.blockOwn : SCENE_COLORS.block}
        emissive={isOwn ? SCENE_COLORS.blockOwn : SCENE_COLORS.gateEmissive}
        emissiveIntensity={baseEmissive}
        roughness={0.45}
        metalness={0.1}
      />
    </mesh>
  )
}

function ChainTrack({
  blocks,
  ownProducerAddress,
  animate,
  onBlockClick,
  onHoverBlock
}: {
  blocks: Block3D[]
  ownProducerAddress: string
  animate: boolean
  onBlockClick?: (block: Block3D) => void
  onHoverBlock?: (block: Block3D | null) => void
}) {
  const normalizedOwn = ownProducerAddress.trim().toLowerCase()

  return (
    <group>
      <mesh position={[CHAIN_START_X + 6, 0.55, 0]}>
        <boxGeometry args={[16, 0.06, 1.9]} />
        <meshStandardMaterial color={SCENE_COLORS.track} roughness={0.85} transparent opacity={0.65} />
      </mesh>
      {blocks.map((block, index) => (
        <BlockCube
          key={block.id}
          block={block}
          index={index}
          isOwn={Boolean(normalizedOwn && block.signer.toLowerCase() === normalizedOwn)}
          animate={animate}
          onClick={onBlockClick}
          onHover={onHoverBlock}
        />
      ))}
    </group>
  )
}

export type Scene3DProps = {
  state: Explorer3DState
  revision: number
  lastEvents: Explorer3DEvent[]
  ownProducerAddress: string
  animate: boolean
  maxParticles?: number
  onHoverTx?: (id: string | null) => void
  onBlockClick?: (block: Block3D) => void
  onHoverBlock?: (block: Block3D | null) => void
}

export default function Scene3D({
  state,
  revision,
  lastEvents,
  ownProducerAddress,
  animate,
  maxParticles,
  onHoverTx,
  onBlockClick,
  onHoverBlock
}: Scene3DProps) {
  return (
    <>
      <color attach="background" args={[SCENE_COLORS.background]} />
      <fog attach="fog" args={[SCENE_COLORS.fog, 12, 34]} />
      <ambientLight intensity={0.85} />
      <hemisphereLight args={[new Color('#ffffff'), new Color('#d8e0ec'), 0.5]} />
      <directionalLight position={[6, 9, 4]} intensity={0.65} />

      <ApiGate animate={animate} />
      <TxParticles
        state={state}
        revision={revision}
        lastEvents={lastEvents}
        animate={animate}
        maxParticles={maxParticles}
        onHoverTx={onHoverTx}
      />
      <ChainTrack
        blocks={state.blocks}
        ownProducerAddress={ownProducerAddress}
        animate={animate}
        onBlockClick={onBlockClick}
        onHoverBlock={onHoverBlock}
      />

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        minDistance={6}
        maxDistance={26}
        maxPolarAngle={Math.PI * 0.52}
        autoRotate={animate}
        autoRotateSpeed={0.3}
      />
    </>
  )
}
