-- Solo play: practice, daily challenge, weekly mock, revision deck, demo quiz,
-- offline packs. Plus onboarding and the coin faucets tied to them.

create or replace function app_private.lang_ok(p_unit text, p_ta text, p_en text, p_lang text) returns boolean
language sql immutable set search_path = '' as $$
  select case
    when p_unit = 'tamil' then p_ta is not null          -- Part A is Tamil only
    when p_lang = 'ta'    then p_ta is not null
    when p_lang = 'en'    then p_en is not null
    else p_ta is not null and p_en is not null            -- 'both': daily challenge
  end
$$;

-- Split N questions across units by exam weight. Largest remainder across the
-- three parts (Tamil 50 %, GS 37.5 %, Aptitude 12.5 %); inside a part the floors
-- go by unit weight and the leftover seats are drawn at random in proportion to
-- the remainders, so small units (e.g. Science) still show up over many matches.
create or replace function app_private.quotas(p_n int, p_subject text)
returns table (unit text, k int)
language plpgsql volatile set search_path = '' as $$
declare
  v_part record;
begin
  if p_subject is not null and p_subject <> 'mixed' then
    unit := p_subject;
    k := p_n;
    return next;
    return;
  end if;
  for v_part in
    with parts as (
      select u.part, sum(u.exam_weight)::numeric as w
      from public.units u where u.exam_weight > 0 group by u.part
    ),
    tot as (select sum(parts.w) as total from parts),
    b as (
      select parts.part,
             floor(p_n * parts.w / tot.total)::int as base,
             p_n * parts.w / tot.total - floor(p_n * parts.w / tot.total) as rem
      from parts, tot
    ),
    lo as (select p_n - sum(b.base)::int as n_left from b)
    select b.part, b.base + case when row_number() over (order by b.rem desc, b.part) <= lo.n_left then 1 else 0 end as quota
    from b, lo
  loop
    continue when v_part.quota <= 0;
    return query
      with w as (
        select u.key, u.exam_weight::numeric as wt
        from public.units u where u.part = v_part.part and u.exam_weight > 0
      ),
      tot as (select sum(w.wt) as total from w),
      b as (
        select w.key,
               floor(v_part.quota * w.wt / tot.total)::int as base,
               (v_part.quota * w.wt / tot.total - floor(v_part.quota * w.wt / tot.total))::float8 as rem
        from w, tot
      ),
      lo as (select v_part.quota - sum(b.base)::int as n_left from b),
      r as (
        select b.*, row_number() over (
          order by case when b.rem > 0 then ln(1 - random()) / b.rem else '-infinity'::float8 end desc
        ) as rn
        from b
      )
      select r.key, (r.base + case when r.rn <= lo.n_left then 1 else 0 end)::int
      from r, lo
      where r.base + case when r.rn <= lo.n_left then 1 else 0 end > 0;
  end loop;
end $$;

-- Solo picks favour weak sub-topics and due revision cards (rooms favour fresh
-- questions instead; see select_room_questions).
create or replace function app_private.pick_solo(
  p_user uuid, p_subject text, p_subtopic text, p_n int,
  p_dmin numeric, p_dmax numeric, p_lang text, p_use_revision boolean, p_ordered boolean
) returns bigint[]
language plpgsql volatile set search_path = '' as $$
declare
  v_quota record;
  v_chosen bigint[] := '{}';
  v_got bigint[];
  v_need int;
  v_pass int;
