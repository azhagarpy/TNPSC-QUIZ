import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { fx } from '../lib/feedback';
import { useI18n } from '../lib/i18n';
import { setPrefs } from '../lib/prefs';
import { useRouter } from '../lib/router';
import { useSession } from '../lib/session';
import type { MatchResult as Result } from '../lib/types';
import { ChatInput, ChatLog, PhraseBar, ReactionBar } from '../components/chat';
import { InstallPrompt } from '../components/InstallPrompt';
import { LevelUpOverlay, PodiumScene } from '../components/scenes';
import { useRoomCosmetics } from '../lib/cosmeticsHook';
import { levelTitle } from '../lib/levels';
import { track } from '../lib/telemetry';
import { Avatar, Button, Card, Coin, ErrorBox, Loading, Screen, cx, useToast } from '../components/ui';
import { useRoomChat } from './Lobby';

// Screen 11: podium, pot split, rematch, chat.
export default function MatchResult({ params }: { params: Record<string, string> }) {
  const id = params.id;
  const { t, lang, errorText } = useI18n();
  const { userId, profile, refresh } = useSession();
  const { navigate } = useRouter();
  const toast = useToast();
  const [res, setRes] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const me = userId!;

  const load = useCallback(async () => {
    try {
      let r = await api.matchResult(id);
      if (r.status === 'live') r = await api.finishMatch(id);
      setRes(r);
      if (r.status !== 'live') {
        void refresh();
        setPrefs({ finishedFirst: true });
      }
      return r.status;
    } catch (e) {
      setError(errorText(e));
      return 'error';
    }
  }, [id, refresh, errorText]);

  useEffect(() => {
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      const status = await load();
      if (status === 'live' && tries++ < 20) timer = setTimeout(loop, 3000);
    };
    void loop();
    return () => clearTimeout(timer);
  }, [load]);

  const mine = res?.players.find((p) => p.user_id === me);
  const startLevel = useRef(profile?.level ?? 1);
  const [levelUp, setLevelUp] = useState<number | null>(null);
  const reported = useRef(false);
  useEffect(() => {
    if (!res || res.status === 'live' || !mine || reported.current) return;
    reported.current = true;
    if (mine.payout > 0) fx.win();
    if (res.level > startLevel.current) setLevelUp(res.level);
    track('match_finished', { status: res.status, players: res.players.length, stake: res.stake, rank: mine.rank });
  }, [res, mine]);
  const { frames, backdrop } = useRoomCosmetics(res?.players.map((p) => p.user_id) ?? [], res?.room_id);

  const { chat, react, phrase, sendText } = useRoomChat(res?.room_id ?? null, me, (event, p) => {
    if (event === 'match_started') navigate(`/m/${String(p.match_id)}`, { replace: true });
  });

  if (error) {
    return (
      <Screen title={t('mres.title')} back="/">
        <ErrorBox text={error} onRetry={() => void load()} />
      </Screen>
    );
  }
  if (!res || !mine) return <Loading />;
  if (res.status === 'live') {
    return (
      <Screen title={t('mres.title')}>
        <div className="py-16 text-center">
          <Loading />
          <p className="font-semibold">{t('mres.settling')}</p>
        </div>
      </Screen>
    );
  }

  const canRematch = res.room_code && res.room_status === 'lobby';
  return (
    <Screen
      title={t('mres.title')}
      back="/"
      backdrop={backdrop}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => navigate('/', { replace: true })}>
            {t('nav.home')}
          </Button>
          <Button
            variant="gold"
            disabled={!canRematch}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.setReady(res.room_id!, true);
              } catch (e) {
                toast(errorText(e), 'bad');
              }
              navigate(`/r/${res.room_code}`, { replace: true });
            }}
          >
            🔁 {t('mres.rematch')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <PodiumScene entries={res.players.map((p) => ({ avatar: p.avatar, name: p.name ?? '', rank: p.rank ?? 4 }))} />

        <Card className="anim-pop text-center">
          {res.status === 'refunded' ? (
            <p className="text-lg font-bold">↩️ {t('mres.refunded')}</p>
          ) : mine.payout > 0 ? (
            <p className="text-2xl font-black text-ok">🎉 {t('mres.won', { n: mine.payout })}</p>
          ) : (
            <p className="text-lg font-bold">{t('mres.lost')}</p>
          )}
          {res.stake > 0 && res.status === 'settled' && (
            <p className={cx('mt-1 inline-flex items-center gap-1 font-bold tabular-nums', mine.net >= 0 ? 'text-ok' : 'text-bad')}>
              <Coin /> {mine.net >= 0 ? '+' : ''}
              {mine.net}
            </p>
          )}
          <p className="text-sm text-muted">{t('result.xp', { n: mine.xp })}</p>
        </Card>

        <ol className="space-y-2">
          {res.players.map((p) => (
            <li key={p.user_id} className={cx('flex items-center gap-3 rounded-2xl p-2 shadow-card', p.user_id === me ? 'bg-accent-bg' : 'bg-surface')}>
              <span className="w-6 text-center text-lg font-black">{p.rank ?? '–'}</span>
              <Avatar avatar={p.avatar} frame={frames[p.user_id]} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{p.name}</p>
                <p className="text-xs text-muted">
                  {t('mres.pts', { n: p.score })} · {p.correct}/{res.n} · 🔥{p.best_streak}
                </p>
              </div>
              {p.payout > 0 && (
                <span className="inline-flex items-center gap-1 font-bold">
                  <Coin /> {p.payout}
                </span>
              )}
            </li>
          ))}
        </ol>

        {res.achievements.length > 0 && (
          <Card>
            {res.achievements.map((a) => (
              <p key={a.key} className="font-bold">
                {a.icon} {t('result.badge', { name: lang === 'ta' ? a.name_ta : a.name_en })} · +{a.coins}
              </p>
            ))}
          </Card>
        )}

        <InstallPrompt />
        {levelUp && <LevelUpOverlay level={levelUp} title={levelTitle(levelUp, lang)} onClose={() => setLevelUp(null)} />}

        {res.room_id && res.room_status === 'lobby' && (
          <section className="space-y-2">
            <ReactionBar onReact={react} />
            <PhraseBar onPhrase={(pid) => phrase(pid, profile?.display_name ?? '', profile?.avatar ?? 'a1')} />
            <ChatLog items={chat} me={me} roomId={res.room_id} />
            <ChatInput
              onSend={async (b) => {
                try {
                  await sendText(b);
                } catch (e) {
                  toast(errorText(e), 'bad');
                  throw e;
                }
              }}
            />
          </section>
        )}
      </div>
    </Screen>
  );
}
