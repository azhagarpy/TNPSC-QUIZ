-- Admin panel functions. Gated by profiles.is_admin, which is set by hand:
--   update public.profiles set is_admin = true where username = 'your_username';

create or replace function public.admin_stats() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_admin();
  return jsonb_build_object(
    'questions', (select jsonb_object_agg(x.status, x.n) from (
                    select q.status, count(*) as n from public.questions q group by q.status) x),
    'live_by_unit', (select jsonb_object_agg(u.key, (select count(*) from public.questions q
                                                     where q.unit = u.key and q.status = 'live'))
                     from public.units u),
    'open_reports', (select count(*) from public.reports r where r.status = 'open'),
    'open_collusion', (select count(*) from public.collusion_flags f where f.status = 'open'),
    'players', (select count(*) from public.profiles p where p.onboarded),
    'active_today', (select count(*) from public.profiles p
                     where p.last_active_at >= app_private.ist_start(app_private.ist_today())),
    'live_matches', (select count(*) from public.matches m where m.status = 'live'),
    'flagged_answers_7d', (select count(*) from public.match_answers a
                           where a.flagged and a.created_at > now() - interval '7 days')
  );
end $$;

create or replace function app_private.question_admin_json(q public.questions) returns jsonb
language sql stable set search_path = '' as $$
  select to_jsonb(q) || jsonb_build_object(
    'created_by_name', (select p.username from public.profiles p where p.id = q.created_by),
    'reviewer_names', (select coalesce(jsonb_agg(p.username), '[]'::jsonb)
                       from public.profiles p where p.id = any(q.reviewed_by)),
    'accuracy', case when q.times_shown > 0 then round(q.times_correct::numeric / q.times_shown, 3) end,
    'avg_time_ms', case when q.times_shown > 0 then q.total_time_ms / q.times_shown end)
$$;

