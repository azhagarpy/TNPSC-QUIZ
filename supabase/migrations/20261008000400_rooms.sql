-- Rooms, room question selection and the live match.
--
-- A match runs on the database clock. Question i is open from cur_open_at to
-- cur_reveal_at, then revealed for reveal_s seconds. Any call (match_sync,
-- submit_answer, finish_match, the minute cron) advances the state lazily, so
-- no always-on game server is needed. Clients only display.

insert into public.app_settings (key, value, note) values
  ('powerup_prices', '{"fifty":30,"time":20}', 'Coins per power-up (max one of each per match)')
on conflict (key) do nothing;

create or replace function app_private.stake_level(p_stake int) returns int
language sql stable set search_path = '' as $$
  select (app_private.setting('stake_tiers') ->> p_stake::text)::int
$$;

create or replace function app_private.new_room_code() returns text
language sql volatile set search_path = '' as $$
  -- No I, O, 0 or 1: easy to read out over the phone.
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 6)
$$;

create or replace function app_private.room_event(p_room uuid, p_event text, p_payload jsonb default '{}'::jsonb)
returns void
language plpgsql set search_path = '' as $$
begin
  if p_room is null then
    return;
  end if;
  perform realtime.send(p_payload, p_event, 'room:' || p_room::text, true);
exception when others then
  -- A broadcast failure must never fail a game write; clients also poll.
  raise warning 'realtime.send failed: %', sqlerrm;
end $$;

create or replace function app_private.in_live_match(p_user uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.match_players mp join public.matches m on m.id = mp.match_id
    where mp.user_id = p_user and m.status = 'live'
  )
$$;

create or replace function app_private.room_state(p_room uuid, p_me uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'code', r.code, 'host_id', r.host_id, 'size', r.size, 'stake', r.stake,
    'subject', r.subject, 'difficulty', r.difficulty, 'question_count', r.question_count,
    'language', r.language, 'powerups', r.powerups, 'status', r.status,
    'current_match_id', r.current_match_id,
    'current_match_status', (select m.status from public.matches m where m.id = r.current_match_id),
    'me', p_me,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', rp.user_id, 'seat', rp.seat,
        'ready', rp.ready or rp.user_id = r.host_id,
        'is_host', rp.user_id = r.host_id,
        'online', rp.last_seen_at > now() - interval '30 seconds',
        'name', pr.display_name, 'username', pr.username, 'avatar', pr.avatar, 'level', pr.level,
        'can_afford', pr.coins - pr.escrow >= r.stake
      ) order by rp.seat)
      from public.room_players rp join public.profiles pr on pr.id = rp.user_id
      where rp.room_id = r.id), '[]'::jsonb)
  )
  from public.rooms r where r.id = p_room
$$;

