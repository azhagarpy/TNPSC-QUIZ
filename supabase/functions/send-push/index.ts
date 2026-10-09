// Sends queued web-push notifications (room invites, friend requests, streak
// reminders). Called asynchronously through pg_net by app_private.kick_push()
// whenever something is queued, and retried by the minute cron.
//
// Deploy:  npx supabase functions deploy send-push --no-verify-jwt --project-ref <ref>
// Secrets: npx supabase secrets set --env-file supabase/functions/.env --project-ref <ref>
//          (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_SECRET; made by `npm run push:setup`)
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

interface QueuedPush {
  endpoint: string;
  p256dh: string;
  auth: string;
  payload: { title: string; body: string; url: string; tag: string };
}

const secret = Deno.env.get('PUSH_SECRET');
webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);

// Service-role access: the legacy key if present, else the new secret key.
const serviceKey =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  (JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>).default;
const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (!secret || req.headers.get('x-push-secret') !== secret) {
    return new Response('forbidden', { status: 403 });
  }
  const { data, error } = await admin.rpc('push_claim', { p_limit: 200 });
  if (error) return new Response(error.message, { status: 500 });

  const gone: string[] = [];
  let sent = 0;
  await Promise.all(
    ((data ?? []) as QueuedPush[]).map(async (item) => {
      try {
        await webpush.sendNotification(
          { endpoint: item.endpoint, keys: { p256dh: item.p256dh, auth: item.auth } },
          JSON.stringify(item.payload),
          { TTL: 3600, urgency: 'high' },
        );
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(item.endpoint); // unsubscribed or expired
        else console.error('push failed', status, (e as Error).message);
      }
    }),
  );
  if (gone.length) await admin.rpc('push_drop', { p_endpoints: gone });
  return Response.json({ sent, gone: gone.length });
});
