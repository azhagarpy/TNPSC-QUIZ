-- Group 4 Quiz Battle: core schema.
--
-- Security model: RLS is on for every table. Players may read a handful of their
-- own rows directly (profile, coin ledger, achievements, unit stats). Every write,
-- and every read of questions, answers or other players, goes through the
-- SECURITY DEFINER functions in the later migrations. Answers therefore never
-- reach the browser before a question closes.

create schema if not exists app_private;
revoke all on schema app_private from public;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

create table public.units (
  key          text primary key,
  part         text not null check (part in ('A', 'GS', 'APT', 'CA')),
  exam_weight  int  not null check (exam_weight >= 0), -- questions in the real paper
  name_en      text not null,
  name_ta      text not null,
  sort         smallint not null
);

insert into public.units (key, part, exam_weight, name_en, name_ta, sort) values
  ('tamil',           'A',   100, 'Tamil (Part A)',                       'பொதுத் தமிழ் (பகுதி அ)',            1),
  ('science',         'GS',    5, 'General Science',                      'பொது அறிவியல்',                      2),
  ('geography',       'GS',    5, 'Geography',                            'புவியியல்',                           3),
  ('history_india',   'GS',   10, 'History, Culture & National Movement', 'இந்திய வரலாறு & தேசிய இயக்கம்',       4),
  ('polity',          'GS',   15, 'Indian Polity',                        'இந்திய ஆட்சியியல்',                   5),
  ('economy_tn',      'GS',   20, 'Economy & TN Administration',          'பொருளாதாரம் & தமிழக நிர்வாகம்',       6),
  ('tn_history',      'GS',   20, 'TN History, Culture & Movements',      'தமிழக வரலாறு, பண்பாடு & இயக்கங்கள்',  7),
  ('aptitude',        'APT',  15, 'Aptitude',                             'திறனறிவு',                            8),
  ('reasoning',       'APT',  10, 'Reasoning',                            'காரணவியல்',                           9),
  ('current_affairs', 'CA',    0, 'Current Affairs',                      'நடப்பு நிகழ்வுகள்',                  10);

-- Tunable from the admin panel. Values are JSON scalars or objects.
create table public.app_settings (
  key   text primary key,
  value jsonb not null,
  note  text
);

insert into public.app_settings (key, value, note) values
  ('room_cooldown_days',      '14',   'Room questions unseen by every player for this many days (raise to 30 past 20,000 questions)'),
  ('group_norepeat_matches',  '3',    'Never reuse questions from this many recent matches of the same group'),
  ('difficulty_band',         '1',    'Room rating ± band; widened by 1 before the cooldown is relaxed'),
  ('max_per_subtopic',        '2',    'Max questions from one sub-topic per room match'),
  ('unseen_bonus',            '1.2',  'Freshness weight multiplier when no player has seen a question'),
  ('reported_penalty',        '0.8',  'Freshness weight multiplier when report rate is above the threshold'),
  ('report_rate_threshold',   '0.02', 'Report rate (reports / times shown) that triggers the penalty'),
  ('room_timer_s',            '15',   'Seconds per room question'),
  ('reveal_s',                '5',    'Seconds of answer reveal between room questions'),
  ('solo_timer_s',            '20',   'Seconds per solo question'),
  ('house_cut',               '0.10', 'Share of every room pot that is removed (coin sink)'),
  ('daily_stake_cap',         '5000', 'Max coins a player can stake per IST day'),
  ('solo_daily_coin_cap',     '300',  'Max coins from solo practice per IST day'),
  ('offline_session_coin_cap','100',  'Max coins per offline sync'),
  ('offline_pack_size',       '200',  'Questions in the offline solo pack'),
  ('required_reviews',        '2',    'Distinct reviewers needed before a question goes live'),
  ('signup_bonus',            '500',  'Starter coins'),
  ('signup_bonus_per_device', '2',    'Sign-up bonuses allowed per browser fingerprint'),
  ('refill_threshold',        '50',   'Bankruptcy refill available below this balance'),
  ('refill_to',               '200',  'Bankruptcy refill tops the balance up to this'),
  ('stake_tiers',             '{"0":1,"50":1,"100":1,"250":3,"500":5,"1000":10}', 'Stake → minimum level (0 = friendly room, no coins)'),
  ('four_player_level',       '3',    'Level needed to host a 4-player room'),
  ('next_exam_date',          '"2026-12-20"', 'Shown as the exam countdown on home'),
  ('referral_reward',         '200',  'Coins to a referrer when their friend finishes 3 room matches'),
  ('referral_max',            '10',   'Max rewarded referrals per player');

