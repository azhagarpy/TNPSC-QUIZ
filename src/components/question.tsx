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
// Green, then gold under 10 s, then red and pulsing for the last 5 s.
// ---------------------------------------------------------------------------

export function TimerRing({
  deadline, totalMs, size = 64, onExpire, tick = true,
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
    <div
      className={cx('relative shrink-0 rounded-full bg-[rgb(14_3_56/0.6)] shadow-[0_4px_0_rgb(0_0_0/0.3)]', urgent && 'anim-urgent')}
      style={{ width: size, height: size }}
      role="timer"
      aria-label={`${secs}s`}
    >
      <svg viewBox="0 0 40 40" className="h-full w-full -rotate-90">
        <circle cx="20" cy="20" r="16" fill="none" stroke="rgb(255 255 255 / 0.15)" strokeWidth="5" />
        <circle
          cx="20" cy="20" r="16" fill="none" pathLength={100} strokeDasharray="100" strokeDashoffset={100 - frac * 100}
          stroke={urgent ? 'var(--red)' : secs <= 10 ? 'var(--gold)' : 'var(--green)'} strokeWidth="5" strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.2s linear' }}
        />
      </svg>
      <span className="text-outline absolute inset-0 grid place-items-center font-display text-2xl font-extrabold tabular-nums text-white [--o:#12043f]">
        {secs}
      </span>
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

/** The question card. */
export function QuestionText({ q, lang, canToggle, onToggle, meta }: {
  q: QuestionPayload; lang: Lang; canToggle: boolean; onToggle: () => void; meta?: boolean;
}) {
  const { t, lang: uiLang } = useI18n();
  return (
    <div className="panel anim-rise px-4 pb-4 pt-3">
      <div className="mb-2 flex items-center gap-2 text-xs">
        {meta !== false && (
          <span className="min-w-0 truncate rounded-full bg-chip px-2.5 py-1 font-semibold text-muted">
            {unitName(q.unit, uiLang)} · {subtopicName(q.subtopic, uiLang)}
          </span>
        )}
        {canToggle && (
          <button onClick={onToggle} className="ml-auto min-h-9 shrink-0 rounded-full border-2 border-line bg-chip px-3 font-display text-sm font-bold text-ink">
            {lang === 'ta' ? t('lang.en') : t('lang.ta')}
          </button>
        )}
      </div>
      {q.image_url && <img src={q.image_url} alt="" className="mb-3 max-h-48 w-full rounded-2xl object-contain" loading="eager" />}
      <p className="tamil-wrap text-lg font-bold leading-relaxed" lang={lang}>
        {lang === 'ta' ? q.text_ta : q.text_en}
      </p>
    </div>
  );
}

// Each option letter has its own colour; none is green or red, which mean right and wrong.
const LETTER_COLORS = ['bg-blue text-white', 'bg-pink text-white', 'bg-gold text-gold-ink', 'bg-violet text-white'];

export function Options({
  q, lang, selected, answer, removed, locked, onPick,
}: {
  q: QuestionPayload; lang: Lang; selected: number | null; answer?: number | null; removed?: number[]; locked: boolean; onPick: (i: number) => void;
}) {
  const opts = (lang === 'ta' ? q.options_ta : q.options_en) ?? q.options_ta ?? q.options_en ?? [];
  const revealed = answer !== undefined && answer !== null;
  return (
    <div className="flex flex-col gap-3" role="group">
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
              'tile tamil-wrap flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left font-semibold',
              isAnswer && 'tile-ok anim-pulse-ok',
              isWrongPick && 'tile-bad anim-shake',
              isPicked && 'tile-picked',
              isRemoved && 'opacity-35 line-through',
              revealed && !isAnswer && !isWrongPick && 'opacity-55',
            )}
          >
            <span
              className={cx(
                'grid h-9 w-9 shrink-0 place-items-center rounded-xl font-display text-lg font-extrabold [text-shadow:none] shadow-[inset_0_-3px_0_rgb(0_0_0/0.2)]',
                isAnswer ? 'bg-white text-[var(--green-lip)]' : isWrongPick ? 'bg-white text-[var(--red-lip)]' : LETTER_COLORS[i % 4],
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
    <div className="panel anim-rise !border-l-[6px] !border-l-[var(--blue)] p-3 text-sm">
      <span className="font-display font-extrabold">💡 {t('play.explanation')}: </span>
      <span className="tamil-wrap">{text}</span>
      {q.book_ref && <p className="mt-1 text-xs text-muted">{t('play.ref', { ref: q.book_ref })}</p>}
    </div>
  );
}

/** One pip per question: solid for right, striped for wrong, glowing for the current one. */
export function ProgressDots({ n, current, results }: { n: number; current: number; results: (boolean | null | undefined)[] }) {
  return (
    <div className="flex gap-1" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={cx('pip', results[i] === true ? 'pip-ok' : results[i] === false ? 'pip-bad' : i === current && 'pip-now')} />
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
      <button className="min-h-11 text-sm font-semibold text-muted underline" onClick={() => setOpen(true)}>
        🚩 {t('play.report')}
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
