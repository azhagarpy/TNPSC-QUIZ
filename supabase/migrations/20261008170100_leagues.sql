-- Weekly leagues (plan: Gamification → Leaderboards). Groups of up to 30 per
-- tier: Bronze → Silver → Gold → Diamond → Champion. A player joins a group in
-- their tier the first time they earn XP in an IST week. At 00:10 IST on Monday
-- the top of each group moves up, the bottom moves down, and the top 3 of
-- groups with at least 10 players earn coins.

insert into public.app_settings (key, value, note) values
  ('league_group_size', '30',            'Players per weekly league group'),
  ('league_move',       '5',             'Promoted and relegated per group (at most a third of a small group)'),
  ('league_rewards',    '[200,150,100]', 'Coins for 1st/2nd/3rd in a group'),
  ('league_reward_min', '10',            'Minimum group size for league coin rewards')
on conflict (key) do nothing;

create table public.league_groups (
  id         bigint generated always as identity primary key,
  week_start date not null,
  tier       smallint not null check (tier between 0 and 4),
  created_at timestamptz not null default now()
);
create index league_groups_week_idx on public.league_groups (week_start, tier);

create table public.league_members (
  week_start date not null,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  group_id   bigint not null references public.league_groups (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (week_start, user_id)
);
create index league_members_group_idx on public.league_members (group_id);

create table public.league_results (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  week_start  date not null,
  tier_before smallint not null,
  tier_after  smallint not null,
  rank        int not null,
  group_size  int not null,
  xp          int not null,
  coins       int not null default 0,
  seen        boolean not null default false,
  primary key (user_id, week_start)
);

alter table public.league_groups  enable row level security;
alter table public.league_members enable row level security;
alter table public.league_results enable row level security;
revoke insert, update, delete, truncate on public.league_groups, public.league_members, public.league_results from anon, authenticated;

create or replace function app_private.league_moves(p_n int) returns int
language sql stable set search_path = '' as $$
  select least(app_private.num('league_move')::int, p_n / 3)
$$;

create or replace function app_private.ensure_league(p_user uuid) returns bigint
language plpgsql set search_path = '' as $$
declare
  v_wk date := app_private.week_start(app_private.ist_today());
  v_tier smallint;
  v_group bigint;
begin
  select lm.group_id into v_group from public.league_members lm where lm.week_start = v_wk and lm.user_id = p_user;
  if found then
    return v_group;
  end if;
  select p.league_tier into v_tier from public.profiles p where p.id = p_user;
  -- One filler at a time per (week, tier), so a group never passes the size.
  perform pg_advisory_xact_lock(hashtext('league:' || v_wk || ':' || v_tier));
  select g.id into v_group
  from public.league_groups g
  where g.week_start = v_wk and g.tier = v_tier
    and (select count(*) from public.league_members m where m.group_id = g.id) < app_private.num('league_group_size')
  order by g.id
  limit 1;
  if v_group is null then
    insert into public.league_groups (week_start, tier) values (v_wk, v_tier) returning id into v_group;
  end if;
  insert into public.league_members (week_start, user_id, group_id) values (v_wk, p_user, v_group)
  on conflict do nothing;
  return v_group;
end $$;

-- Same as before, plus: earning XP puts the player in this week's league.
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
  perform app_private.ensure_league(p_user);
  return jsonb_build_object('xp', p_xp, 'level', new_level, 'level_up', new_level > old_level, 'level_coins', reward);
end $$;

create or replace function app_private.league_standings(p_group bigint, p_week date)
returns table (user_id uuid, xp int, rn bigint)
language sql stable set search_path = '' as $$
  select m.user_id, coalesce(ws.xp, 0),
         row_number() over (order by coalesce(ws.xp, 0) desc, m.joined_at)
  from public.league_members m
  left join public.weekly_stats ws on ws.user_id = m.user_id and ws.week_start = p_week and ws.unit = '*'
  where m.group_id = p_group
$$;

create or replace function public.my_league() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_wk date := app_private.week_start(app_private.ist_today());
  v_tier smallint;
  v_group bigint;
  v_n int;
  v_move int;
  v_last jsonb;
begin
  select league_tier into v_tier from public.profiles where id = v_me;
  select to_jsonb(r) into v_last from (
    select * from public.league_results lr where lr.user_id = v_me and not lr.seen order by lr.week_start desc limit 1
  ) r;
  select lm.group_id into v_group from public.league_members lm where lm.week_start = v_wk and lm.user_id = v_me;
  if v_group is null then
    return jsonb_build_object('tier', v_tier, 'joined', false, 'week', v_wk,
                              'ends_at', app_private.ist_start(v_wk + 7), 'last_result', v_last);
  end if;
  select count(*) into v_n from public.league_members lm where lm.group_id = v_group;
  v_move := app_private.league_moves(v_n);
  return jsonb_build_object(
    'tier', v_tier, 'joined', true, 'week', v_wk, 'ends_at', app_private.ist_start(v_wk + 7),
    'group_size', v_n,
    'promote', case when v_tier < 4 then v_move else 0 end,
    'demote', case when v_tier > 0 then v_move else 0 end,
    'rewards', app_private.setting('league_rewards'),
    'reward_min', app_private.num('league_reward_min'),
    'last_result', v_last,
    'members', (
      select jsonb_agg(jsonb_build_object('rank', s.rn, 'xp', s.xp, 'me', s.user_id = v_me,
                                          'user', app_private.public_user(s.user_id)) order by s.rn)
      from app_private.league_standings(v_group, v_wk) s)
  );
end $$;

create or replace function public.league_seen() returns void
language sql security definer set search_path = '' as $$
  update public.league_results set seen = true where user_id = auth.uid() and not seen
$$;

create or replace function app_private.settle_leagues(p_week date) returns int
language plpgsql set search_path = '' as $$
declare
  v_g record;
  v_m record;
  v_n int;
  v_move int;
  v_after smallint;
  v_coins int;
  v_rewards jsonb := app_private.setting('league_rewards');
  v_min int := app_private.num('league_reward_min')::int;
  v_count int := 0;
begin
  for v_g in
    select g.id, g.tier from public.league_groups g
    where g.week_start = p_week
      and not exists (select 1 from public.league_results r
                      join public.league_members m on m.user_id = r.user_id and m.week_start = r.week_start
                      where m.group_id = g.id and r.week_start = p_week)
  loop
    select count(*) into v_n from public.league_members m where m.group_id = v_g.id;
    v_move := app_private.league_moves(v_n);
    for v_m in select * from app_private.league_standings(v_g.id, p_week) loop
      v_after := case
        when v_m.rn <= v_move and v_g.tier < 4 then v_g.tier + 1
        when v_m.rn > v_n - v_move and v_g.tier > 0 then v_g.tier - 1
        else v_g.tier end;
      v_coins := case when v_n >= v_min and v_m.rn <= jsonb_array_length(v_rewards)
                      then (v_rewards ->> (v_m.rn - 1)::int)::int else 0 end;
      update public.profiles set league_tier = v_after where id = v_m.user_id;
      if v_coins > 0 then
        perform app_private.post_coins(v_m.user_id, v_coins, 'league', null, 'league:' || p_week);
      end if;
      insert into public.league_results (user_id, week_start, tier_before, tier_after, rank, group_size, xp, coins)
      values (v_m.user_id, p_week, v_g.tier, v_after, v_m.rn, v_n, v_m.xp, v_coins)
      on conflict do nothing;
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end $$;

-- Monday 00:10 IST: settle the week that just ended.
create or replace function app_private.cron_weekly() returns int
language sql set search_path = '' as $$
  select app_private.settle_leagues(app_private.week_start(app_private.ist_today()) - 7)
$$;
