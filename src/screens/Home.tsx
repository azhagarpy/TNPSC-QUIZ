import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { levelProgress, levelTitle } from '../lib/levels';
import { useRouter } from '../lib/router';
import { useSession } from '../lib/session';
import { isDemo } from '../lib/supabase';
import { InstallPrompt } from '../components/InstallPrompt';
import { ChestScene } from '../components/scenes';
import { LEAGUES } from '../lib/cosmetics';
import { setPrefs, usePrefs } from '../lib/prefs';
import type { LeagueInfo } from '../lib/types';

const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
import { Avatar, Button, Card, CoinChip, ProgressBar, Screen, cx, useToast } from '../components/ui';

export default function Home() {
  const { t, lang, errorText } = useI18n();
  const { summary, profile, refresh, offline, syncedCoins, clearSynced } = useSession();
  const { navigate } = useRouter();
  const toast = useToast();
  const [refilling, setRefilling] = useState(false);
  const [league, setLeague] = useState<LeagueInfo | null>(null);
  const prefs = usePrefs();
  const chestAnimate = !!summary?.streak_today && prefs.chestOpenedOn !== istToday();

  useEffect(() => {
    void refresh();
    if (!isDemo) api.myLeague().then(setLeague).catch(() => {});
  }, [refresh]);

  // The chest plays its opening once per day, the first time Home shows it open.
  useEffect(() => {
    if (chestAnimate) {
      const id = setTimeout(() => setPrefs({ chestOpenedOn: istToday() }), 3000);
      return () => clearTimeout(id);
    }
  }, [chestAnimate]);

  useEffect(() => {
    if (syncedCoins > 0) {
      toast(t('home.synced', { coins: syncedCoins }), 'coin');
      clearSynced();
    }
  }, [syncedCoins, clearSynced, toast, t]);

  if (!summary || !profile) return null;
  const lp = levelProgress(profile.xp);
  const examDays = summary.next_exam_date
    ? Math.ceil((Date.parse(summary.next_exam_date + 'T00:00:00+05:30') - Date.now()) / 86_400_000)
    : null;

  return (
    <Screen nav>
      <div className="safe-top space-y-4">
        {/* Header: who, level, coins */}
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/profile')} aria-label={t('nav.profile')}>
            <Avatar avatar={profile.avatar} frame={profile.frame} size={52} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold">{t('home.hello', { name: profile.display_name ?? '' })}</p>
            <p className="truncate text-xs text-muted">
              {t('common.level', { n: lp.level })} · {levelTitle(lp.level, lang)}
            </p>
            <div className="mt-1">
              <ProgressBar pct={lp.pct} color="bg-accent" />
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <CoinChip value={summary.available} />
            {!isDemo && (
              <button className="text-xs font-semibold text-accent" onClick={() => navigate('/shop')}>
                🛍️ {t('home.shop')}
              </button>
            )}
          </div>
        </div>

        {isDemo && <p className="rounded-2xl bg-accent-bg p-3 text-sm">{t('common.demo')}</p>}
        {offline && <p className="rounded-2xl bg-bad-bg p-3 text-sm font-semibold">📴 {t('common.offline')}</p>}

        {summary.live_match && (
          <Button block variant="accent" onClick={() => navigate(`/m/${summary.live_match}`)}>
            ⚔️ {t('home.resumeMatch')}
          </Button>
        )}
        {!summary.live_match && summary.active_room && (
          <Button block variant="secondary" onClick={() => navigate(`/r/${summary.active_room!.code}`)}>
            🚪 {t('home.resumeRoom', { code: summary.active_room.code })}
          </Button>
        )}

        {league?.last_result && (
          <Card className="anim-rise flex items-center gap-3 border-gold">
            <span className="text-3xl">{LEAGUES[league.last_result.tier_after].icon}</span>
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-bold">
                {league.last_result.tier_after > league.last_result.tier_before
                  ? t('home.leagueUp', { league: LEAGUES[league.last_result.tier_after][lang] })
                  : league.last_result.tier_after < league.last_result.tier_before
                    ? t('home.leagueDown', { league: LEAGUES[league.last_result.tier_after][lang] })
                    : t('home.leagueStay', { league: LEAGUES[league.last_result.tier_after][lang], rank: league.last_result.rank })}
              </p>
              {league.last_result.coins > 0 && <p className="text-muted">{t('home.leagueCoins', { coins: league.last_result.coins })}</p>}
            </div>
            <button
              aria-label={t('common.close')}
              className="grid h-10 w-10 place-items-center rounded-full"
              onClick={() => {
                setLeague({ ...league, last_result: null });
                void api.leagueSeen().catch(() => {});
              }}
            >
              ✕
            </button>
          </Card>
        )}

        {/* Treasure chest: opens when today's reward (first solo set) is collected */}
        <Card className="flex items-center gap-3 !p-2">
          <div className="h-24 w-28 shrink-0">
            <ChestScene open={summary.streak_today} animate={chestAnimate} />
          </div>
          <div className="min-w-0 flex-1">
            <CoinChip value={summary.available} />
            <p className="mt-1 text-xs text-muted">{summary.streak_today ? t('home.chestOpen') : t('home.chestClosed')}</p>
            {league && (
              <button className="mt-1 text-xs font-semibold" style={{ color: LEAGUES[league.tier].color }} onClick={() => navigate('/leaderboard')}>
                {LEAGUES[league.tier].icon} {t('league.title', { league: LEAGUES[league.tier][lang] })} →
              </button>
            )}
          </div>
        </Card>

        {/* Exam countdown and streak */}
        <div className="grid grid-cols-2 gap-3">
          <Card className="!p-3">
            <p className="text-2xl font-black tabular-nums">{examDays !== null && examDays > 0 ? examDays : '🎯'}</p>
            <p className="text-xs text-muted">
              {examDays !== null && examDays > 0 ? t('home.examIn', { days: examDays }) : t('home.examToday')}
            </p>
            <p className="mt-1 text-[11px] font-semibold text-accent">{t('home.plan')}</p>
          </Card>
          <Card className={cx('!p-3', summary.streak_today && 'border-gold')}>
            <p className="text-2xl font-black tabular-nums">
              🔥 {summary.streak_alive ? profile.streak_count : 0}
            </p>
            <p className="text-xs text-muted">{t('home.streak', { n: summary.streak_alive ? profile.streak_count : 0 })}</p>
            <p className={cx('mt-1 text-[11px] font-semibold', summary.streak_today ? 'text-ok' : 'text-bad')}>
              {summary.streak_today ? `✓ ${t('home.streakDone')}` : t('home.streakTodo')}
            </p>
          </Card>
        </div>

        {/* Main actions */}
        <Button block size="lg" className="!min-h-18 flex-col !gap-0 py-2" onClick={() => navigate('/solo')}>
          <span className="text-xl">🎯 {t('home.playSolo')}</span>
          <span className="text-sm font-normal opacity-90">{t('home.playSoloSub')}</span>
        </Button>
        <Button block size="lg" variant="accent" className="flex-col !gap-0 py-2" onClick={() => navigate('/quick')}>
          <span className="text-lg">⚡ {t('home.quick')}</span>
          <span className="text-xs font-normal opacity-90">{isDemo ? t('bot.noStakes') : t('home.quickSub')}</span>
        </Button>
        <div className="grid grid-cols-2 gap-3">
          <Button size="lg" variant="gold" className="!min-h-20 flex-col !gap-0.5 py-2" onClick={() => (isDemo ? toast(t('common.needsServer')) : navigate('/room/new'))}>
            <span className="text-2xl" aria-hidden>⚔️</span>
            <span className="leading-tight">{t('home.createRoom')}</span>
          </Button>
          <Button size="lg" variant="secondary" className="!min-h-20 flex-col !gap-0.5 py-2" onClick={() => (isDemo ? toast(t('common.needsServer')) : navigate('/join'))}>
            <span className="text-2xl" aria-hidden>🔑</span>
            <span className="leading-tight">{t('home.joinRoom')}</span>
          </Button>
        </div>

        {summary.refill_available && (
          <Card className="flex items-center gap-3 border-gold">
            <span className="flex-1 text-sm font-semibold">🪙 {t('home.refill')}</span>
            <Button
              size="sm"
              variant="gold"
              loading={refilling}
              onClick={async () => {
                setRefilling(true);
                try {
                  const r = await api.claimRefill();
                  toast(`+${r.coins}`, 'coin');
                  await refresh();
                } catch (e) {
                  toast(errorText(e), 'bad');
                } finally {
                  setRefilling(false);
                }
              }}
            >
              {t('home.refillClaim')}
            </Button>
          </Card>
        )}

        {/* Daily challenge */}
        <Card onClick={() => (isDemo ? toast(t('common.needsServer')) : navigate('/daily'))} className="bg-linear-to-br from-brand to-brand-2 !text-brand-ink">
          <div className="flex items-center justify-between">
            <p className="text-lg font-black">🗓️ {t('home.daily')}</p>
            <span className="text-sm opacity-90">{t('home.dailyPlayers', { n: summary.daily.players })}</span>
          </div>
          <p className="mt-1 text-sm opacity-90">
            {summary.daily.finished ? t('home.dailyDone', { score: summary.daily.score ?? 0 }) : t('home.dailyBody')}
          </p>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Card onClick={() => navigate('/solo')} className="!p-3">
            <p className="font-bold">📚 {t('home.revision')}</p>
            <p className="text-xs text-muted">{t('home.revisionDue', { n: summary.revision_due })}</p>
          </Card>
          <Card onClick={() => (isDemo ? toast(t('common.needsServer')) : navigate('/mock'))} className="!p-3">
            <p className="font-bold">📝 {t('home.mock')}</p>
            <p className="text-xs text-muted">
              {summary.mock_active ? t('home.mockResume') : summary.mock_done_this_week ? `✓ ${t('home.mockDone')}` : '+500'}
            </p>
          </Card>
        </div>

        {/* Friends online */}
        {!isDemo && (
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <p className="font-bold">🟢 {t('home.friendsOnline')}</p>
              <button className="text-sm font-semibold text-accent" onClick={() => navigate('/leaderboard')}>
                {t('home.board')} →
              </button>
            </div>
            {summary.friend_requests > 0 && (
              <button className="mb-2 text-sm font-semibold text-brand" onClick={() => navigate('/friends')}>
                {t('home.requests', { n: summary.friend_requests })} →
              </button>
            )}
            {summary.friends_online.length === 0 ? (
              <p className="text-sm text-muted">{t('home.noFriendsOnline')}</p>
            ) : (
              <div className="flex gap-3 overflow-x-auto">
                {summary.friends_online.map((f) => (
                  <button key={f.id} className="flex w-16 shrink-0 flex-col items-center" onClick={() => navigate(`/chat/${f.id}`)}>
                    <Avatar avatar={f.avatar} frame={f.frame} size={48} ring="var(--ok)" />
                    <span className="mt-1 w-full truncate text-center text-xs">{f.name}</span>
                  </button>
                ))}
              </div>
            )}
            <p className="mt-2 text-xs text-muted">
              {t('home.weekXp', { xp: summary.week_xp })} · {t('home.soloCoins', { n: summary.solo_coins_today, cap: summary.solo_coin_cap })}
            </p>
          </Card>
        )}

        <InstallPrompt />
      </div>
    </Screen>
  );
}
