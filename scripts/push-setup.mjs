// One-time web-push setup. Generates VAPID keys and a shared secret into
// supabase/functions/.env (gitignored), puts the public key in .env.local as
// VITE_VAPID_PUBLIC_KEY, and stores the project URL + secret in Supabase Vault
// so the database can call the send-push Edge Function. Secrets are never
// printed. Safe to re-run: existing keys are kept.
//
//   npm run push:setup
import webpush from 'web-push';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const fnEnvPath = join(root, 'supabase', 'functions', '.env');
const localEnvPath = join(root, '.env.local');

const parse = (file) =>
  existsSync(file)
    ? Object.fromEntries(
        readFileSync(file, 'utf8')
          .split(/\r?\n/)
          .filter((l) => /^[A-Z_]+=/.test(l))
          .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
      )
    : {};

const local = parse(localEnvPath);
let fn = parse(fnEnvPath);
if (!fn.VAPID_PRIVATE_KEY) {
  const keys = webpush.generateVAPIDKeys();
  fn = {
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
    VAPID_SUBJECT: local.VITE_CONTACT_EMAIL ? `mailto:${local.VITE_CONTACT_EMAIL}` : local.VITE_SUPABASE_URL,
    PUSH_SECRET: randomBytes(24).toString('base64url'),
  };
  writeFileSync(fnEnvPath, Object.entries(fn).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  console.log('✓ generated VAPID keys and push secret → supabase/functions/.env');
} else {
  console.log('✓ keeping existing keys in supabase/functions/.env');
}

let envText = existsSync(localEnvPath) ? readFileSync(localEnvPath, 'utf8') : '';
if (/^VITE_VAPID_PUBLIC_KEY=/m.test(envText)) envText = envText.replace(/^VITE_VAPID_PUBLIC_KEY=.*$/m, `VITE_VAPID_PUBLIC_KEY=${fn.VAPID_PUBLIC_KEY}`);
else envText += `\n# Web push (public half of the VAPID key pair)\nVITE_VAPID_PUBLIC_KEY=${fn.VAPID_PUBLIC_KEY}\n`;
writeFileSync(localEnvPath, envText);
console.log('✓ VITE_VAPID_PUBLIC_KEY set in .env.local (rebuild the app to pick it up)');

if (local.SUPABASE_DB_URL && local.VITE_SUPABASE_URL) {
  const db = new pg.Client({ connectionString: local.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  for (const [name, value] of [['project_url', local.VITE_SUPABASE_URL], ['push_secret', fn.PUSH_SECRET]]) {
    const { rows } = await db.query('select id from vault.secrets where name = $1', [name]);
    if (rows.length) await db.query('select vault.update_secret($1, $2)', [rows[0].id, value]);
    else await db.query('select vault.create_secret($1, $2)', [value, name]);
  }
  await db.end();
  console.log('✓ project_url and push_secret stored in Supabase Vault');
} else {
  console.log('• SUPABASE_DB_URL missing: Vault secrets not stored');
}

const ref = (local.VITE_SUPABASE_URL ?? '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? '<ref>';
console.log(`
Next (needs \`npx supabase login\` once):
  npx supabase secrets set --env-file supabase/functions/.env --project-ref ${ref}
  npx supabase functions deploy send-push --no-verify-jwt --project-ref ${ref}`);
