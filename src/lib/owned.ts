import { useEffect, useSyncExternalStore } from 'react';
import { isDemo, sb } from './supabase';
import { EMOJI_PACKS } from './cosmetics';

// Shop items the player owns (RLS: own rows only), cached for the session.
let owned: string[] = [];
let loaded = false;
const listeners = new Set<() => void>();

export function setOwned(keys: string[]) {
  owned = keys;
  loaded = true;
  listeners.forEach((l) => l());
}

async function load() {
  if (isDemo || loaded) return;
  loaded = true;
  const { data } = await (await sb()).from('user_items').select('item_key');
  if (data) setOwned(data.map((r: { item_key: string }) => r.item_key));
}

export function useOwnedItems() {
  useEffect(() => {
    void load();
  }, []);
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => owned,
  );
}

/** Reactions unlocked by owned emoji packs. */
export function useOwnedEmojis() {
  const items = useOwnedItems();
  return items.flatMap((k) => EMOJI_PACKS[k] ?? []);
}
