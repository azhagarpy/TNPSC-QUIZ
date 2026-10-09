import type { HomeSummary, PackQuestion, Profile } from './types';
import { levelForXp } from './levels';

// Demo mode (no Supabase configured): a local profile and the bundled sample
// questions, so the app can be tried with `npm run dev` straight away.

const KEY = 'g4.demo.profile';

export function demoProfile(): Profile {
  const base: Profile = {
    id: 'demo', username: 'demo', display_name: 'Demo', district: 'Madurai', exam_year: 2027, language: 'ta',
    avatar: 'a1', xp: 0, level: 1, coins: 500, escrow: 0, onboarded: true, signup_bonus_claimed: true,
    streak_count: 0, streak_last_date: null, shields: 1, room_win_streak: 0, league_tier: 0, frame: null, theme: null,
    chat_muted_until: null,
    allow_stranger_chat: false, stakes_frozen: false, is_admin: false,
  };
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return base;
  }
}

export function saveDemoProfile(patch: Partial<Profile>) {
  const p = { ...demoProfile(), ...patch };
  p.level = levelForXp(p.xp);
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
  return p;
}

export function demoSummary(): HomeSummary {
  const profile = demoProfile();
  const today = new Date().toISOString().slice(0, 10);
  return {
    profile,
    available: profile.coins,
    streak_today: profile.streak_last_date === today,
    streak_alive: true,
    daily: { played: false, finished: false, session_id: null, score: null, players: 0 },
    revision_due: 0,
    mock_active: null,
    mock_done_this_week: false,
    active_room: null,
    live_match: null,
    friends_online: [],
    friend_requests: 0,
    refill_available: false,
    solo_coins_today: 0,
    solo_coin_cap: 300,
    week_xp: 0,
    next_exam_date: '2026-12-20',
    stake_tiers: { '0': 1, '50': 1, '100': 1, '250': 3, '500': 5, '1000': 10 },
    four_player_level: 3,
    server_now: new Date().toISOString(),
  };
}

export async function demoQuestions(): Promise<PackQuestion[]> {
  const mod = await import('../demo/samplePack.json');
  return mod.default as PackQuestion[];
}