-- ---------------------------------------------------------------------------
-- Players
-- ---------------------------------------------------------------------------

create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  username            text unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name        text check (char_length(display_name) between 1 and 40),
  district            text,
  exam_year           smallint,
  language            text not null default 'ta' check (language in ('ta', 'en')),
  avatar              text not null default 'a1',
  xp                  int  not null default 0,
  level               int  not null default 1,
  coins               int  not null default 0,  -- cached sum of coin_ledger
  escrow              int  not null default 0,  -- part of coins locked in live matches
  onboarded           boolean not null default false,
  signup_bonus_claimed boolean not null default false,
  streak_count        int  not null default 0,
  streak_last_date    date,
  shields             int  not null default 1,
  shield_week         date,
  last_refill_at      timestamptz,
  room_win_streak     int  not null default 0,
  league_tier         smallint not null default 0 check (league_tier between 0 and 4), -- Bronze … Champion
  frame               text,  -- equipped shop frame
  theme               text,  -- equipped room theme
  chat_muted_until    timestamptz,
  allow_stranger_chat boolean not null default false,
  stakes_frozen       boolean not null default false,
  referred_by         uuid references public.profiles (id) on delete set null,
  referral_rewarded   boolean not null default false,
  is_admin            boolean not null default false,
  last_active_at      timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  constraint coins_valid check (coins >= 0 and escrow >= 0 and escrow <= coins)
);
create index profiles_district_idx on public.profiles (district);
create index profiles_username_prefix_idx on public.profiles (username text_pattern_ops);

-- Hidden skill rating per unit, on the 1–5 difficulty scale.
create table public.user_unit_stats (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  unit     text not null references public.units (key),
  rating   numeric(4, 2) not null default 2.5,
  answered int not null default 0,
  correct  int not null default 0,
  primary key (user_id, unit)
);

create table public.user_subtopic_stats (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  unit     text not null references public.units (key),
  subtopic text not null,
  answered int not null default 0,
  correct  int not null default 0,
  last_at  timestamptz not null default now(),
  primary key (user_id, unit, subtopic)
);

-- Weekly totals for leaderboards. unit = '*' holds overall XP.
create table public.weekly_stats (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  week_start date not null,
  unit       text not null,
  xp         int not null default 0,
  correct    int not null default 0,
  answered   int not null default 0,
  primary key (user_id, week_start, unit)
);
create index weekly_stats_board_idx on public.weekly_stats (week_start, unit, xp desc);

-- Append-only coin ledger. Balance = sum(amount), cached on profiles.coins.
create table public.coin_ledger (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  amount        int  not null,
  balance_after int  not null,
  reason        text not null,
  match_id      uuid,
  ref           text,
  txid          bigint not null default txid_current(),
  created_at    timestamptz not null default now()
);
create index coin_ledger_user_idx on public.coin_ledger (user_id, created_at desc);
create index coin_ledger_reason_idx on public.coin_ledger (user_id, reason, created_at);

create function app_private.ledger_no_update() returns trigger language plpgsql as $$
begin
  raise exception 'coin_ledger is append-only';
end $$;
create trigger coin_ledger_append_only before update on public.coin_ledger
  for each row execute function app_private.ledger_no_update();

