import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { api } from '../lib/api';
import { fx } from '../lib/feedback';
import { isDemo } from '../lib/supabase';
import type { Lang, QuestionPayload } from '../lib/types';
import { subtopicName, unitName } from '../lib/units';
import { Button, Sheet, cx, inputClass, useToast } from './ui';

// ---------------------------------------------------------------------------
// Timer ring: SVG, driven from the deadline so it stays right on slow networks.
// ---------------------------------------------------------------------------

export function TimerRing({
  deadline, totalMs, size = 60, onExpire, tick = true,
}: { deadline: number; totalMs: number; size?: number; onExpire?: () => void; tick?: boolean }) {
  const [left, setLeft] = useState(() => Math.max(0, deadline - Date.now()));
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  useEffect(() => {
    let fired = false;
    let lastSec = -1;
    const step = () => {
      const l = Math.max(0, deadline - Date.now());
      setLeft(l);
      const sec = Math.ceil(l / 1000);
      if (tick && sec !== lastSec && sec <= 5 && sec > 0) fx.tick();
      lastSec = sec;
      if (l <= 0 && !fired) {
        fired = true;
        expireRef.current?.();
      }
    };
    step();
    const id = setInterval(step, 200);
    return () => clearInterval(id);
  }, [deadline, tick]);

  const frac = totalMs > 0 ? left / totalMs : 0;
  const secs = Math.ceil(left / 1000);
  const urgent = secs <= 5;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="timer" aria-label={`${secs}s`}>
      <svg viewBox="0 0 40 40" className="h-full w-full -rotate-90">
        <circle cx="20" cy="20" r="17" fill="none" stroke="var(--line)" strokeWidth="4" />
        <circle
          cx="20" cy="20" r="17" fill="none" pathLength={100} strokeDasharray="100" strokeDashoffset={100 - frac * 100}
          stroke={urgent ? 'var(--bad)' : 'var(--accent)'} strokeWidth="4" strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.2s linear' }}
        />
      </svg>
      <span className={cx('absolute inset-0 grid place-items-center text-lg font-bold tabular-nums', urgent && 'text-bad')}>{secs}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Question text and options
// ---------------------------------------------------------------------------

export function useQuestionLang(q: QuestionPayload | null) {
  const { lang } = useI18n();
  const [shown, setShown] = useState<Lang>(lang);
  useEffect(() => setShown(lang), [lang, q?.id]);
  const has = (l: Lang) => !!(l === 'ta' ? q?.text_ta : q?.text_en);
  const effective: Lang = has(shown) ? shown : shown === 'ta' ? 'en' : 'ta';
  return { lang: effective, canToggle: has('ta') && has('en'), toggle: () => setShown(effective === 'ta' ? 'en' : 'ta') };
}

export function QuestionText({ q, lang, canToggle, onToggle, meta }: {
  q: QuestionPayload; lang: Lang; canToggle: boolean; onToggle: () => void; meta?: boolean;
}) {
  const { t, lang: uiLang } = useI18n();
  return (
    <div className="anim-rise">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted">
        {meta !== false && (
          <span className="truncate">
            {unitName(q.unit, uiLang)} · {subtopicName(q.subtopic, uiLang)}
          </span>
        )}
        {canToggle && (
          <button onClick={onToggle} className="ml-auto shrink-0 rounded-full border border-line px-3 py-1 font-semibold text-ink">
            {lang === 'ta' ? t('lang.en') : t('lang.ta')}
          </button>
        )}
      </div>
      {q.image_url && <img src={q.image_url} alt="" className="mb-3 max-h-48 w-full rounded-2xl object-contain" loading="eager" />}
      <p className="tamil-wrap text-lg font-semibold leading-relaxed" lang={lang}>
        {lang === 'ta' ? q.text_ta : q.text_en}
      </p>
    </div>
  );
}

export function Options({
  q, lang, selected, answer, removed, locked, onPick,
}: {
  q: QuestionPayload; lang: Lang; selected: number | null; answer?: number | null; removed?: number[]; locked: boolean; onPick: (i: number) => void;
}) {
  const opts = (lang === 'ta' ? q.options_ta : q.options_en) ?? q.options_ta ?? q.options_en ?? [];
  const revealed = answer !== undefined && answer !== null;
  return (
    <div className="flex flex-col gap-2.5" role="group">
      {opts.map((text, i) => {
        const isRemoved = removed?.includes(i) && !revealed;
        const isAnswer = revealed && i === answer;
        const isWrongPick = revealed && i === selected && i !== answer;
        const isPicked = !revealed && i === selected;
        return (
          <button
            key={i}
            disabled={locked || isRemoved}
            onClick={() => onPick(i)}
            aria-pressed={isPicked}
            className={cx(
              'tamil-wrap flex min-h-14 w-full items-center gap-3 rounded-2xl border-2 px-3 py-2.5 text-left font-semibold transition',
              'active:scale-[0.99] disabled:active:scale-100',
              isAnswer && 'anim-pulse-ok border-ok bg-ok-bg',
              isWrongPick && 'anim-shake border-bad bg-bad-bg',
              isPicked && 'border-accent bg-accent-bg',
              !isAnswer && !isWrongPick && !isPicked && 'border-line bg-surface',
              isRemoved && 'opacity-30 line-through',
              revealed && !isAnswer && !isWrongPick && 'opacity-60',
            )}
          >
            <span
              className={cx(
                'grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold',
                isAnswer ? 'bg-ok text-white' : isWrongPick ? 'bg-bad text-white' : isPicked ? 'bg-accent text-white' : 'bg-surface-2',
              )}
              aria-hidden
            >
              {isAnswer ? '✓' : isWrongPick ? '✗' : 'ABCD'[i]}
            </span>
            <span className="flex-1" lang={lang}>
              {text}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Explanation({ q, lang }: { q: QuestionPayload; lang: Lang }) {
  const { t } = useI18n();
  const text = lang === 'ta' ? (q.explanation_ta ?? q.explanation_en) : (q.explanation_en ?? q.explanation_ta);
  if (!text) return null;
  return (
    <div className="anim-rise rounded-2xl bg-surface-2 p-3 text-sm">
      <span className="font-bold">{t('play.explanation')}: </span>
      <span className="tamil-wrap">{text}</span>
      {q.book_ref && <p className="mt-1 text-xs text-muted">{t('play.ref', { ref: q.book_ref })}</p>}
    </div>
  );
}

export function ProgressDots({ n, current, results }: { n: number; current: number; results: (boolean | null | undefined)[] }) {
  return (
    <div className="flex flex-wrap gap-1" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className={cx(
            'h-2 flex-1 rounded-full',
            results[i] === true ? 'bg-ok' : results[i] === false ? 'bg-bad' : i === current ? 'bg-accent' : 'bg-line',
          )}
          style={{ minWidth: 6 }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report a question (review queue within 48 h; upheld → +20 coins)
// ---------------------------------------------------------------------------

export function ReportQuestion({ questionId }: { questionId: number }) {
  const { t, errorText } = useI18n();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('wrong_answer');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  if (isDemo || questionId < 0) return null;
  const reasons = ['wrong_answer', 'typo', 'translation', 'outdated', 'other'] as const;
  return (
    <>
      <button className="text-xs font-semibold text-muted underline" onClick={() => setOpen(true)}>
        {t('play.report')}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('report.title')}>
        <div className="flex flex-col gap-2">
          {reasons.map((r) => (
            <label key={r} className="flex min-h-11 items-center gap-3">
              <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} className="h-5 w-5 accent-[var(--brand)]" />
              {t(`report.${r}`)}
            </label>
          ))}
          <textarea
            className={cx(inputClass, 'min-h-20 py-2')}
            maxLength={500}
            placeholder={t('report.details')}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.reportQuestion(questionId, reason, details || undefined);
                toast(t('play.reported'), 'ok');
                setOpen(false);
              } catch (e) {
                toast(errorText(e), 'bad');
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('report.send')}
          </Button>
        </div>
      </Sheet>
    </>
  );
}
