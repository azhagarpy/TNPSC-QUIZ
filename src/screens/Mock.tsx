import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useRouter } from '../lib/router';
import { useSession } from '../lib/session';
import type { SoloQuestion, SoloSessionInfo, SoloSummary } from '../lib/types';
import { unitName } from '../lib/units';
import { Options, QuestionText, useQuestionLang } from '../components/question';
import { SoloResult } from '../components/SoloResult';
import { Button, Card, ErrorBox, Loading, ProgressBar, Screen, Sheet, cx } from '../components/ui';

const LIMIT_S = 3 * 60 * 60;

function hms(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// Weekly mock: full 200-question pattern, 3 hours of active time, pausable.
export default function Mock() {
  const { t, lang, errorText } = useI18n();
  const { summary: home, refresh } = useSession();
  const { navigate } = useRouter();
  const [info, setInfo] = useState<SoloSessionInfo | null>(null);
  const [index, setIndex] = useState(0);
  const [q, setQ] = useState<SoloQuestion | null>(null);
  const [answers, setAnswers] = useState<Map<number, number>>(new Map());
  const [elapsed, setElapsed] = useState(0);
  const [palette, setPalette] = useState(false);
  const [result, setResult] = useState<SoloSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cache = useRef(new Map<number, SoloQuestion>());
  const elapsedRef = useRef(0);
  elapsedRef.current = elapsed;
  const ql = useQuestionLang(q);

  const begin = async () => {
    setBusy(true);
    setError('');
    try {
      const s = await api.soloStart('mock');
      setInfo(s);
      setElapsed(s.elapsed_s);
      setAnswers(new Map(s.answered.map((i) => [i, -1])));
      setIndex(s.next_index < s.n ? s.next_index : 0);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const fetchQ = useCallback(
    async (i: number) => {
      if (!info) return null;
      const hit = cache.current.get(i);
      if (hit) return hit;
      const fresh = await api.soloQuestion(info.id, i);
      cache.current.set(i, fresh);
      return fresh;
    },
    [info],
  );

  useEffect(() => {
    if (!info) return;
    let alive = true;
    setQ(null);
    fetchQ(index)
      .then((fresh) => {
        if (!alive || !fresh) return;
        setQ(fresh);
        if (fresh.choice !== null && fresh.choice !== undefined) setAnswers((m) => new Map(m).set(index, fresh.choice!));
        if (index + 1 < info.n) void fetchQ(index + 1).catch(() => {});
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [info, index, fetchQ, errorText]);

  // Active time only counts while this screen is open and visible.
  useEffect(() => {
    if (!info || result) return;
    const tick = setInterval(() => {
      if (!document.hidden) setElapsed((e) => e + 1);
    }, 1000);
    const save = setInterval(() => void api.mockProgress(info.id, elapsedRef.current).catch(() => {}), 30_000);
    return () => {
      clearInterval(tick);
      clearInterval(save);
      void api.mockProgress(info.id, elapsedRef.current).catch(() => {});
    };
  }, [info, result]);

  const submit = useCallback(async () => {
    if (!info) return;
    setBusy(true);
    try {
      setResult(await api.soloFinish(info.id, elapsedRef.current));
      void refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }, [info, refresh, errorText]);

  useEffect(() => {
    if (info && !result && elapsed >= LIMIT_S) void submit();
  }, [elapsed, info, result, submit]);

  const pick = async (choice: number | null) => {
    if (!info) return;
    const prev = answers.get(index);
    setAnswers((m) => {
      const c = new Map(m);
      if (choice === null) c.delete(index);
      else c.set(index, choice);
      return c;
    });
    const cached = cache.current.get(index);
    if (cached) cache.current.set(index, { ...cached, choice });
    try {
      await api.soloAnswer(info.id, index, choice);
    } catch (e) {
      setAnswers((m) => {
        const c = new Map(m);
        if (prev === undefined) c.delete(index);
        else c.set(index, prev);
        return c;
      });
      setError(errorText(e));
    }
  };

  if (result) {
    return (
      <Screen title={t('mock.title')} back="/">
        <SoloResult
          summary={result}
          onHome={() => navigate('/', { replace: true })}
          extra={
            <Card>
              <p className="text-2xl font-black">{t('mock.marks', { marks: result.marks ?? 0 })}</p>
              <p className={cx('text-sm font-semibold', result.coins > 0 ? 'text-ok' : 'text-muted')}>
                {result.coins > 0 ? t('mock.reward') : t('mock.noReward')}
              </p>
              <h3 className="mb-2 mt-4 font-bold">{t('mock.byUnit')}</h3>
              <ul className="space-y-2">
                {result.report?.map((r) => (
                  <li key={r.unit}>
                    <div className="flex justify-between text-sm">
                      <span className="truncate">{unitName(r.unit, lang)}</span>
                      <span className="font-semibold tabular-nums">
                        {r.correct}/{r.total}
                      </span>
                    </div>
                    <ProgressBar pct={r.total ? (r.correct / r.total) * 100 : 0} color="bg-ok" />
                  </li>
                ))}
              </ul>
            </Card>
          }
        />
      </Screen>
    );
  }

  if (!info) {
    return (
      <Screen title={t('mock.title')} back="/">
        <Card>
          <p className="text-sm">{t('mock.intro')}</p>
          <Button block size="lg" className="mt-4" loading={busy} onClick={begin}>
            {home?.mock_active ? t('home.mockResume') : t('mock.start')}
          </Button>
          {home?.mock_done_this_week && <p className="mt-2 text-xs text-muted">✓ {t('home.mockDone')}</p>}
        </Card>
        {error && (
          <div className="mt-4">
            <ErrorBox text={error} />
          </div>
        )}
      </Screen>
    );
  }

  const answeredCount = answers.size;
  const selected = answers.get(index);
  return (
    <Screen
      title={`${t('mock.title')} · ${index + 1}/${info.n}`}
      right={
        <span className={cx('rounded-full px-3 py-1 text-sm font-bold tabular-nums', LIMIT_S - elapsed < 600 ? 'bg-bad-bg text-bad' : 'bg-surface-2')}>
          ⏱ {hms(Math.max(0, LIMIT_S - elapsed))}
        </span>
      }
      footer={
        <div className="grid grid-cols-3 gap-2">
          <Button variant="secondary" disabled={index === 0} onClick={() => setIndex(index - 1)}>
            ← {t('mock.prev')}
          </Button>
          <Button variant="secondary" onClick={() => setPalette(true)}>
            {answeredCount}/{info.n}
          </Button>
          <Button disabled={index + 1 >= info.n} onClick={() => setIndex(index + 1)}>
            {t('mock.next')} →
          </Button>
        </div>
      }
    >
      <div className="flex min-h-[calc(100dvh-11rem)] flex-col gap-4">
        <ProgressBar pct={(answeredCount / info.n) * 100} color="bg-accent" />
        {error && <ErrorBox text={error} onRetry={() => setError('')} />}
        {!q ? (
          <Loading />
        ) : (
          <>
            <QuestionText q={q} lang={ql.lang} canToggle={ql.canToggle} onToggle={ql.toggle} />
            <div className="mt-auto space-y-2">
              <Options q={q} lang={ql.lang} selected={selected !== undefined && selected >= 0 ? selected : null} locked={false} onPick={(i) => void pick(i)} />
              {selected !== undefined && (
                <button className="text-sm font-semibold text-muted underline" onClick={() => void pick(null)}>
                  {t('mock.clear')}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <Sheet open={palette} onClose={() => setPalette(false)} title={t('mock.palette')}>
        <p className="mb-3 text-sm text-muted">{t('mock.answered', { a: answeredCount, n: info.n })}</p>
        <div className="grid grid-cols-8 gap-1.5">
          {Array.from({ length: info.n }, (_, i) => (
            <button
              key={i}
              onClick={() => {
                setIndex(i);
                setPalette(false);
              }}
              className={cx(
                'h-9 rounded-lg text-xs font-bold tabular-nums',
                i === index ? 'bg-accent text-white' : answers.has(i) ? 'bg-ok-bg text-ok' : 'bg-surface-2',
              )}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-2">
          <Button
            loading={busy}
            onClick={() => {
              const left = info.n - answeredCount;
              if (left === 0 || confirm(t('mock.submitConfirm', { left }))) void submit();
            }}
          >
            {t('mock.submit')}
          </Button>
          <Button variant="secondary" onClick={() => navigate('/', { replace: true })}>
            ⏸ {t('mock.pause')}
          </Button>
        </div>
      </Sheet>
    </Screen>
  );
}
