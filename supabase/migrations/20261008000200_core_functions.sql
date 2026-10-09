-- Shared helpers used by every game function. All of them live in app_private,
-- which the API cannot reach; only SECURITY DEFINER functions in public call them.
-- Every function pins search_path = '' and qualifies names.

-- ---------------------------------------------------------------------------
-- Settings, time and auth
-- ---------------------------------------------------------------------------

create or replace function app_private.setting(k text) returns jsonb
language sql stable set search_path = '' as $$
  select value from public.app_settings where key = k
$$;

create or replace function app_private.num(k text) returns numeric
language sql stable set search_path = '' as $$
  select (value #>> '{}')::numeric from public.app_settings where key = k
$$;

-- "Today" for streaks, caps and the daily challenge is the IST calendar day.
create or replace function app_private.ist_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

create or replace function app_private.ist_start(d date) returns timestamptz
language sql stable set search_path = '' as $$
  select d::timestamp at time zone 'Asia/Kolkata'
$$;

create or replace function app_private.week_start(d date) returns date
language sql immutable set search_path = '' as $$
  select d - (extract(isodow from d)::int - 1)
$$;

create or replace function app_private.uid() returns uuid
language plpgsql stable set search_path = '' as $$
declare
  u uuid := auth.uid();
begin
  if u is null then
    raise exception 'not_authenticated';
  end if;
  return u;
end $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false)
$$;

create or replace function app_private.require_admin() returns uuid
language plpgsql stable set search_path = '' as $$
declare
  u uuid := app_private.uid();
begin
  if not public.is_admin() then
    raise exception 'admin_only';
  end if;
  return u;
end $$;

-- A profile row is created for every new auth user; onboarding fills it in.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name',
                         new.raw_user_meta_data ->> 'name',
                         split_part(coalesce(new.email, ''), '@', 1)), 40), '')
  )
  on conflict (id) do nothing;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Coins: every change is a ledger row; profiles.coins is the cached balance.
-- ---------------------------------------------------------------------------

create or replace function app_private.post_coins(
  p_user uuid, p_amount int, p_reason text, p_match uuid default null, p_ref text default null
) returns int
language plpgsql set search_path = '' as $$
declare
  bal int;
begin
  if p_amount = 0 then
    select coins into bal from public.profiles where id = p_user;
    return bal;
  end if;
  update public.profiles set coins = coins + p_amount where id = p_user returning coins into bal;
  if bal is null then
    raise exception 'no_profile';
  end if;
  insert into public.coin_ledger (user_id, amount, balance_after, reason, match_id, ref)
  values (p_user, p_amount, bal, p_reason, p_match, p_ref);
  return bal;
end $$;

-- Spend from the available balance (coins not locked in escrow).
create or replace function app_private.spend_coins(
  p_user uuid, p_amount int, p_reason text, p_match uuid default null, p_ref text default null
) returns int
language plpgsql set search_path = '' as $$
declare
  avail int;
begin
  select coins - escrow into avail from public.profiles where id = p_user for update;
  if avail is null or avail < p_amount then
    raise exception 'insufficient_coins';
  end if;
  return app_private.post_coins(p_user, -p_amount, p_reason, p_match, p_ref);
end $$;

-- ---------------------------------------------------------------------------
-- XP and levels (mirrored in src/lib/levels.ts)
-- ---------------------------------------------------------------------------

create or replace function app_private.xp_for_level(l int) returns int
language sql immutable set search_path = '' as $$
  select 60 * (l - 1) * (l - 1) + 40 * (l - 1)
$$;

create or replace function app_private.level_for_xp(x int) returns int
language sql immutable set search_path = '' as $$
  select coalesce(max(l), 1)::int
  from generate_series(1, 50) l
  where 60 * (l - 1) * (l - 1) + 40 * (l - 1) <= x
$$;

create or replace function app_private.award(p_user uuid, p_key text) returns boolean
language plpgsql set search_path = '' as $$
declare
  reward int;
