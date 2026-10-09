import { get, set } from 'idb-keyval';
import { api } from './api';
import type { PackQuestion } from './types';

// Offline solo practice. The pack (questions with answers) lives in IndexedDB;
// results queue up here and the server re-checks them on sync (max 100 coins
// per sync). Pack questions count as "seen", so rooms keep them out for 14 days.

export interface StoredPack {
  packId: string;
  issuedAt: string;
  questions: PackQuestion[];
  used: number[];
}

export interface PendingResult {
  q: number;
  c: number | null;
  t: number;
}

const packKey = (user: string) => `g4.pack.${user}`;
const pendingKey = (user: string) => `g4.pending.${user}`;

export async function loadPack(user: string): Promise<StoredPack | null> {
  try {
    return (await get<StoredPack>(packKey(user))) ?? null;
  } catch {
    return null;
  }
}

export async function downloadPack(user: string): Promise<StoredPack> {
  const pack = await api.offlinePack();
  const stored: StoredPack = { packId: pack.pack_id, issuedAt: pack.issued_at, questions: pack.questions, used: [] };
  await set(packKey(user), stored);
  return stored;
}

export function unusedQuestions(pack: StoredPack) {
  const used = new Set(pack.used);
  return pack.questions.filter((q) => !used.has(q.id));
}

export async function recordOfflineSet(user: string, packId: string, results: PendingResult[]) {
  const pack = await loadPack(user);
  if (pack) await set(packKey(user), { ...pack, used: [...pack.used, ...results.map((r) => r.q)] });
  const pending = (await get<Record<string, PendingResult[]>>(pendingKey(user))) ?? {};
  pending[packId] = [...(pending[packId] ?? []), ...results];
  await set(pendingKey(user), pending);
}

/** Sends queued offline results. Returns coins credited (0 if nothing to sync or still offline). */
export async function syncPending(user: string): Promise<number> {
  let pending: Record<string, PendingResult[]>;
  try {
    pending = (await get<Record<string, PendingResult[]>>(pendingKey(user))) ?? {};
  } catch {
    return 0;
  }
  let coins = 0;
  for (const [packId, results] of Object.entries(pending)) {
    if (!results.length) continue;
    try {
      const r = await api.syncOffline(packId, results);
      coins += r.coins;
      delete pending[packId];
      await set(pendingKey(user), pending);
    } catch {
      break; // still offline or server busy: keep for next time
    }
  }
  return coins;
}
