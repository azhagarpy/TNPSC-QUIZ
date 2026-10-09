-- Realtime authorization. Clients join private channels only:
--   room:<room uuid>          lobby/match events, chat, emoji, quick phrases, presence
--   dm:<smaller>:<larger>     1:1 messages, typing indicator, read receipts
-- Server events are sent from the database with realtime.send(..., private => true).

create policy "game channels: receive" on realtime.messages
  for select to authenticated
  using (
    (realtime.topic() like 'room:%' and public.is_room_member(substring(realtime.topic() from 6)))
    or (realtime.topic() like 'dm:%' and public.is_dm_peer(realtime.topic()))
  );

create policy "game channels: send" on realtime.messages
  for insert to authenticated
  with check (
    (realtime.topic() like 'room:%' and public.is_room_member(substring(realtime.topic() from 6)))
    or (realtime.topic() like 'dm:%' and public.is_dm_peer(realtime.topic()))
  );
