import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

// A small history-API router: the app has ~20 screens and needs deep links
// like /r/ABC123 from WhatsApp, not a full routing library.

interface Location {
  path: string;
  query: URLSearchParams;
  state: unknown;
}

interface RouterValue extends Location {
  navigate: (to: string, opts?: { replace?: boolean; state?: unknown }) => void;
  back: (fallback?: string) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

function readLocation(): Location {
  return {
    path: window.location.pathname.replace(/\/+$/, '') || '/',
    query: new URLSearchParams(window.location.search),
    state: window.history.state?.usr ?? null,
  };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(readLocation);

  useEffect(() => {
    const onPop = () => setLoc(readLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string, opts: { replace?: boolean; state?: unknown } = {}) => {
    const entry = { usr: opts.state ?? null, idx: (window.history.state?.idx ?? 0) + (opts.replace ? 0 : 1) };
    if (opts.replace) window.history.replaceState(entry, '', to);
    else window.history.pushState(entry, '', to);
    setLoc(readLocation());
    window.scrollTo(0, 0);
  }, []);

  const back = useCallback(
    (fallback = '/') => {
      if ((window.history.state?.idx ?? 0) > 0) window.history.back();
      else navigate(fallback, { replace: true });
    },
    [navigate],
  );

  const value = useMemo(() => ({ ...loc, navigate, back }), [loc, navigate, back]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter outside RouterProvider');
  return ctx;
}

/** Matches "/r/:code" style patterns. Returns params or null. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export function Link({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
