import type { PostHog } from 'posthog-js';
import { getPrefs, setPrefs } from './prefs';

// Crash reports (Sentry) and product analytics (PostHog). Both load after the
// first screen is up, so they never count against the first-load budget.
// Neither receives emails or names: players are identified by their user id.
// Analytics only run when the player has opted in (Onboarding or Profile).

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://us.i.posthog.com';

type SentryModule = typeof import('@sentry/browser');
let sentry: SentryModule | null = null;
let posthog: PostHog | null = null;
let userId: string | null = null;
const earlyErrors: unknown[] = [];
const earlyEvents: [string, Record<string, unknown>][] = [];

export const analyticsAvailable = !!POSTHOG_KEY;

export function initTelemetry() {
  // Until Sentry has loaded, keep the first few errors and send them after.
  const buffer = (e: unknown) => {
    if (!sentry && earlyErrors.length < 10) earlyErrors.push(e);
  };
  window.addEventListener('error', (e) => buffer(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => buffer(e.reason));

  const idle = (cb: () => void) =>
    'requestIdleCallback' in window ? window.requestIdleCallback(cb, { timeout: 6000 }) : setTimeout(cb, 4000);
  idle(() => {
    if (SENTRY_DSN) void loadSentry();
    if (POSTHOG_KEY && getPrefs().analytics) void loadPosthog();
  });
}

async function loadSentry() {
  const s = await import('@sentry/browser');
  s.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: `g4quiz@${import.meta.env.VITE_APP_VERSION ?? 'dev'}`,
    // No user info, cookies, headers, bodies or query strings: just the error.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    tracesSampleRate: 0,
  });
  if (userId) s.setUser({ id: userId });
  sentry = s;
  earlyErrors.splice(0).forEach((e) => s.captureException(e));
}

async function loadPosthog() {
  if (posthog || !POSTHOG_KEY) return;
  const { default: ph } = await import('posthog-js');
  ph.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    persistence: 'localStorage',
    person_profiles: 'identified_only',
    mask_all_text: true,
  });
  if (userId) ph.identify(userId);
  posthog = ph;
  earlyEvents.splice(0).forEach(([e, p]) => ph.capture(e, p));
}

export function captureError(e: unknown) {
  if (sentry) sentry.captureException(e);
  else if (earlyErrors.length < 10) earlyErrors.push(e);
}

export function identify(id: string | null) {
  userId = id;
  if (!id) return;
  sentry?.setUser({ id });
  posthog?.identify(id);
}

export function track(event: string, props: Record<string, unknown> = {}) {
  if (!POSTHOG_KEY || !getPrefs().analytics) return;
  if (posthog) posthog.capture(event, props);
  else if (earlyEvents.length < 50) earlyEvents.push([event, props]);
}

export function setAnalytics(on: boolean) {
  setPrefs({ analytics: on });
  if (on) void loadPosthog();
  else posthog?.opt_out_capturing();
}
