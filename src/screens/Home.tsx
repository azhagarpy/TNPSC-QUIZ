import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { fx } from '../lib/feedback';
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
import { Avatar, Button, Card, Coin, LevelBadge, ProgressBar, Screen, cx, useToast } from '../components/ui';

/** A game-mode button on the lobby: big icon, title, one line of detail. */
function ModeTile({ icon, title, sub, tone, onClick }: { icon: string; title: ReactNode; sub?: ReactNode; tone: string; onClick: () => void }) {
  return (
    <button
      onClick={() => {
        fx.click();
        onClick();
      }}
      className={cx('btn3d flex min-h-30 wrap-break-word flex-col items-start gap-1.5 px-3 pb-3 pt-2.5 text-left', tone)}
    >
      <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/25 text-2xl shadow-[inset_0_-3px_0_rgb(0_0_0/0.12)]" aria-hidden>
        {icon}
      </span>
      <span className="block text-lg leading-tight">{title}</span>
      {sub && <span className="block font-sans text-xs font-semibold leading-snug opacity-90 [text-shadow:none]">{sub}</span>}
    </button>
  );
}

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
  const streak = summary.streak_alive ? profile.streak_count : 0;
  const needsServer = (to: string) => () => (isDemo ? toast(t('common.needsServer')) : navigate(to));

  const coins = (
    <>
      <Coin size={24} /> {summary.available.toLocaleString('en-IN')}
    </>
  );

  // Player HUD: portrait with level, XP bar, coin counter (+ opens the shop).
  const hud = (
    <div className="flex items-center gap-2.5">
      <button onClick={() => navigate('/profile')} aria-label={t('nav.profile')} className="relative shrink-0">
        <Avatar avatar={profile.avatar} frame={profile.frame} size={48} />
        <LevelBadge level={lp.level} className="absolute -bottom-1 -right-1.5" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-outline-sm truncate font-display text-lg font-extrabold leading-tight">{t('home.hello', { name: profile.display_name ?? '' })}</p>
        <p className="truncate text-xs font-semibold text-muted">
          {t('common.level', { n: lp.level })} · {levelTitle(lp.level, lang)}
        </p>
        <div className="mt-1 [&_.bar]:h-2.5">
          <ProgressBar pct={lp.pct} color="bg-blue" />
        </div>
      </div>
      {isDemo ? (
        <span className="hud-pill shrink-0">{coins}</span>
      ) : (
        <button className="hud-pill shrink-0 !pr-1" onClick={() => navigate('/shop')} aria-label={`${summary.available} · ${t('home.shop')}`}>
          {coins}
          <span className="ml-0.5 grid h-7 w-7 place-items-center rounded-full bg-green text-lg leading-none shadow-[inset_0_-2px_0_var(--green-lip)]" aria-hidden>
            +
          </span>
        </button>
      )}
    </div>
  );

  return (
    <Screen nav hud={hud}>
      <div className="space-y-4">
        {isDemo && <p className="glass p-3 text-sm">🧪 {t('common.demo')}</p>}
        {offline && <p className="glass !border-[var(--red)] p-3 text-sm font-semibold">📴 {t('common.offline')}</p>}

        {summary.live_match && (
          <Button block size="lg" variant="accent" className="shine" onClick={() => navigate(`/m/${summary.live_match}`)}>
            ⚔️ {t('home.resumeMatch')}
          </Button>
        )}
        {!summary.live_match && summary.active_room && (
          <Button block variant="secondary" onClick={() => navigate(`/r/${summary.active_room!.code}`)}>
            🚪 {t('home.resumeRoom', { code: summary.active_room.code })}
          </Button>
        )}

        {league?.last_result && (
          <Card className="anim-rise flex items-center gap-3 !border-gold">
            <span className="text-4xl">{LEAGUES[league.last_result.tier_after].icon}</span>
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-display text-base font-bold leading-snug">
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
              className="btn-round"
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
        <div className="stage flex items-center gap-3 p-2 pr-4">
          <div className="h-24 w-28 shrink-0">
            <ChestScene open={summary.streak_today} animate={chestAnimate} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-outline-sm font-display text-base font-extrabold leading-snug">
              {summary.streak_today ? '🎁 ' : '🔒 '}
              {summary.streak_today ? t('home.chestOpen') : t('home.chestClosed')}
            </p>
            {league && (
              <button
                className="mt-2 inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border-2 bg-chip px-3 font-display text-sm font-bold"
                style={{ borderColor: LEAGUES[league.tier].color }}
                onClick={() => navigate('/leaderboard')}
              >
                <span aria-hidden>{LEAGUES[league.tier].icon}</span>
                <span className="truncate">{t('league.title', { league: LEAGUES[league.tier][lang] })}</span>
                <span aria-hidden>›</span>
              </button>
            )}
          </div>
        </div>

        {/* Exam countdown and streak */}
        <div className="grid grid-cols-2 gap-3">
          <div className="glass p-3">
            <p className="text-outline font-display text-4xl font-extrabold leading-none tabular-nums">{examDays !== null && examDays > 0 ? examDays : '🎯'}</p>
            <p className="mt-2 text-xs font-semibold text-muted">
              {examDays !== null && examDays > 0 ? t('home.examIn', { days: examDays }) : t('home.examToday')}
            </p>
            <p className="mt-1 text-xs font-bold text-gold">{t('home.plan')}</p>
          </div>
          <div className={cx('glass p-3', summary.streak_today && '!border-gold')}>
            <p className="text-outline font-display text-4xl font-extrabold leading-none tabular-nums">
              <span aria-hidden>🔥</span> {streak}
            </p>
            <p className="mt-2 text-xs font-semibold text-muted">{t('home.streak', { n: streak })}</p>
            <p className={cx('mt-1 text-xs font-bold', summary.streak_today ? 'text-ok' : 'text-bad')}>
              {summary.streak_today ? `✓ ${t('home.streakDone')}` : `⚠ ${t('home.streakTodo')}`}
            </p>
          </div>
        </div>

        {/* The big PLAY button */}
        <button
          onClick={() => {
            fx.click();
            navigate('/solo');
          }}
          className="btn3d btn-gold shine flex min-h-24 w-full items-center gap-3 px-4 py-3 text-left"
        >
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-white/40 text-4xl shadow-[inset_0_-4px_0_rgb(0_0_0/0.12)]" aria-hidden>
            🎯
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-2xl leading-tight">{t('home.playSolo')}</span>
            <span className="block font-sans text-sm font-semibold opacity-90 [text-shadow:none]">{t('home.playSoloSub')}</span>
          </span>
          <span className="text-3xl" aria-hidden>
            ▶
          </span>
        </button>

        <div className="grid grid-cols-2 gap-3">
          <ModeTile tone="btn-blue" icon="⚡" title={t('home.quick')} sub={isDemo ? t('bot.noStakes') : t('home.quickSub')} onClick={() => navigate('/quick')} />
          <ModeTile
            tone=""
            icon={summary.daily.finished ? '✅' : '🗓️'}
            title={t('home.daily')}
            sub={summary.daily.finished ? t('home.dailyDone', { score: summary.daily.score ?? 0 }) : t('home.dailyPlayers', { n: summary.daily.players })}
            onClick={needsServer('/daily')}
          />
          <ModeTile tone="btn-violet" icon="⚔️" title={t('home.createRoom')} onClick={needsServer('/room/new')} />
          <ModeTile tone="btn-cream" icon="🔑" title={t('home.joinRoom')} onClick={needsServer('/join')} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button className="glass flex items-center wrap-break-word gap-2.5 p-3 text-left transition-transform active:translate-y-0.5" onClick={() => navigate('/solo')}>
            <span className="text-3xl" aria-hidden>
              📚
            </span>
            <span className="min-w-0">
              <span className="block font-display font-bold leading-tight">{t('home.revision')}</span>
              <span className="block text-xs text-muted">{t('home.revisionDue', { n: summary.revision_due })}</span>
            </span>
          </button>
          <button className="glass flex items-center wrap-break-word gap-2.5 p-3 text-left transition-transform active:translate-y-0.5" onClick={needsServer('/mock')}>
            <span className="text-3xl" aria-hidden>
              📝
            </span>
            <span className="min-w-0">
              <span className="block font-display font-bold leading-tight">{t('home.mock')}</span>
              <span className="block text-xs text-muted">
                {summary.mock_active ? t('home.mockResume') : summary.mock_done_this_week ? `✓ ${t('home.mockDone')}` : '+500'}
              </span>
            </span>
          </button>
        </div>

        {summary.refill_available && (
          <Card className="flex items-center gap-3 !border-gold">
            <Coin size={36} />
            <span className="flex-1 font-display font-bold leading-snug">{t('home.refill')}</span>
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

        {/* Friends online */}
        {!isDemo && (
          <Card>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-lg font-extrabold">🟢 {t('home.friendsOnline')}</h2>
              <button className="min-h-11 shrink-0 font-display text-sm font-bold text-accent" onClick={() => navigate('/leaderboard')}>
                {t('home.board')} ›
              </button>
            </div>
            {summary.friend_requests > 0 && (
              <button className="mb-2 min-h-11 font-display text-sm font-bold text-brand" onClick={() => navigate('/friends')}>
                {t('home.requests', { n: summary.friend_requests })} ›
              </button>
            )}
            {summary.friends_online.length === 0 ? (
              <p className="text-sm text-muted">{t('home.noFriendsOnline')}</p>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-1">
                {summary.friends_online.map((f) => (
                  <button key={f.id} className="flex w-16 shrink-0 flex-col items-center" onClick={() => navigate(`/chat/${f.id}`)}>
                    <Avatar avatar={f.avatar} frame={f.frame} size={48} ring="var(--green)" />
                    <span className="mt-1 w-full truncate text-center text-xs font-semibold">{f.name}</span>
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
