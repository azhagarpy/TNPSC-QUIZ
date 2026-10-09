// Live end-to-end check against the real Supabase project. Two temporary
// players (e2e-*@example.invalid) sign in through Supabase Auth, onboard,
// play a 5-question staked room match over the real API and private Realtime
// channels, then delete their accounts with the in-app deletion function.
// Leftovers are removed even if a step fails.
//
// Needs in .env.local: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_DB_URL
// (the DB URL creates the confirmed test users; no secret API key is used).
//
//   npm run e2e:live
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (s) => console.log(`  ✓ ${s}`);
const tag = randomBytes(3).toString('hex');

async function createUser(name) {
  const id = randomUUID();
  const email = `e2e-${name}-${tag}@example.invalid`;
  const password = randomBytes(18).toString('base64url');
  await db.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
       confirmation_token, email_change, email_change_token_new, recovery_token)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
       extensions.crypt($3, extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}', $4, now(), now(), '', '', '', '')`,
    [id, email, password, JSON.stringify({ full_name: `E2E ${name}` })],
  );
  await db.query(
    `insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
     values (gen_random_uuid(), $1, $3, $2, 'email', now(), now(), now())`,
    [id, JSON.stringify({ sub: id, email, email_verified: true }), id],
  );
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return { id, email, client };
}

async function rpc(user, fn, args = {}) {
  const { data, error } = await user.client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

async function channel(user, topic) {
  await user.client.realtime.setAuth();
  const events = [];
  const ch = user.client.channel(topic, { config: { private: true, broadcast: { self: false } } });
  for (const ev of ['lobby', 'match_started', 'answered', 'phase', 'match_settled', 'emoji']) {
    ch.on('broadcast', { event: ev }, (m) => events.push({ event: ev, payload: m.payload }));
  }
  await new Promise((resolve, reject) => {
    ch.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') resolve();
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(`${topic}: ${status} ${err?.message ?? ''}`));
    });
  });
  return { ch, events };
}

async function waitFor(fn, label, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${label}`);
}

let users = [];
try {
  const A = await createUser('arun');
  const B = await createUser('banu');
  users = [A, B];
  step('two confirmed test players signed in through Supabase Auth');

  for (const [u, name] of [[A, 'arun'], [B, 'banu']]) {
    await rpc(u, 'complete_onboarding', {
      p_username: `e2e_${name}_${tag}`, p_name: `E2E ${name}`, p_district: 'Madurai', p_exam_year: 2027,
      p_language: 'ta', p_is_adult: true, p_consent: true,
    });
    const bonus = await rpc(u, 'claim_signup_bonus', { p_fp: randomBytes(32).toString('hex') });
    assert.equal(bonus.coins, 500);
  }
  step('onboarding + 500 starter coins via RPC');

  const { data: hidden } = await A.client.from('questions').select('id').limit(1);
  assert.deepEqual(hidden, [], 'questions hidden from players');
  const { data: ledger } = await A.client.from('coin_ledger').select('user_id');
  assert.ok(ledger.length > 0 && ledger.every((r) => r.user_id === A.id), 'ledger shows own rows only');
  step('RLS through the real API: questions hidden, own ledger only');

  const room = await rpc(A, 'create_room', { p_size: 2, p_stake: 50, p_count: 5 });
  await rpc(B, 'join_room', { p_code: room.code });
  const chA = await channel(A, `room:${room.id}`);
  const chB = await channel(B, `room:${room.id}`);
  step(`both joined private Realtime channel room:${room.id.slice(0, 8)}…`);

  chA.ch.send({ type: 'broadcast', event: 'emoji', payload: { user_id: A.id, emoji: '🔥' } });
  await waitFor(() => chB.events.some((e) => e.event === 'emoji'), 'client emoji broadcast');
  await rpc(B, 'set_ready', { p_room: room.id, p_ready: true });
  await waitFor(() => chA.events.some((e) => e.event === 'lobby'), 'server lobby event');
  step('client broadcast (emoji) and server broadcast (lobby) both delivered');

  const { match_id } = await rpc(A, 'start_match', { p_room: room.id });
  const started = await waitFor(() => chB.events.find((e) => e.event === 'match_started'), 'match_started');
  assert.equal(started.payload.match_id, match_id);
  step('match_started reached the other player over Realtime');

  for (let i = 0; i < 5; i++) {
    const s = await waitFor(async () => {
      const x = await rpc(A, 'match_sync', { p_match: match_id });
      return x.phase === 'question' && x.index === i ? x : null;
    }, `question ${i + 1}`, 15000);
    assert.equal(s.question.answer, undefined, 'no answer key while open');
    await rpc(A, 'submit_answer', { p_match: match_id, p_index: i, p_choice: 0 });
    await rpc(B, 'submit_answer', { p_match: match_id, p_index: i, p_choice: 1 });
    const r = await waitFor(async () => {
      const x = await rpc(B, 'match_sync', { p_match: match_id });
      return x.phase === 'reveal' ? x : null;
    }, `reveal ${i + 1}`);
    assert.ok(Number.isInteger(r.question.answer), 'answer key after close');
  }
  await waitFor(() => chA.events.some((e) => e.event === 'phase') || chA.events.some((e) => e.event === 'answered'), 'answer events');
  step('5 questions played: synced opens, server timing, early reveals, answer keys only after close');

  const result = await waitFor(async () => {
    const x = await rpc(B, 'finish_match', { p_match: match_id });
    return x.status === 'settled' ? x : null;
  }, 'settlement', 20000);
  const payouts = result.players.map((p) => p.payout).sort((a, b) => b - a);
  assert.ok(payouts[0] === 90 || (payouts[0] === 45 && payouts[1] === 45), `pot split ${payouts}`);
  for (const u of [A, B]) {
    const home = await rpc(u, 'home_summary');
    const { data: rows } = await u.client.from('coin_ledger').select('amount');
    assert.equal(home.profile.coins, rows.reduce((s, r) => s + r.amount, 0));
    assert.equal(home.profile.escrow, 0);
  }
  step(`settled once: payouts ${payouts.join('/')} of a 100-coin pot, balances match the ledger`);

  await A.client.removeChannel(chA.ch);
  await B.client.removeChannel(chB.ch);
  for (const u of users) await rpc(u, 'delete_my_account');
  const { rows: left } = await db.query('select count(*)::int as n from auth.users where id = any($1)', [users.map((u) => u.id)]);
  assert.equal(left[0].n, 0);
  users = [];
  step('in-app account deletion removed both auth users and their data');
  console.log('\nLive end-to-end check passed.');
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  process.exitCode = 1;
} finally {
  // Remove anything this run created, even after a failure part-way through.
  const { rowCount } = await db.query(`delete from auth.users where email like 'e2e-%-' || $1 || '@example.invalid'`, [tag]);
  if (rowCount) console.log(`  (cleaned up ${rowCount} test user(s))`);
  await db.end();
  process.exit();
}