-- One sign-up bonus counter per hashed browser fingerprint.
create table public.device_bonus (
  fp      text primary key,
  count   int not null default 0,
  last_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Question bank
-- ---------------------------------------------------------------------------

create table public.questions (
  id             bigint generated always as identity primary key,
  unit           text not null references public.units (key),
  subtopic       text not null,
  difficulty     smallint not null check (difficulty between 1 and 5),
  text_ta        text,
  text_en        text,
  options_ta     text[],
  options_en     text[],
  answer         smallint not null check (answer between 0 and 3),
  explanation_ta text,
  explanation_en text,
  source         text,          -- 'PYQ 2019 Group 4', 'original', 'sample'
  book_ref       text,          -- Samacheer Kalvi book/chapter
  image_url      text,
  status         text not null default 'review' check (status in ('draft', 'review', 'live', 'retired')),
  created_by     uuid references public.profiles (id) on delete set null,
  reviewed_by    uuid[] not null default '{}',
  review_note    text,
  times_shown    int not null default 0,
  times_correct  int not null default 0,
  total_time_ms  bigint not null default 0,
  report_count   int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint has_language check (
    (text_ta is not null and cardinality(options_ta) = 4) or
    (text_en is not null and cardinality(options_en) = 4)
  ),
  constraint ta_complete check (text_ta is null or cardinality(options_ta) = 4),
  constraint en_complete check (text_en is null or cardinality(options_en) = 4)
);
create index questions_pick_idx on public.questions (unit, status, difficulty);
create index questions_status_idx on public.questions (status, created_at);

-- One row per (player, question), upserted whenever a question is shown/answered.
create table public.user_question_history (
  user_id      uuid   not null references public.profiles (id) on delete cascade,
  question_id  bigint not null references public.questions (id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  times_seen   int not null default 1,
  last_correct boolean,
  primary key (user_id, question_id)
);
create index uqh_question_idx on public.user_question_history (question_id, user_id);

-- Spaced-repetition revision deck (Leitner boxes 1–5).
create table public.revision_cards (
  user_id     uuid   not null references public.profiles (id) on delete cascade,
  question_id bigint not null references public.questions (id) on delete cascade,
  box         smallint not null default 1,
  due_at      timestamptz not null default now(),
  added_at    timestamptz not null default now(),
  primary key (user_id, question_id)
);
create index revision_due_idx on public.revision_cards (user_id, due_at);

-- ---------------------------------------------------------------------------
-- Solo play
-- ---------------------------------------------------------------------------

create table public.solo_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  mode          text not null check (mode in ('practice', 'daily', 'mock', 'revision', 'demo')),
  unit          text,
  subtopic      text,
  question_ids  bigint[] not null,
  timer_s       int,            -- null = untimed (mock)
  daily_date    date,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  score         int not null default 0,
  correct       int not null default 0,
  answered      int not null default 0,
  streak        int not null default 0,
  total_time_ms int not null default 0,
  elapsed_s     int not null default 0, -- mock: active time reported by the client
  summary       jsonb
);
create index solo_sessions_user_idx on public.solo_sessions (user_id, started_at desc);
create unique index solo_one_daily_idx on public.solo_sessions (user_id, daily_date) where mode = 'daily';
create index solo_daily_board_idx on public.solo_sessions (daily_date, score desc) where mode = 'daily';

create table public.solo_answers (
  session_id  uuid not null references public.solo_sessions (id) on delete cascade,
  q_index     smallint not null,
  question_id bigint not null references public.questions (id) on delete cascade,
  shown_at    timestamptz not null,
  choice      smallint,        -- canonical option index, null = no answer
  answered_at timestamptz,     -- set on answer or timeout
  time_ms     int,
  correct     boolean,
  points      int not null default 0,
  primary key (session_id, q_index)
);

create table public.daily_challenges (
  day          date primary key,
  question_ids bigint[] not null,
  settled      boolean not null default false
);

create table public.offline_packs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  question_ids bigint[] not null,
  synced_ids   bigint[] not null default '{}',
  issued_at    timestamptz not null default now()
);
create index offline_packs_user_idx on public.offline_packs (user_id, issued_at desc);

-- ---------------------------------------------------------------------------
-- Rooms and matches
-- ---------------------------------------------------------------------------

create table public.rooms (
  id               uuid primary key default gen_random_uuid(),
  code             text not null check (code ~ '^[A-Z2-9]{6}$'),
  host_id          uuid not null references public.profiles (id) on delete cascade,
  size             smallint not null check (size between 2 and 4),
  stake            int not null check (stake >= 0),
  subject          text not null default 'mixed',
  difficulty       smallint check (difficulty between 1 and 5), -- null = players' average rating
  question_count   smallint not null check (question_count between 5 and 15),
  language         text not null default 'ta' check (language in ('ta', 'en')),
  powerups         boolean not null default true,
  theme            text, -- host's equipped room theme
  status           text not null default 'lobby' check (status in ('lobby', 'playing', 'closed')),
  current_match_id uuid,
  created_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);
create unique index rooms_open_code_idx on public.rooms (code) where status <> 'closed';

