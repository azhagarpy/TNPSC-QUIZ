import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, LayoutGroup } from 'motion/react';
import { api, ApiError } from '../lib/api';
import { toLocal } from '../lib/clock';
import { fx } from '../lib/feedback';
import { useI18n } from '../lib/i18n';
import { useRouter } from '../lib/router';
import { useSession } from '../lib/session';
import type { MatchPlayer, MatchSync } from '../lib/types';
import { Explanation, Options, QuestionText, TimerRing, useQuestionLang } from '../components/question';
import { FloatingEmoji, PhraseBar, ReactionBar, type ChatItem } from '../components/chat';
import { Avatar, Button, Coin, Loading, Screen, cx, useToast } from '../components/ui';
import { useRoomChat } from './Lobby';
import { useRoomCosmetics } from '../lib/cosmeticsHook';

// The phone only displays: questions arrive when the database clock opens
// them, answers are timestamped by the server, and the answer key arrives
// only after the question closes.
export default function LiveMatch({ params }: { params: Record<string, string> }) {
  const id = params.id;
  const { t, errorText } = useI18n();
  const { userId, profile } = useSession();
  const { navigate } = useRouter();
  const toast = useToast();
  const [sync, setSync] = useState<MatchSync | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [removed, setRemoved] = useState<number[]>([]);
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(Date.now());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inflight = useRef(false);
  const again = useRef(false); // an event arrived mid-request: sync once more
  const phaseKey = useRef('');
  const finishing = useRef(false);
  const me = userId!;
  const ql = useQuestionLang(sync?.question ?? null);

  const finish = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    try {
      await api.finishMatch(id);
    } catch {
      /* the result screen retries; the minute cron settles regardless */
    }
    navigate(`/m/${id}/result`, { replace: true });
  }, [id, navigate]);

  const pull = useCallback(async () => {
    if (inflight.current) {
      again.current = true;
      return;
    }
    inflight.current = true;
    again.current = false;
    clearTimeout(timer.current);
    try {
      const s = await api.matchSync(id);
      setOnline(true);
      setSync(s);
      const key = `${s.phase}:${s.index}`;
      if (key !== phaseKey.current) {
        phaseKey.current = key;
        if (s.phase === 'question') {
          setPicked(s.mine?.choice ?? null);
          setRemoved(s.question?.removed ?? []);
          fx.start();
        } else if (s.phase === 'reveal') {
          if (s.mine?.correct) fx.correct();
          else fx.wrong();
        }
      }
      if (s.phase === 'finished') {
        void finish();
        return;
      }
      // Wake up at the next scheduled change; while waiting for others, also poll gently.
      const next = s.next_at ? toLocal(s.next_at) - Date.now() + 120 : 2000;
      const waiting = s.phase === 'question' && s.mine?.choice !== undefined && s.mine?.choice !== null;
      timer.current = setTimeout(() => void pull(), Math.max(150, waiting ? Math.min(next, 4000) : next));
    } catch (e) {
      setOnline(false);
      if (e instanceof ApiError && e.code === 'not_in_match') {
        navigate('/', { replace: true });
        return;
      }
      timer.current = setTimeout(() => void pull(), 2000);
    } finally {
      inflight.current = false;
      if (again.current) {
        again.current = false;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void pull(), 0);
      }
    }
  }, [id, finish, navigate]);

  useEffect(() => {
    void pull();
    const onVisible = () => !document.hidden && void pull();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    const clock = setInterval(() => setNow(Date.now()), 250);
    return () => {
      clearTimeout(timer.current);
      clearInterval(clock);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [pull]);

  const { chat, reactions, react, phrase } = useRoomChat(sync?.room_id ?? null, me, (event, p) => {
    if (event === 'answered' && sync && p.index === sync.index) {
      setSync((s) => (s ? { ...s, players: s.players.map((x) => (x.user_id === p.user_id ? { ...x, answered: true } : x)) } : s));
    } else if (event === 'phase') {
      void pull();
    } else if (event === 'match_settled') {
      void finish();
    }
  });

  const pick = async (i: number) => {
    if (!sync || sync.phase !== 'question' || picked !== null || sync.index === null) return;
    setPicked(i);
    fx.tap();
    try {
      const r = await api.submitAnswer(id, sync.index, i);
      setSync((s) => (s ? { ...s, mine: { choice: i }, players: s.players.map((x) => (x.user_id === me ? { ...x, answered: true } : x)) } : s));
      if (r.all_answered) void pull();
    } catch (e) {
      if (e instanceof ApiError && ['question_closed', 'too_late', 'already_answered'].includes(e.code)) void pull();
      else {
        setPicked(null);
        toast(errorText(e), 'bad');
      }
    }
  };

  const power = async (kind: 'fifty' | 'time') => {
    try {
      const r = await api.usePowerup(id, kind);
      if (r.removed) setRemoved(r.removed);
      setSync((s) => (s ? { ...s, powerups: { ...s.powerups, [kind === 'fifty' ? 'fifty_used' : 'time_used']: true } } : s));
      if (kind === 'time') void pull();
    } catch (e) {
      toast(errorText(e), 'bad');
    }
  };

  const { frames, backdrop } = useRoomCosmetics(sync?.players.map((p) => p.user_id) ?? [], sync?.room_id);

  if (!sync) return <Loading />;
  // Quick phrases show over the sender's avatar for a few seconds.
  const lastPhrase = (uid: string) => chat.filter((c: ChatItem) => c.kind === 'phrase' && c.userId === uid && now - (c.at ?? 0) < 4000).at(-1);
  const sorted = [...sync.players].sort((a, b) => b.score - a.score);
  const secondsTo = (iso: string | null) => (iso ? Math.max(0, Math.ceil((toLocal(iso) - now) / 1000)) : 0);

  return (
    <Screen
      backdrop={backdrop}
      title={sync.index !== null && sync.phase !== 'starting' ? t('play.question', { i: sync.index + 1, n: sync.n }) : t('match.starting')}
      right={
        sync.stake > 0 ? (
          <span className="mr-2 inline-flex items-center gap-1 text-sm font-bold">
            <Coin /> {sync.stake * sync.players.length}
          </span>
        ) : undefined
      }
    >
      <div className="flex min-h-[calc(100dvh-6rem)] flex-col gap-3">
        {!online && <p className="rounded-xl bg-bad-bg px-3 py-2 text-center text-sm font-semibold">{t('match.reconnecting')}</p>}

        {/* Live strip: who has answered (never what) */}
        <div className="flex justify-around gap-2">
          {sync.players.map((p) => (
            <PlayerChip key={p.user_id} p={p} frame={frames[p.user_id]} me={me} phase={sync.phase} emojis={reactions.forUser(p.user_id)} phrase={sync.phase !== 'question' ? lastPhrase(p.user_id)?.body : undefined} />
          ))}
        </div>

        {sync.phase === 'starting' && (
          <div className="grid flex-1 place-items-center">
            <div className="text-center">
              <p className="anim-pop text-8xl font-black tabular-nums text-brand" key={secondsTo(sync.next_at)}>
                {secondsTo(sync.next_at) || '⚡'}
              </p>
              <p className="mt-2 font-semibold">{t('match.starting')}</p>
            </div>
          </div>
        )}

        {sync.phase === 'question' && sync.question && (
          <>
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <QuestionText q={sync.question} lang={ql.lang} canToggle={ql.canToggle} onToggle={ql.toggle} />
              </div>
              {sync.deadline_at && (
                <TimerRing
                  key={sync.deadline_at}
                  deadline={toLocal(sync.deadline_at)}
                  totalMs={toLocal(sync.deadline_at) - toLocal(sync.open_at)}
                  tick={picked === null}
                />
              )}
            </div>
            <div className="mt-auto space-y-3">
              {picked !== null && <p className="text-center text-sm font-semibold text-muted">🔒 {t('match.locked')} · {t('match.waiting')}</p>}
              <Options q={sync.question} lang={ql.lang} selected={picked} removed={removed} locked={picked !== null} onPick={(i) => void pick(i)} />
              {sync.powerups.enabled && picked === null && (
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant="secondary" disabled={sync.powerups.fifty_used} onClick={() => void power('fifty')}>
                    ✂️ 50:50 · <Coin size={14} /> {sync.powerups.prices.fifty}
                  </Button>
                  <Button size="sm" variant="secondary" disabled={sync.powerups.time_used} onClick={() => void power('time')}>
                    ⏱ +10s · <Coin size={14} /> {sync.powerups.prices.time}
                  </Button>
                </div>
              )}
              <ReactionBar onReact={react} />
              <p className="text-center text-[11px] text-muted">{t('chat.emojiOnly')}</p>
            </div>
          </>
        )}

        {sync.phase === 'reveal' && sync.question && (
          <>
            <div className={cx('anim-pop rounded-2xl px-4 py-3 text-center font-bold', sync.mine?.correct ? 'bg-ok-bg text-ok' : 'bg-bad-bg text-bad')}>
              {sync.mine?.correct ? `✓ ${t('play.correct')} ${t('match.you', { n: sync.mine.points ?? 0 })}` : sync.mine?.choice === null || sync.mine?.choice === undefined ? `⏱ ${t('match.noAnswer')}` : `✗ ${t('play.wrong')}`}
            </div>
            <QuestionText q={sync.question} lang={ql.lang} canToggle={ql.canToggle} onToggle={ql.toggle} meta={false} />
            <Options q={sync.question} lang={ql.lang} selected={sync.mine?.choice ?? null} answer={sync.question.answer} locked onPick={() => {}} />
            <Explanation q={sync.question} lang={ql.lang} />
            <LayoutGroup>
              <ol className="space-y-1.5">
                {sorted.map((p, i) => (
                  <motion.li layout key={p.user_id} className={cx('flex items-center gap-2 rounded-xl px-2 py-1.5', p.user_id === me ? 'bg-accent-bg' : 'bg-surface')}>
                    <span className="w-5 text-center font-black">{i + 1}</span>
                    <Avatar avatar={p.avatar} frame={frames[p.user_id]} size={28} />
                    <span className="flex-1 truncate text-sm font-semibold">{p.name}</span>
                    {p.points ? <span className="text-xs font-bold text-ok">+{p.points}</span> : null}
                    {p.streak && p.streak >= 3 ? <span className="text-xs">🔥{p.streak}</span> : null}
                    <span className="w-14 text-right font-bold tabular-nums">{p.score}</span>
                  </motion.li>
                ))}
              </ol>
            </LayoutGroup>
            <div className="mt-auto space-y-2">
              <p className="text-center text-xs text-muted">
                {sync.index !== null && sync.index + 1 < sync.n ? `${t('play.next')} · ${secondsTo(sync.next_at)}s` : t('match.over')}
              </p>
              <ReactionBar onReact={react} />
              <PhraseBar onPhrase={(pid) => phrase(pid, profile?.display_name ?? '', profile?.avatar ?? 'a1')} />
            </div>
          </>
        )}

        {sync.phase === 'finished' && (
          <div className="grid flex-1 place-items-center text-center">
            <div>
              <Loading />
              <p className="font-semibold">{t('mres.settling')}</p>
            </div>
          </div>
        )}
      </div>
    </Screen>
  );
}

function PlayerChip({
  p, me, phase, emojis, phrase, frame,
}: { p: MatchPlayer; me: string; phase: string; emojis: { id: number; emoji: string }[]; phrase?: string; frame?: string }) {
  const { t } = useI18n();
  return (
    <div className="relative flex w-20 flex-col items-center">
      <FloatingEmoji emojis={emojis} />
      {phrase && (
        <span className="anim-pop absolute -top-6 z-10 max-w-28 truncate rounded-full bg-ink px-2 py-0.5 text-[10px] font-semibold text-bg">
          {t(`phrase.${phrase}` as 'phrase.gg')}
        </span>
      )}
      <div className="relative">
        <Avatar avatar={p.avatar} frame={frame} size={44} ring={p.user_id === me ? 'var(--accent)' : undefined} />
        {phase === 'question' && p.answered && (
          <span className="anim-pop absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-ok text-[11px] font-bold text-white" aria-label="answered">
            ✓
          </span>
        )}
      </div>
      <span className="mt-0.5 max-w-full truncate text-xs font-semibold">{p.name}</span>
      <span className="text-xs font-bold tabular-nums">{p.score}</span>
    </div>
  );
}
