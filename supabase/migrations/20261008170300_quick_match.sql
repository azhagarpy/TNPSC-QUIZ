-- Quick Match (plan: core game modes): a random online opponent of similar
-- level, fixed 50-coin entry. The client calls quick_match() every ~2 s while
-- searching; the level gap widens the longer either player waits. Only players
-- polled in the last 8 s are matched, so nobody is paired with a closed tab.
-- With nobody around, the app offers a clearly labelled practice bot with no
-- stakes (client side, runs as a normal practice set).

insert into public.app_settings (key, value, note) values
  ('quick_stake',     '50', 'Entry coins for Quick Match'),
  ('quick_level_gap', '3',  'Starting level gap for Quick Match; +1 for every 10 s of waiting')
on conflict (key) do nothing;

create table public.quick_queue (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  level        int not null,
  language     text not null,
  joined_at    timestamptz not null default now(),
  last_poll_at timestamptz not null default now(),
  match_id     uuid
);
alter table public.quick_queue enable row level security;
revoke insert, update, delete, truncate on public.quick_queue from anon, authenticated;

create or replace function app_private.check_can_stake(p_user uuid, p_stake int) returns void
language plpgsql stable set search_path = '' as $$
declare
  v_p public.profiles;
  v_staked int;
begin
  select * into v_p from public.profiles where id = p_user;
  if not v_p.onboarded then raise exception 'not_onboarded'; end if;
  if v_p.coins - v_p.escrow < p_stake then raise exception 'insufficient_coins'; end if;
  if p_stake > 0 and v_p.stakes_frozen then raise exception 'stakes_frozen'; end if;
  if app_private.in_live_match(p_user) then raise exception 'in_match'; end if;
  select coalesce(sum(m.stake), 0) into v_staked
  from public.match_players mp join public.matches m on m.id = mp.match_id
  where mp.user_id = p_user and m.status <> 'refunded'
    and m.started_at >= app_private.ist_start(app_private.ist_today());
  if v_staked + p_stake > app_private.num('daily_stake_cap') then
    raise exception 'daily_stake_cap';
  end if;
end $$;

create or replace function public.quick_match() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_p public.profiles;
  v_q public.quick_queue;
  v_opp public.quick_queue;
  v_stake int := app_private.num('quick_stake')::int;
  v_wait numeric := 0;
  v_room uuid;
  v_match uuid;
  v_other record;
begin
  select * into v_q from public.quick_queue where user_id = v_me for update;
  if found then
    if v_q.match_id is not null then
      delete from public.quick_queue where user_id = v_me;
      return jsonb_build_object('status', 'matched', 'match_id', v_q.match_id);
    end if;
    v_wait := extract(epoch from now() - v_q.joined_at);
  end if;
  perform app_private.check_can_stake(v_me, v_stake);
  select * into v_p from public.profiles where id = v_me;

  select * into v_opp from public.quick_queue o
  where o.user_id <> v_me and o.match_id is null
    and o.last_poll_at > now() - interval '8 seconds'
    and abs(o.level - v_p.level)
        <= app_private.num('quick_level_gap') + floor(greatest(v_wait, extract(epoch from now() - o.joined_at)) / 10)
    and not app_private.is_blocked(v_me, o.user_id)
  order by o.joined_at
  limit 1
  for update skip locked;

  if found then
    begin
      for v_other in select rp.room_id, rp.user_id from public.room_players rp where rp.user_id in (v_me, v_opp.user_id) loop
        perform app_private.leave_room(v_other.room_id, v_other.user_id);
      end loop;
      loop
        begin
          insert into public.rooms (code, host_id, size, stake, subject, question_count, language, powerups)
          values (app_private.new_room_code(), v_opp.user_id, 2, v_stake, 'mixed', 10,
                  case when v_p.language = 'en' and v_opp.language = 'en' then 'en' else 'ta' end, true)
          returning id into v_room;
          exit;
        exception when unique_violation then
          -- code clash: draw another
        end;
      end loop;
      insert into public.room_players (room_id, user_id, seat, ready)
      values (v_room, v_opp.user_id, 0, true), (v_room, v_me, 1, true);
      v_match := app_private.begin_match(v_room);
      update public.quick_queue set match_id = v_match where user_id = v_opp.user_id;
      delete from public.quick_queue where user_id = v_me;
      return jsonb_build_object('status', 'matched', 'match_id', v_match);
    exception when others then
      -- The opponent can no longer play (coins, daily cap, another match): drop them, keep searching.
      delete from public.quick_queue where user_id = v_opp.user_id;
    end;
  end if;

  insert into public.quick_queue (user_id, level, language) values (v_me, v_p.level, v_p.language)
  on conflict (user_id) do update set last_poll_at = now(), level = excluded.level;
  return jsonb_build_object('status', 'waiting', 'waited_s', floor(v_wait),
                            'searching', (select count(*) from public.quick_queue q
                                          where q.match_id is null and q.last_poll_at > now() - interval '8 seconds'));
end $$;

create or replace function public.quick_match_cancel() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_match uuid;
begin
  delete from public.quick_queue where user_id = app_private.uid() returning match_id into v_match;
  -- Matched in the last instant: hand the match back instead of dropping it.
  return case when v_match is not null then jsonb_build_object('status', 'matched', 'match_id', v_match)
              else jsonb_build_object('status', 'cancelled') end;
end $$;
