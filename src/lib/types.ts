// Shapes returned by the database functions (supabase/migrations).

export type Lang = 'ta' | 'en';
export type SoloMode = 'practice' | 'daily' | 'mock' | 'revision' | 'demo';

export interface Profile {
  id: string;
  username: string | null;
  display_name: string | null;
  district: string | null;
  exam_year: number | null;
  language: Lang;
  avatar: string;
  xp: number;
  level: number;
  coins: number;
  escrow: number;
  onboarded: boolean;
  signup_bonus_claimed: boolean;
  streak_count: number;
  streak_last_date: string | null;
  shields: number;
  room_win_streak: number;
  league_tier: number;
  frame: string | null;
  theme: string | null;
  chat_muted_until: string | null;
  allow_stranger_chat: boolean;
  stakes_frozen: boolean;
  is_admin: boolean;
}

export interface PublicUser {
  id: string;
  username: string | null;
  name: string | null;
  avatar: string;
  frame?: string | null;
  level: number;
  district: string | null;
}

export interface HomeSummary {
  profile: Profile;
  available: number;
  streak_today: boolean;
  streak_alive: boolean;
  daily: { played: boolean; finished: boolean; session_id: string | null; score: number | null; players: number };
  revision_due: number;
  mock_active: string | null;
  mock_done_this_week: boolean;
  active_room: { id: string; code: string; status: string; match_id: string | null } | null;
  live_match: string | null;
  friends_online: PublicUser[];
  friend_requests: number;
  refill_available: boolean;
  solo_coins_today: number;
  solo_coin_cap: number;
  week_xp: number;
  next_exam_date: string | null;
  stake_tiers: Record<string, number>;
  four_player_level: number;
  server_now: string;
}

export interface QuestionPayload {
  id: number;
  unit: string;
  subtopic: string;
  difficulty: number;
  text_ta: string | null;
  text_en: string | null;
  options_ta: string[] | null;
  options_en: string[] | null;
  image_url: string | null;
  removed?: number[];
  // present once the question has closed
  answer?: number;
  explanation_ta?: string | null;
  explanation_en?: string | null;
  book_ref?: string | null;
  source?: string | null;
}

export interface SoloSessionInfo {
  id: string;
  mode: SoloMode;
  unit: string | null;
  subtopic: string | null;
  n: number;
  timer_s: number | null;
  daily_date: string | null;
  elapsed_s: number;
  score: number;
  streak: number;
  answered: number[];
  next_index: number;
}

export interface SoloQuestion extends QuestionPayload {
  index: number;
  n: number;
  answered: boolean;
  server_now: string;
  shown_at?: string;
  deadline_at?: string | null;
  choice?: number | null;
  correct?: boolean;
  points?: number;
  score?: number;
  streak?: number;
}

export interface SoloReveal extends QuestionPayload {
  index: number;
  choice: number | null;
  correct: boolean;
  points: number;
  time_ms: number | null;
  score: number;
  streak: number;
}

export interface XpResult {
  xp: number;
  level: number;
  level_up: boolean;
  level_coins: number;
}

export interface WeakTopic {
  unit: string;
  subtopic: string;
  total: number;
  correct: number;
}

export interface SoloSummary {
  id: string;
  mode: SoloMode;
  n: number;
  answered: number;
  correct: number;
  score: number;
  complete: boolean;
  coins: number;
  coin_cap_hit: boolean;
  xp: XpResult;
  streak: { streak: number; reward: number; shield_used: boolean; new_day: boolean } | null;
  weak: WeakTopic[];
  achievements: string[];
  report: { unit: string; total: number; correct: number; answered: number }[] | null;
  marks: number | null;
  daily_rank: number | null;
  balance: number;
  pending_sync?: boolean;
}

export interface RoomPlayer {
  user_id: string;
  seat: number;
  ready: boolean;
  is_host: boolean;
  online: boolean;
  name: string | null;
  username: string | null;
  avatar: string;
  level: number;
  can_afford: boolean;
}

export interface RoomState {
  id: string;
  code: string;
  host_id: string;
  size: number;
  stake: number;
  subject: string;
  difficulty: number | null;
  question_count: number;
  language: Lang;
  powerups: boolean;
  status: 'lobby' | 'playing' | 'closed';
  current_match_id: string | null;
  current_match_status: 'live' | 'settled' | 'refunded' | null;
  me: string;
  players: RoomPlayer[];
}

export type MatchPhase = 'starting' | 'question' | 'reveal' | 'finished';

export interface MatchPlayer {
  user_id: string;
  seat: number;
  name: string | null;
  avatar: string;
  level: number;
  score: number;
  streak: number | null;
  answered: boolean;
  correct: boolean | null;
  points: number | null;
  rank: number | null;
  payout: number;
}

