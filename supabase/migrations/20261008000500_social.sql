-- Friends, blocks, chat, reports, leaderboards, profile stats and the home screen.

create or replace function app_private.is_blocked(a uuid, b uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.blocks bl
    where (bl.blocker_id = a and bl.blocked_id = b) or (bl.blocker_id = b and bl.blocked_id = a)
  )
$$;

create or replace function app_private.dm_topic(a uuid, b uuid) returns text
language sql immutable set search_path = '' as $$
  select 'dm:' || least(a, b)::text || ':' || greatest(a, b)::text
$$;

-- Realtime authorization for 1:1 channels: "dm:<smaller uuid>:<larger uuid>".
create or replace function public.is_dm_peer(p_topic text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_topic, ':');
  v_a uuid;
  v_b uuid;
  v_me uuid := auth.uid();
begin
  if cardinality(v_parts) <> 3 or v_parts[1] <> 'dm' then
    return false;
  end if;
  begin
    v_a := v_parts[2]::uuid;
    v_b := v_parts[3]::uuid;
  exception when others then
    return false;
  end;
  return v_me is not null and v_a < v_b and v_me in (v_a, v_b) and not app_private.is_blocked(v_a, v_b);
end $$;

-- ---------------------------------------------------------------------------
-- Friends and blocks
-- ---------------------------------------------------------------------------