begin
  insert into public.user_achievements (user_id, key) values (p_user, p_key)
  on conflict do nothing;
  if not found then
    return false;
  end if;
  select coins into reward from public.achievements where key = p_key;
  perform app_private.post_coins(p_user, coalesce(reward, 0), 'achievement', null, p_key);
  return true;
end $$;

create or replace function app_private.add_xp(p_user uuid, p_xp int) returns jsonb
language plpgsql set search_path = '' as $$
declare
  old_level int;
  new_level int;
  new_xp int;
  reward int := 0;
  l int;
begin
  if coalesce(p_xp, 0) <= 0 then
    select level into old_level from public.profiles where id = p_user;
    return jsonb_build_object('xp', 0, 'level', old_level, 'level_up', false, 'level_coins', 0);
  end if;
  select level into old_level from public.profiles where id = p_user for update;
  update public.profiles set xp = xp + p_xp where id = p_user returning xp into new_xp;
  new_level := app_private.level_for_xp(new_xp);
  if new_level > old_level then
    update public.profiles set level = new_level where id = p_user;
    for l in old_level + 1 .. new_level loop
      reward := reward + least(1000, 50 + 20 * (l - 2));
    end loop;
    perform app_private.post_coins(p_user, reward, 'level_up', null, 'level:' || new_level);
  end if;
  insert into public.weekly_stats (user_id, week_start, unit, xp)
  values (p_user, app_private.week_start(app_private.ist_today()), '*', p_xp)
  on conflict (user_id, week_start, unit) do update set xp = public.weekly_stats.xp + excluded.xp;
  return jsonb_build_object('xp', p_xp, 'level', new_level, 'level_up', new_level > old_level, 'level_coins', reward);
end $$;

-- ---------------------------------------------------------------------------
-- Daily streak: one solo set per IST day. Rewards 20 → 100 over a 7-day cycle.
-- ---------------------------------------------------------------------------

