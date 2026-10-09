import { sb } from './supabase';
import { syncClock } from './clock';
import type {
  ChatMessage, Cosmetics, LeagueInfo, ShopCatalog, ShopKind, DailyBoard, FriendsList, HomeSummary, Leaderboard, MatchResult, MatchSync, MyStats,
  PackQuestion, Profile, PublicUser, RoomState, SoloQuestion, SoloReveal, SoloSessionInfo, SoloSummary,
} from './types';

/** Errors carry the snake_case code raised by the database (e.g. "insufficient_coins"). */
export class ApiError extends Error {
  constructor(public code: string, public detail?: string) {
    super(code);
  }
}

export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const sentAt = Date.now();
  let result;
  try {
    result = await (await sb()).rpc(fn, args);
  } catch {
    throw new ApiError('network');
  }
  const { data, error } = result;
  if (error) {
    const raw = error.message ?? '';
    const code = /^[a-z_]+$/.test(raw) ? raw : /fetch|network|Failed/i.test(raw) ? 'network' : 'unknown';
    if (code === 'unknown') console.warn(`rpc ${fn} failed:`, error);
    throw new ApiError(code, error.details ?? undefined);
  }
  if (data && typeof data === 'object' && 'server_now' in data) {
    syncClock((data as { server_now: string }).server_now, sentAt, Date.now());
  }
  return data as T;
}

