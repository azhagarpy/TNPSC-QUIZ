import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { strings, type StringKey } from './strings';
import { ApiError } from './api';
import type { Lang } from './types';

type Vars = Record<string, string | number | null | undefined>;

interface I18n {
  lang: Lang;
  /** False until the player has picked a language once on this device. */
  chosen: boolean;
  setLang: (l: Lang) => void;
  t: (key: StringKey, vars?: Vars) => string;
  /** Picks the Tamil or English variant of bilingual content. */
  pick: <T>(ta: T | null | undefined, en: T | null | undefined) => T | null | undefined;
  errorText: (e: unknown) => string;
}

const I18nContext = createContext<I18n | null>(null);
const STORAGE_KEY = 'g4.lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ta' || saved === 'en') return saved;
  } catch {
    /* storage unavailable */
  }
  return navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'ta';
}

export function hasChosenLang() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [chosen, setChosen] = useState(hasChosenLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    setChosen(true);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<I18n>(() => {
    const idx = lang === 'ta' ? 1 : 0;
    const t = (key: StringKey, vars?: Vars) => {
      let s: string = strings[key]?.[idx] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v ?? ''));
      return s;
    };
    return {
      lang,
      chosen,
      setLang,
      t,
      pick: (ta, en) => (lang === 'ta' ? (ta ?? en) : (en ?? ta)),
      errorText: (e) => {
        const code = e instanceof ApiError ? e.code : 'unknown';
        const key = `err.${code}` as StringKey;
        return key in strings ? t(key, { detail: e instanceof ApiError ? (e.detail ?? '') : '' }) : t('err.unknown');
      },
    };
  }, [lang, chosen, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}