create or replace function app_private.leave_room(p_room uuid, p_user uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_room public.rooms;
  v_next uuid;
begin
  select * into v_room from public.rooms where id = p_room for update;
  if not found then
    return;
  end if;
  delete from public.room_players where room_id = p_room and user_id = p_user;
  if not found then
    return;
  end if;
  if v_room.host_id = p_user then
    select rp.user_id into v_next from public.room_players rp where rp.room_id = p_room order by rp.seat limit 1;
    if v_next is not null then
      update public.rooms set host_id = v_next, last_activity_at = now() where id = p_room;
    end if;
  end if;
  if v_room.status = 'lobby' and not exists (select 1 from public.room_players rp where rp.room_id = p_room) then
    update public.rooms set status = 'closed' where id = p_room;
  end if;
  perform app_private.room_event(p_room, 'lobby');
end $$;

-- Realtime authorization helpers (used by policies on realtime.messages).
create or replace function public.is_room_member(p_topic_room text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_room uuid;
begin
  begin
    v_room := p_topic_room::uuid;
  exception when others then
    return false;
  end;
  return exists (select 1 from public.room_players rp where rp.room_id = v_room and rp.user_id = auth.uid())
      or exists (select 1 from public.rooms r join public.match_players mp on mp.match_id = r.current_match_id
                 where r.id = v_room and mp.user_id = auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- Lobby
-- ---------------------------------------------------------------------------

create or replace function public.create_room(
  p_size int, p_stake int, p_subject text default 'mixed', p_count int default 10,
  p_language text default null, p_powerups boolean default true, p_difficulty int default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_p public.profiles;
  v_need_level int;
  v_room uuid;
  v_other record;
begin
  select * into v_p from public.profiles where id = v_me for update;
  if not v_p.onboarded then raise exception 'not_onboarded'; end if;
  if p_size not between 2 and 4 then raise exception 'bad_size'; end if;
  if p_size = 4 and v_p.level < app_private.num('four_player_level') then raise exception 'level_too_low'; end if;
  v_need_level := app_private.stake_level(p_stake);
  if v_need_level is null then raise exception 'bad_stake'; end if;
  if v_p.level < v_need_level then raise exception 'level_too_low'; end if;
  if p_stake > 0 and v_p.stakes_frozen then raise exception 'stakes_frozen'; end if;
  if v_p.coins - v_p.escrow < p_stake then raise exception 'insufficient_coins'; end if;
  if p_count not between 5 and 15 then raise exception 'bad_count'; end if;
  p_subject := coalesce(p_subject, 'mixed');
  if p_subject <> 'mixed' and not exists (select 1 from public.units u where u.key = p_subject) then
    raise exception 'bad_subject';
  end if;
  if p_difficulty is not null and p_difficulty not between 1 and 5 then raise exception 'bad_difficulty'; end if;
  if coalesce(p_language, v_p.language) not in ('ta', 'en') then raise exception 'bad_language'; end if;
  if app_private.in_live_match(v_me) then raise exception 'in_match'; end if;

  for v_other in select rp.room_id from public.room_players rp where rp.user_id = v_me loop
    perform app_private.leave_room(v_other.room_id, v_me);
  end loop;

  loop
    begin
      insert into public.rooms (code, host_id, size, stake, subject, difficulty, question_count, language, powerups)
      values (app_private.new_room_code(), v_me, p_size, p_stake, p_subject, p_difficulty, p_count,
              coalesce(p_language, v_p.language), coalesce(p_powerups, true))
      returning id into v_room;
      exit;
    exception when unique_violation then
      -- Code clash with an open room: draw another.
    end;
  end loop;
  insert into public.room_players (room_id, user_id, seat, ready) values (v_room, v_me, 0, true);
  return app_private.room_state(v_room, v_me);
end $$;

create or replace function public.join_room(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_p public.profiles;
  v_room public.rooms;
  v_seat int;
  v_other record;
begin
  select * into v_room from public.rooms
  where code = upper(btrim(p_code)) and status <> 'closed' for update;
  if not found then raise exception 'room_not_found'; end if;
  if exists (select 1 from public.room_players rp where rp.room_id = v_room.id and rp.user_id = v_me) then
    update public.room_players set last_seen_at = now() where room_id = v_room.id and user_id = v_me;
    return app_private.room_state(v_room.id, v_me);
  end if;

  select * into v_p from public.profiles where id = v_me for update;
  if not v_p.onboarded then raise exception 'not_onboarded'; end if;
  if v_room.status <> 'lobby' then raise exception 'room_in_match'; end if;
  if exists (select 1 from public.blocks b
             where (b.blocker_id = v_room.host_id and b.blocked_id = v_me)
                or (b.blocker_id = v_me and b.blocked_id = v_room.host_id)) then
    raise exception 'room_not_found';
  end if;
  if (select count(*) from public.room_players rp where rp.room_id = v_room.id) >= v_room.size then
    raise exception 'room_full';
  end if;
  if v_p.level < app_private.stake_level(v_room.stake) then raise exception 'level_too_low'; end if;
  if v_room.stake > 0 and v_p.stakes_frozen then raise exception 'stakes_frozen'; end if;
  if v_p.coins - v_p.escrow < v_room.stake then raise exception 'insufficient_coins'; end if;
  if app_private.in_live_match(v_me) then raise exception 'in_match'; end if;

  for v_other in select rp.room_id from public.room_players rp where rp.user_id = v_me loop
    perform app_private.leave_room(v_other.room_id, v_me);
  end loop;

  select min(g.s) into v_seat from generate_series(0, v_room.size - 1) g(s)
  where not exists (select 1 from public.room_players rp where rp.room_id = v_room.id and rp.seat = g.s);
  insert into public.room_players (room_id, user_id, seat) values (v_room.id, v_me, v_seat);
  update public.rooms set last_activity_at = now() where id = v_room.id;
  perform app_private.room_event(v_room.id, 'lobby');
  return app_private.room_state(v_room.id, v_me);
end $$;

create or replace function public.get_room(p_room uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
begin
  if not exists (select 1 from public.room_players rp where rp.room_id = p_room and rp.user_id = v_me) then
    raise exception 'not_member';
  end if;
  return app_private.room_state(p_room, v_me);
end $$;

-- Called every ~15 s from the lobby. Drops players gone for 90 s and passes
-- hosting on when the host has been away for 30 s.
create or replace function public.room_heartbeat(p_room uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_room public.rooms;
  v_next uuid;
  v_changed boolean := false;
begin
  update public.room_players set last_seen_at = now() where room_id = p_room and user_id = v_me;
  if not found then raise exception 'not_member'; end if;
  update public.profiles set last_active_at = now() where id = v_me;
  select * into v_room from public.rooms where id = p_room for update;
  if v_room.status = 'lobby' then
    delete from public.room_players
     where room_id = p_room and user_id <> v_me and last_seen_at < now() - interval '90 seconds';
    v_changed := found;
    if not exists (select 1 from public.room_players rp
                   where rp.room_id = p_room and rp.user_id = v_room.host_id
                     and rp.last_seen_at > now() - interval '30 seconds') then
      select rp.user_id into v_next from public.room_players rp
      where rp.room_id = p_room and rp.last_seen_at > now() - interval '30 seconds'
      order by rp.seat limit 1;
      if v_next is not null and v_next <> v_room.host_id then
        update public.rooms set host_id = v_next where id = p_room;
        v_changed := true;
      end if;
    end if;
  end if;
  if v_changed then
    perform app_private.room_event(p_room, 'lobby');
  end if;
  return app_private.room_state(p_room, v_me);
end $$;

create or replace function public.set_ready(p_room uuid, p_ready boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
begin
  update public.room_players set ready = p_ready, last_seen_at = now()
   where room_id = p_room and user_id = v_me;
  if not found then raise exception 'not_member'; end if;
  perform app_private.room_event(p_room, 'lobby');
  return app_private.room_state(p_room, v_me);
end $$;

create or replace function public.leave_room(p_room uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.leave_room(p_room, app_private.uid());
end $$;

-- ---------------------------------------------------------------------------
-- Room question selection (plan: "Room question selection algorithm")
-- ---------------------------------------------------------------------------

create or replace function app_private.select_room_questions(
  p_players uuid[], p_n int, p_subject text, p_lang text, p_rating numeric
) returns bigint[]
language plpgsql volatile set search_path = '' as $$
declare
  v_np int := cardinality(p_players);
  v_cooldown int := app_private.num('room_cooldown_days')::int;
  v_band numeric := app_private.num('difficulty_band');
  v_cap int := app_private.num('max_per_subtopic')::int;
  v_unseen numeric := app_private.num('unseen_bonus');
  v_penalty numeric := app_private.num('reported_penalty');
  v_threshold numeric := app_private.num('report_rate_threshold');
  v_group_recent bigint[];
  v_chosen bigint[] := '{}';
  v_got bigint[];
  v_need int;
  v_quota record;
  v_stage record;
begin
  -- Step 3b: questions from this group's last 3 matches together. Never relaxed.
  select coalesce(array_agg(distinct x.qid), '{}') into v_group_recent
  from (
    select m.question_ids from public.matches m
    where m.id in (
      select mp.match_id from public.match_players mp
      where mp.user_id = any(p_players)
      group by mp.match_id
      having count(*) >= least(2, v_np)
    )
    order by m.started_at desc
    limit app_private.num('group_norepeat_matches')::int
  ) g, unnest(g.question_ids) as x(qid);

  -- Step 1: quotas by exam weight.
  for v_quota in select * from app_private.quotas(p_n, p_subject) loop
    v_need := v_quota.k;
    -- Step 6 fallback order: ±band → ±band+1 → cooldown 7 d → 3 d → oldest-seen
    -- first → any difficulty without the sub-topic cap.
    for v_stage in
      select * from (values
        (v_band,         v_cooldown,             v_cap, false),
        (v_band + 1,     v_cooldown,             v_cap, false),
        (v_band + 1,     least(v_cooldown, 7),   v_cap, false),
        (v_band + 1,     least(v_cooldown, 3),   v_cap, false),
        (v_band + 1,     0,                      v_cap, true),
        (5::numeric,     0,                      1000,  true)
      ) as s(band, cooldown, cap, oldest_first)
    loop
      exit when v_need <= 0;
      with pool as (
        -- Step 2: live questions in the room's language, difficulty within the band.
        select q.id, q.subtopic, q.times_shown, q.report_count
        from public.questions q
        where q.unit = v_quota.unit
          and q.status = 'live'
          and app_private.lang_ok(q.unit, q.text_ta, q.text_en, p_lang)
          and q.difficulty between p_rating - v_stage.band and p_rating + v_stage.band
          and not (q.id = any(v_chosen))
          and not (q.id = any(v_group_recent))
      ),
      hist as (
        select h.question_id,
               count(*) as n_seen,
               max(h.last_seen_at) as max_seen,
               sum(least(extract(epoch from now() - h.last_seen_at) / 86400.0, 60) / 60.0) as fresh_sum
        from public.user_question_history h
        where h.user_id = any(p_players) and h.question_id in (select pool.id from pool)
        group by h.question_id
      ),
      cand as (
        -- Step 3a: drop anything any player saw within the cooldown.
        -- Step 4: freshness weight = mean over players of min(days, 60) / 60 (never seen = 1).
        select pool.id, pool.subtopic, hist.max_seen,
               ((v_np - coalesce(hist.n_seen, 0)) + coalesce(hist.fresh_sum, 0)) / v_np
               * case when hist.n_seen is null then v_unseen else 1 end
               * case when pool.times_shown > 0 and pool.report_count::numeric / pool.times_shown > v_threshold
                      then v_penalty else 1 end as w
        from pool left join hist on hist.question_id = pool.id
        where v_stage.cooldown = 0
           or hist.max_seen is null
           or hist.max_seen < now() - make_interval(days => v_stage.cooldown)
      ),
      keyed as (
        -- Step 5: Efraimidis–Spirakis keys (log form): ln(u) / w, largest first.
        select cand.id, cand.subtopic,
               case when v_stage.oldest_first
                    then -extract(epoch from coalesce(cand.max_seen, 'epoch'::timestamptz))::float8 + random()
                    else ln(1 - random()) / greatest(cand.w, 0.001)::float8 end as sort_key
        from cand
      ),
      capped as (
        select keyed.id, keyed.sort_key,
               row_number() over (partition by keyed.subtopic order by keyed.sort_key desc)
               + (select count(*) from public.questions c
                  where c.id = any(v_chosen) and c.unit = v_quota.unit and c.subtopic = keyed.subtopic) as sub_rank
        from keyed
      )
      select coalesce(array_agg(t.id), '{}') into v_got
      from (
        select capped.id from capped
        where capped.sub_rank <= v_stage.cap
        order by capped.sort_key desc
        limit v_need
      ) t;
      v_chosen := v_chosen || v_got;
      v_need := v_need - cardinality(v_got);
    end loop;
  end loop;

  -- Bank too thin for the quotas: top up from any unit, oldest-seen first.
  if cardinality(v_chosen) < p_n then
    select v_chosen || coalesce(array_agg(t.id), '{}') into v_chosen from (
      select q.id
      from public.questions q
      left join lateral (
        select max(h.last_seen_at) as seen from public.user_question_history h
        where h.question_id = q.id and h.user_id = any(p_players)
      ) hs on true
      where q.status = 'live'
        and app_private.lang_ok(q.unit, q.text_ta, q.text_en, p_lang)
        and (p_subject = 'mixed' or q.unit = p_subject)
        and not (q.id = any(v_chosen))
        and not (q.id = any(v_group_recent))
      order by hs.seen nulls first, random()
      limit p_n - cardinality(v_chosen)
    ) t;
  end if;

  return (select coalesce(array_agg(x.id order by random()), '{}') from unnest(v_chosen) as x(id));
end $$;

-- ---------------------------------------------------------------------------
-- Match lifecycle
-- ---------------------------------------------------------------------------

-- Checks every player, picks the questions, moves stakes to escrow and opens the
-- match, in the caller's transaction. Used by start_match and Quick Match.
create or replace function app_private.begin_match(p_room uuid) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_room public.rooms;
  v_players uuid[];
  v_pl record;
  v_staked int;
  v_cap int := app_private.num('daily_stake_cap')::int;
  v_today timestamptz := app_private.ist_start(app_private.ist_today());
  v_rating numeric;
  v_ids bigint[];
  v_match uuid;
  v_timer int := app_private.num('room_timer_s')::int;
  v_open timestamptz;
begin
  select * into v_room from public.rooms where id = p_room for update;
  if not found then raise exception 'room_not_found'; end if;
  if v_room.status <> 'lobby' then raise exception 'room_in_match'; end if;
  select array_agg(rp.user_id order by rp.user_id) into v_players
  from public.room_players rp where rp.room_id = p_room;
  if coalesce(cardinality(v_players), 0) < 2 then raise exception 'need_two_players'; end if;

  -- Lock every player's balance in a fixed order (no deadlocks), then check.
  for v_pl in
    select pr.id, pr.display_name, pr.coins, pr.escrow, pr.stakes_frozen
    from public.profiles pr where pr.id = any(v_players) order by pr.id for update
  loop
    if v_pl.coins - v_pl.escrow < v_room.stake then
      raise exception 'player_cannot_afford' using detail = coalesce(v_pl.display_name, '');
    end if;
    if app_private.in_live_match(v_pl.id) then
      raise exception 'player_in_match' using detail = coalesce(v_pl.display_name, '');
    end if;
    if v_room.stake > 0 then
      if v_pl.stakes_frozen then
        raise exception 'stakes_frozen' using detail = coalesce(v_pl.display_name, '');
      end if;
      select coalesce(sum(m.stake), 0) into v_staked
      from public.match_players mp join public.matches m on m.id = mp.match_id
      where mp.user_id = v_pl.id and m.started_at >= v_today and m.status <> 'refunded';
      if v_staked + v_room.stake > v_cap then
        raise exception 'daily_stake_cap' using detail = coalesce(v_pl.display_name, '');
      end if;
    end if;
  end loop;

  -- Room rating = host's chosen difficulty, or the players' average unit rating.
  v_rating := v_room.difficulty;
  if v_rating is null then
    select avg(coalesce(x.rt, 2.5)) into v_rating
    from unnest(v_players) as u(pid)
    left join lateral (
      select avg(s.rating) as rt from public.user_unit_stats s
      where s.user_id = u.pid and (v_room.subject = 'mixed' or s.unit = v_room.subject)
    ) x on true;
  end if;

  v_ids := app_private.select_room_questions(v_players, v_room.question_count, v_room.subject, v_room.language, v_rating);
  if cardinality(v_ids) < least(5, v_room.question_count) then
    raise exception 'not_enough_questions';
  end if;

  -- Stakes move to escrow; they are only deducted when the match settles.
  update public.profiles set escrow = escrow + v_room.stake where id = any(v_players);

  v_open := clock_timestamp() + interval '4 seconds'; -- 3-2-1 countdown
  insert into public.matches (room_id, stake, house_cut, question_ids, n, timer_s, reveal_s, powerups, language,
                              cur_index, cur_open_at, cur_reveal_at)
  values (p_room, v_room.stake, app_private.num('house_cut'), v_ids, cardinality(v_ids), v_timer,
          app_private.num('reveal_s')::int, v_room.powerups, v_room.language,
          0, v_open, v_open + make_interval(secs => v_timer))
  returning id into v_match;
  insert into public.match_players (match_id, user_id, seat)
  select v_match, rp.user_id, rp.seat from public.room_players rp where rp.room_id = p_room;
  update public.rooms set status = 'playing', current_match_id = v_match, last_activity_at = now() where id = p_room;
  update public.room_players set ready = false where room_id = p_room;
  perform app_private.room_event(p_room, 'match_started', jsonb_build_object('match_id', v_match));
  return v_match;
end $$;

create or replace function public.start_match(p_room uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_room public.rooms;
begin
  select * into v_room from public.rooms where id = p_room for update;
  if not found then raise exception 'room_not_found'; end if;
  if v_room.host_id <> v_me then raise exception 'host_only'; end if;
  if v_room.status <> 'lobby' then raise exception 'room_in_match'; end if;
  if (select count(*) from public.room_players rp where rp.room_id = p_room) < 2 then
    raise exception 'need_two_players';
  end if;
  if exists (select 1 from public.room_players rp
             where rp.room_id = p_room and rp.user_id <> v_room.host_id and not rp.ready) then
    raise exception 'not_all_ready';
  end if;
  return jsonb_build_object('match_id', app_private.begin_match(p_room));
end $$;

create or replace function app_private.advance_match(p_match uuid) returns public.matches
language plpgsql set search_path = '' as $$
declare
  v_m public.matches;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_m from public.matches where id = p_match;
  if not found then
    raise exception 'match_not_found';
  end if;
  if v_m.status = 'live' and v_m.cur_index < v_m.n and v_now >= v_m.cur_reveal_at then
    select * into v_m from public.matches where id = p_match for update;
    while v_m.cur_index < v_m.n and v_now >= v_m.cur_reveal_at loop
      v_m.cur_index := v_m.cur_index + 1;
      v_m.cur_open_at := v_m.cur_reveal_at + make_interval(secs => v_m.reveal_s);
      v_m.cur_reveal_at := v_m.cur_open_at + make_interval(secs => v_m.timer_s);
    end loop;
    update public.matches
       set cur_index = v_m.cur_index, cur_open_at = v_m.cur_open_at, cur_reveal_at = v_m.cur_reveal_at
     where id = p_match;
  end if;
  return v_m;
end $$;

create or replace function app_private.match_phase(p_m public.matches, p_now timestamptz) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_m.status <> 'live' then 'finished'
    when p_m.cur_index >= p_m.n and p_now >= p_m.cur_open_at then 'finished'
    when p_now < p_m.cur_open_at and p_m.cur_index = 0 then 'starting'
    when p_now < p_m.cur_open_at then 'reveal'
    else 'question'
  end
$$;

create or replace function app_private.match_seed(p_match uuid, p_user uuid, p_index int) returns text
language sql immutable set search_path = '' as $$
  select p_match::text || ':' || p_user::text || ':' || p_index
$$;

-- Everything a player's screen needs for the current phase. The question comes
-- back only once the database clock has passed its open time, and the answer
-- only after it closes.
create or replace function public.match_sync(p_match uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_mp public.match_players;
  v_m public.matches;
  v_now timestamptz;
  v_phase text;
  v_idx int;
  v_qid bigint;
  v_seed text;
  v_deadline timestamptz;
  v_next timestamptz;
  v_question jsonb;
  v_mine jsonb;
  v_players jsonb;
  v_a public.match_answers;
begin
  select * into v_mp from public.match_players where match_id = p_match and user_id = v_me;
  if not found then raise exception 'not_in_match'; end if;
  v_m := app_private.advance_match(p_match);
  v_now := clock_timestamp();
  v_phase := app_private.match_phase(v_m, v_now);
  v_idx := case v_phase when 'question' then v_m.cur_index when 'reveal' then v_m.cur_index - 1 when 'starting' then 0 end;
  update public.profiles set last_active_at = now() where id = v_me and last_active_at < now() - interval '1 minute';

  if v_phase = 'question' then
    v_qid := v_m.question_ids[v_idx + 1];
    v_seed := app_private.match_seed(p_match, v_me, v_idx);
    insert into public.match_views (match_id, user_id, q_index) values (p_match, v_me, v_idx) on conflict do nothing;
    if found then
      perform app_private.mark_seen(v_me, v_qid);
    end if;
    v_question := app_private.question_payload(v_qid, v_seed, false);
    if v_mp.used_5050 = v_idx then
      v_question := v_question || jsonb_build_object('removed', app_private.fifty_removed(v_qid, v_seed));
    end if;
    v_deadline := v_m.cur_open_at + make_interval(secs => v_m.timer_s + case when v_mp.used_time = v_idx then 10 else 0 end);
    v_next := v_m.cur_reveal_at;
    select * into v_a from public.match_answers where match_id = p_match and user_id = v_me and q_index = v_idx;
    if found then
      v_mine := jsonb_build_object('choice', app_private.to_display(v_seed, v_a.choice));
    end if;
  elsif v_phase = 'reveal' then
    v_qid := v_m.question_ids[v_idx + 1];
    v_seed := app_private.match_seed(p_match, v_me, v_idx);
    v_question := app_private.question_payload(v_qid, v_seed, true);
    v_next := v_m.cur_open_at;
    select * into v_a from public.match_answers where match_id = p_match and user_id = v_me and q_index = v_idx;
    if found then
      v_mine := jsonb_build_object('choice', app_private.to_display(v_seed, v_a.choice), 'correct', v_a.correct,
                                   'points', v_a.points, 'time_ms', v_a.time_ms);
    else
      v_mine := jsonb_build_object('choice', null, 'correct', false, 'points', 0);
    end if;
  elsif v_phase = 'starting' then
    v_next := v_m.cur_open_at;
  end if;

  -- During a question, scores exclude that question's points and streaks are
  -- hidden, so nobody learns who got it right before the reveal.
  select jsonb_agg(jsonb_build_object(
           'user_id', p.user_id, 'seat', p.seat, 'name', pr.display_name, 'avatar', pr.avatar, 'level', pr.level,
           'score', p.score - case when v_phase = 'question' then coalesce(ca.points, 0) else 0 end,
           'streak', case when v_phase = 'question' then null else p.streak end,
           'answered', ca.user_id is not null,
           'correct', case when v_phase = 'reveal' then coalesce(ca.correct, false) end,
           'points', case when v_phase = 'reveal' then coalesce(ca.points, 0) end,
           'rank', p.rank, 'payout', p.payout
         ) order by p.seat)
    into v_players
  from public.match_players p
  join public.profiles pr on pr.id = p.user_id
  left join public.match_answers ca on ca.match_id = p.match_id and ca.user_id = p.user_id and ca.q_index = v_idx
  where p.match_id = p_match;

  return jsonb_build_object(
    'match_id', p_match, 'room_id', v_m.room_id, 'status', v_m.status, 'phase', v_phase,
    'index', v_idx, 'n', v_m.n, 'timer_s', v_m.timer_s, 'reveal_s', v_m.reveal_s,
    'stake', v_m.stake, 'language', v_m.language,
    'server_now', v_now, 'open_at', v_m.cur_open_at, 'deadline_at', v_deadline, 'next_at', v_next,
    'question', v_question, 'mine', v_mine, 'players', v_players, 'me', v_me,
    'powerups', jsonb_build_object('enabled', v_m.powerups, 'fifty_used', v_mp.used_5050 is not null,
                                   'time_used', v_mp.used_time is not null,
                                   'prices', app_private.setting('powerup_prices'))
  );
end $$;

-- p_choice is the display index the player tapped. Timestamped on the database clock.
create or replace function public.submit_answer(p_match uuid, p_index int, p_choice int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_mp public.match_players;
  v_m public.matches;
  v_now timestamptz;
  v_seed text;
  v_canon int;
  v_q public.questions;
  v_t int;
  v_ok boolean;
  v_streak int;
  v_pts int;
  v_all boolean;
begin
  select * into v_mp from public.match_players where match_id = p_match and user_id = v_me;
  if not found then raise exception 'not_in_match'; end if;
  perform 1 from public.matches where id = p_match for update; -- serialise answers within a match
  v_m := app_private.advance_match(p_match);
  v_now := clock_timestamp();
  if v_m.status <> 'live' then raise exception 'match_over'; end if;
  if app_private.match_phase(v_m, v_now) <> 'question' or v_m.cur_index <> p_index then
    raise exception 'question_closed';
  end if;
  -- 1 s grace for the network on top of the player's own deadline.
  if v_now > v_m.cur_open_at + make_interval(secs => v_m.timer_s + 1 + case when v_mp.used_time = p_index then 10 else 0 end) then
    raise exception 'too_late';
  end if;
  v_seed := app_private.match_seed(p_match, v_me, p_index);
  v_canon := app_private.to_canonical(v_seed, p_choice);
  if v_canon is null then raise exception 'bad_choice'; end if;

  select * into v_q from public.questions where id = v_m.question_ids[p_index + 1];
  v_t := greatest(0, (extract(epoch from v_now - v_m.cur_open_at) * 1000)::int);
  v_ok := v_canon = v_q.answer;
  v_streak := case when v_ok then v_mp.streak + 1 else 0 end;
  v_pts := app_private.answer_points(v_ok, least(v_t, v_m.timer_s * 1000), v_m.timer_s, v_streak);

  insert into public.match_answers (match_id, user_id, q_index, choice, time_ms, correct, points, flagged)
  values (p_match, v_me, p_index, v_canon, v_t, v_ok, v_pts,
          v_t < 800 and char_length(coalesce(v_q.text_en, v_q.text_ta)) > 80) -- suspiciously fast on a long question
  on conflict do nothing;
  if not found then raise exception 'already_answered'; end if;

  update public.match_players
     set score = score + v_pts, correct = correct + v_ok::int, answered = answered + 1,
         streak = v_streak, best_streak = greatest(best_streak, v_streak),
         total_time_ms = total_time_ms + least(v_t, v_m.timer_s * 1000)
   where match_id = p_match and user_id = v_me;
  perform app_private.record_answer(v_me, v_q.id, v_ok, v_t, true);

  select count(*) >= (select count(*) from public.match_players mp where mp.match_id = p_match) into v_all
  from public.match_answers ma where ma.match_id = p_match and ma.q_index = p_index;
  if v_all then
    -- Everyone has answered: reveal now instead of waiting out the timer.
    update public.matches set cur_reveal_at = least(cur_reveal_at, v_now) where id = p_match;
    perform app_private.room_event(v_m.room_id, 'phase', jsonb_build_object('match_id', p_match, 'index', p_index));
  else
    perform app_private.room_event(v_m.room_id, 'answered',
      jsonb_build_object('match_id', p_match, 'index', p_index, 'user_id', v_me));
  end if;
  return jsonb_build_object('accepted', true, 'index', p_index, 'choice', p_choice, 'all_answered', v_all);
end $$;

create or replace function public.use_powerup(p_match uuid, p_kind text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_mp public.match_players;
  v_m public.matches;
  v_idx int;
  v_price int;
begin
  select * into v_mp from public.match_players where match_id = p_match and user_id = v_me;
  if not found then raise exception 'not_in_match'; end if;
  perform 1 from public.matches where id = p_match for update;
  v_m := app_private.advance_match(p_match);
  if not v_m.powerups then raise exception 'powerups_off'; end if;
  if app_private.match_phase(v_m, clock_timestamp()) <> 'question' then raise exception 'question_closed'; end if;
  v_idx := v_m.cur_index;
  if exists (select 1 from public.match_answers ma where ma.match_id = p_match and ma.user_id = v_me and ma.q_index = v_idx) then
    raise exception 'already_answered';
  end if;
  v_price := (app_private.setting('powerup_prices') ->> p_kind)::int;
  if v_price is null then raise exception 'bad_powerup'; end if;

  if p_kind = 'fifty' then
    if v_mp.used_5050 is not null then raise exception 'powerup_used'; end if;
    perform app_private.spend_coins(v_me, v_price, 'powerup', p_match, 'fifty');
    update public.match_players set used_5050 = v_idx where match_id = p_match and user_id = v_me;
    return jsonb_build_object('kind', p_kind, 'index', v_idx,
      'removed', app_private.fifty_removed(v_m.question_ids[v_idx + 1], app_private.match_seed(p_match, v_me, v_idx)));
  else
    if v_mp.used_time is not null then raise exception 'powerup_used'; end if;
    perform app_private.spend_coins(v_me, v_price, 'powerup', p_match, 'time');
    update public.match_players set used_time = v_idx where match_id = p_match and user_id = v_me;
    -- Others wait up to 10 s longer for the reveal of this question.
    update public.matches
       set cur_reveal_at = greatest(cur_reveal_at, cur_open_at + make_interval(secs => timer_s + 10))
     where id = p_match;
    perform app_private.room_event(v_m.room_id, 'phase', jsonb_build_object('match_id', p_match, 'index', v_idx));
    return jsonb_build_object('kind', p_kind, 'index', v_idx,
      'deadline_at', v_m.cur_open_at + make_interval(secs => v_m.timer_s + 10));
  end if;
end $$;

create or replace function app_private.refund_match(p_match uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_m public.matches;
begin
  select * into v_m from public.matches where id = p_match for update;
  if not found or v_m.status <> 'live' then
    return;
  end if;
  update public.profiles set escrow = escrow - v_m.stake
   where id in (select mp.user_id from public.match_players mp where mp.match_id = p_match);
  update public.matches set status = 'refunded', pot = 0, settled_at = now() where id = p_match;
  update public.rooms
     set status = case when exists (select 1 from public.room_players rp where rp.room_id = v_m.room_id) then 'lobby' else 'closed' end,
         last_activity_at = now()
   where id = v_m.room_id and current_match_id = p_match;
  perform app_private.room_event(v_m.room_id, 'match_settled', jsonb_build_object('match_id', p_match, 'refunded', true));
end $$;

create or replace function app_private.check_referral(p_user uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_p public.profiles;
begin
  select * into v_p from public.profiles where id = p_user;
  if v_p.referred_by is null or v_p.referral_rewarded then
    return;
  end if;
  if (select count(*) from public.match_players mp join public.matches m on m.id = mp.match_id
      where mp.user_id = p_user and m.status = 'settled') < 3 then
    return;
  end if;
  update public.profiles set referral_rewarded = true where id = p_user;
  if (select count(*) from public.profiles p where p.referred_by = v_p.referred_by and p.referral_rewarded and p.id <> p_user)
     < app_private.num('referral_max') then
    perform app_private.post_coins(v_p.referred_by, app_private.num('referral_reward')::int, 'referral', null, p_user::text);
  end if;
end $$;

-- Settles once. Ranks by points, ties broken by total answer time (unanswered =
-- full timer). Pot = stake × players; the house keeps 10 %; the rest is paid
-- 90 % (2p), 70/20 (3p) or 60/30 (4p). Exact ties share their positions' prizes.
create or replace function app_private.settle_match(p_match uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_m public.matches;
  v_np int;
  v_pot int;
  v_shares numeric[];
  v_scale numeric;
  v_pl record;
  v_share numeric;
  v_payout int;
  v_xp int;
  v_winner uuid;
  v_trailed boolean;
begin
  select * into v_m from public.matches where id = p_match for update;
  if not found or v_m.status <> 'live' then
    return;
  end if;
  if not exists (select 1 from public.match_answers ma where ma.match_id = p_match) then
    perform app_private.refund_match(p_match); -- nobody played: abandoned
    return;
  end if;

  update public.matches set status = 'settled' where id = p_match;
  select count(*) into v_np from public.match_players mp where mp.match_id = p_match;
  v_pot := v_m.stake * v_np;
  v_shares := case v_np when 2 then array[0.9, 0] when 3 then array[0.7, 0.2, 0] else array[0.6, 0.3, 0, 0] end;
  v_scale := (1 - v_m.house_cut) / 0.9;

  update public.match_players
     set total_time_ms = total_time_ms + (v_m.n - answered) * v_m.timer_s * 1000
   where match_id = p_match;

  for v_pl in
    select mp.user_id, mp.correct, mp.answered,
           rank() over (order by mp.score desc, mp.total_time_ms asc) as rk,
           count(*) over (partition by mp.score, mp.total_time_ms) as tie_n
    from public.match_players mp where mp.match_id = p_match
  loop
    select coalesce(sum(v_shares[i]), 0) / v_pl.tie_n into v_share
    from generate_series(v_pl.rk::int, (v_pl.rk + v_pl.tie_n - 1)::int) as g(i);
    v_payout := floor(v_pot * v_share * v_scale);
    v_xp := round((10 * v_pl.correct + 2 * v_pl.answered) * 1.5);
    update public.match_players set rank = v_pl.rk, payout = v_payout, xp = v_xp
     where match_id = p_match and user_id = v_pl.user_id;

    update public.profiles set escrow = escrow - v_m.stake where id = v_pl.user_id;
    if v_m.stake > 0 then
      perform app_private.post_coins(v_pl.user_id, -v_m.stake, 'room_stake', p_match);
      if v_payout > 0 then
        perform app_private.post_coins(v_pl.user_id, v_payout, 'room_win', p_match);
      end if;
    end if;
    perform app_private.add_xp(v_pl.user_id, v_xp);

    update public.profiles
       set room_win_streak = case when v_pl.rk = 1 and v_pl.tie_n = 1 then room_win_streak + 1 else 0 end
     where id = v_pl.user_id;
    if v_pl.rk = 1 and v_pl.tie_n = 1 then
      v_winner := v_pl.user_id;
      perform app_private.award(v_pl.user_id, 'first_win');
    end if;
    if (select count(*) from public.match_answers a
        where a.match_id = p_match and a.user_id = v_pl.user_id and a.correct and a.time_ms < 5000) >= 10 then
      perform app_private.award(v_pl.user_id, 'speed_demon');
    end if;
    if exists (
      select 1 from public.match_players a
      join public.match_players b on b.match_id = a.match_id and b.user_id <> a.user_id
      join public.matches mm on mm.id = a.match_id and mm.status = 'settled'
      where a.user_id = v_pl.user_id and app_private.are_friends(a.user_id, b.user_id)
      group by b.user_id having count(*) >= 25
    ) then
      perform app_private.award(v_pl.user_id, 'study_buddy');
    end if;
    perform app_private.check_referral(v_pl.user_id);
  end loop;

  -- Comeback King: the winner trailed someone by 300+ points after some question.
  if v_winner is not null then
    select exists (
      with cum as (
        select mp.user_id, g.j,
               (select coalesce(sum(a.points), 0) from public.match_answers a
                where a.match_id = p_match and a.user_id = mp.user_id and a.q_index <= g.j) as pts
        from public.match_players mp cross join generate_series(0, v_m.n - 1) as g(j)
        where mp.match_id = p_match
      )
      select 1 from cum w join cum o on o.j = w.j and o.user_id <> w.user_id
      where w.user_id = v_winner and o.pts - w.pts >= 300
    ) into v_trailed;
    if v_trailed then
      perform app_private.award(v_winner, 'comeback_king');
    end if;
  end if;

  update public.matches set pot = v_pot, settled_at = now() where id = p_match;
  update public.rooms
     set status = case when exists (select 1 from public.room_players rp where rp.room_id = v_m.room_id) then 'lobby' else 'closed' end,
         last_activity_at = now()
   where id = v_m.room_id and current_match_id = p_match;
  perform app_private.room_event(v_m.room_id, 'match_settled', jsonb_build_object('match_id', p_match));
end $$;

create or replace function public.match_result(p_match uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_m public.matches;
begin
  if not exists (select 1 from public.match_players mp where mp.match_id = p_match and mp.user_id = v_me) then
    raise exception 'not_in_match';
  end if;
  select * into v_m from public.matches where id = p_match;
  return jsonb_build_object(
    'match_id', v_m.id, 'status', v_m.status, 'stake', v_m.stake, 'pot', v_m.pot, 'n', v_m.n,
    'house_cut', v_m.house_cut, 'settled_at', v_m.settled_at, 'room_id', v_m.room_id,
    'room_code', (select r.code from public.rooms r where r.id = v_m.room_id),
    'room_status', (select r.status from public.rooms r where r.id = v_m.room_id),
    'me', v_me,
    'players', (
      select jsonb_agg(jsonb_build_object(
        'user_id', mp.user_id, 'name', pr.display_name, 'avatar', pr.avatar, 'level', pr.level,
        'score', mp.score, 'correct', mp.correct, 'answered', mp.answered, 'best_streak', mp.best_streak,
        'rank', mp.rank, 'payout', mp.payout, 'xp', mp.xp,
        'net', case when v_m.status = 'settled' then mp.payout - v_m.stake else 0 end
      ) order by mp.rank nulls last, mp.score desc)
      from public.match_players mp join public.profiles pr on pr.id = mp.user_id
      where mp.match_id = p_match),
    'balance', (select p.coins - p.escrow from public.profiles p where p.id = v_me),
    'level', (select p.level from public.profiles p where p.id = v_me),
    'achievements', coalesce((
      select jsonb_agg(jsonb_build_object('key', a.key, 'name_en', a.name_en, 'name_ta', a.name_ta,
                                          'icon', a.icon, 'coins', a.coins))
      from public.user_achievements ua join public.achievements a on a.key = ua.key
      where ua.user_id = v_me and ua.earned_at between v_m.started_at and coalesce(v_m.settled_at, now())), '[]'::jsonb)
  );
end $$;

create or replace function public.finish_match(p_match uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_m public.matches;
begin
  if not exists (select 1 from public.match_players mp where mp.match_id = p_match and mp.user_id = v_me) then
    raise exception 'not_in_match';
  end if;
  v_m := app_private.advance_match(p_match);
  if v_m.status = 'live' and app_private.match_phase(v_m, clock_timestamp()) = 'finished' then
    perform app_private.settle_match(p_match);
  end if;
  return public.match_result(p_match);
end $$;

create or replace function public.my_recent_matches(p_limit int default 20) returns jsonb
language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x.started_at desc), '[]'::jsonb) from (
    select m.id, m.started_at, m.status, m.stake, m.n, mp.rank, mp.score, mp.payout,
           (select count(*) from public.match_players o where o.match_id = m.id) as players
    from public.match_players mp join public.matches m on m.id = mp.match_id
    where mp.user_id = auth.uid()
    order by m.started_at desc
    limit least(coalesce(p_limit, 20), 50)
  ) x
$$;