export const api = {
  homeSummary: () => rpc<HomeSummary>('home_summary'),
  usernameAvailable: (username: string) => rpc<boolean>('username_available', { p_username: username }),
  /** Email for a username, only if the password is right (null otherwise). */
  resolveLogin: (login: string, password: string) => rpc<string | null>('resolve_login', { p_login: login, p_password: password }),
  completeOnboarding: (a: {
    username: string; name: string; district: string; examYear: number; language: string; referrer?: string | null;
  }) =>
    rpc<Profile>('complete_onboarding', {
      p_username: a.username, p_name: a.name, p_district: a.district, p_exam_year: a.examYear,
      p_language: a.language, p_is_adult: true, p_consent: true, p_referrer: a.referrer ?? null,
    }),
  updateProfile: (changes: Partial<Profile>) => rpc<Profile>('update_profile', { p_changes: changes }),
  claimSignupBonus: (fp: string) =>
    rpc<{ coins: number; balance: number; limited: boolean; already: boolean }>('claim_signup_bonus', { p_fp: fp }),
  claimRefill: () => rpc<{ coins: number; balance: number }>('claim_refill'),
  buyShield: () => rpc<{ shields: number; balance: number }>('buy_shield'),
  deleteAccount: () => rpc<void>('delete_my_account'),

  soloStart: (mode: string, subject?: string | null, level?: string | null, subtopic?: string | null) =>
    rpc<SoloSessionInfo>('solo_start', { p_mode: mode, p_subject: subject ?? null, p_level: level ?? null, p_subtopic: subtopic ?? null }),
  soloResume: (session: string) => rpc<SoloSessionInfo>('solo_resume', { p_session: session }),
  soloQuestion: (session: string, index: number) => rpc<SoloQuestion>('solo_question', { p_session: session, p_index: index }),
  soloAnswer: (session: string, index: number, choice: number | null) =>
    rpc<SoloReveal & { saved?: boolean }>('solo_answer', { p_session: session, p_index: index, p_choice: choice }),
  soloFinish: (session: string, elapsed?: number) =>
    rpc<SoloSummary>('solo_finish', { p_session: session, p_elapsed_s: elapsed ?? null }),
  mockProgress: (session: string, elapsed: number) => rpc<void>('mock_progress', { p_session: session, p_elapsed_s: elapsed }),
  addToRevision: (question: number) => rpc<void>('add_to_revision', { p_question: question }),
  reportQuestion: (question: number, reason: string, details?: string) =>
    rpc<void>('report_question', { p_question: question, p_reason: reason, p_details: details ?? null }),
  dailyBoard: (scope: string) => rpc<DailyBoard>('daily_leaderboard', { p_scope: scope }),
  offlinePack: () => rpc<{ pack_id: string; issued_at: string; questions: PackQuestion[] }>('get_offline_pack'),
  syncOffline: (pack: string, results: { q: number; c: number | null; t: number }[]) =>
    rpc<{ answered: number; correct: number; coins: number }>('sync_offline', { p_pack: pack, p_results: results }),

  createRoom: (a: { size: number; stake: number; subject: string; count: number; language: string; powerups: boolean; difficulty: number | null }) =>
    rpc<RoomState>('create_room', {
      p_size: a.size, p_stake: a.stake, p_subject: a.subject, p_count: a.count,
      p_language: a.language, p_powerups: a.powerups, p_difficulty: a.difficulty,
    }),
  joinRoom: (code: string) => rpc<RoomState>('join_room', { p_code: code }),
  getRoom: (room: string) => rpc<RoomState>('get_room', { p_room: room }),
  heartbeat: (room: string) => rpc<RoomState>('room_heartbeat', { p_room: room }),
  setReady: (room: string, ready: boolean) => rpc<RoomState>('set_ready', { p_room: room, p_ready: ready }),
  leaveRoom: (room: string) => rpc<void>('leave_room', { p_room: room }),
  startMatch: (room: string) => rpc<{ match_id: string }>('start_match', { p_room: room }),
  matchSync: (match: string) => rpc<MatchSync>('match_sync', { p_match: match }),
  submitAnswer: (match: string, index: number, choice: number) =>
    rpc<{ accepted: boolean; all_answered: boolean }>('submit_answer', { p_match: match, p_index: index, p_choice: choice }),
  usePowerup: (match: string, kind: 'fifty' | 'time') =>
    rpc<{ kind: string; removed?: number[]; deadline_at?: string }>('use_powerup', { p_match: match, p_kind: kind }),
  finishMatch: (match: string) => rpc<MatchResult>('finish_match', { p_match: match }),
  matchResult: (match: string) => rpc<MatchResult>('match_result', { p_match: match }),
  recentMatches: () =>
    rpc<{ id: string; started_at: string; status: string; stake: number; rank: number | null; score: number; payout: number; players: number }[]>('my_recent_matches'),

  sendRoomChat: (room: string, body: string) => rpc<ChatMessage>('send_room_chat', { p_room: room, p_body: body }),
  roomChatHistory: (room: string) => rpc<ChatMessage[]>('room_chat_history', { p_room: room }),
  sendDm: (to: string, body: string, kind: 'text' | 'invite' = 'text') => rpc<ChatMessage>('send_dm', { p_to: to, p_body: body, p_kind: kind }),
  dmHistory: (peer: string, before?: number) => rpc<ChatMessage[]>('dm_history', { p_peer: peer, p_before: before ?? null }),
  markDmRead: (peer: string) => rpc<void>('mark_dm_read', { p_peer: peer }),
  reportMessage: (message: number, reason: string) => rpc<void>('report_message', { p_message: message, p_reason: reason }),
  reportUser: (user: string, reason: string) => rpc<void>('report_user', { p_user: user, p_reason: reason }),

  searchUsers: (q: string) => rpc<(PublicUser & { friend_status: string | null })[]>('search_users', { p_q: q }),
  friendRequest: (user: string) => rpc<string>('friend_request', { p_user: user }),
  respondFriend: (user: string, accept: boolean) => rpc<string>('respond_friend', { p_user: user, p_accept: accept }),
  removeFriend: (user: string) => rpc<void>('remove_friend', { p_user: user }),
  blockUser: (user: string) => rpc<void>('block_user', { p_user: user }),
  unblockUser: (user: string) => rpc<void>('unblock_user', { p_user: user }),
  listFriends: () => rpc<FriendsList>('list_friends'),
  publicProfile: (user: string) =>
    rpc<PublicUser & { friend_status: string | null; badges: string[]; room_win_streak: number; head_to_head: { played: number; my_wins: number } }>(
      'public_profile', { p_user: user }),

  leaderboard: (scope: string, unit: string) => rpc<Leaderboard>('leaderboard', { p_scope: scope, p_unit: unit }),
  myStats: () => rpc<MyStats>('my_stats'),

  myLeague: () => rpc<LeagueInfo>('my_league'),
  leagueSeen: () => rpc<void>('league_seen'),
  shopCatalog: () => rpc<ShopCatalog>('shop_catalog'),
  buyItem: (key: string) => rpc<ShopCatalog>('buy_item', { p_key: key }),
  equipItem: (kind: ShopKind, key: string | null) => rpc<ShopCatalog>('equip_item', { p_kind: kind, p_key: key }),
  publicCosmetics: (users: string[], room?: string | null) =>
    rpc<Cosmetics>('public_cosmetics', { p_users: users, p_room: room ?? null }),
  quickMatch: () => rpc<{ status: 'waiting' | 'matched'; match_id?: string; waited_s?: number; searching?: number }>('quick_match'),
  quickMatchCancel: () => rpc<{ status: 'cancelled' | 'matched'; match_id?: string }>('quick_match_cancel'),
  savePushSubscription: (endpoint: string, p256dh: string, auth: string) =>
    rpc<void>('save_push_subscription', { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth }),
  deletePushSubscription: (endpoint: string) => rpc<void>('delete_push_subscription', { p_endpoint: endpoint }),
};
