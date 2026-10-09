// Visuals for shop items. Keys, prices and level gates live in the database
// (public.shop_items); a unit test checks the two lists match.

export const SHOP_AVATARS: Record<string, { emoji: string; bg: string }> = {
  av_graduate: { emoji: '🧑‍🎓', bg: '#FFD166' },
  av_teacher: { emoji: '🧑‍🏫', bg: '#A0C4FF' },
  av_tiger: { emoji: '🐅', bg: '#F4A261' },
  av_crown: { emoji: '👑', bg: '#FFE066' },
  av_unicorn: { emoji: '🦄', bg: '#E0AAFF' },
  av_dragon: { emoji: '🐉', bg: '#80ED99' },
};

/** Ring drawn around an avatar: a solid colour or a gradient, optionally dashed (kolam). */
export const FRAMES: Record<string, { ring: string; dashed?: boolean }> = {
  fr_gold: { ring: '#F2B705' },
  fr_jasmine: { ring: 'conic-gradient(#ffffff, #e9edc9, #ffffff, #e9edc9, #ffffff)' },
  fr_kolam: { ring: '#C2185B', dashed: true },
  fr_peacock: { ring: 'conic-gradient(#0f9b8e, #1d4ed8, #7c3aed, #0f9b8e)' },
  fr_fire: { ring: 'conic-gradient(#ffb703, #fb5607, #d00000, #ffb703)' },
  fr_champion: { ring: 'conic-gradient(#ff595e, #ffca3a, #8ac926, #1982c4, #6a4c93, #ff595e)' },
};

export const EMOJI_PACKS: Record<string, string[]> = {
  ep_study: ['📚', '✍️', '🧠', '💡', '🎯', '⏰', '🏅', '🙌'],
  ep_festival: ['🪔', '🎆', '🌾', '🍚', '🐄', '🪁', '🌺', '🥳'],
  ep_cinema: ['🕶️', '🤩', '😤', '🫡', '💪', '🎬', '👊', '🕺'],
};

/** Room themes: translucent washes so they work in light and dark mode. */
export const THEMES: Record<string, { background: string; swatch: string }> = {
  th_temple: { background: 'linear-gradient(170deg, rgb(242 183 5 / 0.28), transparent 55%)', swatch: '#F2B705' },
  th_marina: { background: 'linear-gradient(170deg, rgb(77 150 255 / 0.28), transparent 55%)', swatch: '#4D96FF' },
  th_nilgiri: { background: 'linear-gradient(170deg, rgb(67 170 139 / 0.3), transparent 55%)', swatch: '#43AA8B' },
  th_pongal: {
    background: 'linear-gradient(170deg, rgb(251 86 7 / 0.25), rgb(255 190 11 / 0.18) 35%, transparent 65%)',
    swatch: '#FB5607',
  },
  th_night: { background: 'linear-gradient(170deg, rgb(91 52 214 / 0.35), rgb(20 10 60 / 0.15) 45%, transparent 70%)', swatch: '#5B34D6' },
};

export const SHOP_KEYS = [...Object.keys(SHOP_AVATARS), ...Object.keys(FRAMES), ...Object.keys(EMOJI_PACKS), ...Object.keys(THEMES)];

export const ALL_PACK_EMOJIS = Object.values(EMOJI_PACKS).flat();

// Weekly leagues: Bronze → Silver → Gold → Diamond → Champion.
export const LEAGUES = [
  { en: 'Bronze', ta: 'வெண்கலம்', icon: '🥉', color: '#CD7F32' },
  { en: 'Silver', ta: 'வெள்ளி', icon: '🥈', color: '#A8A9AD' },
  { en: 'Gold', ta: 'தங்கம்', icon: '🥇', color: '#F2B705' },
  { en: 'Diamond', ta: 'வைரம்', icon: '💎', color: '#4D96FF' },
  { en: 'Champion', ta: 'சாம்பியன்', icon: '🏆', color: '#C2185B' },
] as const;
