import type { Lang } from './types';

// Mirrors app_private.xp_for_level / level_for_xp in the database.
export const MAX_LEVEL = 50;
export const xpForLevel = (l: number) => 60 * (l - 1) * (l - 1) + 40 * (l - 1);

export function levelForXp(xp: number) {
  let l = 1;
  while (l < MAX_LEVEL && xpForLevel(l + 1) <= xp) l++;
  return l;
}

// Ten titles named after Tamil Nadu government posts, five levels each.
const TITLES: [string, string][] = [
  ['Aspirant', 'ஆர்வலர்'],
  ['Typist', 'தட்டச்சர்'],
  ['Junior Assistant', 'இளநிலை உதவியாளர்'],
  ['VAO', 'கிராம நிர்வாக அலுவலர்'],
  ['Bill Collector', 'வரி வசூலிப்பாளர்'],
  ['Steno-Typist', 'சுருக்கெழுத்துத் தட்டச்சர்'],
  ['Field Surveyor', 'நில அளவர்'],
  ['Draftsman', 'வரைவாளர்'],
  ['Forest Guard', 'வனக் காவலர்'],
  ['Group 4 Champion', 'குரூப் 4 சாம்பியன்'],
];
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

export function levelTitle(level: number, lang: Lang) {
  const l = Math.max(1, Math.min(MAX_LEVEL, level));
  const [en, ta] = TITLES[Math.floor((l - 1) / 5)];
  return `${lang === 'ta' ? ta : en} ${ROMAN[(l - 1) % 5]}`;
}

export function levelProgress(xp: number) {
  const level = levelForXp(xp);
  if (level >= MAX_LEVEL) return { level, pct: 100, toNext: 0 };
  const from = xpForLevel(level);
  const to = xpForLevel(level + 1);
  return { level, pct: Math.round(((xp - from) / (to - from)) * 100), toNext: to - xp };
}
