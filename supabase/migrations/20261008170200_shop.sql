-- Cosmetics shop (plan: coin sinks). Avatars, avatar frames, emoji packs and
-- room themes, 200–5,000 coins, some gated by level. Coins only: nothing here
-- can be bought with money. Item visuals live in src/lib/cosmetics.ts; the keys
-- must match (a unit test checks).

create table public.shop_items (
  key       text primary key,
  kind      text not null check (kind in ('avatar', 'frame', 'emoji_pack', 'theme')),
  name_en   text not null,
  name_ta   text not null,
  price     int not null check (price between 0 and 5000),
  min_level int not null default 1,
  sort      smallint not null
);

insert into public.shop_items (key, kind, name_en, name_ta, price, min_level, sort) values
  ('av_graduate',  'avatar',     'Graduate',          'பட்டதாரி',             300,  1, 1),
  ('av_teacher',   'avatar',     'Teacher',           'ஆசிரியர்',             300,  2, 2),
  ('av_tiger',     'avatar',     'Royal Tiger',       'அரசப் புலி',           500,  3, 3),
  ('av_crown',     'avatar',     'Crown',             'மகுடம்',               800,  5, 4),
  ('av_unicorn',   'avatar',     'Unicorn',           'ஒற்றைக்கொம்புக் குதிரை', 800,  5, 5),
  ('av_dragon',    'avatar',     'Dragon',            'டிராகன்',              1200, 8, 6),
  ('fr_gold',      'frame',      'Gold ring',         'தங்க வளையம்',          200,  1, 1),
  ('fr_jasmine',   'frame',      'Jasmine',           'மல்லிகை',              400,  2, 2),
  ('fr_kolam',     'frame',      'Kolam',             'கோலம்',                600,  3, 3),
  ('fr_peacock',   'frame',      'Peacock',           'மயில்',                1000, 5, 4),
  ('fr_fire',      'frame',      'Fire',              'நெருப்பு',             1500, 8, 5),
  ('fr_champion',  'frame',      'Champion',          'சாம்பியன்',            5000, 20, 6),
  ('ep_study',     'emoji_pack', 'Study pack',        'படிப்புத் தொகுப்பு',     400,  1, 1),
  ('ep_festival',  'emoji_pack', 'Festival pack',     'திருவிழாத் தொகுப்பு',    500,  1, 2),
  ('ep_cinema',    'emoji_pack', 'Cinema mass pack',  'சினிமா மாஸ் தொகுப்பு',   500,  2, 3),
  ('th_temple',    'theme',      'Temple gold',       'கோயில் தங்கம்',         1000, 3, 1),
  ('th_marina',    'theme',      'Marina blue',       'மெரினா நீலம்',          1000, 3, 2),
  ('th_nilgiri',   'theme',      'Nilgiri green',     'நீலகிரி பச்சை',         1500, 5, 3),
  ('th_pongal',    'theme',      'Pongal festival',   'பொங்கல் திருவிழா',      2500, 8, 4),
  ('th_night',     'theme',      'Chennai night',     'சென்னை இரவு',          5000, 15, 5);

create table public.user_items (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  item_key    text not null references public.shop_items (key) on delete cascade,
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_key)
);

alter table public.shop_items enable row level security;
alter table public.user_items enable row level security;
create policy "shop catalog is public" on public.shop_items for select to anon, authenticated using (true);
create policy "read own items" on public.user_items for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.shop_items, public.user_items from anon, authenticated;

create or replace function public.shop_catalog() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_p public.profiles;
begin
  select * into v_p from public.profiles where id = v_me;
  return jsonb_build_object(
    'balance', v_p.coins - v_p.escrow,
    'level', v_p.level,
    'equipped', jsonb_build_object('avatar', v_p.avatar, 'frame', v_p.frame, 'theme', v_p.theme),
    'items', (
      select jsonb_agg(to_jsonb(i) || jsonb_build_object('owned', ui.user_id is not null) order by i.kind, i.sort)
      from public.shop_items i
      left join public.user_items ui on ui.item_key = i.key and ui.user_id = v_me)
  );
end $$;

create or replace function public.buy_item(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
  v_item public.shop_items;
  v_level int;
begin
  select * into v_item from public.shop_items where key = p_key;
  if not found then raise exception 'not_found'; end if;
  if exists (select 1 from public.user_items ui where ui.user_id = v_me and ui.item_key = p_key) then
    raise exception 'already_owned';
  end if;
  select level into v_level from public.profiles where id = v_me;
  if v_level < v_item.min_level then raise exception 'level_too_low'; end if;
  perform app_private.spend_coins(v_me, v_item.price, 'shop', null, p_key);
  insert into public.user_items (user_id, item_key) values (v_me, p_key);
  return public.shop_catalog();
end $$;

-- p_key null takes the item off (frame/theme). Base avatars a1–a12 are free.
create or replace function public.equip_item(p_kind text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.uid();
begin
  if p_key is not null
     and not (p_kind = 'avatar' and p_key ~ '^a([1-9]|1[0-2])$')
     and not exists (select 1 from public.user_items ui join public.shop_items i on i.key = ui.item_key
                     where ui.user_id = v_me and ui.item_key = p_key and i.kind = p_kind) then
    raise exception 'not_owned';
  end if;
  if p_kind = 'avatar' then
    update public.profiles set avatar = coalesce(p_key, 'a1') where id = v_me;
  elsif p_kind = 'frame' then
    update public.profiles set frame = p_key where id = v_me;
  elsif p_kind = 'theme' then
    update public.profiles set theme = p_key where id = v_me;
  else
    raise exception 'bad_kind';
  end if;
  return public.shop_catalog();
end $$;

-- Frames of the given players and the room's theme, for lobby/match/result screens.
create or replace function public.public_cosmetics(p_users uuid[], p_room uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'frames', coalesce((select jsonb_object_agg(p.id, p.frame) from public.profiles p
                        where p.id = any(p_users[1:8]) and p.frame is not null), '{}'::jsonb),
    'theme', (select r.theme from public.rooms r where r.id = p_room))
$$;

-- Rooms take the host's equipped theme when created.
create or replace function app_private.room_theme_from_host() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.theme := (select p.theme from public.profiles p where p.id = new.host_id);
  return new;
end $$;

create trigger rooms_theme_from_host before insert on public.rooms
  for each row execute function app_private.room_theme_from_host();

-- Public player cards now include the equipped frame.
create or replace function app_private.public_user(p_user uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', id, 'username', username, 'name', display_name,
                            'avatar', avatar, 'frame', frame, 'level', level, 'district', district)
  from public.profiles where id = p_user
$$;
