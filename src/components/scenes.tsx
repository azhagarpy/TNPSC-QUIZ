import { Component, Suspense, lazy, type ReactNode } from 'react';
import { useTier, type Tier } from '../lib/device';
import { AVATARS } from '../lib/units';
import { Coin, cx } from './ui';

// Reward moments (plan: MVP ships the stake pot and the results podium).
// three.js is a separate chunk loaded only on high/medium-tier phones; low tier
// and reduced motion get light 2D versions of the same moments.

const Scene3D = lazy(() => import('./three/Scenes3D'));

export interface PodiumEntry {
  avatar: string;
  name: string;
  rank: number;
}

class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function use3D(tier: Tier) {
  return tier === 'high' || tier === 'medium';
}

export function StakePotScene({ count, stake }: { count: number; stake: number }) {
  const tier = useTier();
  const flat = <StakePot2D count={count} still={tier === 'reduced'} />;
  return (
    <div className="relative h-40 w-full overflow-hidden rounded-3xl bg-linear-to-b from-accent-bg to-surface-2">
      {use3D(tier) ? (
        <SceneBoundary fallback={flat}>
          <Suspense fallback={flat}>
            <Scene3D kind="pot" count={count} tier={tier} />
          </Suspense>
        </SceneBoundary>
      ) : (
        flat
      )}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-surface/90 px-3 py-1 text-sm font-bold shadow-card">
        <span className="inline-flex items-center gap-1">
          <Coin /> {(count * stake).toLocaleString('en-IN')}
        </span>
      </div>
    </div>
  );
}

