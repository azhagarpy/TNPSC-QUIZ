import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { fx } from '../lib/feedback';
import { useI18n } from '../lib/i18n';
import type { SoloEngine } from '../lib/solo';
import type { QuestionPayload, SoloReveal, SoloSummary } from '../lib/types';
import { Explanation, Options, ProgressDots, QuestionText, ReportQuestion, TimerRing, useQuestionLang } from './question';
import { Button, ErrorBox, Loading, Screen, cx } from './ui';

// Screens 5–6: question and answer reveal, for every timed solo mode.
// `top`, `onShown` and `onRevealed` let a screen add an opponent (practice bot).
export function SoloRunner({
  engine, title, onFinished, onQuit, top, onShown, onRevealed,
}: {
  engine: SoloEngine; title: string; onFinished: (s: SoloSummary) => void; onQuit: () => void;
  top?: React.ReactNode; onShown?: (index: number, q: QuestionPayload) => void; onRevealed?: (index: number, r: SoloReveal) => void;
}) {
  const { t, errorText } = useI18n();
  const [index, setIndex] = useState(engine.startIndex);
  const [q, setQ] = useState<QuestionPayload | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [reveal, setReveal] = useState<SoloReveal | null>(null);
  const [results, setResults] = useState<(boolean | null)[]>([]);
  const [score, setScore] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [inDeck, setInDeck] = useState(false);
  const answering = useRef(false);
  const shownRef = useRef(onShown);
  shownRef.current = onShown;
  const { lang, canToggle, toggle } = useQuestionLang(q);

  const load = useCallback(
    async (i: number) => {
      setError('');
      setQ(null);
      setReveal(null);
      setSelected(null);
      setInDeck(false);
      try {
        const { q: next, deadline: d } = await engine.question(i);
        setQ(next);
        setDeadline(d);
        if (!next.answered) shownRef.current?.(i, next);
        if (next.answered && next.answer !== undefined) {
          setReveal(next as unknown as SoloReveal);
          setSelected(next.choice ?? null);
        }
      } catch (e) {
        setError(errorText(e));
      }
    },
    [engine, errorText],
  );

  useEffect(() => {
    void load(index);
  }, [index, load]);

  const answer = async (choice: number | null) => {
    if (reveal || answering.current) return;
    answering.current = true;
    setSelected(choice);
    if (choice !== null) fx.tap();
    try {
      const r = await engine.answer(index, choice);
      setReveal(r);
      if (typeof r.score === 'number') setScore(r.score);
      onRevealed?.(index, r);
      setResults((xs) => {
        const c = [...xs];
        c[index] = r.correct;
        return c;
      });
      if (r.correct) fx.correct();
      else fx.wrong();
    } catch (e) {
      setError(errorText(e));
    } finally {
      answering.current = false;
    }
  };

  const next = async () => {
    if (index + 1 < engine.n) {
      setIndex(index + 1);
      return;
    }
    setBusy(true);
    try {
      onFinished(await engine.finish());
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const quit = (
    <button
      aria-label={t('play.quit')}
      className="btn-round"
      onClick={() => (reveal === null && index === 0 ? onQuit() : confirm(t('play.quitConfirm')) && onQuit())}
    >
      ✕
    </button>
  );

  const last = index + 1 >= engine.n;
  return (
    <Screen
      title={
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-base">{title}</span>
          <span className="font-display text-sm font-bold text-muted [text-shadow:none]">{t('play.question', { i: index + 1, n: engine.n })}</span>
        </span>
      }
      right={
        <div className="flex items-center gap-2">
          <span className="hud-pill !pl-2.5" aria-label={t('result.score', { n: score })}>
            <span aria-hidden>⭐</span> {score}
          </span>
          {quit}
        </div>
      }
      footer={
        reveal && (
          <Button block size="lg" variant={reveal.correct ? 'success' : 'primary'} onClick={next} loading={busy}>
            {last ? t('play.finish') : t('play.next')} <span aria-hidden>▶</span>
          </Button>
        )
      }
    >
      <div className="flex min-h-[calc(100dvh-10rem)] flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <ProgressDots n={engine.n} current={index} results={results} />
          </div>
          {/* The timer slot turns into a ✓ / ✗ medallion once the answer is shown. */}
          {reveal ? (
            <span
              className={cx(
                'btn3d anim-slam grid h-16 w-16 shrink-0 place-items-center !rounded-full text-3xl',
                reveal.correct ? 'btn-green' : 'btn-red',
              )}
              aria-hidden
            >
              {reveal.correct ? '✓' : reveal.choice === null ? '⏱' : '✗'}
            </span>
          ) : q && deadline && engine.timerS ? (
            <TimerRing key={`${index}-${deadline}`} deadline={deadline} totalMs={engine.timerS * 1000} onExpire={() => void answer(null)} />
          ) : (
            <span className="h-16 w-16 shrink-0" />
          )}
        </div>

        {top}
        {error && <ErrorBox text={error} onRetry={() => void load(index)} />}
        {!q && !error && <Loading />}

        {q && (
          <>
            <QuestionText q={q} lang={lang} canToggle={canToggle} onToggle={toggle} />
            {reveal && (
              <div
                className={cx(
                  'btn3d anim-slam relative flex items-center justify-between gap-2 px-4 py-2.5',
                  reveal.correct ? 'btn-green' : 'btn-red',
                )}
              >
                <span className="text-2xl leading-tight">
                  {reveal.correct ? `✓ ${t('play.correct')}` : reveal.choice === null ? `⏱ ${t('play.timeUp')}` : `✗ ${t('play.wrong')}`}
                </span>
                <span className="text-right text-sm leading-tight">
                  {reveal.points > 0 && <span className="block">{t('play.points', { n: reveal.points })}</span>}
                  {reveal.streak >= 3 && <span className="block">🔥 {t('play.streak', { n: reveal.streak })}</span>}
                </span>
                {reveal.points > 0 && (
                  <span
                    className="text-outline pointer-events-none absolute -top-3 right-6 font-display text-3xl font-extrabold text-gold"
                    style={{ animation: 'float-up 1.3s ease-out forwards' }}
                    aria-hidden
                  >
                    +{reveal.points}
                  </span>
                )}
              </div>
            )}
            <div className="mt-auto">
              <Options
                q={reveal ?? q}
                lang={lang}
                selected={selected}
                answer={reveal?.answer}
                locked={!!reveal || selected !== null}
                onPick={(i) => void answer(i)}
              />
            </div>
            {reveal && (
              <div className="space-y-3">
                <Explanation q={reveal} lang={lang} />
                <div className="flex items-center justify-between gap-3">
                  {q.id > 0 && engine.mode !== 'offline' ? (
                    reveal.correct && !inDeck ? (
                      <button
                        className="min-h-11 text-sm font-semibold text-accent underline"
                        onClick={async () => {
                          try {
                            await api.addToRevision(q.id);
                            setInDeck(true);
                          } catch {
                            /* not critical */
                          }
                        }}
                      >
                        + {t('play.addRevision')}
                      </button>
                    ) : (
                      <span className="text-sm text-muted">📚 {t('play.addedRevision')}</span>
                    )
                  ) : (
                    <span />
                  )}
                  <ReportQuestion questionId={q.id} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Screen>
  );
}
