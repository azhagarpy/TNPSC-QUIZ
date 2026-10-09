import { useEffect, useState } from 'react';
import { fx } from '../lib/feedback';
import { useI18n } from '../lib/i18n';
import { levelTitle } from '../lib/levels';
import { setPrefs } from '../lib/prefs';
import type { SoloSummary } from '../lib/types';
import { subtopicName, unitName } from '../lib/units';
import { InstallPrompt } from './InstallPrompt';
import { LevelUpOverlay } from './scenes';
import { track } from '../lib/telemetry';
import { Button, Card, Coin, cx } from './ui';

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

  useEffect(() => {
    if (summary.coins > 0) fx.coin();
    if (summary.mode !== 'demo') setPrefs({ finishedFirst: true });
    track('solo_finished', { mode: summary.mode, n: summary.n, correct: summary.correct, coins: summary.coins });
  }, [summary]);

  return (
    <div className="space-y-4">
      <Card className="anim-pop text-center">
        <p className="text-sm font-semibold text-muted">{t('result.title')}</p>
        <p className="mt-1 text-5xl font-black tabular-nums">{pct}%</p>
        <p className="font-semibold">{t('result.correct', { c: summary.correct, n: summary.n })}</p>
        {summary.mode !== 'mock' && <p className="text-sm text-muted">{t('result.score', { n: summary.score })}</p>}
        <div className="mt-4 flex justify-center gap-3">
          <span className={cx('inline-flex items-center gap-1 rounded-full px-3 py-1.5 font-bold', summary.coins > 0 ? 'bg-gold/25' : 'bg-surface-2')}>
            <Coin /> +{summary.coins}
          </span>
          <span className="inline-flex items-center rounded-full bg-accent-bg px-3 py-1.5 font-bold text-accent">{t('result.xp', { n: summary.xp.xp })}</span>
        </div>
        {summary.pending_sync && <p className="mt-2 text-xs text-muted">{t('result.pendingSync')}</p>}
        {summary.coin_cap_hit && <p className="mt-2 text-xs text-muted">{t('result.capHit')}</p>}
      </Card>

      {summary.xp.level_up && (
        <Card className="anim-rise border-gold bg-gold/15">
          <p className="font-bold">⭐ {t('result.levelUp', { title: levelTitle(summary.xp.level, lang), coins: summary.xp.level_coins })}</p>
        </Card>
      )}
      {summary.streak?.new_day && (
        <Card className="anim-rise">
          <p className="font-bold">🔥 {t('result.streak', { n: summary.streak.streak, coins: summary.streak.reward })}</p>
          {summary.streak.shield_used && <p className="text-sm text-muted">🛡️ {t('result.shieldUsed')}</p>}
        </Card>
      )}
      {summary.achievements.length > 0 && (
        <Card className="anim-rise">
          {summary.achievements.map((a) => (
            <p key={a} className="font-bold">
              🏅 {t('result.badge', { name: a.replace(/_/g, ' ') })}
            </p>
          ))}
        </Card>
      )}
      {summary.daily_rank && (
        <Card>
          <p className="font-bold">🏆 {t('result.dailyRank', { rank: summary.daily_rank })}</p>
          <p className="text-sm text-muted">{t('result.dailyReward')}</p>
        </Card>
      )}
      {extra}

      {summary.weak.length > 0 && (
        <Card>
          <p className="mb-2 font-bold">📡 {t('result.weak')}</p>
          <ul className="space-y-2">
            {summary.weak.map((w) => (
              <li key={w.unit + w.subtopic} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{subtopicName(w.subtopic, lang)}</p>
                  <p className="text-xs text-muted">
                    {unitName(w.unit, lang)} · {w.correct}/{w.total}
                  </p>
                </div>
                {onPractise && (
                  <Button size="sm" variant="secondary" onClick={() => onPractise(w.unit, w.subtopic)}>
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

      <div className="grid gap-2">
        {onPlayAgain && (
          <Button block size="lg" onClick={onPlayAgain}>
            {t('result.playAgain')}
          </Button>
        )}
        <Button block variant="secondary" onClick={onHome}>
          {t('nav.home')}
        </Button>
      </div>
    </div>
  );
}
