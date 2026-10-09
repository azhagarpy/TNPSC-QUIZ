-- Web push (plan: room invites and streak reminders go out as web push;
-- WhatsApp links stay the main invite path; on iPhone only after install).
--
-- Rows land in push_queue (in the reader's language), then the database pings
-- the send-push Edge Function through pg_net. The function claims the queue
-- with the service role and sends via VAPID. The project URL and a shared
-- secret come from Supabase Vault ('project_url', 'push_secret'); without them
-- notifications simply wait in the queue.

create table public.push_subscriptions (
  endpoint   text primary key check (endpoint ~ '^https://' and char_length(endpoint) < 1000),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table public.push_queue (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
alter table public.push_queue enable row level security;
revoke insert, update, delete, truncate on public.push_subscriptions, public.push_queue from anon, authenticated;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
begin
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values (p_endpoint, v_me, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = v_me, p256dh = excluded.p256dh, auth = excluded.auth;
  -- Keep the 5 newest devices per player.
  delete from public.push_subscriptions s
  where s.user_id = v_me and s.endpoint not in (
    select x.endpoint from public.push_subscriptions x where x.user_id = v_me order by x.created_at desc limit 5);
end $$;

create or replace function public.delete_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;

-- Ask the Edge Function to flush the queue. Asynchronous (pg_net), so it never
-- slows down or fails a game write.
create or replace function app_private.kick_push() returns void
language plpgsql set search_path = '' as $$
begin
  if to_regproc('net.http_post') is null or to_regclass('vault.decrypted_secrets') is null then
    return;
  end if;
  execute $q$
    select net.http_post(
      url := s.url || '/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', s.secret),
      body := '{}'::jsonb)
    from (select (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') as url,
                 (select decrypted_secret from vault.decrypted_secrets where name = 'push_secret') as secret) s
    where s.url is not null and s.secret is not null
  $q$;
exception when others then
  raise warning 'kick_push failed: %', sqlerrm;
end $$;

create or replace function app_private.notify(
  p_user uuid, p_tag text, p_url text, p_title_en text, p_title_ta text, p_body_en text, p_body_ta text
) returns void
language plpgsql set search_path = '' as $$
declare
  v_lang text;
begin
  if not exists (select 1 from public.push_subscriptions s where s.user_id = p_user) then
    return;
  end if;
  select language into v_lang from public.profiles where id = p_user;
  insert into public.push_queue (user_id, payload)
  values (p_user, jsonb_build_object(
    'title', case when v_lang = 'en' then p_title_en else p_title_ta end,
    'body', case when v_lang = 'en' then p_body_en else p_body_ta end,
    'url', p_url, 'tag', p_tag));
  perform app_private.kick_push();
end $$;

-- Service role only (the Edge Function): take up to p_limit queued pushes.
create or replace function public.push_claim(p_limit int default 200) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_out jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  with batch as (
    delete from public.push_queue q
    where q.id in (select x.id from public.push_queue x order by x.id limit p_limit for update skip locked)
    returning q.user_id, q.payload, q.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'payload', b.payload)), '[]'::jsonb)
    into v_out
  from batch b
  join public.push_subscriptions s on s.user_id = b.user_id
  where b.created_at > now() - interval '1 hour'; -- stale invites are not worth sending
  return v_out;
end $$;

-- Service role only: forget subscriptions the push service says are gone.
create or replace function public.push_drop(p_endpoints text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  delete from public.push_subscriptions where endpoint = any(p_endpoints);
end $$;

-- Room invite cards in chat → push to the invited friend.
create or replace function app_private.push_on_invite() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_name text;
begin
  if new.kind = 'invite' and new.recipient_id is not null then
    select coalesce(display_name, username) into v_name from public.profiles where id = new.sender_id;
    perform app_private.notify(
      new.recipient_id, 'invite:' || new.body, '/r/' || new.body,
      '⚔️ Room invite', '⚔️ அறை அழைப்பு',
      v_name || ' invited you · code ' || new.body || ' · ' || coalesce(new.meta ->> 'stake', '0') || ' coins',
      v_name || ' உங்களை அழைக்கிறார் · குறியீடு ' || new.body || ' · ' || coalesce(new.meta ->> 'stake', '0') || ' நாணயங்கள்');
  end if;
  return null;
end $$;

create trigger chat_invite_push after insert on public.chat_messages
  for each row execute function app_private.push_on_invite();

-- New friend request → push to the other player.
create or replace function app_private.push_on_friend_request() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_name text;
  v_target uuid := case when new.requested_by = new.user_a then new.user_b else new.user_a end;
begin
  if new.status = 'pending' then
    select coalesce(display_name, username) into v_name from public.profiles where id = new.requested_by;
    perform app_private.notify(
      v_target, 'friend:' || new.requested_by, '/friends',
      '👋 Friend request', '👋 நண்பர் கோரிக்கை',
      v_name || ' wants to practise with you', v_name || ' உங்களுடன் பயிற்சி செய்ய விரும்புகிறார்');
  end if;
  return null;
end $$;

create trigger friendship_request_push after insert on public.friendships
  for each row execute function app_private.push_on_friend_request();

-- 19:30 IST: remind players on a 2+ day streak who have not played today.
create or replace function app_private.cron_streak_reminders() returns int
language plpgsql set search_path = '' as $$
declare
  v_p record;
  v_n int := 0;
begin
  for v_p in
    select p.id, p.streak_count from public.profiles p
    where p.streak_count >= 2 and p.streak_last_date = app_private.ist_today() - 1
      and exists (select 1 from public.push_subscriptions s where s.user_id = p.id)
  loop
    perform app_private.notify(
      v_p.id, 'streak', '/solo',
      '🔥 Keep your ' || v_p.streak_count || '-day streak', '🔥 உங்கள் ' || v_p.streak_count || ' நாள் தொடரைக் காப்பாற்றுங்கள்',
      'One 5-minute solo set keeps it alive.', 'ஒரு 5 நிமிடப் பயிற்சி போதும்.');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Every minute: tidy the Quick Match queue, drop stale pushes, retry the rest.
create or replace function app_private.cron_minutely_phase2() returns void
language plpgsql set search_path = '' as $$
begin
  delete from public.quick_queue where last_poll_at < now() - interval '1 minute';
  delete from public.push_queue where created_at < now() - interval '1 hour';
  if exists (select 1 from public.push_queue) then
    perform app_private.kick_push();
  end if;
end $$;
