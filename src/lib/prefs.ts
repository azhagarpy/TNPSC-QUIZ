import { useSyncExternalStore } from 'react';

// Per-device preferences kept in localStorage (never needed by the server).

export interface Prefs {
  sound: boolean;
  haptics: boolean;
  batterySaver: boolean;
  mutedUsers: string[];
  installDismissed: boolean;
  finishedFirst: boolean;
  analytics: boolean; // opted in to anonymous usage analytics
  chestOpenedOn: string | null; // IST date the home chest last played its opening
}

const KEY = 'g4.prefs';
const defaults: Prefs = { sound: true, haptics: true, batterySaver: false, mutedUsers: [], installDismissed: false, finishedFirst: false, analytics: false, chestOpenedOn: null };
let current: Prefs = load();
const listeners = new Set<() => void>();

function load(): Prefs {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...defaults };
  }
}

export function getPrefs() {
  return current;
}

export function setPrefs(patch: Partial<Prefs>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable: keep in memory */
  }
  listeners.forEach((l) => l());
}

export function usePrefs() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
