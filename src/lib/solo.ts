import { api } from './api';
import { toLocal } from './clock';
import type { PackQuestion, SoloMode, SoloQuestion, SoloReveal, SoloSummary, WeakTopic } from './types';

// One interface for every solo flow. Online sets run on the server (it keeps
// the clock and the answers); offline and demo sets run from a local pack.

export interface SoloEngine {
  mode: SoloMode | 'offline';
  n: number;
  timerS: number | null;
  startIndex: number;
  /** The question plus a local-clock deadline (ms), or null when untimed. */
  question(i: number): Promise<{ q: SoloQuestion; deadline: number | null }>;
  answer(i: number, choice: number | null): Promise<SoloReveal>;
  finish(): Promise<SoloSummary>;
}

export async function startRemote(
  mode: SoloMode, subject?: string | null, level?: string | null, subtopic?: string | null, resumeId?: string | null,
): Promise<SoloEngine> {
  const info = resumeId ? await api.soloResume(resumeId) : await api.soloStart(mode, subject, level, subtopic);
  return {
    mode,
    n: info.n,
    timerS: info.timer_s,
    startIndex: info.next_index,
    async question(i) {
      const q = await api.soloQuestion(info.id, i);
      return { q, deadline: q.deadline_at ? toLocal(q.deadline_at) : null };
    },
    answer: (i, c) => api.soloAnswer(info.id, i, c),
    finish: () => api.soloFinish(info.id),
  };
}

// Same scoring as app_private.answer_points.
export function answerPoints(correct: boolean, timeMs: number, timerS: number, streakAfter: number) {
  if (!correct) return 0;
  const bonus = Math.max(0, Math.min(50, Math.round(50 * (1 - timeMs / (timerS * 1000)))));
  return 100 + bonus + (streakAfter >= 3 ? 25 : 0);
}

function shuffle<T>(a: T[]) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

export interface LocalResult {
  q: number;
  c: number | null; // canonical option index
  t: number;
  correct: boolean;
}

/**
 * Runs a set from questions that carry their answers (offline pack or demo pack).
 * `onFinish` stores/syncs the results and returns the coin/XP part of the summary.
 */
export function startLocal(
  pool: PackQuestion[],
  opts: {
    mode: SoloMode | 'offline';
    n?: number;
    timerS?: number;
    subject?: string | null;
    onFinish: (results: LocalResult[], base: SoloSummary) => Promise<SoloSummary>;
  },
): SoloEngine {
  const timerS = opts.timerS ?? 20;
  const candidates = opts.subject ? pool.filter((q) => q.unit === opts.subject) : pool;
  const picked = shuffle(candidates.length ? candidates : pool).slice(0, opts.n ?? 10);
  const perms = picked.map(() => shuffle([0, 1, 2, 3]));
  const shownAt: number[] = [];
  const results: LocalResult[] = [];
  let streak = 0;
  let score = 0;

  const payload = (i: number, reveal: boolean) => {
    const q = picked[i];
    const p = perms[i];
    return {
      id: q.id, unit: q.unit, subtopic: q.subtopic, difficulty: q.difficulty,
      text_ta: q.text_ta, text_en: q.text_en, image_url: null,
      options_ta: q.options_ta ? p.map((k) => q.options_ta![k]) : null,
      options_en: q.options_en ? p.map((k) => q.options_en![k]) : null,
      ...(reveal ? { answer: p.indexOf(q.answer), explanation_ta: q.explanation_ta, explanation_en: q.explanation_en, book_ref: q.book_ref ?? null } : {}),
    };
  };

  return {
    mode: opts.mode,
    n: picked.length,
    timerS,
    startIndex: 0,
    async question(i) {
      shownAt[i] ??= Date.now();
      const q: SoloQuestion = { ...payload(i, false), index: i, n: picked.length, answered: false, server_now: new Date().toISOString() };
      return { q, deadline: shownAt[i] + timerS * 1000 };
    },
    async answer(i, choice) {
      const t = Date.now() - (shownAt[i] ?? Date.now());
      const late = t > (timerS + 2) * 1000;
      const canon = choice === null || late ? null : perms[i][choice];
      const correct = canon !== null && canon === picked[i].answer;
      streak = correct ? streak + 1 : 0;
      const points = answerPoints(correct, Math.min(t, timerS * 1000), timerS, streak);
      score += points;
      results[i] = { q: picked[i].id, c: canon, t, correct };
      return { ...payload(i, true), index: i, choice: late ? null : choice, correct, points, time_ms: t, score, streak } as SoloReveal;
    },
    async finish() {
      const done = results.filter(Boolean);
      const correct = done.filter((r) => r.correct).length;
      const answered = done.filter((r) => r.c !== null).length;
      const bySub = new Map<string, WeakTopic>();
      done.forEach((r, i) => {
        const q = picked[i];
        const w = bySub.get(q.subtopic) ?? { unit: q.unit, subtopic: q.subtopic, total: 0, correct: 0 };
        w.total++;
        if (r.correct) w.correct++;
        bySub.set(q.subtopic, w);
      });
      const weak = [...bySub.values()]
        .filter((w) => w.correct < w.total)
        .sort((a, b) => a.correct / a.total - b.correct / b.total || b.total - a.total)
        .slice(0, 3);
      const base: SoloSummary = {
        id: 'local', mode: opts.mode === 'offline' ? 'practice' : opts.mode, n: picked.length, answered, correct, score,
        complete: done.length === picked.length, coins: 0, coin_cap_hit: false,
        xp: { xp: 10 * correct + 2 * answered, level: 0, level_up: false, level_coins: 0 },
        streak: null, weak, achievements: [], report: null, marks: null, daily_rank: null, balance: 0,
      };
      return opts.onFinish(done, base);
    },
  };
}