begin
  for v_quota in select * from app_private.quotas(p_n, coalesce(p_subject, 'mixed')) loop
    v_need := v_quota.k;
    if p_use_revision then
      select coalesce(array_agg(s.id), '{}') into v_got from (
        select rc.question_id as id
        from public.revision_cards rc
        join public.questions q on q.id = rc.question_id
        where rc.user_id = p_user and rc.due_at <= now()
          and q.unit = v_quota.unit and q.status = 'live'
          and (p_subtopic is null or q.subtopic = p_subtopic)
          and app_private.lang_ok(q.unit, q.text_ta, q.text_en, p_lang)
        order by rc.due_at
        limit least(2, v_need)
      ) s;
      v_chosen := v_chosen || v_got;
      v_need := v_need - cardinality(v_got);
    end if;
    -- Pass 1: in band, not seen for 2 days. Pass 2: any difficulty. Pass 3: anything.
    v_pass := 1;
    while v_need > 0 and v_pass <= 3 loop
      select coalesce(array_agg(s.id), '{}') into v_got from (
        select q.id
        from public.questions q
        left join public.user_question_history h on h.user_id = p_user and h.question_id = q.id
        left join public.user_subtopic_stats st on st.user_id = p_user and st.unit = q.unit and st.subtopic = q.subtopic
        where q.unit = v_quota.unit and q.status = 'live'
          and (p_subtopic is null or q.subtopic = p_subtopic)
          and app_private.lang_ok(q.unit, q.text_ta, q.text_en, p_lang)
          and not (q.id = any(v_chosen))
          and (v_pass >= 2 or q.difficulty between p_dmin and p_dmax)
          and (v_pass >= 3 or h.last_seen_at is null or h.last_seen_at < now() - interval '2 days')
        order by ln(1 - random()) / (
          (case when h.last_seen_at is null then 1.0
                else greatest(0.05, least(1.0, extract(epoch from now() - h.last_seen_at) / 86400.0 / 30)) end)
          * (1 + case when st.answered >= 3 then 1 - st.correct::numeric / st.answered else 0.5 end)
        )::float8 desc
        limit v_need
      ) s;
      v_chosen := v_chosen || v_got;
      v_need := v_need - cardinality(v_got);
      v_pass := v_pass + 1;
    end loop;
  end loop;

  if cardinality(v_chosen) < p_n and p_subtopic is null then
    select v_chosen || coalesce(array_agg(s.id), '{}') into v_chosen from (
      select q.id from public.questions q
      where q.status = 'live'
        and (p_subject is null or p_subject = 'mixed' or q.unit = p_subject)
        and app_private.lang_ok(q.unit, q.text_ta, q.text_en, p_lang)
        and not (q.id = any(v_chosen))
      order by random()
      limit p_n - cardinality(v_chosen)
    ) s;
  end if;

  if p_ordered then
    return (
      select coalesce(array_agg(x.id order by u.sort, random()), '{}')
      from unnest(v_chosen) as x(id)
      join public.questions q on q.id = x.id
      join public.units u on u.key = q.unit
    );
  end if;
  return (select coalesce(array_agg(x.id order by random()), '{}') from unnest(v_chosen) as x(id));
end $$;

-- The daily challenge: same 15 questions for everyone on an IST day.
create or replace function app_private.ensure_daily(p_day date) returns bigint[]
language plpgsql volatile set search_path = '' as $$
declare
  v_ids bigint[];
  v_recent bigint[];
  v_got bigint[];
  v_quota record;
begin
  select dc.question_ids into v_ids from public.daily_challenges dc where dc.day = p_day;
  if found then
    return v_ids;
  end if;
  select coalesce(array_agg(x.id), '{}') into v_recent
  from public.daily_challenges dc, unnest(dc.question_ids) as x(id)
  where dc.day > p_day - 60;

  v_ids := '{}';
  for v_quota in select * from app_private.quotas(15, 'mixed') loop
    select coalesce(array_agg(s.id), '{}') into v_got from (
      select q.id from public.questions q
      where q.unit = v_quota.unit and q.status = 'live'
        and app_private.lang_ok(q.unit, q.text_ta, q.text_en, 'both')
        and not (q.id = any(v_recent)) and not (q.id = any(v_ids))
      order by (q.difficulty between 2 and 4) desc, random()
      limit v_quota.k
    ) s;
    v_ids := v_ids || v_got;
  end loop;
  if cardinality(v_ids) < 15 then
    select v_ids || coalesce(array_agg(s.id), '{}') into v_ids from (
      select q.id from public.questions q
      where q.status = 'live'
        and app_private.lang_ok(q.unit, q.text_ta, q.text_en, 'both')
        and not (q.id = any(v_ids))
      order by (q.id = any(v_recent)), random()
      limit 15 - cardinality(v_ids)
    ) s;
  end if;
  if cardinality(v_ids) = 0 then
    raise exception 'no_questions';
  end if;
  v_ids := (select array_agg(x.id order by random()) from unnest(v_ids) as x(id));
  insert into public.daily_challenges (day, question_ids) values (p_day, v_ids)
  on conflict (day) do nothing;
  select dc.question_ids into v_ids from public.daily_challenges dc where dc.day = p_day;
  return v_ids;
end $$;

create or replace function app_private.session_info(s public.solo_sessions) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id,
    'mode', s.mode,
    'unit', s.unit,
    'subtopic', s.subtopic,
    'n', cardinality(s.question_ids),
    'timer_s', s.timer_s,
    'daily_date', s.daily_date,
    'started_at', s.started_at,
    'elapsed_s', s.elapsed_s,
    'score', s.score,
    'streak', s.streak,
    'answered', coalesce((select jsonb_agg(a.q_index order by a.q_index) from public.solo_answers a
                          where a.session_id = s.id and a.answered_at is not null), '[]'::jsonb),
    'next_index', coalesce((select min(g.i) from generate_series(0, cardinality(s.question_ids) - 1) g(i)
                            where not exists (select 1 from public.solo_answers a
                                              where a.session_id = s.id and a.q_index = g.i and a.answered_at is not null)),
                           cardinality(s.question_ids))
  )
$$;

