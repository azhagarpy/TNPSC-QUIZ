import { api } from './api';
import { isIos, isStandalone } from './platform';

// Web push for room invites, friend requests and streak reminders. On iPhone,
// Safari only allows push once the app is installed to the home screen.

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export const pushConfigured = !!VAPID;

export function pushSupported() {
  return pushConfigured && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function keyBytes(base64url: string) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function pushEnabled() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

export async function enablePush(): Promise<'on' | 'denied' | 'install' | 'unsupported'> {
  if (isIos() && !isStandalone()) return 'install';
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID!) }));
  const json = sub.toJSON();
  await api.savePushSubscription(json.endpoint!, json.keys!.p256dh, json.keys!.auth);
  return 'on';
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api.deletePushSubscription(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}