export function PodiumScene({ entries }: { entries: PodiumEntry[] }) {
  const tier = useTier();
  const ordered = podiumOrder(entries);
  const flat = <Podium2D entries={ordered} still={tier === 'reduced'} />;
  return (
    <div className="w-full">
      <div className="relative h-48 w-full overflow-hidden rounded-3xl bg-linear-to-b from-accent-bg to-surface-2">
        {use3D(tier) ? (
          <SceneBoundary fallback={flat}>
            <Suspense fallback={flat}>
              <Scene3D kind="podium" entries={ordered.map((e) => ({ ...e, color: AVATARS[e.avatar]?.bg ?? '#ccc' }))} tier={tier} />
            </Suspense>
          </SceneBoundary>
        ) : (
          flat
        )}
      </div>
      {use3D(tier) && (
        <div className="mt-2 grid text-center text-xs" style={{ gridTemplateColumns: `repeat(${ordered.length}, minmax(0, 1fr))` }}>
          {ordered.map((e) => (
            <div key={e.name + e.rank} className="truncate px-1">
              <span className="font-bold">#{e.rank}</span> {AVATARS[e.avatar]?.emoji} {e.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Home: treasure chest with the coin balance; the lid opens once today's reward is collected. */
export function ChestScene({ open, animate }: { open: boolean; animate: boolean }) {
  const tier = useTier();
  const flat = <Chest2D open={open} animate={animate && tier !== 'reduced'} />;
  if (!use3D(tier)) return flat;
  return (
    <SceneBoundary fallback={flat}>
      <Suspense fallback={flat}>
        <Scene3D kind="chest" open={open} animate={animate} tier={tier} />
      </Suspense>
    </SceneBoundary>
  );
}

/** Lobby: round table, one seat per player; a seat lights up when that player is ready. */
export function TableScene({ seats, stake }: { seats: { avatar: string; ready: boolean; present: boolean }[]; stake: number }) {
  const tier = useTier();
  const present = seats.filter((s) => s.present).length;
  const flat = <StakePot2D count={present} still={tier === 'reduced'} />;
  return (
    <div className="relative h-44 w-full overflow-hidden rounded-3xl bg-linear-to-b from-accent-bg to-surface-2">
      {use3D(tier) ? (
        <SceneBoundary fallback={flat}>
          <Suspense fallback={flat}>
            <Scene3D
              kind="table"
              tier={tier}
              count={present}
              seats={seats.map((s) => ({ color: AVATARS[s.avatar]?.bg ?? '#F2B705', ready: s.ready, present: s.present }))}
            />
          </Suspense>
        </SceneBoundary>
      ) : (
        flat
      )}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-surface/90 px-3 py-1 text-sm font-bold shadow-card">
        <span className="inline-flex items-center gap-1">
          <Coin /> {(present * stake).toLocaleString('en-IN')}
        </span>
      </div>
    </div>
  );
}

/** Level up: a trophy flips and glows, then the overlay settles away. */
export function LevelUpOverlay({ level, title, onClose }: { level: number; title: string; onClose: () => void }) {
  const tier = useTier();
  const flat = <Trophy2D still={tier === 'reduced'} />;
  return (
    <button className="fixed inset-0 z-50 grid place-items-center bg-black/55" onClick={onClose} aria-label={title}>
      <div className="anim-pop flex flex-col items-center text-white">
        <div className="h-56 w-56">
          {use3D(tier) ? (
            <SceneBoundary fallback={flat}>
              <Suspense fallback={flat}>
                <Scene3D kind="levelup" tier={tier} />
              </Suspense>
            </SceneBoundary>
          ) : (
            flat
          )}
        </div>
        <p className="text-4xl font-black drop-shadow">{level}</p>
        <p className="mt-1 text-lg font-bold drop-shadow">{title}</p>
      </div>
    </button>
  );
}

function Chest2D({ open, animate }: { open: boolean; animate: boolean }) {
  return (
    <svg viewBox="0 0 120 100" className="h-full w-full" aria-hidden>
      <rect x="18" y="48" width="84" height="44" rx="6" fill="#8b4513" />
      <rect x="54" y="48" width="12" height="44" fill="#F2B705" />
      {open && (
        <g>
          <circle cx="44" cy="50" r="8" fill="#F2B705" />
          <circle cx="60" cy="46" r="8" fill="#FFD166" />
          <circle cx="76" cy="50" r="8" fill="#F2B705" />
        </g>
      )}
      <g
        style={{
          transformOrigin: '18px 48px',
          transform: open ? 'rotate(-28deg)' : 'none',
          transition: animate ? 'transform 0.9s cubic-bezier(.34,1.56,.64,1) 0.3s' : undefined,
        }}
      >
        <rect x="18" y="30" width="84" height="20" rx="6" fill="#a0522d" />
        <rect x="54" y="30" width="12" height="20" fill="#F2B705" />
      </g>
    </svg>
  );
}

function Trophy2D({ still }: { still: boolean }) {
  return (
    <div className="grid h-full w-full place-items-center">
      <span className="text-[120px] leading-none" style={still ? undefined : { animation: 'trophy-flip 1.6s ease-out both' }}>
        🏆
      </span>
    </div>
  );
}

/** Classic podium order: 2nd, 1st, 3rd, 4th. */
export function podiumOrder<T extends { rank: number }>(entries: T[]) {
  const byRank = [...entries].sort((a, b) => a.rank - b.rank);
  const order = [1, 0, 2, 3].filter((i) => i < byRank.length);
  return order.map((i) => byRank[i]);
}

// ---------------------------------------------------------------------------
// 2D versions (transform/opacity only)
// ---------------------------------------------------------------------------

function StakePot2D({ count, still }: { count: number; still: boolean }) {
  const coins = Math.min(12, Math.max(1, count * 2));
  return (
    <div className="absolute inset-0 flex items-end justify-center pb-9">
      <div className="relative h-24 w-32">
        {Array.from({ length: coins }, (_, i) => (
          <span
            key={i}
            className="absolute"
            style={{
              left: 34 + ((i * 17) % 44),
              bottom: 26 + Math.floor(i / 3) * 5,
              animation: still ? undefined : `coin-drop 0.9s ease-out ${i * 0.12}s both`,
            }}
          >
            <Coin size={26} />
          </span>
        ))}
        <svg viewBox="0 0 128 70" className="absolute bottom-0 h-16 w-32" aria-hidden>
          <ellipse cx="64" cy="14" rx="56" ry="12" fill="#6b3410" />
          <path d="M8 14 C 10 60, 118 60, 120 14 Z" fill="#a0522d" />
          <ellipse cx="64" cy="14" rx="48" ry="8" fill="#3d1d08" />
        </svg>
      </div>
    </div>
  );
}

function Podium2D({ entries, still }: { entries: PodiumEntry[]; still: boolean }) {
  const heights: Record<number, number> = { 1: 96, 2: 72, 3: 54, 4: 40 };
  return (
    <div className="absolute inset-0 flex items-end justify-center gap-3 px-6">
      {entries.map((e, i) => (
        <div key={e.name + e.rank} className="flex w-20 flex-col items-center">
          <span className={cx('mb-1 text-3xl', !still && 'anim-pop')} style={{ animationDelay: `${0.3 + i * 0.15}s` }}>
            {AVATARS[e.avatar]?.emoji}
          </span>
          <span className="mb-1 max-w-full truncate text-xs font-semibold">{e.name}</span>
          <div
            className={cx('flex w-full origin-bottom items-start justify-center rounded-t-xl pt-1 text-lg font-black text-white', e.rank === 1 ? 'bg-gold' : 'bg-accent')}
            style={{ height: heights[e.rank] ?? 36, animation: still ? undefined : `grow-up 0.6s ease-out ${i * 0.1}s both` }}
          >
            {e.rank}
          </div>
          {e.rank === 1 && !still && <CoinBurst />}
        </div>
      ))}
    </div>
  );
}

function CoinBurst() {
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2" aria-hidden>
      {Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2;
        return (
          <span
            key={i}
            className="absolute"
            style={
              {
                '--dx': `${Math.cos(a) * 90}px`,
                '--dy': `${Math.sin(a) * 70 - 30}px`,
                animation: `burst 1s ease-out ${0.8 + i * 0.03}s both`,
              } as React.CSSProperties
            }
          >
            <Coin size={16} />
          </span>
        );
      })}
    </div>
  );
}
