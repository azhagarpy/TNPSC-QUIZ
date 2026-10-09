-- Email + password accounts with a username; sign in with username OR email.
--
-- Supabase Auth signs in by email only. resolve_login() turns a username into
-- the account email, but only after checking the password, so nobody can use
-- it to collect emails. Failed attempts are rate-limited per login and per IP
-- (this endpoint sits in front of Supabase Auth's own rate limits).
-- Requires Authentication → Email → "Confirm email" OFF (no email is sent).

create table app_private.login_failures (
  id    bigint generated always as identity primary key,
  login text not null,
  ip    text,
  at    timestamptz not null default now()
);
create index login_failures_login_idx on app_private.login_failures (login, at);
create index login_failures_ip_idx on app_private.login_failures (ip, at);

create or replace function app_private.request_ip() returns text
language sql stable set search_path = '' as $$
  select nullif(btrim(split_part(coalesce(
    current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1)), '')
$$;

-- Registration form: is this username free? (Usernames are public anyway.)
create or replace function public.username_available(p_username text) returns boolean
language sql stable security definer set search_path = '' as $$
  select lower(btrim(p_username)) ~ '^[a-z0-9_]{3,20}$'
     and not exists (select 1 from public.profiles p where p.username = lower(btrim(p_username)))
$$;

-- Returns the email to sign in with, or null for a wrong login (not an error:
-- raising would roll back the failure record and defeat the rate limit).
-- Raises too_many_attempts when locked out.
create or replace function public.resolve_login(p_login text, p_password text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_login text := lower(btrim(coalesce(p_login, '')));
  v_ip text := app_private.request_ip();
  v_user auth.users;
begin
  delete from app_private.login_failures where at < now() - interval '1 day';
  if (select count(*) from app_private.login_failures f
      where f.login = v_login and f.at > now() - interval '15 minutes') >= 10
     or (v_ip is not null and (select count(*) from app_private.login_failures f
          where f.ip = v_ip and f.at > now() - interval '15 minutes') >= 30) then
    raise exception 'too_many_attempts';
  end if;

  select u.* into v_user from auth.users u
  where (v_login like '%@%' and lower(u.email) = v_login)
     or (v_login not like '%@%' and u.id = (select p.id from public.profiles p where p.username = v_login));

  -- Same work and same answer for an unknown login and a wrong password.
  if v_user.id is null or v_user.encrypted_password is null or v_user.encrypted_password = '' then
    perform extensions.crypt(coalesce(p_password, ''), '$2a$10$abcdefghijklmnopqrstuu');
    insert into app_private.login_failures (login, ip) values (v_login, v_ip);
    return null;
  end if;
  if extensions.crypt(coalesce(p_password, ''), v_user.encrypted_password) <> v_user.encrypted_password then
    insert into app_private.login_failures (login, ip) values (v_login, v_ip);
    return null;
  end if;

  delete from app_private.login_failures where login = v_login;
  return v_user.email;
end $$;

-- New accounts take the username chosen at registration (if still free).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_username text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));
begin
  if v_username !~ '^[a-z0-9_]{3,20}$'
     or exists (select 1 from public.profiles p where p.username = v_username) then
    v_username := null; -- onboarding asks again
  end if;
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    v_username,
    nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name',
                         new.raw_user_meta_data ->> 'name',
                         new.raw_user_meta_data ->> 'username',
                         split_part(coalesce(new.email, ''), '@', 1)), 40), '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- No reset emails: an admin can set a temporary password for a player,
-- who then changes it in Profile.
create or replace function public.admin_reset_password(p_username text, p_password text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform app_private.require_admin();
  if char_length(coalesce(p_password, '')) < 8 then
    raise exception 'weak_password';
  end if;
  select p.id into v_id from public.profiles p where p.username = lower(btrim(p_username));
  if v_id is null then
    raise exception 'user_not_found';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)), updated_at = now()
   where id = v_id;
  delete from app_private.login_failures where login = lower(btrim(p_username));
end $$;

-- API surface: the two sign-in helpers must work before signing in.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.handle_new_user() from authenticated;
revoke execute on function public.push_claim(int) from authenticated;
revoke execute on function public.push_drop(text[]) from authenticated;
grant execute on function public.username_available(text) to anon;
grant execute on function public.resolve_login(text, text) to anon;
revoke execute on all functions in schema app_private from public, anon, authenticated;
