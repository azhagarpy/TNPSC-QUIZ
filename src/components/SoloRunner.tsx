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
      className="grid h-11 w-11 place-items-center rounded-full text-xl hover:bg-surface-2"
      onClick={() => (reveal === null && index === 0 ? onQuit() : confirm(t('play.quitConfirm')) && onQuit())}
    >
      ✕
    </button>
  );

  const last = index + 1 >= engine.n;
  return (
    <Screen
      title={title}
      right={quit}
      footer={
        reveal && (
          <Button block size="lg" onClick={next} loading={busy}>
            {last ? t('play.finish') : t('play.next')}
          </Button>
        )
      }
    >
      <div className="flex min-h-[calc(100dvh-10rem)] flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="mb-1 text-sm font-semibold text-muted">{t('play.question', { i: index + 1, n: engine.n })}</p>
            <ProgressDots n={engine.n} current={index} results={results} />
          </div>
          {q && deadline && engine.timerS && !reveal && (
            <TimerRing key={`${index}-${deadline}`} deadline={deadline} totalMs={engine.timerS * 1000} onExpire={() => void answer(null)} />
          )}
        </div>

        {top}
        {error && <ErrorBox text={error} onRetry={() => void load(index)} />}
        {!q && !error && <Loading />}

        {q && (
          <>
            <QuestionText q={q} lang={lang} canToggle={canToggle} onToggle={toggle} />
            {reveal && (
              <div className={cx('anim-pop flex items-center justify-between rounded-2xl px-4 py-3 font-bold', reveal.correct ? 'bg-ok-bg text-ok' : 'bg-bad-bg text-bad')}>
                <span>
                  {reveal.correct ? `✓ ${t('play.correct')}` : reveal.choice === null ? `⏱ ${t('play.timeUp')}` : `✗ ${t('play.wrong')}`}
                </span>
                <span className="text-sm">
                  {reveal.points > 0 && t('play.points', { n: reveal.points })}
                  {reveal.streak >= 3 && ` · 🔥 ${t('play.streak', { n: reveal.streak })}`}
                </span>
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
                        className="text-xs font-semibold text-accent underline"
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
                      <span className="text-xs text-muted">📚 {t('play.addedRevision')}</span>
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
