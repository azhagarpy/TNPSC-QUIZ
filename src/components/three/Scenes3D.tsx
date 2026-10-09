import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { stepDownTier, type Tier } from '../../lib/device';
import { track } from '../../lib/telemetry';

// Low-poly procedural scenes (no model downloads): stake pot, results podium,
// home treasure chest, level-up trophy and lobby table. frameloop="demand"
// renders only while something moves; the FPS guard steps the device down a
// tier if a scene drops below 30 fps for 2 seconds, and each animation reports
// its average fps per tier (plan: in-app frame-rate logger).

export type SceneProps =
  | { kind: 'pot'; count: number; tier: Tier }
  | { kind: 'podium'; entries: { avatar: string; name: string; rank: number; color: string }[]; tier: Tier }
  | { kind: 'chest'; open: boolean; animate: boolean; tier: Tier }
  | { kind: 'levelup'; tier: Tier }
  | { kind: 'table'; seats: { color: string; ready: boolean; present: boolean }[]; count: number; tier: Tier };

const CAMERA: Record<SceneProps['kind'], [number, number, number]> = {
  pot: [0, 2.4, 3.8],
  podium: [0, 1.8, 5.2],
  chest: [0, 1.6, 3.4],
  levelup: [0, 0.6, 3.6],
  table: [0, 3.4, 3.4],
};

const coinGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.06, 20);
const coinMat = new THREE.MeshStandardMaterial({ color: '#f2b705', metalness: 0.75, roughness: 0.3 });

export default function Scenes3D(props: SceneProps) {
  const dpr: [number, number] | number = props.tier === 'high' ? [1, 1.5] : 1;
  return (
    <Canvas
      frameloop="demand"
      dpr={dpr}
      gl={{ antialias: props.tier === 'high', powerPreference: 'low-power', alpha: true }}
      camera={{ position: CAMERA[props.kind], fov: 40 }}
      aria-hidden
    >
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 5, 2]} intensity={1.5} />
      <PauseWhenHidden />
      {props.kind === 'pot' && <StakePot count={props.count} tier={props.tier} />}
      {props.kind === 'podium' && <Podium entries={props.entries} tier={props.tier} />}
      {props.kind === 'chest' && <Chest open={props.open} animate={props.animate} tier={props.tier} />}
      {props.kind === 'levelup' && <Trophy tier={props.tier} />}
      {props.kind === 'table' && <Table seats={props.seats} count={props.count} tier={props.tier} />}
    </Canvas>
  );
}

function PauseWhenHidden() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const onVis = () => !document.hidden && invalidate();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [invalidate]);
  return null;
}

/** Keeps rendering while `until` is in the future; watches and reports frame rate. */
function useAnimate(until: React.MutableRefObject<number>, scene: string, tier: Tier) {
  const invalidate = useThree((s) => s.invalidate);
  const slow = useRef({ since: 0 });
  const stats = useRef({ frames: 0, time: 0 });
  useFrame((_, delta) => {
    const now = performance.now();
    if (now < until.current) {
      if (1 / delta < 30) {
        slow.current.since ||= now;
        if (now - slow.current.since > 2000) stepDownTier();
      } else slow.current.since = 0;
      if (delta < 0.5) {
        stats.current.frames++;
        stats.current.time += delta;
      }
      invalidate();
    } else if (stats.current.frames > 10) {
      track('fps', { scene, tier, avg: Math.round(stats.current.frames / stats.current.time) });
      stats.current = { frames: 0, time: 0 };
    }
  });
  return invalidate;
}

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const goldMat = new THREE.MeshStandardMaterial({ color: '#f2b705', metalness: 0.8, roughness: 0.25, emissive: '#7a5200', emissiveIntensity: 0.2 });