create or replace function public.admin_list_questions(
  p_status text default 'review', p_unit text default null, p_search text default null,
  p_limit int default 50, p_offset int default 0
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_admin();
begin
  return jsonb_build_object(
    'total', (select count(*) from public.questions q
              where (p_status is null or q.status = p_status) and (p_unit is null or q.unit = p_unit)
                and (p_search is null or q.text_ta ilike '%' || p_search || '%' or q.text_en ilike '%' || p_search || '%'
                     or q.subtopic ilike '%' || p_search || '%')),
    'items', coalesce((
      select jsonb_agg(app_private.question_admin_json(q) || jsonb_build_object('i_reviewed', v_me = any(q.reviewed_by))
                       order by q.created_at, q.id)
      from (select * from public.questions q
            where (p_status is null or q.status = p_status) and (p_unit is null or q.unit = p_unit)
              and (p_search is null or q.text_ta ilike '%' || p_search || '%' or q.text_en ilike '%' || p_search || '%'
                   or q.subtopic ilike '%' || p_search || '%')
            order by q.created_at, q.id
            limit least(coalesce(p_limit, 50), 200) offset coalesce(p_offset, 0)) q), '[]'::jsonb)
  );
end $$;

-- Validates one question object; returns an error string or null.
create or replace function app_private.validate_question(r jsonb) returns text
language plpgsql stable set search_path = '' as $$
declare
  v_ans text := upper(btrim(coalesce(r ->> 'answer', '')));
begin
  if not exists (select 1 from public.units u where u.key = r ->> 'unit') then return 'unknown unit'; end if;
  if coalesce(btrim(r ->> 'subtopic'), '') = '' then return 'missing subtopic'; end if;
  if (r ->> 'difficulty') !~ '^[1-5]$' then return 'difficulty must be 1-5'; end if;
  if v_ans !~ '^([0-3]|[A-D])$' then return 'answer must be A-D or 0-3'; end if;
  if coalesce(r ->> 'text_ta', '') = '' and coalesce(r ->> 'text_en', '') = '' then return 'needs Tamil or English text'; end if;
  if r ->> 'unit' = 'tamil' and coalesce(r ->> 'text_ta', '') = '' then return 'Part A questions need Tamil text'; end if;
  if coalesce(r ->> 'text_ta', '') <> '' and (jsonb_typeof(r -> 'options_ta') <> 'array' or jsonb_array_length(r -> 'options_ta') <> 4
      or exists (select 1 from jsonb_array_elements_text(r -> 'options_ta') o where btrim(o) = '')) then
    return 'Tamil text needs 4 Tamil options';
  end if;
  if coalesce(r ->> 'text_en', '') <> '' and (jsonb_typeof(r -> 'options_en') <> 'array' or jsonb_array_length(r -> 'options_en') <> 4
      or exists (select 1 from jsonb_array_elements_text(r -> 'options_en') o where btrim(o) = '')) then
    return 'English text needs 4 English options';
  end if;
  return null;
end $$;

create or replace function app_private.answer_index(r jsonb) returns smallint
language sql immutable set search_path = '' as $$
  select case upper(btrim(r ->> 'answer'))
    when 'A' then 0 when 'B' then 1 when 'C' then 2 when 'D' then 3
    else (r ->> 'answer')::smallint end
$$;

create or replace function app_private.text_array(j jsonb) returns text[]
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(j) = 'array' then array(select btrim(x) from jsonb_array_elements_text(j) x) end
$$;

-- p_rows: array of question objects (the admin page parses the CSV). Imported
-- questions enter the review queue; nothing goes live without reviewers.
create or replace function public.admin_import_questions(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_admin();
  v_row jsonb;
  v_i int := 0;
  v_err text;
  v_inserted int := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'bad_rows'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'too_many_rows'; end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_err := app_private.validate_question(v_row);
    if v_err is not null then
      v_errors := v_errors || jsonb_build_object('row', v_i, 'error', v_err);
      continue;
    end if;
    insert into public.questions (unit, subtopic, difficulty, text_ta, text_en, options_ta, options_en, answer,
                                  explanation_ta, explanation_en, source, book_ref, image_url, status, created_by)
    values (v_row ->> 'unit', btrim(v_row ->> 'subtopic'), (v_row ->> 'difficulty')::smallint,
            nullif(btrim(v_row ->> 'text_ta'), ''), nullif(btrim(v_row ->> 'text_en'), ''),
            case when coalesce(v_row ->> 'text_ta', '') <> '' then app_private.text_array(v_row -> 'options_ta') end,
            case when coalesce(v_row ->> 'text_en', '') <> '' then app_private.text_array(v_row -> 'options_en') end,
            app_private.answer_index(v_row),
            nullif(btrim(v_row ->> 'explanation_ta'), ''), nullif(btrim(v_row ->> 'explanation_en'), ''),
            nullif(btrim(v_row ->> 'source'), ''), nullif(btrim(v_row ->> 'book_ref'), ''),
            nullif(btrim(v_row ->> 'image_url'), ''), 'review', v_me);
    v_inserted := v_inserted + 1;
  end loop;
  return jsonb_build_object('inserted', v_inserted, 'errors', v_errors);
end $$;

-- Two distinct reviewers (not the author) must approve before a question goes live.
create or replace function public.admin_review(p_question bigint, p_approve boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_admin();
  v_q public.questions;
begin
  select * into v_q from public.questions where id = p_question for update;
  if not found then raise exception 'not_found'; end if;
  if v_q.status not in ('review', 'draft') then raise exception 'not_in_review'; end if;
  if p_approve then
    if v_q.created_by = v_me then raise exception 'cannot_review_own'; end if;
    if not (v_me = any(v_q.reviewed_by)) then
      v_q.reviewed_by := v_q.reviewed_by || v_me;
    end if;
    update public.questions
       set reviewed_by = v_q.reviewed_by,
           status = case when cardinality(v_q.reviewed_by) >= app_private.num('required_reviews') then 'live' else 'review' end,
           review_note = coalesce(p_note, review_note),
           updated_at = now()
     where id = p_question
    returning * into v_q;
  else
    update public.questions
       set status = 'draft', reviewed_by = '{}', review_note = p_note, updated_at = now()
     where id = p_question
    returning * into v_q;
  end if;
  return app_private.question_admin_json(v_q);
end $$;

-- Editing content sends a question back through review.
create or replace function public.admin_save_question(p_question bigint, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_admin();
  v_err text := app_private.validate_question(p_data);
  v_q public.questions;
begin
  if v_err is not null then raise exception '%', v_err; end if;
  if p_question is null then
    insert into public.questions (unit, subtopic, difficulty, text_ta, text_en, options_ta, options_en, answer,
                                  explanation_ta, explanation_en, source, book_ref, image_url, status, created_by)
    values (p_data ->> 'unit', btrim(p_data ->> 'subtopic'), (p_data ->> 'difficulty')::smallint,
            nullif(btrim(p_data ->> 'text_ta'), ''), nullif(btrim(p_data ->> 'text_en'), ''),
            case when coalesce(p_data ->> 'text_ta', '') <> '' then app_private.text_array(p_data -> 'options_ta') end,
            case when coalesce(p_data ->> 'text_en', '') <> '' then app_private.text_array(p_data -> 'options_en') end,
            app_private.answer_index(p_data),
            nullif(btrim(p_data ->> 'explanation_ta'), ''), nullif(btrim(p_data ->> 'explanation_en'), ''),
            nullif(btrim(p_data ->> 'source'), ''), nullif(btrim(p_data ->> 'book_ref'), ''),
            nullif(btrim(p_data ->> 'image_url'), ''), 'review', v_me)
    returning * into v_q;
  else
    update public.questions set
      unit = p_data ->> 'unit', subtopic = btrim(p_data ->> 'subtopic'),
      difficulty = (p_data ->> 'difficulty')::smallint,
      text_ta = nullif(btrim(p_data ->> 'text_ta'), ''), text_en = nullif(btrim(p_data ->> 'text_en'), ''),
      options_ta = case when coalesce(p_data ->> 'text_ta', '') <> '' then app_private.text_array(p_data -> 'options_ta') end,
      options_en = case when coalesce(p_data ->> 'text_en', '') <> '' then app_private.text_array(p_data -> 'options_en') end,
      answer = app_private.answer_index(p_data),
      explanation_ta = nullif(btrim(p_data ->> 'explanation_ta'), ''),
      explanation_en = nullif(btrim(p_data ->> 'explanation_en'), ''),
      source = nullif(btrim(p_data ->> 'source'), ''), book_ref = nullif(btrim(p_data ->> 'book_ref'), ''),
      image_url = nullif(btrim(p_data ->> 'image_url'), ''),
      status = 'review', reviewed_by = '{}', updated_at = now()
    where id = p_question
    returning * into v_q;
    if not found then raise exception 'not_found'; end if;
  end if;
  return app_private.question_admin_json(v_q);
end $$;

create or replace function public.admin_set_question_status(p_question bigint, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_admin();
  if p_status not in ('retired', 'review', 'draft') then
    raise exception 'bad_status'; -- going live always needs reviewers
  end if;
  update public.questions set status = p_status, updated_at = now(),
         reviewed_by = case when p_status = 'retired' then reviewed_by else '{}' end
   where id = p_question;
end $$;

create or replace function public.admin_list_reports(p_status text default 'open') returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(r) || jsonb_build_object(
             'reporter', app_private.public_user(r.reporter_id),
             'target', case when r.target_user_id is not null then app_private.public_user(r.target_user_id) end,
             'target_upheld', (select count(*) from public.reports x
                               where x.target_user_id = r.target_user_id and x.status = 'upheld'),
             'question', (select app_private.question_admin_json(q) from public.questions q where q.id = r.question_id))
           order by r.created_at)
    from (select * from public.reports r where r.status = p_status order by r.created_at limit 200) r), '[]'::jsonb);
end $$;

-- Upheld question report → reporter gets 20 coins. Three upheld reports
-- against a player within 30 days → chat muted for 24 h.
create or replace function public.admin_resolve_report(p_report bigint, p_upheld boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_admin();
  v_r public.reports;
begin
  update public.reports set status = case when p_upheld then 'upheld' else 'rejected' end,
         resolved_by = v_me, resolved_at = now()
   where id = p_report and status = 'open'
  returning * into v_r;
  if not found then raise exception 'not_found'; end if;
  if not p_upheld then
    if v_r.kind = 'question' then
      update public.questions set report_count = greatest(0, report_count - 1) where id = v_r.question_id;
    end if;
    return;
  end if;
  if v_r.kind = 'question' then
    perform app_private.post_coins(v_r.reporter_id, 20, 'report_reward', null, 'report:' || v_r.id);
  elsif v_r.target_user_id is not null
        and (select count(*) from public.reports x
             where x.target_user_id = v_r.target_user_id and x.status = 'upheld'
               and x.resolved_at > now() - interval '30 days') >= 3 then
    update public.profiles set chat_muted_until = now() + interval '24 hours' where id = v_r.target_user_id;
  end if;
end $$;

create or replace function public.admin_settings() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_admin();
  return (select jsonb_agg(to_jsonb(s) order by s.key) from public.app_settings s);
end $$;

create or replace function public.admin_set_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_admin();
  update public.app_settings set value = p_value where key = p_key;
  if not found then raise exception 'not_found'; end if;
end $$;

create or replace function public.admin_banned_words() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_admin();
  return coalesce((select jsonb_agg(to_jsonb(w) order by w.word) from public.banned_words w), '[]'::jsonb);
end $$;

create or replace function public.admin_set_banned_word(p_word text, p_match_inside boolean, p_remove boolean default false)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_admin();
  if p_remove then
    delete from public.banned_words where word = lower(btrim(p_word));
  else
    insert into public.banned_words (word, match_inside) values (lower(btrim(p_word)), p_match_inside)
    on conflict (word) do update set match_inside = excluded.match_inside;
  end if;
end $$;

create or replace function public.admin_collusion() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(f) || jsonb_build_object('a', app_private.public_user(f.user_a),
                                                       'b', app_private.public_user(f.user_b))
                     order by f.created_at desc)
    from public.collusion_flags f where f.status = 'open'), '[]'::jsonb);
