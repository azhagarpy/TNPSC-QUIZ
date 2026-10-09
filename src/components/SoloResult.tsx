import { useEffect, useState, type ReactNode } from 'react';
import { fx } from '../lib/feedback';
import { useI18n } from '../lib/i18n';
import { levelTitle } from '../lib/levels';
import { setPrefs } from '../lib/prefs';
import type { SoloSummary } from '../lib/types';
import { subtopicName, unitName } from '../lib/units';
import { InstallPrompt } from './InstallPrompt';
import { LevelUpOverlay } from './scenes';
import { track } from '../lib/telemetry';
import { Button, Card, Coin, Ribbon, cx } from './ui';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Counts up from 0 to `target` (eased), after a short delay; instant with reduced motion. */
export function useCountUp(target: number, ms = 900, delay = 500) {
  const [value, setValue] = useState(() => (reducedMotion() ? target : 0));
  useEffect(() => {
    if (reducedMotion() || target <= 0) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now() + delay;
    const step = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - start) / ms));
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, delay]);
  return value;
}

/** 0–3 stars from accuracy: 40 %, 70 %, 90 %. */
export function starsFor(pct: number) {
  return pct >= 90 ? 3 : pct >= 70 ? 2 : pct >= 40 ? 1 : 0;
}

export function Stars({ n }: { n: number }) {
  useEffect(() => {
    const ids = Array.from({ length: n }, (_, i) => setTimeout(() => fx.tap(), 300 + i * 260));
    return () => ids.forEach(clearTimeout);
  }, [n]);
  return (
    <div className="flex items-end justify-center gap-1" role="img" aria-label={`${n} / 3 ★`}>
      {[0, 1, 2].map((i) => {
        const earned = i < n;
        return (
          <svg
            key={i}
            viewBox="0 0 24 24"
            className={cx(i === 1 ? 'h-20 w-20 -translate-y-2' : 'h-14 w-14', 'drop-shadow-[0_4px_0_rgb(0_0_0/0.3)]')}
            style={earned ? { animation: `star-pop 0.4s ease-out ${0.3 + i * 0.26}s both` } : undefined}
            aria-hidden
          >
            <path
              d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"
              fill={earned ? '#FFC629' : 'rgb(14 3 56 / 0.55)'}
              stroke={earned ? '#B87400' : 'rgb(255 255 255 / 0.3)'}
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            {earned && <path d="M8.6 9.6 11 9.2l1-2.2" stroke="#fff" strokeOpacity=".8" strokeWidth="1.3" strokeLinecap="round" fill="none" />}
          </svg>
        );
      })}
    </div>
  );
}

/** A reward tile on a result screen. */
export function LootTile({ icon, value, label, tone, delay = 0 }: { icon: ReactNode; value: ReactNode; label: ReactNode; tone: 'gold' | 'violet' | 'blue'; delay?: number }) {
  return (
    <div
      className={cx('btn3d flex flex-col items-center gap-0.5 px-2 pb-2.5 pt-3 text-center', tone === 'gold' ? 'btn-gold' : tone === 'violet' ? 'btn-violet' : 'btn-blue')}
      style={{ animation: `pop-in 0.25s ease-out ${delay}s both` }}
    >
      <span className="grid h-11 place-items-center text-4xl leading-none">{icon}</span>
      <span className="text-3xl leading-tight tabular-nums">{value}</span>
      <span className="text-sm font-bold opacity-90">{label}</span>
    </div>
  );
}