/** Home treasure chest: the lid opens once today's reward is collected. */
function Chest({ open, animate, tier }: { open: boolean; animate: boolean; tier: Tier }) {
  const until = useRef(0);
  const invalidate = useAnimate(until, 'chest', tier);
  const start = useRef(0);
  const lid = useRef<THREE.Group>(null);
  const glow = useRef<THREE.PointLight>(null);
  useEffect(() => {
    start.current = animate ? performance.now() : performance.now() - 10_000;
    until.current = performance.now() + (animate ? 2400 : 50);
    invalidate();
  }, [open, animate, invalidate]);
  useFrame(() => {
    const t = (performance.now() - start.current - 300) / 1300;
    const a = open ? ease(t) : 0;
    if (lid.current) lid.current.rotation.x = -a * 1.9;
    if (glow.current) glow.current.intensity = open ? 1.2 + 2 * Math.sin(Math.min(1, Math.max(0, t)) * Math.PI) : 0;
  });
  return (
    <group position={[0, -0.55, 0]} rotation={[0.1, -0.5, 0]}>
      <mesh position={[0, 0.38, 0]}>
        <boxGeometry args={[1.6, 0.76, 1]} />
        <meshStandardMaterial color="#8b4513" roughness={0.8} />
      </mesh>
      {[-0.55, 0.55].map((x) => (
        <mesh key={x} position={[x, 0.38, 0]} material={goldMat}>
          <boxGeometry args={[0.12, 0.78, 1.02]} />
        </mesh>
      ))}
      {open &&
        [-0.35, 0, 0.35, -0.15, 0.2].map((x, i) => (
          <mesh key={i} position={[x, 0.8 + (i > 2 ? 0.06 : 0), (i % 2) * 0.2 - 0.1]} rotation={[0.3 * i, 0, 0.2]} geometry={coinGeo} material={coinMat} />
        ))}
      <group ref={lid} position={[0, 0.76, -0.5]}>
        <mesh position={[0, 0.17, 0.5]}>
          <boxGeometry args={[1.6, 0.34, 1]} />
          <meshStandardMaterial color="#a0522d" roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.17, 1.0]} material={goldMat}>
          <boxGeometry args={[0.22, 0.2, 0.06]} />
        </mesh>
      </group>
      <pointLight ref={glow} position={[0, 1.1, 0.2]} color="#ffd166" distance={3.5} intensity={0} />
    </group>
  );
}

/** Level up: a trophy flips and glows, then settles. */
function Trophy({ tier }: { tier: Tier }) {
  const until = useRef(0);
  const invalidate = useAnimate(until, 'levelup', tier);
  const start = useRef(0);
  const ref = useRef<THREE.Group>(null);
  const cupGeo = useMemo(
    () =>
      new THREE.LatheGeometry(
        [new THREE.Vector2(0.06, 0), new THREE.Vector2(0.38, 0.05), new THREE.Vector2(0.5, 0.45), new THREE.Vector2(0.55, 0.75), new THREE.Vector2(0.5, 0.78)],
        32,
      ),
    [],
  );
  useEffect(() => {
    start.current = performance.now();
    until.current = start.current + 2800;
    invalidate();
  }, [invalidate]);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const t = (performance.now() - start.current) / 2200;
    const e = ease(t);
    g.rotation.y = (1 - e) * Math.PI * 4;
    g.scale.setScalar(0.6 + 0.4 * ease(t * 2) + 0.08 * Math.sin(Math.min(1, t) * Math.PI));
    goldMat.emissiveIntensity = 0.2 + 0.8 * Math.sin(Math.min(1, t) * Math.PI);
  });
  return (
    <group ref={ref} position={[0, -0.75, 0]}>
      <mesh position={[0, 0.1, 0]}>
        <boxGeometry args={[0.8, 0.2, 0.8]} />
        <meshStandardMaterial color="#5b34d6" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.4, 0]} material={goldMat}>
        <cylinderGeometry args={[0.07, 0.12, 0.4, 16]} />
      </mesh>
      <mesh position={[0, 0.6, 0]} geometry={cupGeo} material={goldMat} />
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.55, 1.05, 0]} rotation={[0, 0, side * 0.2]} material={goldMat}>
          <torusGeometry args={[0.16, 0.035, 8, 20, Math.PI]} />
        </mesh>
      ))}
    </group>
  );
}