end $$;

create or replace function public.admin_resolve_collusion(p_flag bigint, p_confirmed boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_f public.collusion_flags;
begin
  perform app_private.require_admin();
  update public.collusion_flags set status = case when p_confirmed then 'confirmed' else 'cleared' end
   where id = p_flag returning * into v_f;
  if not found then raise exception 'not_found'; end if;
  if not p_confirmed then
    update public.profiles set stakes_frozen = false
     where id in (v_f.user_a, v_f.user_b)
       and not exists (select 1 from public.collusion_flags o
                       where o.status in ('open', 'confirmed') and (o.user_a = profiles.id or o.user_b = profiles.id));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Scheduled jobs (see 20261008000800_cron.sql)
-- ---------------------------------------------------------------------------

-- Every minute: settle matches nobody finished, refund stuck ones, tidy lobbies.
create or replace function app_private.cron_minutely() returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_m record;
  v_cur public.matches;
  v_settled int := 0;
  v_refunded int := 0;
begin
  for v_m in select m.id, m.started_at, m.n, m.timer_s, m.reveal_s from public.matches m where m.status = 'live' loop
    if v_m.started_at < now() - make_interval(secs => v_m.n * (v_m.timer_s + v_m.reveal_s + 10) + 900) then
      -- Far past any possible end: something went wrong, refund everyone.
      perform app_private.refund_match(v_m.id);
      v_refunded := v_refunded + 1;
    else
      v_cur := app_private.advance_match(v_m.id);
      if app_private.match_phase(v_cur, clock_timestamp() - interval '30 seconds') = 'finished' then
        perform app_private.settle_match(v_m.id);
        v_settled := v_settled + 1;
      end if;
    end if;
  end loop;

  delete from public.room_players rp using public.rooms r
   where r.id = rp.room_id and r.status = 'lobby' and rp.last_seen_at < now() - interval '10 minutes';
  update public.rooms r set status = 'closed'
   where r.status = 'lobby'
     and (r.last_activity_at < now() - interval '3 hours'
          or not exists (select 1 from public.room_players rp where rp.room_id = r.id));
  return jsonb_build_object('settled', v_settled, 'refunded', v_refunded);
end $$;

-- Hourly: the same pair repeatedly staking 250+ with one side always losing
-- (coin dumping) → freeze both players' stakes for review.
create or replace function app_private.cron_hourly() returns int
language plpgsql set search_path = '' as $$
declare
  v_flagged int;
begin
  with pairs as (
    select a.user_id as ua, b.user_id as ub, count(*) as n,
           count(*) filter (where a.rank = 1) as wins_a,
           count(*) filter (where b.rank = 1) as wins_b,
           sum(m.stake) as coins
    from public.match_players a
    join public.match_players b on b.match_id = a.match_id and a.user_id < b.user_id
    join public.matches m on m.id = a.match_id
    where m.status = 'settled' and m.stake >= 250 and m.settled_at > now() - interval '7 days'
      and (select count(*) from public.match_players x where x.match_id = m.id) = 2
    group by a.user_id, b.user_id
  ),
  flagged as (
    insert into public.collusion_flags (user_a, user_b, matches, coins)
    select p.ua, p.ub, p.n, p.coins from pairs p
    where p.n >= 5 and (p.wins_a = p.n or p.wins_b = p.n)
      and not exists (select 1 from public.collusion_flags f
                      where f.user_a = p.ua and f.user_b = p.ub and f.status in ('open', 'confirmed'))
    returning user_a, user_b
  )
  update public.profiles set stakes_frozen = true
   where id in (select user_a from flagged union select user_b from flagged);
  get diagnostics v_flagged = row_count;
  return v_flagged;
end $$;

-- Daily at 00:05 IST: pay yesterday's daily-challenge ranks, prepare today's
-- set, and apply data retention (chat 30 days).
create or replace function app_private.cron_daily() returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_paid int;
begin
  v_paid := app_private.settle_daily(app_private.ist_today() - 1);
  perform app_private.ensure_daily(app_private.ist_today());
  delete from public.chat_messages where created_at < now() - interval '30 days';
  delete from public.offline_packs where issued_at < now() - interval '30 days';
  delete from public.solo_sessions where finished_at is null and mode <> 'mock' and started_at < now() - interval '2 days';
  delete from public.solo_sessions where finished_at is null and mode = 'mock' and started_at < now() - interval '14 days';
  return jsonb_build_object('daily_paid', v_paid);
end $$;
