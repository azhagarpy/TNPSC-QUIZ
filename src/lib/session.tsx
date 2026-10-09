import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import { isDemo, sb } from './supabase';
import { demoSummary } from './demo';
import { syncPending } from './offline';
import type { HomeSummary, Profile } from './types';

type Status = 'loading' | 'signedOut' | 'ready';

interface Session {
  status: Status;
  userId: string | null;
  email: string | null;
  summary: HomeSummary | null;
  profile: Profile | null;
  /** True when the server could not be reached and a cached summary is shown. */
  offline: boolean;
  refresh: () => Promise<HomeSummary | null>;
  patchProfile: (p: Partial<Profile>) => void;
  signOut: () => Promise<void>;
  syncedCoins: number;
  clearSynced: () => void;
}

const SessionContext = createContext<Session | null>(null);
const CACHE = 'g4.summary';

function cached(userId: string): HomeSummary | null {
  try {
    const s = JSON.parse(localStorage.getItem(CACHE) ?? 'null') as HomeSummary | null;
    return s && s.profile.id === userId ? s : null;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(isDemo ? 'ready' : 'loading');
  const [userId, setUserId] = useState<string | null>(isDemo ? 'demo' : null);
  const [email, setEmail] = useState<string | null>(null);
  const [summary, setSummary] = useState<HomeSummary | null>(isDemo ? demoSummary() : null);
  const [offline, setOffline] = useState(false);
  const [syncedCoins, setSyncedCoins] = useState(0);

  const refresh = useCallback(async () => {
    if (isDemo) {
      const s = demoSummary();
      setSummary(s);
      return s;
    }
    if (!userId) return null;
    try {
      const s = await api.homeSummary();
      setSummary(s);
      setOffline(false);
      try {
        localStorage.setItem(CACHE, JSON.stringify(s));
      } catch {
        /* ignore */
      }
      return s;
    } catch {
      const c = cached(userId);
      if (c) setSummary((prev) => prev ?? c);
      setOffline(true);
      return c;
    }
  }, [userId]);

  useEffect(() => {
    if (isDemo) return;
    let unsubscribe: (() => void) | undefined;
    let alive = true;
    // Load the client once the first screen has painted (idle), so it never
    // competes with the first render on slow phones.
    const start = (cb: () => void) =>
      'requestIdleCallback' in window ? window.requestIdleCallback(cb, { timeout: 800 }) : setTimeout(cb, 50);
    start(() => void sb().then((client) => {
      if (!alive) return;
      client.auth.getSession().then(({ data }) => {
        setUserId(data.session?.user.id ?? null);
        setEmail(data.session?.user.email ?? null);
        if (!data.session) setStatus('signedOut');
      });
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        setUserId(session?.user.id ?? null);
        setEmail(session?.user.email ?? null);
        if (!session) {
          setSummary(null);
          setStatus('signedOut');
        }
      });
      unsubscribe = () => data.subscription.unsubscribe();
    }));
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (isDemo || !userId) return;
    let alive = true;
    (async () => {
      await refresh();
      if (!alive) return;
      setStatus('ready'); // summary may be null when offline with no cache: App shows OfflineHome
      const coins = await syncPending(userId);
      if (coins > 0 && alive) {
        setSyncedCoins(coins);
        void refresh();
      }
    })();
    const onOnline = async () => {
      const coins = await syncPending(userId);
      if (coins > 0) setSyncedCoins(coins);
      void refresh();
    };
    window.addEventListener('online', onOnline);
    return () => {
      alive = false;
      window.removeEventListener('online', onOnline);
    };
  }, [userId, refresh]);

  const value = useMemo<Session>(
    () => ({
      status,
      userId,
      email,
      summary,
      profile: summary?.profile ?? null,
      offline,
      refresh,
      patchProfile: (p) => setSummary((s) => (s ? { ...s, profile: { ...s.profile, ...p } } : s)),
      signOut: async () => {
        if (isDemo) return;
        await (await sb()).auth.signOut();
        try {
          localStorage.removeItem(CACHE);
        } catch {
          /* ignore */
        }
      },
      syncedCoins,
      clearSynced: () => setSyncedCoins(0),
    }),
    [status, userId, email, summary, offline, refresh, syncedCoins],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession outside SessionProvider');
  return ctx;
}
