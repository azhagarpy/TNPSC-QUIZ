import { describe, expect, it } from 'vitest';
import { csvToQuestions, parseCsv, CSV_TEMPLATE } from './csv';
import { levelForXp, levelProgress, levelTitle, xpForLevel } from './levels';
import { matchPath } from './router';
import { answerPoints, startLocal } from './solo';
import { podiumOrder } from '../components/scenes';
import { strings } from './strings';
import samplePack from '../demo/samplePack.json';
import type { PackQuestion } from './types';

describe('levels mirror the database formula', () => {
  it('matches app_private.xp_for_level', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(100);
    expect(xpForLevel(3)).toBe(320);
    expect(xpForLevel(10)).toBe(5220);
    expect(xpForLevel(50)).toBe(146020);
  });
  it('level_for_xp boundaries', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(5220)).toBe(10);
    expect(levelForXp(10_000_000)).toBe(50);
    expect(levelProgress(210).pct).toBe(50);
  });
  it('has 50 titled levels', () => {
    expect(levelTitle(1, 'en')).toBe('Aspirant I');
    expect(levelTitle(50, 'en')).toBe('Group 4 Champion V');
    expect(levelTitle(16, 'ta')).toContain('கிராம நிர்வாக அலுவலர்');
  });
});

describe('scoring mirrors app_private.answer_points', () => {
  it('100 + linear speed bonus + streak', () => {
    expect(answerPoints(false, 1000, 15, 0)).toBe(0);
    expect(answerPoints(true, 0, 15, 1)).toBe(150);
    expect(answerPoints(true, 7500, 15, 1)).toBe(125);
    expect(answerPoints(true, 15000, 15, 2)).toBe(100);
    expect(answerPoints(true, 20000, 15, 3)).toBe(125); // late (extra time): no bonus, streak still counts
  });
});

describe('csv import', () => {
  it('handles quotes, commas, newlines and BOM', () => {
    expect(parseCsv('﻿a,b\n"x, y","he said ""hi"""\r\n"multi\nline",z\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
      ['multi\nline', 'z'],
    ]);
  });
  it('turns the template into an importable question', () => {
    const { items, missing } = csvToQuestions(CSV_TEMPLATE);
    expect(missing).toEqual([]);
    expect(items).toHaveLength(1);
    expect(items[0].unit).toBe('polity');
    expect(items[0].options_ta).toHaveLength(4);
    expect(items[0].options_en?.[0]).toBe('Part III');
    expect(items[0].answer).toBe('A');
  });
});

describe('router', () => {
  it('matches deep links', () => {
    expect(matchPath('/r/:code', '/r/ABC234')).toEqual({ code: 'ABC234' });
    expect(matchPath('/m/:id/result', '/m/x1/result')).toEqual({ id: 'x1' });
    expect(matchPath('/m/:id', '/m/x1/result')).toBeNull();
  });
});

describe('podium', () => {
  it('orders 2nd, 1st, 3rd, 4th', () => {
    const order = podiumOrder([{ rank: 3 }, { rank: 1 }, { rank: 4 }, { rank: 2 }]).map((e) => e.rank);
    expect(order).toEqual([2, 1, 3, 4]);
    expect(podiumOrder([{ rank: 2 }, { rank: 1 }]).map((e) => e.rank)).toEqual([2, 1]);
  });
});

describe('sample pack', () => {
  const pack = samplePack as PackQuestion[];
  it('is valid', () => {
    expect(pack.length).toBeGreaterThanOrEqual(100);
    for (const q of pack) {
      expect(q.answer).toBeGreaterThanOrEqual(0);
      expect(q.answer).toBeLessThan(4);
      if (q.unit === 'tamil') expect(q.text_ta).toBeTruthy();
      else expect(q.text_en && q.text_ta).toBeTruthy();
      if (q.options_ta) expect(new Set(q.options_ta).size).toBe(4);
      if (q.options_en) expect(new Set(q.options_en).size).toBe(4);
    }
  });
  it('spreads correct answers across A–D after shuffling', () => {
    const counts = [0, 0, 0, 0];
    pack.forEach((q) => counts[q.answer]++);
    expect(Math.min(...counts)).toBeGreaterThan(pack.length / 8);
  });
});

describe('local solo engine (offline/demo)', () => {
  it('reveals the right answer and scores like the server', async () => {
    const pack = samplePack as PackQuestion[];
    let finished: { correct: number; answered: number } | null = null;
    const engine = startLocal(pack, {
      mode: 'demo',
      n: 3,
      onFinish: async (results, base) => {
        finished = { correct: base.correct, answered: base.answered };
        expect(results).toHaveLength(3);
        return base;
      },
    });
    for (let i = 0; i < 3; i++) {
      const { q } = await engine.question(i);
      expect(q.answer).toBeUndefined(); // no answer while the question is open
      const r = await engine.answer(i, 0);
      expect(r.correct).toBe(r.answer === 0);
      if (r.correct) expect(r.points).toBeGreaterThanOrEqual(100);
      else expect(r.points).toBe(0);
    }
    await engine.finish();
    expect(finished!.answered).toBe(3);
  });
});

describe('strings', () => {
  it('every entry has English and Tamil', () => {
    for (const [k, [en, ta]] of Object.entries(strings)) {
      expect(en, k).toBeTruthy();
      expect(ta, k).toBeTruthy();
    }
  });
  it('never uses betting words', () => {
    const all = Object.values(strings).flat().join(' ').toLowerCase();
    expect(all).not.toMatch(/\bbet\b|\bwager|பந்தயம்/);
  });
});

describe('phase 2 catalogues', () => {
  it('cosmetics visuals match public.shop_items exactly', async () => {
    const { readFileSync } = await import('node:fs');
    const { SHOP_KEYS, EMOJI_PACKS, LEAGUES } = await import('./cosmetics');
    const sql = readFileSync(new URL('../../supabase/migrations/20261008170200_shop.sql', import.meta.url), 'utf8');
    const sqlKeys = [...sql.matchAll(/\('((?:av|fr|ep|th)_[a-z]+)',/g)].map((m) => m[1]).sort();
    expect(sqlKeys.length).toBe(20);
    expect([...SHOP_KEYS].sort()).toEqual(sqlKeys);
    for (const pack of Object.values(EMOJI_PACKS)) expect(new Set(pack).size).toBe(pack.length);
    expect(LEAGUES).toHaveLength(5);
  });
  it('pack emojis never collide with the free reactions', async () => {
    const { ALL_PACK_EMOJIS } = await import('./cosmetics');
    const { REACTIONS } = await import('./units');
    expect(ALL_PACK_EMOJIS.filter((e) => REACTIONS.includes(e))).toEqual([]);
  });
});