/** Lobby: a round table with 2–4 seats; a seat lights up when that player is ready. */
function Table({ seats, count, tier }: { seats: { color: string; ready: boolean; present: boolean }[]; count: number; tier: Tier }) {
  const until = useRef(0);
  const invalidate = useAnimate(until, 'table', tier);
  const changed = useRef(0);
  const key = seats.map((s) => `${s.present ? 1 : 0}${s.ready ? 1 : 0}`).join('');
  useEffect(() => {
    changed.current = performance.now();
    until.current = changed.current + 1500;
    invalidate();
  }, [key, invalidate]);
  return (
    <group position={[0, -0.4, 0]}>
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[1.45, 1.45, 0.12, 40]} />
        <meshStandardMaterial color="#7a4a22" roughness={0.7} />
      </mesh>
      {seats.map((s, i) => {
        const a = (i / seats.length) * Math.PI * 2 + Math.PI / 2;
        return <Seat key={i} x={Math.cos(a) * 1.9} z={Math.sin(a) * 1.9} seat={s} changed={changed} />;
      })}
      <group scale={0.55} position={[0, 0.06, 0]}>
        <StakePot count={count} tier={tier} />
      </group>
    </group>
  );
}

function Seat({ x, z, seat, changed }: { x: number; z: number; seat: { color: string; ready: boolean; present: boolean }; changed: React.MutableRefObject<number> }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(() => {
    if (!mat.current) return;
    const t = Math.min(1, (performance.now() - changed.current) / 900);
    mat.current.emissiveIntensity = seat.ready ? 0.25 + 0.6 * Math.sin(t * Math.PI) + 0.25 * t : 0;
  });
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, -0.05, 0]}>
        <cylinderGeometry args={[0.34, 0.34, 0.22, 24]} />
        <meshStandardMaterial ref={mat} color={seat.present ? seat.color : '#777777'} emissive={seat.ready ? '#2ecc71' : '#000000'} roughness={0.6} />
      </mesh>
      {seat.ready && (
        <mesh position={[0, -0.17, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.38, 0.48, 32]} />
          <meshBasicMaterial color="#2ecc71" />
        </mesh>
      )}
    </group>
  );
}

function StakePot({ count, tier }: { count: number; tier: Tier }) {
  const until = useRef(0);
  const invalidate = useAnimate(until, 'pot', tier);
  const born = useRef<number[]>([]);
  const coins = Math.min(tier === 'high' ? 24 : 12, Math.max(1, count * 3));

  useEffect(() => {
    const now = performance.now();
    for (let i = born.current.length; i < coins; i++) born.current[i] = now + (i - born.current.length) * 140;
    born.current.length = coins;
    until.current = now + coins * 140 + 1400;
    invalidate();
  }, [coins, invalidate]);

  const potGeo = useMemo(() => {
    const pts = [
      new THREE.Vector2(0, -0.45), new THREE.Vector2(0.7, -0.4), new THREE.Vector2(0.95, -0.1),
      new THREE.Vector2(0.9, 0.25), new THREE.Vector2(0.72, 0.42), new THREE.Vector2(0.8, 0.5),
    ];
    return new THREE.LatheGeometry(pts, 28);
  }, []);

  return (
    <group position={[0, -0.6, 0]}>
      <mesh geometry={potGeo}>
        <meshStandardMaterial color="#a0522d" roughness={0.8} side={THREE.DoubleSide} />
      </mesh>
      {Array.from({ length: coins }, (_, i) => (
        <FallingCoin key={i} index={i} born={born} />
      ))}
    </group>
  );
}