create or replace function public.solo_start(
  p_mode text, p_subject text default null, p_level text default null, p_subtopic text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_p public.profiles;
  v_ids bigint[];
  v_s public.solo_sessions;
  v_day date := app_private.ist_today();
  v_rating numeric;
  v_dmin numeric := 1;
  v_dmax numeric := 5;
  v_timer int := app_private.num('solo_timer_s')::int;
begin
  select * into v_p from public.profiles where id = v_me;
  if p_mode <> 'demo' and not v_p.onboarded then
    raise exception 'not_onboarded';
  end if;
  if p_subject = 'mixed' then
    p_subject := null;
  end if;
  if p_subject is not null and not exists (select 1 from public.units u where u.key = p_subject) then
    raise exception 'bad_subject';
  end if;
  update public.profiles set last_active_at = now() where id = v_me;

  if p_mode = 'practice' then
    if p_level = 'easy' then v_dmin := 1; v_dmax := 2;
    elsif p_level = 'medium' then v_dmin := 2; v_dmax := 4;
    elsif p_level = 'hard' then v_dmin := 4; v_dmax := 5;
    else
      select coalesce(avg(us.rating), 2.5) into v_rating
      from public.user_unit_stats us
      where us.user_id = v_me and (p_subject is null or us.unit = p_subject);
      v_dmin := v_rating - 1;
      v_dmax := v_rating + 1;
    end if;
    v_ids := app_private.pick_solo(v_me, p_subject, p_subtopic, 10, v_dmin, v_dmax, v_p.language, true, false);
  elsif p_mode = 'revision' then
    select coalesce(array_agg(x.qid), '{}') into v_ids from (
      select rc.question_id as qid
      from public.revision_cards rc join public.questions q on q.id = rc.question_id
      where rc.user_id = v_me and q.status = 'live'
      order by rc.due_at
      limit 10
    ) x;
    if cardinality(v_ids) = 0 then
      raise exception 'revision_empty';
    end if;
  elsif p_mode = 'daily' then
    if exists (select 1 from public.solo_sessions ss where ss.user_id = v_me and ss.mode = 'daily' and ss.daily_date = v_day) then
      raise exception 'daily_done';
    end if;
    v_ids := app_private.ensure_daily(v_day);
  elsif p_mode = 'mock' then
    select * into v_s from public.solo_sessions ss
    where ss.user_id = v_me and ss.mode = 'mock' and ss.finished_at is null
    order by ss.started_at desc limit 1;
    if found then
      return app_private.session_info(v_s);
    end if;
    v_ids := app_private.pick_solo(v_me, null, null, 200, 1, 5, v_p.language, false, true);
    v_timer := null;
  elsif p_mode = 'demo' then
    v_ids := app_private.pick_solo(v_me, null, null, 3, 1, 2, v_p.language, false, true);
  else
    raise exception 'bad_mode';
  end if;

  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'no_questions';
  end if;
  insert into public.solo_sessions (user_id, mode, unit, subtopic, question_ids, timer_s, daily_date)
  values (v_me, p_mode, p_subject, p_subtopic, v_ids, v_timer, case when p_mode = 'daily' then v_day end)
  returning * into v_s;
  return app_private.session_info(v_s);
end $$;

-- Resume an unfinished set (e.g. the app was closed mid daily challenge).
create or replace function public.solo_resume(p_session uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_s public.solo_sessions;
begin
  select * into v_s from public.solo_sessions
  where id = p_session and user_id = app_private.uid() and finished_at is null;
  if not found then
    raise exception 'not_found';
  end if;
  return app_private.session_info(v_s);
end $$;

create or replace function app_private.solo_reveal(p_session uuid, p_index int) returns jsonb
language sql stable set search_path = '' as $$
  select app_private.question_payload(a.question_id, p_session::text || ':' || p_index, true)
         || jsonb_build_object(
              'index', a.q_index,
              'choice', app_private.to_display(p_session::text || ':' || p_index, a.choice),
              'correct', coalesce(a.correct, false),
              'points', a.points,
              'time_ms', a.time_ms,
              'score', s.score,
              'streak', s.streak)
  from public.solo_answers a join public.solo_sessions s on s.id = a.session_id
  where a.session_id = p_session and a.q_index = p_index
$$;

-- Returns the question (never the answer while it is open). The first fetch
-- starts the server-side timer; refetching does not reset it.
create or replace function public.solo_question(p_session uuid, p_index int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_s public.solo_sessions;
  v_a public.solo_answers;
  v_qid bigint;
  v_seed text := p_session::text || ':' || p_index;
begin
  select * into v_s from public.solo_sessions where id = p_session and user_id = v_me;
  if not found then
    raise exception 'not_found';
  end if;
  if v_s.finished_at is not null then
    raise exception 'session_finished';
  end if;
  if p_index < 0 or p_index >= cardinality(v_s.question_ids) then
    raise exception 'bad_index';
  end if;
  v_qid := v_s.question_ids[p_index + 1];
  select * into v_a from public.solo_answers where session_id = v_s.id and q_index = p_index;
  if not found then
    insert into public.solo_answers (session_id, q_index, question_id, shown_at)
    values (v_s.id, p_index, v_qid, clock_timestamp())
    returning * into v_a;
    perform app_private.mark_seen(v_me, v_qid);
  end if;
  if v_s.mode <> 'mock' and v_a.answered_at is not null then
    return app_private.solo_reveal(v_s.id, p_index)
           || jsonb_build_object('answered', true, 'n', cardinality(v_s.question_ids), 'server_now', clock_timestamp());
  end if;
  return app_private.question_payload(v_qid, v_seed, false) || jsonb_build_object(
    'index', p_index,
    'n', cardinality(v_s.question_ids),
    'answered', false,
    'server_now', clock_timestamp(),
    'shown_at', v_a.shown_at,
    'deadline_at', case when v_s.timer_s is null then null else v_a.shown_at + make_interval(secs => v_s.timer_s) end,
    'choice', app_private.to_display(v_seed, v_a.choice)
  );
end $$;

-- p_choice is the display index (0–3) or null for "time up".
create or replace function public.solo_answer(p_session uuid, p_index int, p_choice int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_s public.solo_sessions;
  v_a public.solo_answers;
  v_q public.questions;
  v_seed text := p_session::text || ':' || p_index;
  v_canon int;
  v_t int;
  v_ok boolean;
  v_streak int;
  v_pts int;
begin
  select * into v_s from public.solo_sessions where id = p_session and user_id = v_me for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_s.finished_at is not null then
    raise exception 'session_finished';
  end if;
  select * into v_a from public.solo_answers where session_id = v_s.id and q_index = p_index;
  if not found then
    raise exception 'not_shown';
  end if;
  v_canon := app_private.to_canonical(v_seed, p_choice);

  if v_s.mode = 'mock' then
    update public.solo_answers
       set choice = v_canon,
           answered_at = case when v_canon is null then null else clock_timestamp() end
     where session_id = v_s.id and q_index = p_index;
    return jsonb_build_object('saved', true, 'index', p_index, 'choice', p_choice);
  end if;

  if v_a.answered_at is not null then
    return app_private.solo_reveal(v_s.id, p_index);
  end if;

  select * into v_q from public.questions where id = v_a.question_id;
  v_t := greatest(0, (extract(epoch from clock_timestamp() - v_a.shown_at) * 1000)::int);
  if v_t > (v_s.timer_s + 2) * 1000 then
    v_canon := null; -- too late (2 s grace for the network)
  end if;
  v_ok := v_canon is not null and v_canon = v_q.answer;
  v_streak := case when v_ok then v_s.streak + 1 else 0 end;
  v_pts := app_private.answer_points(v_ok, least(v_t, v_s.timer_s * 1000), v_s.timer_s, v_streak);

  update public.solo_answers
     set choice = v_canon, answered_at = clock_timestamp(),
         time_ms = least(v_t, v_s.timer_s * 1000), correct = v_ok, points = v_pts
   where session_id = v_s.id and q_index = p_index;
  update public.solo_sessions
     set score = score + v_pts,
         correct = correct + v_ok::int,
         answered = answered + (v_canon is not null)::int,
         streak = v_streak,
         total_time_ms = total_time_ms + least(v_t, v_s.timer_s * 1000)
   where id = v_s.id;
  perform app_private.record_answer(v_me, v_q.id, v_ok, v_t, v_canon is not null, v_s.mode = 'revision');
  return app_private.solo_reveal(v_s.id, p_index);
end $$;

create or replace function app_private.solo_coins_today(p_user uuid) returns int
language sql stable set search_path = '' as $$
  select coalesce(sum(l.amount), 0)::int from public.coin_ledger l
  where l.user_id = p_user and l.reason = 'solo'
    and l.created_at >= app_private.ist_start(app_private.ist_today())
$$;

create or replace function public.solo_finish(p_session uuid, p_elapsed_s int default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_s public.solo_sessions;
  v_n int;
  v_complete boolean;
  v_coins int := 0;
  v_raw int := 0;
  v_xp jsonb;
  v_streak jsonb;
  v_weak jsonb;
  v_report jsonb;
  v_new text[] := '{}';
  v_rank int;
  v_unit record;
begin
  select * into v_s from public.solo_sessions where id = p_session and user_id = v_me for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_s.finished_at is not null then
    return v_s.summary;
  end if;
  v_n := cardinality(v_s.question_ids);

  if v_s.mode = 'mock' then
    update public.solo_answers a
       set correct = (a.choice = q.answer), points = (a.choice = q.answer)::int
      from public.questions q
     where a.session_id = v_s.id and q.id = a.question_id and a.choice is not null;
    perform app_private.record_answer(v_me, a.question_id, a.correct, null, true)
      from public.solo_answers a where a.session_id = v_s.id and a.choice is not null;
    select count(*) filter (where a.choice is not null), count(*) filter (where a.correct)
      into v_s.answered, v_s.correct
      from public.solo_answers a where a.session_id = v_s.id;
    v_s.score := v_s.correct;
    select coalesce(jsonb_agg(r order by r.sort), '[]'::jsonb) into v_report from (
      select u.key as unit, u.sort, count(*) as total,
             count(*) filter (where a.correct) as correct,
             count(*) filter (where a.choice is not null) as answered
      from unnest(v_s.question_ids) as x(id)
      join public.questions q on q.id = x.id
      join public.units u on u.key = q.unit
      left join public.solo_answers a on a.session_id = v_s.id and a.question_id = x.id
      group by u.key, u.sort
    ) r;
    if v_s.answered >= ceil(0.8 * v_n) and not exists (
      select 1 from public.coin_ledger l where l.user_id = v_me and l.reason = 'mock'
        and l.created_at >= app_private.ist_start(app_private.week_start(app_private.ist_today()))
    ) then
      v_coins := 500;
      perform app_private.post_coins(v_me, v_coins, 'mock', null, 'session:' || v_s.id);
    end if;
    v_complete := v_s.answered >= ceil(0.8 * v_n);
  else
    v_complete := (select count(*) from public.solo_answers a where a.session_id = v_s.id and a.answered_at is not null) = v_n;
    if v_s.mode in ('practice', 'revision') then
      v_raw := 5 * v_s.correct + case when v_complete then 20 else 0 end;
      v_coins := greatest(0, least(v_raw, app_private.num('solo_daily_coin_cap')::int - app_private.solo_coins_today(v_me)));
      perform app_private.post_coins(v_me, v_coins, 'solo', null, 'session:' || v_s.id);
    end if;
  end if;

  v_xp := app_private.add_xp(v_me, 10 * v_s.correct + 2 * v_s.answered);

  if v_s.mode <> 'demo' and v_complete then
    v_streak := app_private.bump_streak(v_me);
    if app_private.award(v_me, 'first_solo') then v_new := array_append(v_new, 'first_solo'); end if;
  end if;
  if exists (select 1 from public.user_unit_stats us where us.user_id = v_me and us.unit = 'polity' and us.correct >= 500)
     and app_private.award(v_me, 'polity_pro') then
    v_new := array_append(v_new, 'polity_pro');
  end if;
  if exists (select 1 from public.user_unit_stats us where us.user_id = v_me and us.unit = 'tamil'
             and us.answered >= 200 and us.correct >= 0.9 * us.answered)
     and app_private.award(v_me, 'tamil_scholar') then
    v_new := array_append(v_new, 'tamil_scholar');
  end if;
  if v_streak is not null and (v_streak ->> 'streak')::int >= 7 then
    v_new := v_new || array(select ua.key from public.user_achievements ua
                            where ua.user_id = v_me and ua.key in ('streak_7', 'streak_30')
                              and ua.earned_at > now() - interval '5 seconds');
  end if;

  -- Weak-topic radar: the three weakest sub-topics in this set.
  select coalesce(jsonb_agg(w), '[]'::jsonb) into v_weak from (
    select q.unit, q.subtopic, count(*) as total, count(*) filter (where a.correct) as correct
    from public.solo_answers a join public.questions q on q.id = a.question_id
    where a.session_id = v_s.id and a.answered_at is not null or (a.session_id = v_s.id and v_s.mode = 'mock')
    group by q.unit, q.subtopic
    having count(*) filter (where a.correct) < count(*)
    order by count(*) filter (where a.correct)::numeric / count(*), count(*) desc
    limit 3
  ) w;

  if v_s.mode = 'daily' then
    select count(*) + 1 into v_rank from public.solo_sessions ss
    where ss.mode = 'daily' and ss.daily_date = v_s.daily_date and ss.finished_at is not null
      and (ss.score > v_s.score or (ss.score = v_s.score and ss.total_time_ms < v_s.total_time_ms));
  end if;

  update public.solo_sessions
     set finished_at = now(),
         answered = v_s.answered, correct = v_s.correct, score = v_s.score,
         elapsed_s = coalesce(p_elapsed_s, elapsed_s),
         summary = jsonb_build_object(
           'id', v_s.id, 'mode', v_s.mode, 'n', v_n,
           'answered', v_s.answered, 'correct', v_s.correct, 'score', v_s.score,
           'complete', v_complete,
           'coins', v_coins, 'coin_cap_hit', v_raw > v_coins and v_s.mode in ('practice', 'revision'),
           'xp', v_xp, 'streak', v_streak, 'weak', v_weak, 'achievements', to_jsonb(v_new),
           'report', v_report, 'marks', case when v_s.mode = 'mock' then v_s.correct * 1.5 end,
           'daily_rank', v_rank,
           'balance', (select p.coins from public.profiles p where p.id = v_me))
   where id = v_s.id
  returning summary into v_s.summary;
  return v_s.summary;
end $$;

-- Mock tests are pausable: the client reports active seconds as it goes.
create or replace function public.mock_progress(p_session uuid, p_elapsed_s int) returns void
language sql security definer set search_path = '' as $$
  update public.solo_sessions set elapsed_s = greatest(elapsed_s, least(p_elapsed_s, 3 * 3600))
  where id = p_session and user_id = auth.uid() and mode = 'mock' and finished_at is null
$$;

-- ---------------------------------------------------------------------------
-- Daily challenge leaderboard and settlement
-- ---------------------------------------------------------------------------

create or replace function app_private.are_friends(a uuid, b uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.friendships f
    where f.user_a = least(a, b) and f.user_b = greatest(a, b) and f.status = 'accepted'
  )
$$;

create or replace function public.daily_leaderboard(p_scope text default 'state', p_day date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_day date := coalesce(p_day, app_private.ist_today());
  v_district text;
  v_out jsonb;
begin
  select district into v_district from public.profiles where id = v_me;
  with board as (
    select s.user_id, s.score, s.correct, s.total_time_ms,
           rank() over (order by s.score desc, s.total_time_ms asc) as rk
    from public.solo_sessions s join public.profiles p on p.id = s.user_id
    where s.mode = 'daily' and s.daily_date = v_day and s.finished_at is not null
      and (p_scope = 'state'
           or (p_scope = 'district' and p.district = v_district)
           or (p_scope = 'friends' and (s.user_id = v_me or app_private.are_friends(v_me, s.user_id))))
  )
  select jsonb_build_object(
    'day', v_day,
    'total', (select count(*) from board),
    'top', coalesce((select jsonb_agg(jsonb_build_object('rank', b.rk, 'user', app_private.public_user(b.user_id),
                                                         'score', b.score, 'correct', b.correct, 'time_ms', b.total_time_ms)
                                      order by b.rk)
                     from (select * from board order by rk limit 50) b), '[]'::jsonb),
    'me', (select jsonb_build_object('rank', b.rk, 'score', b.score, 'correct', b.correct, 'time_ms', b.total_time_ms)
           from board b where b.user_id = v_me)
  ) into v_out;
  return v_out;
end $$;

-- Run by pg_cron just after IST midnight. Top 10 % → 300, top 40 % → 200, rest → 100.
create or replace function app_private.settle_daily(p_day date) returns int
language plpgsql set search_path = '' as $$
declare
  v_row record;
  v_count int := 0;
begin
  update public.daily_challenges set settled = true where day = p_day and not settled;
  if not found then
    return 0;
  end if;
  for v_row in
    select s.user_id,
           row_number() over (order by s.score desc, s.total_time_ms asc) as rn,
           count(*) over () as total
    from public.solo_sessions s
    where s.mode = 'daily' and s.daily_date = p_day and s.finished_at is not null
  loop
    perform app_private.post_coins(
      v_row.user_id,
      case when v_row.rn <= ceil(v_row.total * 0.1) then 300
           when v_row.rn <= ceil(v_row.total * 0.4) then 200
           else 100 end,
      'daily_rank', null, 'daily:' || p_day);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Offline practice: a pack with answers is cached on the phone; results are
-- re-checked by the server on sync, capped at 100 coins per sync. Pack
-- questions count as seen at download, so rooms keep them out for 14 days.
-- ---------------------------------------------------------------------------

create or replace function public.get_offline_pack() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_p public.profiles;
  v_pack public.offline_packs;
  v_ids bigint[];
begin
  select * into v_p from public.profiles where id = v_me;
  if not v_p.onboarded then
    raise exception 'not_onboarded';
  end if;
  select * into v_pack from public.offline_packs op
  where op.user_id = v_me and op.issued_at > now() - interval '20 hours'
  order by op.issued_at desc limit 1;
  if not found then
    v_ids := app_private.pick_solo(v_me, null, null, app_private.num('offline_pack_size')::int, 1, 5, v_p.language, false, false);
    insert into public.offline_packs (user_id, question_ids) values (v_me, v_ids) returning * into v_pack;
    perform app_private.mark_seen(v_me, x.id) from unnest(v_ids) as x(id);
  end if;
  return jsonb_build_object(
    'pack_id', v_pack.id,
    'issued_at', v_pack.issued_at,
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'unit', q.unit, 'subtopic', q.subtopic, 'difficulty', q.difficulty,
        'text_ta', q.text_ta, 'text_en', q.text_en,
        'options_ta', to_jsonb(q.options_ta), 'options_en', to_jsonb(q.options_en),
        'answer', q.answer, 'explanation_ta', q.explanation_ta, 'explanation_en', q.explanation_en,
        'book_ref', q.book_ref))
      from unnest(v_pack.question_ids) as x(id) join public.questions q on q.id = x.id
      where not (q.id = any(v_pack.synced_ids))), '[]'::jsonb)
  );
end $$;

-- p_results: [{ "q": question_id, "c": canonical choice or null, "t": time_ms }]
create or replace function public.sync_offline(p_pack uuid, p_results jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_pack public.offline_packs;
  v_row record;
  v_synced bigint[];
  v_answered int := 0;
  v_correct int := 0;
  v_ok boolean;
  v_coins int;
  v_xp jsonb;
  v_streak jsonb;
begin
  select * into v_pack from public.offline_packs where id = p_pack and user_id = v_me for update;
  if not found then
    raise exception 'not_found';
  end if;
  v_synced := v_pack.synced_ids;
  for v_row in
    select distinct on ((e ->> 'q')::bigint)
           (e ->> 'q')::bigint as qid,
           case when e ->> 'c' is null then null else (e ->> 'c')::int end as choice,
           coalesce((e ->> 't')::int, 0) as t
    from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) e
  loop
    continue when not (v_row.qid = any(v_pack.question_ids)) or v_row.qid = any(v_synced);
    select (q.answer = v_row.choice) into v_ok from public.questions q where q.id = v_row.qid;
    v_ok := coalesce(v_ok, false);
    perform app_private.record_answer(v_me, v_row.qid, v_ok, v_row.t, v_row.choice is not null);
    v_synced := v_synced || v_row.qid;
    v_answered := v_answered + (v_row.choice is not null)::int;
    v_correct := v_correct + v_ok::int;
  end loop;
  update public.offline_packs set synced_ids = v_synced where id = v_pack.id;

  v_coins := greatest(0, least(5 * v_correct,
                               app_private.num('offline_session_coin_cap')::int,
                               app_private.num('solo_daily_coin_cap')::int - app_private.solo_coins_today(v_me)));
  perform app_private.post_coins(v_me, v_coins, 'solo', null, 'offline:' || v_pack.id);
  v_xp := app_private.add_xp(v_me, 10 * v_correct + 2 * v_answered);
  if v_answered >= 10 then
    v_streak := app_private.bump_streak(v_me);
  end if;
  return jsonb_build_object('answered', v_answered, 'correct', v_correct, 'coins', v_coins, 'xp', v_xp, 'streak', v_streak);
end $$;

-- ---------------------------------------------------------------------------
-- Onboarding, profile and the remaining faucets
-- ---------------------------------------------------------------------------

create or replace function app_private.districts() returns text[]
language sql immutable set search_path = '' as $$
  select array['Ariyalur','Chengalpattu','Chennai','Coimbatore','Cuddalore','Dharmapuri','Dindigul','Erode',
               'Kallakurichi','Kancheepuram','Kanniyakumari','Karur','Krishnagiri','Madurai','Mayiladuthurai',
               'Nagapattinam','Namakkal','Nilgiris','Perambalur','Pudukkottai','Ramanathapuram','Ranipet','Salem',
               'Sivaganga','Tenkasi','Thanjavur','Theni','Thoothukudi','Tiruchirappalli','Tirunelveli','Tirupathur',
               'Tiruppur','Tiruvallur','Tiruvannamalai','Tiruvarur','Vellore','Viluppuram','Virudhunagar']
$$;

create or replace function public.complete_onboarding(
  p_username text, p_name text, p_district text, p_exam_year int, p_language text,
  p_is_adult boolean, p_consent boolean, p_referrer text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_p public.profiles;
  v_username text := lower(btrim(p_username));
  v_ref uuid;
begin
  if not coalesce(p_is_adult, false) or not coalesce(p_consent, false) then
    raise exception 'consent_required';
  end if;
  if v_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'bad_username';
  end if;
  if exists (select 1 from public.profiles p where p.username = v_username and p.id <> v_me) then
    raise exception 'username_taken';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 40 then
    raise exception 'bad_name';
  end if;
  if not (p_district = any(app_private.districts())) then
    raise exception 'bad_district';
  end if;
  if p_exam_year not between 2026 and 2032 then
    raise exception 'bad_exam_year';
  end if;
  if p_language not in ('ta', 'en') then
    raise exception 'bad_language';
  end if;
  select * into v_p from public.profiles where id = v_me for update;
  if not v_p.onboarded and p_referrer is not null then
    select p.id into v_ref from public.profiles p where p.username = lower(btrim(p_referrer)) and p.id <> v_me;
  end if;
  update public.profiles
     set username = v_username, display_name = btrim(p_name), district = p_district,
         exam_year = p_exam_year, language = p_language, onboarded = true,
         referred_by = coalesce(referred_by, v_ref), last_active_at = now()
   where id = v_me;
  return (select to_jsonb(p) from public.profiles p where p.id = v_me);
end $$;

create or replace function public.update_profile(p_changes jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_username text;
begin
  if p_changes ? 'username' then
    v_username := lower(btrim(p_changes ->> 'username'));
    if v_username !~ '^[a-z0-9_]{3,20}$' then raise exception 'bad_username'; end if;
    if exists (select 1 from public.profiles p where p.username = v_username and p.id <> v_me) then
      raise exception 'username_taken';
    end if;
    update public.profiles set username = v_username where id = v_me;
  end if;
  if p_changes ? 'display_name' then
    if char_length(btrim(coalesce(p_changes ->> 'display_name', ''))) not between 1 and 40 then raise exception 'bad_name'; end if;
    update public.profiles set display_name = btrim(p_changes ->> 'display_name') where id = v_me;
  end if;
  if p_changes ? 'district' then
    if not ((p_changes ->> 'district') = any(app_private.districts())) then raise exception 'bad_district'; end if;
    update public.profiles set district = p_changes ->> 'district' where id = v_me;
  end if;
  if p_changes ? 'exam_year' then
    if (p_changes ->> 'exam_year')::int not between 2026 and 2032 then raise exception 'bad_exam_year'; end if;
    update public.profiles set exam_year = (p_changes ->> 'exam_year')::int where id = v_me;
  end if;
  if p_changes ? 'language' then
    if (p_changes ->> 'language') not in ('ta', 'en') then raise exception 'bad_language'; end if;
    update public.profiles set language = p_changes ->> 'language' where id = v_me;
  end if;
  if p_changes ? 'avatar' then
    if (p_changes ->> 'avatar') !~ '^a([1-9]|1[0-2])$' then raise exception 'bad_avatar'; end if;
    update public.profiles set avatar = p_changes ->> 'avatar' where id = v_me;
  end if;
  if p_changes ? 'allow_stranger_chat' then
    update public.profiles set allow_stranger_chat = (p_changes ->> 'allow_stranger_chat')::boolean where id = v_me;
  end if;
  return (select to_jsonb(p) from public.profiles p where p.id = v_me);
end $$;

-- Starter coins, granted after the 3-question demo. A hashed browser
-- fingerprint limits repeat bonuses from the same phone.
create or replace function public.claim_signup_bonus(p_fp text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_p public.profiles;
  v_count int;
  v_amount int;
begin
  select * into v_p from public.profiles where id = v_me for update;
  if not v_p.onboarded then
    raise exception 'not_onboarded';
  end if;
  if v_p.signup_bonus_claimed then
    return jsonb_build_object('coins', 0, 'balance', v_p.coins, 'limited', false, 'already', true);
  end if;
  if p_fp is null or p_fp !~ '^[0-9a-f]{32,128}$' then
    raise exception 'bad_fingerprint';
  end if;
  insert into public.device_bonus (fp, count) values (p_fp, 1)
  on conflict (fp) do update set count = public.device_bonus.count + 1, last_at = now()
  returning count into v_count;
  v_amount := case when v_count <= app_private.num('signup_bonus_per_device') then app_private.num('signup_bonus')::int else 0 end;
  update public.profiles set signup_bonus_claimed = true where id = v_me;
  return jsonb_build_object(
    'coins', v_amount,
    'balance', app_private.post_coins(v_me, v_amount, 'signup_bonus'),
    'limited', v_amount = 0,
    'already', false);
end $$;

-- Bankruptcy refill: below 50 available, top up to 200 once per 24 h.
create or replace function public.claim_refill() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_p public.profiles;
  v_amount int;
begin
  select * into v_p from public.profiles where id = v_me for update;
  if v_p.escrow > 0 or v_p.coins >= app_private.num('refill_threshold') then
    raise exception 'refill_not_needed';
  end if;
  if v_p.last_refill_at is not null and v_p.last_refill_at > now() - interval '24 hours' then
    raise exception 'refill_cooldown';
  end if;
  v_amount := app_private.num('refill_to')::int - v_p.coins;
  update public.profiles set last_refill_at = now() where id = v_me;
  return jsonb_build_object('coins', v_amount, 'balance', app_private.post_coins(v_me, v_amount, 'refill'));
end $$;

create or replace function public.buy_shield() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_shields int;
begin
  select shields into v_shields from public.profiles where id = v_me for update;
  if v_shields >= 3 then
    raise exception 'shield_limit';
  end if;
  perform app_private.spend_coins(v_me, 150, 'shield');
  update public.profiles set shields = shields + 1 where id = v_me returning shields into v_shields;
  return jsonb_build_object('shields', v_shields, 'balance', (select coins from public.profiles where id = v_me));
end $$;

create or replace function public.add_to_revision(p_question bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
begin
  if not exists (select 1 from public.user_question_history h where h.user_id = v_me and h.question_id = p_question) then
    raise exception 'not_seen';
  end if;
  insert into public.revision_cards (user_id, question_id, box, due_at)
  values (v_me, p_question, 1, now() + interval '1 day')
  on conflict (user_id, question_id) do nothing;
end $$;

-- Account deletion (DPDP Act): removes the auth user; everything cascades.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_room record;
begin
  if exists (select 1 from public.match_players mp join public.matches m on m.id = mp.match_id
             where mp.user_id = v_me and m.status = 'live') then
    raise exception 'in_match';
  end if;
  for v_room in select rp.room_id from public.room_players rp where rp.user_id = v_me loop
    perform app_private.leave_room(v_room.room_id, v_me);
  end loop;
  delete from public.rooms where host_id = v_me;
  delete from auth.users where id = v_me;
end $$;