// Screen 7: score, coins and XP earned, streak, weak-topic radar.
export function SoloResult({
  summary, onPlayAgain, onHome, onPractise, extra,
}: {
  summary: SoloSummary; onPlayAgain?: () => void; onHome: () => void;
  onPractise?: (unit: string, subtopic: string) => void; extra?: React.ReactNode;
}) {
  const { t, lang } = useI18n();
  const pct = summary.n ? Math.round((summary.correct / summary.n) * 100) : 0;
  const [levelUp, setLevelUp] = useState(summary.xp.level_up);
  const coins = useCountUp(summary.coins);
  const xp = useCountUp(summary.xp.xp);
  const stars = starsFor(pct);

  useEffect(() => {
    if (summary.coins > 0) fx.coin();
    if (summary.mode !== 'demo') setPrefs({ finishedFirst: true });
    track('solo_finished', { mode: summary.mode, n: summary.n, correct: summary.correct, coins: summary.coins });
  }, [summary]);

  return (
    <div className="space-y-4">
      <div className="anim-pop pt-1 text-center">
        <Ribbon color={stars >= 2 ? 'gold' : 'pink'}>{t('result.title')}</Ribbon>
        <div className="mt-4">
          <Stars n={stars} />
        </div>
        <p className="text-outline mt-1 font-display text-7xl font-extrabold leading-none tabular-nums">{pct}%</p>
        <p className="mt-3 font-display text-lg font-bold">{t('result.correct', { c: summary.correct, n: summary.n })}</p>
        {summary.mode !== 'mock' && <p className="text-sm text-muted">⭐ {t('result.score', { n: summary.score })}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <LootTile tone="gold" icon={<Coin size={40} />} value={`+${coins}`} label={t('common.coins')} delay={0.35} />
        <LootTile tone="violet" icon="⚡" value={`+${xp}`} label="XP" delay={0.5} />
      </div>
      {summary.pending_sync && <p className="glass p-3 text-center text-sm">📶 {t('result.pendingSync')}</p>}
      {summary.coin_cap_hit && <p className="glass p-3 text-center text-sm">🔒 {t('result.capHit')}</p>}

      {summary.xp.level_up && (
        <Card className="anim-rise flex items-center gap-3 !border-gold">
          <span className="text-4xl" aria-hidden>🌟</span>
          <p className="font-display text-lg font-bold leading-snug">{t('result.levelUp', { title: levelTitle(summary.xp.level, lang), coins: summary.xp.level_coins })}</p>
        </Card>
      )}
      {summary.streak?.new_day && (
        <Card className="anim-rise flex items-center gap-3">
          <span className="text-4xl" aria-hidden>🔥</span>
          <div>
            <p className="font-display text-lg font-bold leading-snug">{t('result.streak', { n: summary.streak.streak, coins: summary.streak.reward })}</p>
            {summary.streak.shield_used && <p className="text-sm text-muted">🛡️ {t('result.shieldUsed')}</p>}
          </div>
        </Card>
      )}
      {summary.achievements.length > 0 && (
        <Card className="anim-rise space-y-1">
          {summary.achievements.map((a) => (
            <p key={a} className="font-display text-lg font-bold">
              🏅 {t('result.badge', { name: a.replace(/_/g, ' ') })}
            </p>
          ))}
        </Card>
      )}
      {summary.daily_rank && (
        <Card className="flex items-center gap-3">
          <span className="text-4xl" aria-hidden>🏆</span>
          <div>
            <p className="font-display text-lg font-bold">{t('result.dailyRank', { rank: summary.daily_rank })}</p>
            <p className="text-sm text-muted">{t('result.dailyReward')}</p>
          </div>
        </Card>
      )}
      {extra}

      {summary.weak.length > 0 && (
        <Card>
          <h2 className="mb-2 text-lg font-extrabold">📡 {t('result.weak')}</h2>
          <ul className="space-y-2">
            {summary.weak.map((w) => (
              <li key={w.unit + w.subtopic} className="flex items-center gap-3 rounded-2xl bg-chip p-2 pl-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{subtopicName(w.subtopic, lang)}</p>
                  <p className="text-xs text-muted">
                    {unitName(w.unit, lang)} · {w.correct}/{w.total}
                  </p>
                </div>
                {onPractise && (
                  <Button size="sm" variant="accent" onClick={() => onPractise(w.unit, w.subtopic)}>
                    {t('result.practise')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <InstallPrompt />
      {levelUp && <LevelUpOverlay level={summary.xp.level} title={levelTitle(summary.xp.level, lang)} onClose={() => setLevelUp(false)} />}

      <div className="grid gap-3 pt-1">
        {onPlayAgain && (
          <Button block size="lg" variant="gold" className="shine" onClick={onPlayAgain}>
            🔁 {t('result.playAgain')}
          </Button>
        )}
        <Button block variant="secondary" onClick={onHome}>
          🏠 {t('nav.home')}
        </Button>
      </div>
    </div>
  );
}