create or replace function app_private.bump_streak(p_user uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare
  p public.profiles;
  d date := app_private.ist_today();
  wk date := app_private.week_start(app_private.ist_today());
  new_streak int;
  shield_used boolean := false;
  reward int := 0;
begin
  select * into p from public.profiles where id = p_user for update;
  -- One free shield per week (banked up to one free; bought shields stack to 3).
  if p.shield_week is null or p.shield_week < wk then
    update public.profiles set shields = greatest(shields, 1), shield_week = wk where id = p_user;
    p.shields := greatest(p.shields, 1);
  end if;
  if p.streak_last_date = d then
    return jsonb_build_object('streak', p.streak_count, 'reward', 0, 'shield_used', false, 'new_day', false);
  elsif p.streak_last_date = d - 1 then
    new_streak := p.streak_count + 1;
  elsif p.streak_last_date = d - 2 and p.shields > 0 then
    new_streak := p.streak_count + 1;
    shield_used := true;
  else
    new_streak := 1;
  end if;
  update public.profiles
     set streak_count = new_streak,
         streak_last_date = d,
         shields = shields - shield_used::int
   where id = p_user;
  reward := (array[20, 30, 40, 50, 60, 80, 100])[((new_streak - 1) % 7) + 1];
  perform app_private.post_coins(p_user, reward, 'streak', null, 'streak:' || d);
  if new_streak >= 7 then perform app_private.award(p_user, 'streak_7'); end if;
  if new_streak >= 30 then perform app_private.award(p_user, 'streak_30'); end if;
  return jsonb_build_object('streak', new_streak, 'reward', reward, 'shield_used', shield_used, 'new_day', true);
end $$;

-- ---------------------------------------------------------------------------
-- Question history, stats and the revision deck
-- ---------------------------------------------------------------------------

create or replace function app_private.mark_seen(p_user uuid, p_q bigint) returns void
language sql set search_path = '' as $$
  insert into public.user_question_history (user_id, question_id, last_seen_at, times_seen)
  values (p_user, p_q, now(), 1)
  on conflict (user_id, question_id) do update
    set last_seen_at = now(), times_seen = public.user_question_history.times_seen + 1;
  update public.questions set times_shown = times_shown + 1 where id = p_q;
$$;

create or replace function app_private.record_answer(
  p_user uuid, p_q bigint, p_correct boolean, p_time_ms int, p_answered boolean, p_revision boolean default false
) returns void
language plpgsql set search_path = '' as $$
declare
  q record;
  r numeric;
  expected numeric;
  card public.revision_cards;
  has_card boolean;
  wk date := app_private.week_start(app_private.ist_today());
begin
  select unit, subtopic, difficulty into q from public.questions where id = p_q;
  if not found then
    return;
  end if;

  update public.user_question_history set last_correct = p_correct
   where user_id = p_user and question_id = p_q;

  update public.questions
     set times_correct = times_correct + p_correct::int,
         total_time_ms = total_time_ms + case when p_answered then coalesce(p_time_ms, 0) else 0 end
   where id = p_q;

  -- Elo-style rating on the 1–5 difficulty scale.
  insert into public.user_unit_stats (user_id, unit) values (p_user, q.unit) on conflict do nothing;
  select rating into r from public.user_unit_stats where user_id = p_user and unit = q.unit for update;
  expected := 1 / (1 + exp(1.2 * (q.difficulty - r)));
  update public.user_unit_stats
     set rating = greatest(1, least(5, r + 0.15 * (p_correct::int - expected))),
         answered = answered + 1,
         correct = correct + p_correct::int
   where user_id = p_user and unit = q.unit;

  insert into public.user_subtopic_stats (user_id, unit, subtopic, answered, correct, last_at)
  values (p_user, q.unit, q.subtopic, 1, p_correct::int, now())
  on conflict (user_id, unit, subtopic) do update
    set answered = public.user_subtopic_stats.answered + 1,
        correct = public.user_subtopic_stats.correct + excluded.correct,
        last_at = now();

  insert into public.weekly_stats (user_id, week_start, unit, answered, correct)
  values (p_user, wk, q.unit, 1, p_correct::int)
  on conflict (user_id, week_start, unit) do update
    set answered = public.weekly_stats.answered + 1,
        correct = public.weekly_stats.correct + excluded.correct;

  -- Every miss goes into the revision deck; a hit in revision mode promotes the card.
  select * into card from public.revision_cards where user_id = p_user and question_id = p_q;
  has_card := found;
  if not p_correct then
    insert into public.revision_cards (user_id, question_id, box, due_at)
    values (p_user, p_q, 1, now() + interval '1 day')
    on conflict (user_id, question_id) do update set box = 1, due_at = now() + interval '1 day';
  elsif has_card and p_revision then
    if card.box >= 5 then
      delete from public.revision_cards where user_id = p_user and question_id = p_q;
    else
      update public.revision_cards
         set box = card.box + 1,
             due_at = now() + (array[1, 3, 7, 14, 30])[card.box + 1] * interval '1 day'
       where user_id = p_user and question_id = p_q;
    end if;
  end if;
end $$;

-- Points for one answer: 100 + speed bonus (0–50, linear over the timer) + 25 from the 3rd correct in a row.
create or replace function app_private.answer_points(p_correct boolean, p_time_ms int, p_timer_s int, p_streak_after int)
returns int
language sql immutable set search_path = '' as $$
  select case when not p_correct then 0 else
    100
    + greatest(0, least(50, round(50 * (1 - p_time_ms::numeric / (p_timer_s * 1000)))))::int
    + case when p_streak_after >= 3 then 25 else 0 end
  end
$$;

-- ---------------------------------------------------------------------------
-- Question payloads. Options are shuffled per player with a seed, so two
-- players in a room never see the same option order.
-- ---------------------------------------------------------------------------

create or replace function app_private.perm4(seed text) returns int[]
language sql immutable set search_path = '' as $$
  select array_agg(k order by md5(seed || ':' || k)) from generate_series(0, 3) k
$$;

create or replace function app_private.question_payload(p_q bigint, p_seed text, p_reveal boolean)
returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  q public.questions;
  perm int[] := app_private.perm4(p_seed);
  o jsonb;
begin
  select * into q from public.questions where id = p_q;
  if not found then
    return null;
  end if;
  o := jsonb_build_object(
    'id', q.id,
    'unit', q.unit,
    'subtopic', q.subtopic,
    'difficulty', q.difficulty,
    'text_ta', q.text_ta,
    'text_en', q.text_en,
    'image_url', q.image_url,
    'options_ta', case when q.options_ta is null then null else
      (select jsonb_agg(q.options_ta[p + 1] order by ord) from unnest(perm) with ordinality t(p, ord)) end,
    'options_en', case when q.options_en is null then null else
      (select jsonb_agg(q.options_en[p + 1] order by ord) from unnest(perm) with ordinality t(p, ord)) end
  );
  if p_reveal then
    o := o || jsonb_build_object(
      'answer', array_position(perm, q.answer::int) - 1,
      'explanation_ta', q.explanation_ta,
      'explanation_en', q.explanation_en,
      'book_ref', q.book_ref,
      'source', q.source
    );
  end if;
  return o;
end $$;

-- Display index → canonical option index.
create or replace function app_private.to_canonical(p_seed text, p_display int) returns int
language sql immutable set search_path = '' as $$
  select case when p_display between 0 and 3 then (app_private.perm4(p_seed))[p_display + 1] end
$$;

create or replace function app_private.to_display(p_seed text, p_canonical int) returns int
language sql immutable set search_path = '' as $$
  select case when p_canonical is null then null else array_position(app_private.perm4(p_seed), p_canonical) - 1 end
$$;

-- 50:50 — two wrong options, as display indices.
create or replace function app_private.fifty_removed(p_q bigint, p_seed text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_agg(app_private.to_display(p_seed, k) order by k)
  from (
    select k from generate_series(0, 3) k, public.questions q
    where q.id = p_q and k <> q.answer
    order by md5(p_seed || ':5050:' || k)
    limit 2
  ) s
$$;

create or replace function app_private.public_user(p_user uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', id, 'username', username, 'name', display_name,
                            'avatar', avatar, 'level', level, 'district', district)
  from public.profiles where id = p_user
$$;

-- ---------------------------------------------------------------------------
-- Chat moderation. Returns an error code, or null when the message is fine.
-- Blocks links, phone numbers, UPI IDs/emails (off-platform trading and scams)
-- and words on the profanity list.
-- ---------------------------------------------------------------------------

create or replace function app_private.moderate(p_body text) returns text
language plpgsql stable set search_path = '' as $$
declare
  b text := btrim(coalesce(p_body, ''));
  norm text;
  spaced text;
  squashed text;
begin
  if char_length(b) = 0 then return 'empty_message'; end if;
  if char_length(b) > 200 then return 'message_too_long'; end if;
  if b ~* '(https?://|www\.|t\.me/|wa\.me/|bit\.ly|\m[a-z0-9-]+\.(com|in|net|org|io|me|ly|xyz|app|link|co|info)\M)' then
    return 'links_not_allowed';
  end if;
  if regexp_replace(b, '[\s\-\.\(\)+/]', '', 'g') ~ '[0-9௦-௯]{7,}' then
    return 'numbers_not_allowed';
  end if;
  if b ~* '[a-z0-9._-]{2,}\s*@\s*[a-z]{2,}' then
    return 'upi_not_allowed';
  end if;
  norm := lower(translate(b, '0134578@$!', 'oieastbasi'));
  spaced := ' ' || btrim(regexp_replace(norm, '[^a-z஀-௿]+', ' ', 'g')) || ' ';
  squashed := replace(spaced, ' ', '');
  if exists (
    select 1 from public.banned_words w
    where position(' ' || w.word || ' ' in spaced) > 0
       or (w.match_inside and position(replace(w.word, ' ', '') in squashed) > 0)
  ) then
    return 'message_blocked';
  end if;
  return null;
end $$;

-- English starter list; add Tamil and Tanglish words from the admin panel.
insert into public.banned_words (word, match_inside) values
  ('fuck', true), ('fucker', false), ('shit', false), ('bitch', true), ('bastard', true),
  ('asshole', true), ('dick', false), ('slut', true), ('whore', true), ('cunt', true),
  ('motherfucker', true), ('rape', false), ('nude', false), ('nudes', false);