create table public.room_players (
  room_id      uuid not null references public.rooms (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  seat         smallint not null,
  ready        boolean not null default false,
  joined_at    timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (room_id, user_id),
  unique (room_id, seat)
);
create index room_players_user_idx on public.room_players (user_id);

create table public.matches (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid references public.rooms (id) on delete set null,
  stake         int not null,
  house_cut     numeric not null,
  question_ids  bigint[] not null,
  n             smallint not null,
  timer_s       smallint not null,
  reveal_s      smallint not null,
  powerups      boolean not null,
  language      text not null,
  started_at    timestamptz not null default now(),
  -- Lazy state machine: question cur_index is open from cur_open_at until
  -- cur_reveal_at, then revealed for reveal_s seconds. cur_index = n means done.
  cur_index     smallint not null default 0,
  cur_open_at   timestamptz not null,
  cur_reveal_at timestamptz not null,
  status        text not null default 'live' check (status in ('live', 'settled', 'refunded')),
  pot           int,
  settled_at    timestamptz
);
create index matches_live_idx on public.matches (status) where status = 'live';
create index matches_room_idx on public.matches (room_id, started_at desc);

create table public.match_players (
  match_id      uuid not null references public.matches (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  seat          smallint not null,
  score         int not null default 0,
  correct       int not null default 0,
  answered      int not null default 0,
  streak        int not null default 0,
  best_streak   int not null default 0,
  total_time_ms int not null default 0,
  rank          smallint,
  payout        int not null default 0,
  xp            int not null default 0,
  used_5050     smallint, -- question index the power-up was used on
  used_time     smallint,
  primary key (match_id, user_id)
);
create index match_players_user_idx on public.match_players (user_id, match_id);

create table public.match_answers (
  match_id   uuid not null references public.matches (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  q_index    smallint not null,
  choice     smallint not null, -- canonical option index
  time_ms    int not null,
  correct    boolean not null,
  points     int not null,
  flagged    boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (match_id, user_id, q_index)
);

-- Which room questions each player actually saw (disconnects don't count as seen).
create table public.match_views (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  q_index  smallint not null,
  primary key (match_id, user_id, q_index)
);

create table public.collusion_flags (
  id         bigint generated always as identity primary key,
  user_a     uuid not null references public.profiles (id) on delete cascade,
  user_b     uuid not null references public.profiles (id) on delete cascade,
  matches    int not null,
  coins      int not null,
  status     text not null default 'open' check (status in ('open', 'cleared', 'confirmed')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Social
-- ---------------------------------------------------------------------------

create table public.friendships (
  user_a       uuid not null references public.profiles (id) on delete cascade,
  user_b       uuid not null references public.profiles (id) on delete cascade,
  status       text not null check (status in ('pending', 'accepted')),
  requested_by uuid not null,
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index friendships_b_idx on public.friendships (user_b);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create table public.chat_messages (
  id           bigint generated always as identity primary key,
  room_id      uuid references public.rooms (id) on delete cascade,
  sender_id    uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid references public.profiles (id) on delete cascade,
  kind         text not null default 'text' check (kind in ('text', 'invite')),
  body         text not null check (char_length(body) between 1 and 200),
  meta         jsonb,
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  check ((room_id is null) <> (recipient_id is null))
);
create index chat_room_idx on public.chat_messages (room_id, id desc) where room_id is not null;
create index chat_dm_idx on public.chat_messages (least(sender_id, recipient_id), greatest(sender_id, recipient_id), id desc) where recipient_id is not null;
create index chat_sender_idx on public.chat_messages (sender_id, created_at desc);

-- Profanity list (Tamil, Tanglish, English). Maintained from the admin panel.
create table public.banned_words (
  word      text primary key check (word = lower(word)),
  match_inside boolean not null default false -- true = also match inside other words
);

create table public.reports (
  id             bigint generated always as identity primary key,
  reporter_id    uuid not null references public.profiles (id) on delete cascade,
  kind           text not null check (kind in ('question', 'message', 'user')),
  question_id    bigint references public.questions (id) on delete cascade,
  message_id     bigint references public.chat_messages (id) on delete set null,
  message_body   text, -- copied so the evidence survives chat retention
  target_user_id uuid references public.profiles (id) on delete cascade,
  reason         text not null,
  details        text check (char_length(details) <= 500),
  status         text not null default 'open' check (status in ('open', 'upheld', 'rejected')),
  resolved_by    uuid references public.profiles (id) on delete set null,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index reports_open_idx on public.reports (status, created_at);
create index reports_target_idx on public.reports (target_user_id, status);

create table public.achievements (
  key     text primary key,
  name_en text not null,
  name_ta text not null,
  desc_en text not null,
  desc_ta text not null,
  coins   int not null,
  icon    text not null,
  sort    smallint not null
);

insert into public.achievements (key, name_en, name_ta, desc_en, desc_ta, coins, icon, sort) values
  ('first_solo',    'First Steps',   'முதல் அடி',        'Finish your first solo set',                      'முதல் தனிப் பயிற்சியை முடியுங்கள்',                50,   '🎯', 1),
  ('first_win',     'First Victory', 'முதல் வெற்றி',     'Win a room match',                                'ஒரு அறைப் போட்டியில் வெல்லுங்கள்',                 100,  '🏆', 2),
  ('streak_7',      'Week Warrior',  'வார வீரர்',         'Keep a 7-day streak',                             '7 நாள் தொடர் பயிற்சி',                             200,  '🔥', 3),
  ('streak_30',     'Unstoppable',   'தடுக்க முடியாதவர்', 'Keep a 30-day streak',                            '30 நாள் தொடர் பயிற்சி',                            1000, '🌋', 4),
  ('polity_pro',    'Polity Pro',    'ஆட்சியியல் வல்லுநர்', '500 correct Polity answers',                      'ஆட்சியியலில் 500 சரியான விடைகள்',                   500,  '⚖️', 5),
  ('tamil_scholar', 'Tamil Scholar', 'தமிழ் அறிஞர்',      '90% accuracy over 200 Part A questions',          'பகுதி அ-வில் 200 வினாக்களில் 90% துல்லியம்',         500,  '📜', 6),
  ('speed_demon',   'Speed Demon',   'மின்னல் வேகம்',     '10 correct answers under 5 s each in one match',  'ஒரே போட்டியில் 5 வினாடிக்குள் 10 சரியான விடைகள்',    300,  '⚡', 7),
  ('comeback_king', 'Comeback King', 'மீண்டு வந்த வீரர்',  'Win a room after trailing by 300+ points',        '300+ புள்ளிகள் பின்தங்கி வென்றது',                  300,  '👑', 8),
  ('study_buddy',   'Study Buddy',   'படிப்புத் தோழர்',    'Play 25 rooms with the same friend',              'ஒரே நண்பருடன் 25 அறைப் போட்டிகள்',                  500,  '🤝', 9);

create table public.user_achievements (
  user_id   uuid not null references public.profiles (id) on delete cascade,
  key       text not null references public.achievements (key),
  earned_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.units                 enable row level security;
alter table public.app_settings          enable row level security;
alter table public.profiles              enable row level security;
alter table public.user_unit_stats       enable row level security;
alter table public.user_subtopic_stats   enable row level security;
alter table public.weekly_stats          enable row level security;
alter table public.coin_ledger           enable row level security;
alter table public.device_bonus          enable row level security;
alter table public.questions             enable row level security;
alter table public.user_question_history enable row level security;
alter table public.revision_cards        enable row level security;
alter table public.solo_sessions         enable row level security;
alter table public.solo_answers          enable row level security;
alter table public.daily_challenges      enable row level security;
alter table public.offline_packs         enable row level security;
alter table public.rooms                 enable row level security;
alter table public.room_players          enable row level security;
alter table public.matches               enable row level security;
alter table public.match_players         enable row level security;
alter table public.match_answers         enable row level security;
alter table public.match_views           enable row level security;
alter table public.collusion_flags       enable row level security;
alter table public.friendships           enable row level security;
alter table public.blocks                enable row level security;
alter table public.chat_messages         enable row level security;
alter table public.banned_words          enable row level security;
alter table public.reports               enable row level security;
alter table public.achievements          enable row level security;
alter table public.user_achievements     enable row level security;

create policy "units are public" on public.units for select to anon, authenticated using (true);
create policy "achievements are public" on public.achievements for select to anon, authenticated using (true);
create policy "read own profile" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "read own unit stats" on public.user_unit_stats for select to authenticated using (user_id = (select auth.uid()));
create policy "read own ledger" on public.coin_ledger for select to authenticated using (user_id = (select auth.uid()));
create policy "read own achievements" on public.user_achievements for select to authenticated using (user_id = (select auth.uid()));

-- No insert/update/delete policies anywhere: clients write only through functions.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