function FallingCoin({ index, born }: { index: number; born: React.MutableRefObject<number[]> }) {
  const ref = useRef<THREE.Mesh>(null);
  const target = useMemo(() => {
    const a = index * 2.4;
    const r = 0.12 + (index % 4) * 0.08;
    return new THREE.Vector3(Math.cos(a) * r, 0.0 + Math.floor(index / 5) * 0.06, Math.sin(a) * r);
  }, [index]);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const t = (performance.now() - (born.current[index] ?? 0)) / 900;
    if (t < 0) {
      m.visible = false;
      return;
    }
    m.visible = true;
    const p = Math.min(1, t);
    const ease = 1 - (1 - p) * (1 - p);
    m.position.set(target.x, 3 - (3 - target.y) * ease, target.z);
    m.rotation.set(p < 1 ? t * 9 : 0.15, index, 0);
  });
  return <mesh ref={ref} geometry={coinGeo} material={coinMat} visible={false} />;
}

const HEIGHTS: Record<number, number> = { 1: 1.15, 2: 0.82, 3: 0.58, 4: 0.4 };

function Podium({ entries, tier }: { entries: { name: string; rank: number; color: string }[]; tier: Tier }) {
  const until = useRef(0);
  const invalidate = useAnimate(until, 'podium', tier);
  const start = useRef(0);
  const width = 1.15;
  const x0 = -((entries.length - 1) * width) / 2;
  const winnerX = x0 + Math.max(0, entries.findIndex((e) => e.rank === 1)) * width;
  const burst = tier === 'high' ? 22 : 10;

  useEffect(() => {
    start.current = performance.now();
    until.current = start.current + 3800;
    invalidate();
  }, [invalidate, entries.length]);

  return (
    <group position={[0, -1.1, 0]}>
      {entries.map((e, i) => {
        const h = HEIGHTS[e.rank] ?? 0.35;
        return (
          <group key={i} position={[x0 + i * width, 0, 0]}>
            <mesh position={[0, h / 2, 0]}>
              <boxGeometry args={[1, h, 0.9]} />
              <meshStandardMaterial color={e.rank === 1 ? '#f2b705' : '#6a4fd8'} roughness={0.6} />
            </mesh>
            <Pawn color={e.color} top={h} delay={(entries.length - e.rank) * 0.25} start={start} />
          </group>
        );
      })}
      {Array.from({ length: burst }, (_, i) => (
        <BurstCoin key={i} index={i} count={burst} toX={winnerX} toY={(HEIGHTS[1] ?? 1) + 0.9} start={start} />
      ))}
    </group>
  );
}

function Pawn({ color, top, delay, start }: { color: string; top: number; delay: number; start: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const t = Math.min(1, Math.max(0, ((performance.now() - start.current) / 1000 - delay) / 0.9));
    const ease = 1 - Math.pow(1 - t, 3);
    g.position.y = top - 0.9 + 0.9 * ease;
    g.visible = t > 0;
  });
  return (
    <group ref={ref} visible={false}>
      <mesh position={[0, 0.3, 0]}>
        <coneGeometry args={[0.28, 0.6, 16]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.72, 0]}>
        <sphereGeometry args={[0.2, 16, 12]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  );
}

function BurstCoin({ index, count, toX, toY, start }: { index: number; count: number; toX: number; toY: number; start: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.Mesh>(null);
  const spread = useMemo(() => ({ a: (index / count) * Math.PI * 2, d: 0.6 + (index % 3) * 0.25 }), [index, count]);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const t = ((performance.now() - start.current) / 1000 - 1.4 - index * 0.03) / 1.4;
    if (t < 0 || t > 1) {
      m.visible = false;
      return;
    }
    m.visible = true;
    // From the front-centre pot, arc up and out, then gather at the winner.
    const out = Math.sin(t * Math.PI) * spread.d;
    m.position.set(toX * t + Math.cos(spread.a) * out, 0.2 + (toY - 0.2) * t + Math.sin(t * Math.PI) * 0.9, 0.8 + Math.sin(spread.a) * out * 0.4);
    m.rotation.set(t * 12, t * 6, 0);
  });
  return <mesh ref={ref} geometry={coinGeo} material={coinMat} visible={false} scale={0.7} />;
}
