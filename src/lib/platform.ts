// Browser glue: fingerprint for the sign-up bonus limit, sharing, PWA install.

export async function deviceFingerprint(): Promise<string> {
  let id = '';
  try {
    id = localStorage.getItem('g4.device') ?? '';
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('g4.device', id);
    }
  } catch {
    /* private mode: the stable signals below still apply */
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  // Only a SHA-256 hash leaves the phone.
  const raw = [
    nav.userAgent, nav.language, nav.hardwareConcurrency, nav.deviceMemory, screen.width, screen.height,
    screen.colorDepth, Intl.DateTimeFormat().resolvedOptions().timeZone, id,
  ].join('|');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function whatsappUrl(text: string) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export async function shareOrWhatsapp(text: string, url: string) {
  if (navigator.share) {
    try {
      await navigator.share({ text, url });
      return;
    } catch {
      /* cancelled or unsupported: fall back to WhatsApp */
    }
  }
  window.open(whatsappUrl(`${text} ${url}`), '_blank', 'noopener');
}

export function roomLink(code: string) {
  return `${window.location.origin}/r/${code}`;
}

// ---------------------------------------------------------------------------
// PWA install prompt. Captured early; shown after the first finished match/set.
// ---------------------------------------------------------------------------

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

export function captureInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

export function canInstall() {
  return !isStandalone() && (deferred !== null || isIos());
}

export function onInstallChange(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export async function promptInstall() {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  listeners.forEach((l) => l());
  return outcome === 'accepted';
}
