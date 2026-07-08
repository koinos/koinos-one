import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Color, Matrix4, Quaternion, Vector3 } from 'three'
import type { Group, InstancedMesh } from 'three'

import { mempoolSlot, type Block3D, type Explorer3DState } from '../../../app/explorer3d'

export const SCENE_COLORS = {
  background: '#fbfcfe',
  fog: '#fbfcfe',
  gate: '#8c3ff0',
  gateEmissive: '#5d00b3',
  pendingTx: '#5d00b3',
  block: '#33485b',
  blockOwn: '#5d00b3',
  track: '#d8e0ec'
} as const

export const MAX_RENDERED_PENDING_TX = 500
const GATE_POSITION = new Vector3(-9, 1.6, 0)
const CHAIN_START_X = 2.2
const CHAIN_SPACING = 1.35

/** API gate: a portal ring where transactions enter the scene. */
function ApiGate() {
  return (
    <group position={GATE_POSITION.toArray()} rotation={[0, 0, Math.PI / 2]}>
      <mesh>
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

/** Instanced pending-transaction particles in static orbital slots. */
function MempoolCluster({ state, revision }: { state: Explorer3DState; revision: number }) {
  const meshRef = useRef<InstancedMesh>(null)
  const matrix = useMemo(() => new Matrix4(), [])
  const quaternion = useMemo(() => new Quaternion(), [])
  const scale = useMemo(() => new Vector3(1, 1, 1), [])
  const position = useMemo(() => new Vector3(), [])

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    let index = 0
    for (const tx of state.txs.values()) {
      if (tx.stage !== 'pending') continue
      if (index >= MAX_RENDERED_PENDING_TX) break
      const slot = mempoolSlot(tx.id)
      position.set(slot.x, slot.y, slot.z)
      matrix.compose(position, quaternion, scale)
      mesh.setMatrixAt(index, matrix)
      index += 1
    }
    mesh.count = index
    mesh.instanceMatrix.needsUpdate = true
    // revision drives refresh when the feed folds new data
  }, [state, revision, matrix, quaternion, scale, position])

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_RENDERED_PENDING_TX]} frustumCulled={false}>
      <sphereGeometry args={[0.09, 12, 12]} />
      <meshStandardMaterial
        color={SCENE_COLORS.pendingTx}
        emissive={SCENE_COLORS.pendingTx}
        emissiveIntensity={0.25}
        roughness={0.4}
      />
    </instancedMesh>
  )
}

/** Receding track of the most recent real blocks; own-producer blocks accented. */
function ChainTrack({ blocks, ownProducerAddress }: { blocks: Block3D[]; ownProducerAddress: string }) {
  const normalizedOwn = ownProducerAddress.trim().toLowerCase()

  return (
    <group>
      <mesh position={[CHAIN_START_X + 6, 0.55, 0]} rotation={[0, 0, 0]}>
        <boxGeometry args={[16, 0.06, 1.9]} />
        <meshStandardMaterial color={SCENE_COLORS.track} roughness={0.85} transparent opacity={0.65} />
      </mesh>
      {blocks.map((block, index) => {
        const isOwn = Boolean(normalizedOwn && block.signer.toLowerCase() === normalizedOwn)
        const size = 0.72
        return (
          <mesh
            key={block.id}
            position={[CHAIN_START_X + index * CHAIN_SPACING, 0.55 + size / 2 + 0.05, 0]}
          >
            <boxGeometry args={[size, size, size]} />
            <meshStandardMaterial
              color={isOwn ? SCENE_COLORS.blockOwn : SCENE_COLORS.block}
              emissive={isOwn ? SCENE_COLORS.blockOwn : '#000000'}
              emissiveIntensity={isOwn ? 0.3 : 0}
              roughness={0.45}
              metalness={0.1}
            />
          </mesh>
        )
      })}
    </group>
  )
}

/** Gentle idle rotation for the mempool cluster so the scene never looks frozen. */
function IdleSpin({ animate, children }: { animate: boolean; children: React.ReactNode }) {
  const groupRef = useRef<Group>(null)
  useFrame((_state, delta) => {
    if (!animate || !groupRef.current) return
    groupRef.current.rotation.y += delta * 0.12
  })
  return <group ref={groupRef}>{children}</group>
}

export type Scene3DProps = {
  state: Explorer3DState
  revision: number
  ownProducerAddress: string
  animate: boolean
}

export default function Scene3D({ state, revision, ownProducerAddress, animate }: Scene3DProps) {
  return (
    <>
      <color attach="background" args={[SCENE_COLORS.background]} />
      <fog attach="fog" args={[SCENE_COLORS.fog, 12, 34]} />
      <ambientLight intensity={0.85} />
      <hemisphereLight args={[new Color('#ffffff'), new Color('#d8e0ec'), 0.5]} />
      <directionalLight position={[6, 9, 4]} intensity={0.65} />

      <ApiGate />
      <IdleSpin animate={animate}>
        <MempoolCluster state={state} revision={revision} />
      </IdleSpin>
      <ChainTrack blocks={state.blocks} ownProducerAddress={ownProducerAddress} />

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        minDistance={6}
        maxDistance={26}
        maxPolarAngle={Math.PI * 0.52}
        autoRotate={animate}
        autoRotateSpeed={0.35}
      />
    </>
  )
}
