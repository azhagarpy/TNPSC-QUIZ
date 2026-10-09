import { useEffect, useState } from 'react';
import { api } from './api';
import { isDemo } from './supabase';
import { THEMES } from './cosmetics';
import type { Cosmetics } from './types';

/** Frames of the listed players and the room's theme background (lobby, match, result). */
export function useRoomCosmetics(userIds: string[], roomId: string | null | undefined) {
  const [c, setC] = useState<Cosmetics>({ frames: {}, theme: null });
  const key = [...userIds].sort().join(',');
  useEffect(() => {
    if (isDemo || !key) return;
    api.publicCosmetics(key.split(','), roomId ?? null).then(setC).catch(() => {});
  }, [key, roomId]);
  return { frames: c.frames, backdrop: c.theme ? THEMES[c.theme]?.background : undefined };
}
