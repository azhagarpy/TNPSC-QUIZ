import type { Lang } from './types';

// Mirrors public.units. Weights are questions in the real paper.
export const UNITS = [
  { key: 'tamil', part: 'A', weight: 100, en: 'Tamil (Part A)', ta: 'பொதுத் தமிழ் (பகுதி அ)', icon: 'அ' },
  { key: 'science', part: 'GS', weight: 5, en: 'General Science', ta: 'பொது அறிவியல்', icon: '🔬' },
  { key: 'geography', part: 'GS', weight: 5, en: 'Geography', ta: 'புவியியல்', icon: '🗺️' },
  { key: 'history_india', part: 'GS', weight: 10, en: 'History & National Movement', ta: 'இந்திய வரலாறு & தேசிய இயக்கம்', icon: '🏛️' },
  { key: 'polity', part: 'GS', weight: 15, en: 'Indian Polity', ta: 'இந்திய ஆட்சியியல்', icon: '⚖️' },
  { key: 'economy_tn', part: 'GS', weight: 20, en: 'Economy & TN Administration', ta: 'பொருளாதாரம் & தமிழக நிர்வாகம்', icon: '📈' },
  { key: 'tn_history', part: 'GS', weight: 20, en: 'TN History, Culture & Movements', ta: 'தமிழக வரலாறு, பண்பாடு & இயக்கங்கள்', icon: '🛕' },
  { key: 'aptitude', part: 'APT', weight: 15, en: 'Aptitude', ta: 'திறனறிவு', icon: '🧮' },
  { key: 'reasoning', part: 'APT', weight: 10, en: 'Reasoning', ta: 'காரணவியல்', icon: '🧩' },
  { key: 'current_affairs', part: 'CA', weight: 0, en: 'Current Affairs', ta: 'நடப்பு நிகழ்வுகள்', icon: '📰' },
] as const;

export type UnitKey = (typeof UNITS)[number]['key'];

export function unitName(key: string | null | undefined, lang: Lang) {
  const u = UNITS.find((x) => x.key === key);
  return u ? u[lang] : (key ?? '');
}

export function unitIcon(key: string) {
  return UNITS.find((x) => x.key === key)?.icon ?? '📘';
}

/** Sub-topics are stored as "English · தமிழ்" for GS units; show the reader's half. */
export function subtopicName(s: string, lang: Lang) {
  const parts = s.split(' · ');
  if (parts.length !== 2) return s;
  return lang === 'ta' ? parts[1] : parts[0];
}

export const DISTRICTS: { key: string; ta: string }[] = [
  { key: 'Ariyalur', ta: 'அரியலூர்' }, { key: 'Chengalpattu', ta: 'செங்கல்பட்டு' }, { key: 'Chennai', ta: 'சென்னை' },
  { key: 'Coimbatore', ta: 'கோயம்புத்தூர்' }, { key: 'Cuddalore', ta: 'கடலூர்' }, { key: 'Dharmapuri', ta: 'தருமபுரி' },
  { key: 'Dindigul', ta: 'திண்டுக்கல்' }, { key: 'Erode', ta: 'ஈரோடு' }, { key: 'Kallakurichi', ta: 'கள்ளக்குறிச்சி' },
  { key: 'Kancheepuram', ta: 'காஞ்சிபுரம்' }, { key: 'Kanniyakumari', ta: 'கன்னியாகுமரி' }, { key: 'Karur', ta: 'கரூர்' },
  { key: 'Krishnagiri', ta: 'கிருஷ்ணகிரி' }, { key: 'Madurai', ta: 'மதுரை' }, { key: 'Mayiladuthurai', ta: 'மயிலாடுதுறை' },
  { key: 'Nagapattinam', ta: 'நாகப்பட்டினம்' }, { key: 'Namakkal', ta: 'நாமக்கல்' }, { key: 'Nilgiris', ta: 'நீலகிரி' },
  { key: 'Perambalur', ta: 'பெரம்பலூர்' }, { key: 'Pudukkottai', ta: 'புதுக்கோட்டை' }, { key: 'Ramanathapuram', ta: 'இராமநாதபுரம்' },
  { key: 'Ranipet', ta: 'இராணிப்பேட்டை' }, { key: 'Salem', ta: 'சேலம்' }, { key: 'Sivaganga', ta: 'சிவகங்கை' },
  { key: 'Tenkasi', ta: 'தென்காசி' }, { key: 'Thanjavur', ta: 'தஞ்சாவூர்' }, { key: 'Theni', ta: 'தேனி' },
  { key: 'Thoothukudi', ta: 'தூத்துக்குடி' }, { key: 'Tiruchirappalli', ta: 'திருச்சிராப்பள்ளி' }, { key: 'Tirunelveli', ta: 'திருநெல்வேலி' },
  { key: 'Tirupathur', ta: 'திருப்பத்தூர்' }, { key: 'Tiruppur', ta: 'திருப்பூர்' }, { key: 'Tiruvallur', ta: 'திருவள்ளூர்' },
  { key: 'Tiruvannamalai', ta: 'திருவண்ணாமலை' }, { key: 'Tiruvarur', ta: 'திருவாரூர்' }, { key: 'Vellore', ta: 'வேலூர்' },
  { key: 'Viluppuram', ta: 'விழுப்புரம்' }, { key: 'Virudhunagar', ta: 'விருதுநகர்' },
];

export function districtName(key: string | null | undefined, lang: Lang) {
  if (!key) return '';
  return lang === 'ta' ? (DISTRICTS.find((d) => d.key === key)?.ta ?? key) : key;
}

export const AVATARS: Record<string, { emoji: string; bg: string }> = {
  a1: { emoji: '🦁', bg: '#F9C74F' }, a2: { emoji: '🐯', bg: '#F8961E' }, a3: { emoji: '🐘', bg: '#90BE6D' },
  a4: { emoji: '🦚', bg: '#43AA8B' }, a5: { emoji: '🐬', bg: '#4D96FF' }, a6: { emoji: '🦉', bg: '#B388EB' },
  a7: { emoji: '🐼', bg: '#E0E0E0' }, a8: { emoji: '🦊', bg: '#F3722C' }, a9: { emoji: '🐢', bg: '#80CFA9' },
  a10: { emoji: '🦋', bg: '#FFADAD' }, a11: { emoji: '🐝', bg: '#FFD166' }, a12: { emoji: '🐵', bg: '#C9A27E' },
};

export const REACTIONS = ['😀', '😂', '😎', '😮', '😢', '😡', '👏', '🔥', '💯', '🙏', '🤔', '🎉'];
export const PHRASES = ['gg', 'rematch', 'easy', 'luck', 'wow', 'tough'] as const;
