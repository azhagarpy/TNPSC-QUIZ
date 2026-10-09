import { useEffect, useRef, useState } from 'react';
import { demoProfile, demoQuestions, saveDemoProfile } from '../lib/demo';
import { useI18n } from '../lib/i18n';
import { useRouter } from '../lib/router';
import { useSession } from '../lib/session';
import { answerPoints, startLocal, startRemote, type SoloEngine } from '../lib/solo';
import { isDemo } from '../lib/supabase';
import { track } from '../lib/telemetry';
import type { QuestionPayload, SoloReveal, SoloSummary } from '../lib/types';
import { SoloResult } from '../components/SoloResult';
import { SoloRunner } from '../components/SoloRunner';
import { Avatar, Card, ErrorBox, Loading, Screen, cx } from '../components/ui';

interface BotTurn {
  at: number; // local time the bot "answers"
  timeMs: number;
  correct: boolean;
  points?: number;
}

// Practice bot (plan: Quick Match fallback): a normal practice set against a
// simulated opponent, clearly labelled, with no coins at stake.
export default function BotMatch() {
  const { t, lang, errorText } = useI18n();
  const { profile, refresh } = useSession();
  const { navigate } = useRouter();
  const [engine, setEngine] = useState<SoloEngine | null>(null);
  const [summary, setSummary] = useState<SoloSummary | null>(null);
  const [error, setError] = useState('');
  const [round, setRound] = useState(0);
  const [, setTick] = useState(0);
  const turns = useRef<BotTurn[]>([]);
  const botStreak = useRef(0);
  const [scores, setScores] = useState({ me: 0, bot: 0 });
  const [current, setCurrent] = useState<number | null>(null);
  const level = profile?.level ?? 1;

  useEffect(() => {
    let alive = true;
    setEngine(null);
    setSummary(null);
    setScores({ me: 0, bot: 0 });
    turns.current = [];
    botStreak.current = 0;
    (async () => {
      try {
        const e = isDemo
          ? startLocal(await demoQuestions(), {
              mode: 'demo',
              onFinish: async (_r, base) => {
                const p = demoProfile();
                const coins = 5 * base.correct + (base.complete ? 20 : 0);
                return { ...base, coins, balance: saveDemoProfile({ coins: p.coins + coins, xp: p.xp + base.xp.xp }).coins };
              },
            })
          : await startRemote('practice');
        if (alive) setEngine(e);
      } catch (err) {
        if (alive) setError(errorText(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [round, errorText]);

  // Re-render while the bot is "thinking" so its tick appears on time.
  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 300);
    return () => clearInterval(id);
  }, []);

  const onShown = (i: number, q: QuestionPayload) => {
    if (turns.current[i]) return;
    // Accuracy grows with level and drops with difficulty; answers in 3–14 s.
    const p = Math.min(0.9, Math.max(0.25, 0.5 + 0.02 * level - 0.08 * (q.difficulty - 3)));
    const timeMs = 3000 + Math.random() * (9000 + q.difficulty * 400);
    turns.current[i] = { at: Date.now() + timeMs, timeMs, correct: Math.random() < p };
    setCurrent(i);
  };

  const onRevealed = (i: number, r: SoloReveal) => {
    const turn = turns.current[i];
    if (!turn || turn.points !== undefined) return;
    botStreak.current = turn.correct ? botStreak.current + 1 : 0;
    turn.points = answerPoints(turn.correct, turn.timeMs, engine?.timerS ?? 20, botStreak.current);
    setScores((s) => ({ me: r.score, bot: s.bot + turn.points! }));
    setCurrent(null);
  };

  const botAnswered = current !== null && turns.current[current] && Date.now() >= turns.current[current].at;
  const strip = (
    <div className="flex items-center justify-around rounded-2xl bg-surface-2 p-2">
      <div className="flex items-center gap-2">
        <Avatar avatar={profile?.avatar ?? 'a1'} frame={profile?.frame} size={36} />
        <span className="font-bold tabular-nums">{scores.me}</span>
      </div>
      <span className="text-xs font-semibold text-muted">{t('bot.noStakes')}</span>
      <div className="flex items-center gap-2">
        <span className="font-bold tabular-nums">{scores.bot}</span>
        <span className="relative">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-bg text-xl" aria-label={t('bot.name')}>
            🤖
          </span>
          {botAnswered && <span className="anim-pop absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-ok text-[10px] text-white">✓</span>}
        </span>
      </div>
    </div>
  );

  if (summary) {
    const outcome = scores.me > scores.bot ? 'bot.youWin' : scores.me < scores.bot ? 'bot.botWins' : 'bot.draw';
    return (
      <Screen title={t('bot.title')} back="/">
        <div className="space-y-4">
          <Card className="text-center">
            <p className="text-2xl font-black">{outcome === 'bot.youWin' ? '🎉 ' : '🤖 '}{t(outcome)}</p>
            <p className="mt-1 text-lg font-bold tabular-nums">
              {scores.me} : {scores.bot}
            </p>
            <p className="text-xs text-muted">{t('bot.noStakes')}</p>
          </Card>
          <SoloResult summary={summary} onHome={() => navigate('/', { replace: true })} onPlayAgain={() => setRound((r) => r + 1)} />
        </div>
      </Screen>
    );
  }
  if (error) {
    return (
      <Screen title={t('bot.title')} back="/">
        <ErrorBox text={error} onRetry={() => setRound((r) => r + 1)} />
      </Screen>
    );
  }
  if (!engine) return <Loading />;
  return (
    <SoloRunner
      key={round}
      engine={engine}
      title={`🤖 ${t('bot.title')}`}
      top={<div className={cx(lang === 'ta' && 'text-sm')}>{strip}</div>}
      onShown={onShown}
      onRevealed={onRevealed}
      onQuit={() => navigate('/', { replace: true })}
      onFinished={(s) => {
        track('bot_match', { me: scores.me, bot: scores.bot });
        setSummary(s);
        void refresh();
      }}
    />
  );
}
