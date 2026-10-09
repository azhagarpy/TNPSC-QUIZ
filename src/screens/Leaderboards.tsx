import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { isDemo } from '../lib/supabase';
import type { Leaderboard, LeagueInfo } from '../lib/types';
import { LEAGUES } from '../lib/cosmetics';
import { UNITS, districtName } from '../lib/units';
import { Avatar, Card, Empty, ErrorBox, Loading, Screen, Segmented, cx, inputClass } from '../components/ui';
import { DailyBoardView } from './Daily';

type Scope = 'league' | 'friends' | 'district' | 'state' | 'daily';

// Screen 13: friends / district / state / subject boards (weekly), plus today's challenge.
export default function Leaderboards() {
  const { t, lang, errorText } = useI18n();
  const [scope, setScope] = useState<Scope>('league');
  const [unit, setUnit] = useState('*');
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (scope === 'daily' || scope === 'league' || isDemo) return;
    setBoard(null);
    setError('');
    try {
      setBoard(await api.leaderboard(scope, unit));
    } catch (e) {
      setError(errorText(e));
    }
  }, [scope, unit, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isDemo) {
    return (
      <Screen title={t('lb.title')} nav>
        <Empty icon="🏆">{t('common.needsServer')}</Empty>
      </Screen>
    );
  }

  return (
    <Screen title={t('lb.title')} nav>
      <div className="space-y-4">
        <Segmented
          small
          value={scope}
          onChange={setScope}
          options={[
            { value: 'league', label: t('lb.league') },
            { value: 'friends', label: t('lb.friends') },
            { value: 'district', label: t('lb.district') },
            { value: 'state', label: t('lb.state') },
            { value: 'daily', label: t('lb.daily') },
          ]}
        />
        {scope === 'league' ? (
          <LeagueView />
        ) : scope === 'daily' ? (
          <DailyBoardView />
        ) : (
          <>
            <select className={inputClass} value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="*">{t('lb.overall')}</option>
              {UNITS.map((u) => (
                <option key={u.key} value={u.key}>
                  {u[lang]}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted">{t('lb.week')}</p>
            {error && <ErrorBox text={error} onRetry={load} />}
            {!board && !error && <Loading />}
            {board && board.top.length === 0 && <Empty icon="🌱">{t('lb.empty')}</Empty>}
            {board && board.top.length > 0 && (
              <ol className="space-y-2">
                {board.top.map((r) => (
                  <li key={r.user.id} className={cx('flex items-center gap-3 rounded-2xl p-2 shadow-card', r.me ? 'bg-accent-bg' : 'bg-surface')}>
                    <span className={cx('w-8 text-center text-lg font-black', r.rank <= 3 && 'text-brand')}>
                      {r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}
                    </span>
                    <Avatar avatar={r.user.avatar} frame={r.user.frame} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">
                        {r.user.name} {r.me && <span className="text-xs text-accent">({t('lb.you')})</span>}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {t('common.level', { n: r.user.level })} · {districtName(r.user.district, lang)}
                      </p>
                    </div>
                    <span className="text-right font-bold tabular-nums">{unit === '*' ? `${r.value} XP` : t('lb.correct', { n: r.value })}</span>
                  </li>
                ))}
              </ol>
            )}
            {board?.me && !board.top.some((r) => r.me) && (
              <p className="text-center text-sm font-semibold">
                {t('lb.you')}: #{board.me.rank} · {board.me.value}
              </p>
            )}
          </>
        )}
      </div>
    </Screen>
  );
}

export function LeagueView() {
  const { t, lang, errorText } = useI18n();
  const [info, setInfo] = useState<LeagueInfo | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.myLeague().then(setInfo).catch((e) => setError(errorText(e)));
  }, [errorText]);

  if (error) return <ErrorBox text={error} />;
  if (!info) return <Loading />;
  const league = LEAGUES[info.tier];
  const left = Math.max(0, Date.parse(info.ends_at) - Date.now());
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor((left % 86_400_000) / 3_600_000);
  const n = info.members?.length ?? 0;
  return (
    <div className="space-y-3">
      <Card className="flex items-center gap-3">
        <span className="grid h-14 w-14 place-items-center rounded-2xl text-3xl" style={{ background: `${league.color}33` }}>
          {league.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-black">{t('league.title', { league: league[lang] })}</p>
          <p className="text-xs text-muted">{t('league.ends', { d: days, h: hours })}</p>
          {info.joined && (
            <p className="text-xs text-muted">{t('league.rules', { up: info.promote ?? 0, down: info.demote ?? 0 })}</p>
          )}
        </div>
      </Card>
      {info.joined && info.rewards && (
        <p className="text-xs text-muted">
          {t('league.rewards', { a: info.rewards[0], b: info.rewards[1], c: info.rewards[2], min: info.reward_min ?? 10 })}
        </p>
      )}
      {!info.joined ? (
        <Empty icon={league.icon}>{t('league.join')}</Empty>
      ) : (
        <ol className="space-y-1.5">
          {info.members!.map((m) => {
            const up = m.rank <= (info.promote ?? 0);
            const down = m.rank > n - (info.demote ?? 0);
            return (
              <li
                key={m.user.id}
                className={cx(
                  'flex items-center gap-3 rounded-2xl border-l-4 p-2 shadow-card',
                  m.me ? 'bg-accent-bg' : 'bg-surface',
                  up ? 'border-ok' : down ? 'border-bad' : 'border-transparent',
                )}
                title={up ? t('league.zoneUp') : down ? t('league.zoneDown') : undefined}
              >
                <span className="w-7 text-center font-black">{m.rank}</span>
                <Avatar avatar={m.user.avatar} frame={m.user.frame} size={36} />
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {m.user.name} {m.me && <span className="text-xs text-accent">({t('lb.you')})</span>}
                </span>
                <span className="text-xs">{up ? '▲' : down ? '▼' : ''}</span>
                <span className="w-16 text-right font-bold tabular-nums">{m.xp} XP</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