create or replace function public.search_users(p_q text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_q text := lower(btrim(coalesce(p_q, '')));
begin
  if char_length(v_q) < 2 then
    return '[]'::jsonb;
  end if;
  v_q := replace(replace(v_q, '%', ''), '_', '\_');
  return coalesce((
    select jsonb_agg(app_private.public_user(p.id) || jsonb_build_object(
             'friend_status', (select case when f.status = 'accepted' then 'friends'
                                           when f.requested_by = v_me then 'outgoing' else 'incoming' end
                               from public.friendships f
                               where f.user_a = least(v_me, p.id) and f.user_b = greatest(v_me, p.id))))
    from (
      select pr.id from public.profiles pr
      where pr.onboarded and pr.id <> v_me
        and (pr.username like v_q || '%' or lower(pr.display_name) like '%' || v_q || '%')
        and not app_private.is_blocked(v_me, pr.id)
      order by (pr.username like v_q || '%') desc, pr.level desc
      limit 20
    ) p), '[]'::jsonb);
end $$;

create or replace function public.friend_request(p_user uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_f public.friendships;
begin
  if p_user = v_me then raise exception 'bad_user'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_user and p.onboarded) then raise exception 'user_not_found'; end if;
  if app_private.is_blocked(v_me, p_user) then raise exception 'blocked'; end if;
  select * into v_f from public.friendships
  where user_a = least(v_me, p_user) and user_b = greatest(v_me, p_user) for update;
  if found then
    if v_f.status = 'accepted' then
      return 'friends';
    elsif v_f.requested_by <> v_me then
      update public.friendships set status = 'accepted', accepted_at = now()
       where user_a = v_f.user_a and user_b = v_f.user_b;
      return 'friends';
    end if;
    return 'outgoing';
  end if;
  if (select count(*) from public.friendships f
      where f.requested_by = v_me and f.status = 'pending' and f.created_at > now() - interval '1 day') >= 30 then
    raise exception 'rate_limited';
  end if;
  insert into public.friendships (user_a, user_b, status, requested_by)
  values (least(v_me, p_user), greatest(v_me, p_user), 'pending', v_me);
  return 'outgoing';
end $$;

create or replace function public.respond_friend(p_user uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
begin
  if p_accept then
    update public.friendships set status = 'accepted', accepted_at = now()
     where user_a = least(v_me, p_user) and user_b = greatest(v_me, p_user)
       and status = 'pending' and requested_by = p_user;
    if not found then raise exception 'no_request'; end if;
    return 'friends';
  end if;
  delete from public.friendships
   where user_a = least(v_me, p_user) and user_b = greatest(v_me, p_user) and status = 'pending';
  return 'none';
end $$;

create or replace function public.remove_friend(p_user uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.friendships
  where user_a = least(auth.uid(), p_user) and user_b = greatest(auth.uid(), p_user)
$$;

create or replace function public.block_user(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
begin
  if p_user = v_me then raise exception 'bad_user'; end if;
  insert into public.blocks (blocker_id, blocked_id) values (v_me, p_user) on conflict do nothing;
  delete from public.friendships where user_a = least(v_me, p_user) and user_b = greatest(v_me, p_user);
end $$;

create or replace function public.unblock_user(p_user uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.blocks where blocker_id = auth.uid() and blocked_id = p_user
$$;

create or replace function public.list_friends() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_wk date := app_private.week_start(app_private.ist_today());
begin
  update public.profiles set last_active_at = now() where id = v_me;
  return jsonb_build_object(
    'friends', coalesce((
      select jsonb_agg(app_private.public_user(o.id) || jsonb_build_object(
               'online', p.last_active_at > now() - interval '5 minutes',
               'last_active_at', p.last_active_at,
               'week_xp', coalesce((select ws.xp from public.weekly_stats ws
                                    where ws.user_id = o.id and ws.week_start = v_wk and ws.unit = '*'), 0),
               'unread', (select count(*) from public.chat_messages c
                          where c.sender_id = o.id and c.recipient_id = v_me and c.read_at is null))
             order by p.last_active_at desc)
      from (select case when f.user_a = v_me then f.user_b else f.user_a end as id
            from public.friendships f
            where (f.user_a = v_me or f.user_b = v_me) and f.status = 'accepted') o
      join public.profiles p on p.id = o.id), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(app_private.public_user(f.requested_by))
      from public.friendships f
      where (f.user_a = v_me or f.user_b = v_me) and f.status = 'pending' and f.requested_by <> v_me), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(app_private.public_user(case when f.user_a = v_me then f.user_b else f.user_a end))
      from public.friendships f
      where (f.user_a = v_me or f.user_b = v_me) and f.status = 'pending' and f.requested_by = v_me), '[]'::jsonb),
    'blocked', coalesce((
      select jsonb_agg(app_private.public_user(b.blocked_id))
      from public.blocks b where b.blocker_id = v_me), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Chat. Text goes through these functions (moderation, rate limit, mutes);
-- emoji reactions and quick phrases are fixed sets broadcast by the clients.
-- ---------------------------------------------------------------------------

create or replace function app_private.check_chat(p_user uuid, p_body text) returns void
language plpgsql stable set search_path = '' as $$
declare
  v_err text;
begin
  if exists (select 1 from public.profiles p where p.id = p_user and p.chat_muted_until > now()) then
    raise exception 'chat_muted';
  end if;
  if (select count(*) from public.chat_messages c
      where c.sender_id = p_user and c.created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'rate_limited';
  end if;
  v_err := app_private.moderate(p_body);
  if v_err is not null then
    raise exception '%', v_err;
  end if;
end $$;

create or replace function app_private.message_json(c public.chat_messages) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'room_id', c.room_id, 'sender_id', c.sender_id, 'recipient_id', c.recipient_id,
    'kind', c.kind, 'body', c.body, 'meta', c.meta, 'created_at', c.created_at, 'read_at', c.read_at,
    'sender_name', (select p.display_name from public.profiles p where p.id = c.sender_id),
    'sender_avatar', (select p.avatar from public.profiles p where p.id = c.sender_id))
$$;

-- Lobby and result screen only; during a match chat is emoji-only.
create or replace function public.send_room_chat(p_room uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_c public.chat_messages;
begin
  if not exists (select 1 from public.room_players rp where rp.room_id = p_room and rp.user_id = v_me) then
    raise exception 'not_member';
  end if;
  if (select r.status from public.rooms r where r.id = p_room) <> 'lobby' then
    raise exception 'chat_closed';
  end if;
  perform app_private.check_chat(v_me, p_body);
  insert into public.chat_messages (room_id, sender_id, body) values (p_room, v_me, btrim(p_body))
  returning * into v_c;
  perform app_private.room_event(p_room, 'chat', app_private.message_json(v_c));
  return app_private.message_json(v_c);
end $$;

create or replace function public.room_chat_history(p_room uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
begin
  if not exists (select 1 from public.room_players rp where rp.room_id = p_room and rp.user_id = v_me) then
    raise exception 'not_member';
  end if;
  return coalesce((
    select jsonb_agg(app_private.message_json(c) order by c.id)
    from (select * from public.chat_messages c
          where c.room_id = p_room and not app_private.is_blocked(v_me, c.sender_id)
          order by c.id desc limit 40) c), '[]'::jsonb);
end $$;

create or replace function public.send_dm(p_to uuid, p_body text, p_kind text default 'text') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_c public.chat_messages;
  v_room public.rooms;
  v_body text := btrim(coalesce(p_body, ''));
  v_meta jsonb;
begin
  if p_to = v_me then raise exception 'bad_user'; end if;
  if app_private.is_blocked(v_me, p_to) then raise exception 'blocked'; end if;
  if not app_private.are_friends(v_me, p_to)
     and not coalesce((select p.allow_stranger_chat from public.profiles p where p.id = p_to), false) then
    raise exception 'not_friends';
  end if;
  if p_kind = 'invite' then
    -- Room invite card: the body is the room code of a lobby the sender is in.
    select r.* into v_room from public.rooms r
    join public.room_players rp on rp.room_id = r.id and rp.user_id = v_me
    where r.code = upper(v_body) and r.status = 'lobby';
    if not found then raise exception 'room_not_found'; end if;
    v_meta := jsonb_build_object('code', v_room.code, 'stake', v_room.stake, 'size', v_room.size,
                                 'subject', v_room.subject, 'count', v_room.question_count);
    v_body := v_room.code;
    if (select count(*) from public.chat_messages c
        where c.sender_id = v_me and c.created_at > now() - interval '10 seconds') >= 5 then
      raise exception 'rate_limited';
    end if;
  elsif p_kind = 'text' then
    perform app_private.check_chat(v_me, v_body);
  else
    raise exception 'bad_kind';
  end if;
  insert into public.chat_messages (sender_id, recipient_id, kind, body, meta)
  values (v_me, p_to, p_kind, v_body, v_meta)
  returning * into v_c;
  begin
    perform realtime.send(app_private.message_json(v_c), 'dm', app_private.dm_topic(v_me, p_to), true);
  exception when others then
    raise warning 'realtime.send failed: %', sqlerrm;
  end;
  return app_private.message_json(v_c);
end $$;

create or replace function public.dm_history(p_peer uuid, p_before bigint default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
begin
  if app_private.is_blocked(v_me, p_peer) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(app_private.message_json(c) order by c.id)
    from (select * from public.chat_messages c
          where least(c.sender_id, c.recipient_id) = least(v_me, p_peer)
            and greatest(c.sender_id, c.recipient_id) = greatest(v_me, p_peer)
            and c.recipient_id is not null
            and (p_before is null or c.id < p_before)
          order by c.id desc limit 50) c), '[]'::jsonb);
end $$;

create or replace function public.mark_dm_read(p_peer uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
begin
  update public.chat_messages set read_at = now()
   where sender_id = p_peer and recipient_id = v_me and read_at is null;
  if found then
    begin
      perform realtime.send(jsonb_build_object('reader', v_me, 'at', now()), 'read', app_private.dm_topic(v_me, p_peer), true);
    exception when others then
      raise warning 'realtime.send failed: %', sqlerrm;
    end;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

create or replace function public.report_question(p_question bigint, p_reason text, p_details text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
begin
  if not exists (select 1 from public.user_question_history h where h.user_id = v_me and h.question_id = p_question) then
    raise exception 'not_seen';
  end if;
  if exists (select 1 from public.reports r where r.reporter_id = v_me and r.question_id = p_question and r.status = 'open') then
    return;
  end if;
  insert into public.reports (reporter_id, kind, question_id, reason, details)
  values (v_me, 'question', p_question, left(coalesce(p_reason, 'other'), 40), left(p_details, 500));
  update public.questions set report_count = report_count + 1 where id = p_question;
end $$;

create or replace function public.report_message(p_message bigint, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_c public.chat_messages;
begin
  select * into v_c from public.chat_messages where id = p_message;
  if not found then raise exception 'not_found'; end if;
  if not (v_c.recipient_id = v_me
          or exists (select 1 from public.room_players rp where rp.room_id = v_c.room_id and rp.user_id = v_me)) then
    raise exception 'not_found';
  end if;
  insert into public.reports (reporter_id, kind, message_id, message_body, target_user_id, reason)
  values (v_me, 'message', v_c.id, v_c.body, v_c.sender_id, left(coalesce(p_reason, 'other'), 40));
end $$;

create or replace function public.report_user(p_user uuid, p_reason text, p_details text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
begin
  if p_user = v_me then raise exception 'bad_user'; end if;
  insert into public.reports (reporter_id, kind, target_user_id, reason, details)
  values (v_me, 'user', p_user, left(coalesce(p_reason, 'other'), 40), left(p_details, 500));
end $$;

-- ---------------------------------------------------------------------------
-- Leaderboards (weekly). p_scope: friends | district | state.
-- p_unit '*' ranks by XP; a unit key ranks by correct answers in that unit.
-- ---------------------------------------------------------------------------

create or replace function public.leaderboard(p_scope text default 'friends', p_unit text default '*', p_week date default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_wk date := coalesce(p_week, app_private.week_start(app_private.ist_today()));
  v_district text;
  v_out jsonb;
begin
  select district into v_district from public.profiles where id = v_me;
  with members as (
    select p.id from public.profiles p
    where p.onboarded and (
      p_scope = 'state'
      or (p_scope = 'district' and p.district = v_district)
      or (p_scope = 'friends' and (p.id = v_me or app_private.are_friends(v_me, p.id))))
  ),
  board as (
    select m.id as user_id,
           coalesce(case when p_unit = '*' then ws.xp else ws.correct end, 0) as value,
           coalesce(ws.answered, 0) as answered
    from members m
    left join public.weekly_stats ws on ws.user_id = m.id and ws.week_start = v_wk and ws.unit = p_unit
    where p_scope = 'friends' or ws.user_id is not null
  ),
  ranked as (
    select b.*, rank() over (order by b.value desc) as rk from board b
  )
  select jsonb_build_object(
    'week', v_wk, 'scope', p_scope, 'unit', p_unit,
    'total', (select count(*) from ranked),
    'top', coalesce((select jsonb_agg(jsonb_build_object('rank', r.rk, 'value', r.value,
                                                         'user', app_private.public_user(r.user_id),
                                                         'me', r.user_id = v_me) order by r.rk, r.user_id)
                     from (select * from ranked order by rk limit 50) r), '[]'::jsonb),
    'me', (select jsonb_build_object('rank', r.rk, 'value', r.value) from ranked r where r.user_id = v_me)
  ) into v_out;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- Profile and home
-- ---------------------------------------------------------------------------

create or replace function public.my_stats() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
begin
  return jsonb_build_object(
    'units', coalesce((
      select jsonb_agg(jsonb_build_object('unit', u.key, 'answered', coalesce(s.answered, 0),
                                          'correct', coalesce(s.correct, 0), 'rating', s.rating)
                       order by u.sort)
      from public.units u
      left join public.user_unit_stats s on s.user_id = v_me and s.unit = u.key), '[]'::jsonb),
    'weak', coalesce((
      select jsonb_agg(w) from (
        select st.unit, st.subtopic, st.answered, st.correct
        from public.user_subtopic_stats st
        where st.user_id = v_me and st.answered >= 3
        order by st.correct::numeric / st.answered, st.answered desc
        limit 3) w), '[]'::jsonb),
    'achievements', (
      select jsonb_agg(jsonb_build_object('key', a.key, 'name_en', a.name_en, 'name_ta', a.name_ta,
                                          'desc_en', a.desc_en, 'desc_ta', a.desc_ta, 'icon', a.icon,
                                          'coins', a.coins, 'earned_at', ua.earned_at) order by a.sort)
      from public.achievements a
      left join public.user_achievements ua on ua.key = a.key and ua.user_id = v_me),
    'matches', (select count(*) from public.match_players mp join public.matches m on m.id = mp.match_id
                where mp.user_id = v_me and m.status = 'settled'),
    'wins', (select count(*) from public.match_players mp join public.matches m on m.id = mp.match_id
             where mp.user_id = v_me and m.status = 'settled' and mp.rank = 1),
    'solo_sets', (select count(*) from public.solo_sessions s
                  where s.user_id = v_me and s.finished_at is not null and s.mode <> 'demo'),
    'revision_cards', (select count(*) from public.revision_cards rc where rc.user_id = v_me)
  );
end $$;

create or replace function public.home_summary() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_p public.profiles;
  v_day date := app_private.ist_today();
  v_daily public.solo_sessions;
begin
  update public.profiles set last_active_at = now() where id = v_me returning * into v_p;
  select * into v_daily from public.solo_sessions s
  where s.user_id = v_me and s.mode = 'daily' and s.daily_date = v_day;
  return jsonb_build_object(
    'profile', to_jsonb(v_p) - 'referred_by',
    'available', v_p.coins - v_p.escrow,
    'streak_today', v_p.streak_last_date = v_day,
    'streak_alive', v_p.streak_last_date >= v_day - 1
                    or (v_p.streak_last_date = v_day - 2 and v_p.shields > 0),
    'daily', jsonb_build_object(
      'played', v_daily.id is not null,
      'finished', v_daily.finished_at is not null,
      'session_id', v_daily.id,
      'score', v_daily.score,
      'players', (select count(*) from public.solo_sessions s
                  where s.mode = 'daily' and s.daily_date = v_day and s.finished_at is not null)),
    'revision_due', (select count(*) from public.revision_cards rc where rc.user_id = v_me and rc.due_at <= now()),
    'mock_active', (select s.id from public.solo_sessions s
                    where s.user_id = v_me and s.mode = 'mock' and s.finished_at is null
                    order by s.started_at desc limit 1),
    'mock_done_this_week', exists (
      select 1 from public.coin_ledger l where l.user_id = v_me and l.reason = 'mock'
        and l.created_at >= app_private.ist_start(app_private.week_start(v_day))),
    'active_room', (
      select jsonb_build_object('id', r.id, 'code', r.code, 'status', r.status, 'match_id', r.current_match_id)
      from public.room_players rp join public.rooms r on r.id = rp.room_id
      where rp.user_id = v_me and r.status <> 'closed'
      order by rp.joined_at desc limit 1),
    'live_match', (
      select m.id from public.match_players mp join public.matches m on m.id = mp.match_id
      where mp.user_id = v_me and m.status = 'live' order by m.started_at desc limit 1),
    'friends_online', coalesce((
      select jsonb_agg(app_private.public_user(o.id))
      from (select case when f.user_a = v_me then f.user_b else f.user_a end as id
            from public.friendships f
            where (f.user_a = v_me or f.user_b = v_me) and f.status = 'accepted') o
      join public.profiles p on p.id = o.id
      where p.last_active_at > now() - interval '5 minutes'
      limit 8), '[]'::jsonb),
    'friend_requests', (select count(*) from public.friendships f
                        where (f.user_a = v_me or f.user_b = v_me) and f.status = 'pending' and f.requested_by <> v_me),
    'refill_available', v_p.escrow = 0 and v_p.coins < app_private.num('refill_threshold')
                        and (v_p.last_refill_at is null or v_p.last_refill_at < now() - interval '24 hours'),
    'solo_coins_today', app_private.solo_coins_today(v_me),
    'solo_coin_cap', app_private.num('solo_daily_coin_cap'),
    'week_xp', coalesce((select ws.xp from public.weekly_stats ws
                         where ws.user_id = v_me and ws.week_start = app_private.week_start(v_day) and ws.unit = '*'), 0),
    'next_exam_date', app_private.setting('next_exam_date') #>> '{}',
    'stake_tiers', app_private.setting('stake_tiers'),
    'four_player_level', app_private.num('four_player_level'),
    'server_now', clock_timestamp()
  );
end $$;

create or replace function public.public_profile(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
begin
  if app_private.is_blocked(v_me, p_user) then
    raise exception 'user_not_found';
  end if;
  return app_private.public_user(p_user) || jsonb_build_object(
    'friend_status', (select case when f.status = 'accepted' then 'friends'
                                  when f.requested_by = v_me then 'outgoing' else 'incoming' end
                      from public.friendships f
                      where f.user_a = least(v_me, p_user) and f.user_b = greatest(v_me, p_user)),
    'badges', coalesce((select jsonb_agg(a.icon order by a.sort)
                        from public.user_achievements ua join public.achievements a on a.key = ua.key
                        where ua.user_id = p_user), '[]'::jsonb),
    'room_win_streak', (select p.room_win_streak from public.profiles p where p.id = p_user),
    'head_to_head', jsonb_build_object(
      'played', (select count(*) from public.match_players a
                 join public.match_players b on b.match_id = a.match_id and b.user_id = p_user
                 join public.matches m on m.id = a.match_id and m.status = 'settled'
                 where a.user_id = v_me),
      'my_wins', (select count(*) from public.match_players a
                  join public.match_players b on b.match_id = a.match_id and b.user_id = p_user
                  join public.matches m on m.id = a.match_id and m.status = 'settled'
                  where a.user_id = v_me and a.rank < b.rank))
  );
end $$;