export interface MatchSync {
  match_id: string;
  room_id: string | null;
  status: 'live' | 'settled' | 'refunded';
  phase: MatchPhase;
  index: number | null;
  n: number;
  timer_s: number;
  reveal_s: number;
  stake: number;
  language: Lang;
  server_now: string;
  open_at: string;
  deadline_at: string | null;
  next_at: string | null;
  question: QuestionPayload | null;
  mine: { choice: number | null; correct?: boolean; points?: number; time_ms?: number } | null;
  players: MatchPlayer[];
  me: string;
  powerups: { enabled: boolean; fifty_used: boolean; time_used: boolean; prices: { fifty: number; time: number } };
}

export interface MatchResultPlayer {
  user_id: string;
  name: string | null;
  avatar: string;
  level: number;
  score: number;
  correct: number;
  answered: number;
  best_streak: number;
  rank: number | null;
  payout: number;
  xp: number;
  net: number;
}

export interface MatchResult {
  match_id: string;
  status: 'live' | 'settled' | 'refunded';
  stake: number;
  pot: number | null;
  n: number;
  room_id: string | null;
  room_code: string | null;
  room_status: string | null;
  me: string;
  players: MatchResultPlayer[];
  balance: number;
  level: number;
  achievements: { key: string; name_en: string; name_ta: string; icon: string; coins: number }[];
}

export interface ChatMessage {
  id: number;
  room_id: string | null;
  sender_id: string;
  recipient_id: string | null;
  kind: 'text' | 'invite';
  body: string;
  meta: { code: string; stake: number; size: number; subject: string; count: number } | null;
  created_at: string;
  read_at: string | null;
  sender_name: string | null;
  sender_avatar: string | null;
}

export interface FriendRow extends PublicUser {
  online: boolean;
  last_active_at: string;
  week_xp: number;
  unread: number;
}

export interface FriendsList {
  friends: FriendRow[];
  incoming: PublicUser[];
  outgoing: PublicUser[];
  blocked: PublicUser[];
}

export interface LeaderboardRow {
  rank: number;
  value: number;
  user: PublicUser;
  me: boolean;
}

export interface Leaderboard {
  week: string;
  total: number;
  top: LeaderboardRow[];
  me: { rank: number; value: number } | null;
}

export interface DailyBoard {
  day: string;
  total: number;
  top: { rank: number; user: PublicUser; score: number; correct: number; time_ms: number }[];
  me: { rank: number; score: number; correct: number; time_ms: number } | null;
}

export interface Achievement {
  key: string;
  name_en: string;
  name_ta: string;
  desc_en: string;
  desc_ta: string;
  icon: string;
  coins: number;
  earned_at: string | null;
}

export interface MyStats {
  units: { unit: string; answered: number; correct: number; rating: number | null }[];
  weak: WeakTopic[];
  achievements: Achievement[];
  matches: number;
  wins: number;
  solo_sets: number;
  revision_cards: number;
}

export interface LedgerRow {
  id: number;
  amount: number;
  balance_after: number;
  reason: string;
  created_at: string;
}

/** A question with its answer, as stored in the offline pack and the demo pack. */
export interface PackQuestion {
  id: number;
  unit: string;
  subtopic: string;
  difficulty: number;
  text_ta: string | null;
  text_en: string | null;
  options_ta: string[] | null;
  options_en: string[] | null;
  answer: number;
  explanation_ta: string | null;
  explanation_en: string | null;
  book_ref?: string | null;
}

export interface LeagueResult {
  week_start: string;
  tier_before: number;
  tier_after: number;
  rank: number;
  group_size: number;
  xp: number;
  coins: number;
}

export interface LeagueInfo {
  tier: number;
  joined: boolean;
  week: string;
  ends_at: string;
  group_size?: number;
  promote?: number;
  demote?: number;
  rewards?: number[];
  reward_min?: number;
  last_result: LeagueResult | null;
  members?: { rank: number; xp: number; me: boolean; user: PublicUser }[];
}

export type ShopKind = 'avatar' | 'frame' | 'emoji_pack' | 'theme';

export interface ShopItem {
  key: string;
  kind: ShopKind;
  name_en: string;
  name_ta: string;
  price: number;
  min_level: number;
  sort: number;
  owned: boolean;
}

export interface ShopCatalog {
  balance: number;
  level: number;
  equipped: { avatar: string; frame: string | null; theme: string | null };
  items: ShopItem[];
}

export interface Cosmetics {
  frames: Record<string, string>;
  theme: string | null;
}
