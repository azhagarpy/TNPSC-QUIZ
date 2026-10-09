// End-to-end test of the database layer. Runs every migration in PGlite (an
// in-process Postgres) with small stand-ins for Supabase's auth and realtime
// schemas, then plays solo sets, a staked room match, chat, friends, admin
// review and the cron jobs as real signed-in players under RLS.
//
//   npm run test:db
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const db = new PGlite();
let passed = 0;

const fail = (e) => {
  console.error(`\n✗ ${e?.message ?? e}`);
  if (e?.where) console.error(`  at ${e.where}`);
  if (e?.query) console.error(`  query: ${e.query}`);
  if (e?.stack && !e.where) console.error(e.stack.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
};
process.on('unhandledRejection', fail);
process.on('uncaughtException', fail);

function ok(name) {
  passed++;
  console.log(`  ✓ ${name}`);
}

// ---------------------------------------------------------------------------
// Supabase stand-ins
// ---------------------------------------------------------------------------
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema auth to service_role;
  grant execute on function auth.jwt(), auth.uid() to authenticated, service_role;

  create schema realtime;
  grant usage on schema realtime to authenticated;
  create table realtime.messages (
    id bigserial primary key, topic text, extension text, event text, payload jsonb,
    private boolean, inserted_at timestamptz default now());
  alter table realtime.messages enable row level security;
  grant select, insert on realtime.messages to authenticated;
  create function realtime.topic() returns text language sql stable as
    $$ select current_setting('realtime.topic', true) $$;
  grant execute on function realtime.topic() to authenticated;
  create function realtime.send(payload jsonb, event text, topic text, private boolean default true)
    returns void language sql as
    $$ insert into realtime.messages (topic, extension, event, payload, private)
       values (topic, 'broadcast', event, payload, private) $$;
`);

const migrationsDir = join(root, 'supabase', 'migrations');
for (const file of readdirSync(migrationsDir).sort()) {
  if (file.includes('cron')) continue; // pg_cron is not in PGlite; jobs are called directly below
  try {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  } catch (e) {
    console.error(`Migration ${file} failed: ${e.message}`);
    process.exit(1);
  }
}
ok('all migrations apply');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function sql(text, params = []) {
  return (await db.query(text, params)).rows;
}

async function as(user, text, params = []) {
  await db.exec(`set role authenticated`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? '']);
  try {
    return (await db.query(text, params)).rows;
  } finally {
    await db.exec(`reset role`);
  }
}

async function rpc(user, fn, args = {}) {
  const names = Object.keys(args);
  const call = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`;
  const rows = await as(user, call, names.map((n) => args[n]));
  return rows[0].r;
}

async function rpcError(user, fn, args = {}) {
  try {
    await rpc(user, fn, args);
  } catch (e) {
    return e.message;
  }
  return null;
}

async function newUser(name) {
  const id = randomUUID();
  await sql(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
    [id, `${name}@example.com`, JSON.stringify({ full_name: name })]);
  return id;
}

async function onboard(id, username, district = 'Madurai') {
  return rpc(id, 'complete_onboarding', {
    p_username: username, p_name: username, p_district: district, p_exam_year: 2027,
    p_language: 'ta', p_is_adult: true, p_consent: true,
  });
}

async function balance(id) {
  const [p] = await sql(`select coins, escrow from public.profiles where id = $1`, [id]);
  return p;
}

async function ledgerSum(id) {
  const [r] = await sql(`select coalesce(sum(amount), 0)::int as s from public.coin_ledger where user_id = $1`, [id]);
  return r.s;
}

// Shift a match's schedule into the past to simulate time passing.
async function travel(match, seconds) {
  await sql(`update public.matches set started_at = started_at - make_interval(secs => $2),
             cur_open_at = cur_open_at - make_interval(secs => $2),
             cur_reveal_at = cur_reveal_at - make_interval(secs => $2) where id = $1`, [match, seconds]);
}

async function correctDisplay(seed, qid) {
  const [r] = await sql(`select app_private.to_display($1, answer::int) as d from public.questions where id = $2`, [seed, qid]);
  return r.d;
}

// ---------------------------------------------------------------------------
// Question bank (synthetic): 120 Tamil + 40 per other unit
// ---------------------------------------------------------------------------
const units = (await sql(`select key from public.units order by sort`)).map((r) => r.key);
const values = [];
for (const unit of units) {
  const count = unit === 'tamil' ? 120 : 40;
  for (let i = 0; i < count; i++) {
    const opts = [0, 1, 2, 3].map((k) => `${unit}-${i}-opt${k}`);
    values.push(sql(`insert into public.questions (unit, subtopic, difficulty, text_ta, text_en, options_ta, options_en,
                      answer, explanation_ta, explanation_en, source, status)
                     values ($1, $2, $3, $4, $5, $6, $7, $8, 'விளக்கம்', 'Explanation', 'test', 'live')`,
      [unit, `${unit}_st${i % 6}`, 1 + (i % 5), `கேள்வி ${unit} ${i}`, unit === 'tamil' ? null : `Question ${unit} ${i}`,
        opts, unit === 'tamil' ? null : opts, i % 4]));
  }
}
await Promise.all(values);
ok(`${values.length} synthetic questions loaded`);

// ---------------------------------------------------------------------------
// Quotas follow exam weights
// ---------------------------------------------------------------------------
{
  const q10 = await sql(`select unit, k from app_private.quotas(10, 'mixed')`);
  const byUnit = Object.fromEntries(q10.map((r) => [r.unit, r.k]));
  const total = q10.reduce((s, r) => s + r.k, 0);
  assert.equal(total, 10);
  assert.equal(byUnit.tamil, 5, 'Tamil gets 50 %');
  const apt = (byUnit.aptitude ?? 0) + (byUnit.reasoning ?? 0);
  assert.equal(apt, 1, 'Aptitude part gets 1 of 10');
  const q200 = await sql(`select unit, k from app_private.quotas(200, 'mixed')`);
  const m = Object.fromEntries(q200.map((r) => [r.unit, r.k]));
  assert.deepEqual(m, { tamil: 100, science: 5, geography: 5, history_india: 10, polity: 15, economy_tn: 20, tn_history: 20, aptitude: 15, reasoning: 10 });
  ok('quotas: 10 → Tamil 5 / Apt 1, 200 → exact exam pattern');
}

// ---------------------------------------------------------------------------
// Sign-up, onboarding, demo quiz, starter coins
// ---------------------------------------------------------------------------
const A = await newUser('arun');
const B = await newUser('banu');
const C = await newUser('chitra');
{
  const [p] = await sql(`select display_name, coins from public.profiles where id = $1`, [A]);
  assert.equal(p.display_name, 'arun');
  assert.equal(p.coins, 0);
  ok('auth trigger creates a profile');

  assert.equal(await rpcError(A, 'solo_start', { p_mode: 'practice' }), 'not_onboarded');
  assert.equal(await rpcError(A, 'complete_onboarding', {
    p_username: 'Arun!', p_name: 'Arun', p_district: 'Madurai', p_exam_year: 2027, p_language: 'ta',
    p_is_adult: true, p_consent: true }), 'bad_username');
  assert.equal(await rpcError(A, 'complete_onboarding', {
    p_username: 'arun', p_name: 'Arun', p_district: 'Madurai', p_exam_year: 2027, p_language: 'ta',
    p_is_adult: false, p_consent: true }), 'consent_required');
  await onboard(A, 'arun');
  await onboard(B, 'banu', 'Chennai');
  await onboard(C, 'chitra');
  assert.equal(await rpcError(C, 'update_profile', { p_changes: JSON.stringify({ username: 'arun' }) }), 'username_taken');
  ok('onboarding validates username, consent and uniqueness');

  // Demo quiz: 3 questions
  const demo = await rpc(A, 'solo_start', { p_mode: 'demo' });
  assert.equal(demo.n, 3);
  for (let i = 0; i < 3; i++) {
    const q = await rpc(A, 'solo_question', { p_session: demo.id, p_index: i });
    assert.equal(q.answer, undefined, 'answer never sent with an open question');
    const right = await correctDisplay(`${demo.id}:${i}`, q.id);
    const rev = await rpc(A, 'solo_answer', { p_session: demo.id, p_index: i, p_choice: right });
    assert.equal(rev.correct, true);
    assert.equal(rev.answer, right);
  }
  const demoSum = await rpc(A, 'solo_finish', { p_session: demo.id });
  assert.equal(demoSum.coins, 0, 'demo earns no coins');

  const fp = 'a'.repeat(64);
  for (const u of [A, B, C]) {
    const bonus = await rpc(u, 'claim_signup_bonus', { p_fp: u === C ? 'b'.repeat(64) : fp });
    assert.equal(bonus.coins, 500);
  }
  const again = await rpc(A, 'claim_signup_bonus', { p_fp: fp });
  assert.equal(again.already, true);
  const D = await newUser('dinesh');
  await onboard(D, 'dinesh');
  const third = await rpc(D, 'claim_signup_bonus', { p_fp: fp });
  assert.equal(third.coins, 0, 'third bonus on the same device is refused');
  assert.equal(third.limited, true);
  ok('demo quiz, 500 starter coins, fingerprint limit');
}

// ---------------------------------------------------------------------------
// RLS: nothing secret is readable, nothing writable
// ---------------------------------------------------------------------------
{
  assert.equal((await as(A, `select * from public.questions`)).length, 0, 'questions hidden');
  assert.equal((await as(A, `select * from public.solo_answers`)).length, 0);
  const own = await as(A, `select * from public.coin_ledger`);
  assert.ok(own.length > 0 && own.every((r) => r.user_id === A), 'ledger: own rows only');
  assert.equal((await as(A, `select * from public.profiles`)).length, 1, 'profiles: own row only');
  await assert.rejects(as(A, `update public.profiles set coins = 999999 where id = '${A}'`));
  await assert.rejects(as(A, `insert into public.coin_ledger (user_id, amount, balance_after, reason) values ('${A}', 1000, 1000, 'x')`));
  await assert.rejects(as(A, `select app_private.post_coins('${A}', 1000, 'hack')`));
  await assert.rejects(sql(`update public.coin_ledger set amount = 1`), /append-only/);
  await assert.rejects(as(null, `select public.home_summary()`), /permission denied|not_authenticated/);
  ok('RLS hides questions/answers/others; ledger append-only; app_private unreachable');
}

// ---------------------------------------------------------------------------
// Solo practice: server timing, coins, cap, streak, revision deck
// ---------------------------------------------------------------------------
{
  const before = (await balance(B)).coins;
  const s = await rpc(B, 'solo_start', { p_mode: 'practice', p_subject: 'polity' });
  assert.equal(s.n, 10);
  let correct = 0;
  for (let i = 0; i < 10; i++) {
    const q = await rpc(B, 'solo_question', { p_session: s.id, p_index: i });
    assert.equal(q.unit, 'polity');
    const right = await correctDisplay(`${s.id}:${i}`, q.id);
    const pick = i < 7 ? right : (right + 1) % 4;
    const r = await rpc(B, 'solo_answer', { p_session: s.id, p_index: i, p_choice: pick });
    if (r.correct) correct++;
    if (i === 2) assert.ok(r.points >= 125, 'third correct in a row earns the streak bonus');
  }
  assert.equal(correct, 7);
  const sum = await rpc(B, 'solo_finish', { p_session: s.id });
  assert.equal(sum.coins, 7 * 5 + 20, '5 per correct + 20 completion');
  assert.equal(sum.streak.streak, 1);
  assert.ok(sum.streak.reward === 20);
  assert.ok(sum.achievements.includes('first_solo'));
  assert.equal(sum.weak.length > 0, true);
  const after = (await balance(B)).coins;
  assert.equal(after - before, 55 + 20 + 50, 'set coins + streak + first_solo achievement');
  const cards = await sql(`select count(*)::int as n from public.revision_cards where user_id = $1`, [B]);
  assert.equal(cards[0].n, 3, 'wrong answers go to the revision deck');
  const again = await rpc(B, 'solo_finish', { p_session: s.id });
  assert.equal(again.coins, sum.coins, 'finish is idempotent');

  // Late answer is treated as no answer.
  const s2 = await rpc(B, 'solo_start', { p_mode: 'practice' });
  const q0 = await rpc(B, 'solo_question', { p_session: s2.id, p_index: 0 });
  await sql(`update public.solo_answers set shown_at = shown_at - interval '30 seconds' where session_id = $1`, [s2.id]);
  const late = await rpc(B, 'solo_answer', { p_session: s2.id, p_index: 0, p_choice: await correctDisplay(`${s2.id}:0`, q0.id) });
  assert.equal(late.correct, false);
  assert.equal(late.choice, null);
  ok('solo practice: streak bonus, coins, revision deck, late answers rejected');

  // Daily solo coin cap (300)
  await sql(`insert into public.coin_ledger (user_id, amount, balance_after, reason) values ($1, 290, 0, 'solo')`, [C]);
  const s3 = await rpc(C, 'solo_start', { p_mode: 'practice' });
  for (let i = 0; i < 10; i++) {
    const q = await rpc(C, 'solo_question', { p_session: s3.id, p_index: i });
    await rpc(C, 'solo_answer', { p_session: s3.id, p_index: i, p_choice: await correctDisplay(`${s3.id}:${i}`, q.id) });
  }
  const capped = await rpc(C, 'solo_finish', { p_session: s3.id });
  assert.equal(capped.coins, 10);
  assert.equal(capped.coin_cap_hit, true);
  await sql(`delete from public.coin_ledger where user_id = $1 and amount = 290`, [C]);
  await sql(`update public.profiles set coins = (select sum(amount) from public.coin_ledger where user_id = $1) where id = $1`, [C]);
  ok('solo daily coin cap of 300');

  const rev = await rpc(B, 'solo_start', { p_mode: 'revision' });
  assert.equal(rev.n, 4, '3 misses + 1 timeout');
  ok('revision mode serves the deck');
}

// ---------------------------------------------------------------------------
// Daily challenge
// ---------------------------------------------------------------------------
{
  const scores = {};
  for (const u of [A, B]) {
    const d = await rpc(u, 'solo_start', { p_mode: 'daily' });
    assert.equal(d.n, 15);
    for (let i = 0; i < 15; i++) {
      const q = await rpc(u, 'solo_question', { p_session: d.id, p_index: i });
      const right = await correctDisplay(`${d.id}:${i}`, q.id);
      await rpc(u, 'solo_answer', { p_session: d.id, p_index: i, p_choice: u === A ? right : (right + 1) % 4 });
    }
    scores[u] = await rpc(u, 'solo_finish', { p_session: d.id });
  }
  const [x, y] = await sql(`select question_ids from public.solo_sessions where mode = 'daily' order by user_id`);
  assert.deepEqual(x.question_ids, y.question_ids, 'same set for everyone');
  assert.equal(scores[A].daily_rank, 1);
  assert.equal(await rpcError(A, 'solo_start', { p_mode: 'daily' }), 'daily_done');
  const board = await rpc(B, 'daily_leaderboard', { p_scope: 'state' });
  assert.equal(board.total, 2);
  assert.equal(board.me.rank, 2);
  // Closing the app mid-challenge: the same session resumes where it stopped.
  const dc = await rpc(C, 'solo_start', { p_mode: 'daily' });
  for (let i = 0; i < 2; i++) {
    await rpc(C, 'solo_question', { p_session: dc.id, p_index: i });
    await rpc(C, 'solo_answer', { p_session: dc.id, p_index: i, p_choice: 0 });
  }
  assert.equal(await rpcError(C, 'solo_start', { p_mode: 'daily' }), 'daily_done');
  const resumed = await rpc(C, 'solo_resume', { p_session: dc.id });
  assert.equal(resumed.next_index, 2);
  assert.equal(await rpcError(A, 'solo_resume', { p_session: dc.id }), 'not_found');
  ok('daily challenge: shared set, one attempt, leaderboard, resume');
}

// ---------------------------------------------------------------------------
// Staked 2-player room
// ---------------------------------------------------------------------------
let room, match;
{
  const a0 = await balance(A);
  const b0 = await balance(B);
  assert.equal(await rpcError(A, 'create_room', { p_size: 4, p_stake: 100 }), 'level_too_low');
  assert.equal(await rpcError(A, 'create_room', { p_size: 2, p_stake: 1000 }), 'level_too_low');
  assert.equal(await rpcError(A, 'create_room', { p_size: 2, p_stake: 75 }), 'bad_stake');
  room = await rpc(A, 'create_room', { p_size: 2, p_stake: 100, p_count: 10 });
  assert.match(room.code, /^[A-HJ-NP-Z2-9]{6}$/);
  const joined = await rpc(B, 'join_room', { p_code: room.code.toLowerCase() });
  assert.equal(joined.players.length, 2);
  assert.equal(await rpcError(C, 'join_room', { p_code: room.code }), 'room_full');
  assert.equal(await rpcError(B, 'start_match', { p_room: room.id }), 'host_only');
  assert.equal(await rpcError(A, 'start_match', { p_room: room.id }), 'not_all_ready');
  await rpc(B, 'set_ready', { p_room: room.id, p_ready: true });
  const started = await rpc(A, 'start_match', { p_room: room.id });
  match = started.match_id;
  const msgs = await sql(`select event from realtime.messages where topic = $1`, [`room:${room.id}`]);
  assert.ok(msgs.some((m) => m.event === 'match_started'), 'match_started broadcast');
  assert.equal((await balance(A)).escrow, 100, 'stake in escrow');
  assert.equal((await balance(A)).coins, a0.coins, 'not deducted yet');
  ok('room: create/join by code, gates, ready, start, escrow');

  // Realtime authorization: members can join the room channel, others cannot.
  await db.query(`select set_config('realtime.topic', $1, false)`, [`room:${room.id}`]);
  const seenByB = await as(B, `select count(*)::int as n from realtime.messages`);
  const seenByC = await as(C, `select count(*)::int as n from realtime.messages`);
  assert.ok(seenByB[0].n > 0);
  assert.equal(seenByC[0].n, 0);
  await assert.rejects(as(C, `insert into realtime.messages (topic, extension, event, payload) values ('room:${room.id}', 'broadcast', 'emoji', '{}')`));
  ok('realtime: private room channel limited to members');

  let sync = await rpc(A, 'match_sync', { p_match: match });
  assert.equal(sync.phase, 'starting');
  assert.equal(sync.question, null);
  assert.equal(await rpcError(A, 'submit_answer', { p_match: match, p_index: 0, p_choice: 0 }), 'question_closed');
  await travel(match, 4.2);

  const n = sync.n;
  assert.equal(n, 10);
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const sa = await rpc(A, 'match_sync', { p_match: match });
    const sb = await rpc(B, 'match_sync', { p_match: match });
    assert.equal(sa.phase, 'question');
    assert.equal(sa.index, i);
    assert.equal(sa.question.answer, undefined, 'no answer during the question');
    assert.equal(sa.question.id, sb.question.id);
    seen.add(sa.question.id);
    const rightA = await correctDisplay(`${match}:${A}:${i}`, sa.question.id);
    const rightB = await correctDisplay(`${match}:${B}:${i}`, sb.question.id);
    if (i === 3) {
      // 50:50 removes two wrong options for B only
      const pu = await rpc(B, 'use_powerup', { p_match: match, p_kind: 'fifty' });
      assert.equal(pu.removed.length, 2);
      assert.ok(!pu.removed.includes(rightB));
      assert.equal(await rpcError(B, 'use_powerup', { p_match: match, p_kind: 'fifty' }), 'powerup_used');
    }
    await rpc(A, 'submit_answer', { p_match: match, p_index: i, p_choice: rightA });
    const mid = await rpc(B, 'match_sync', { p_match: match });
    const aRow = mid.players.find((p) => p.user_id === A);
    assert.equal(aRow.answered, true, 'answered tick visible');
    assert.equal(aRow.correct, null, 'correctness hidden until reveal');
    assert.equal(await rpcError(A, 'submit_answer', { p_match: match, p_index: i, p_choice: rightA }), 'already_answered');
    const r = await rpc(B, 'submit_answer', { p_match: match, p_index: i, p_choice: i < 6 ? rightB : (rightB + 1) % 4 });
    assert.equal(r.all_answered, true);
    const rev = await rpc(A, 'match_sync', { p_match: match });
    assert.equal(rev.phase, 'reveal', 'reveal as soon as everyone answered');
    assert.equal(rev.question.answer, rightA);
    assert.equal(rev.mine.correct, true);
    await travel(match, 5.1);
  }
  assert.equal(seen.size, n, 'no repeats inside a match');
  sync = await rpc(B, 'match_sync', { p_match: match });
  assert.equal(sync.phase, 'finished');
  const res = await rpc(B, 'finish_match', { p_match: match });
  assert.equal(res.status, 'settled');
  const winner = res.players[0];
  assert.equal(winner.user_id, A);
  assert.equal(winner.payout, 180, 'pot 200 minus 10 % house cut');
  assert.equal(res.players[1].net, -100);
  const res2 = await rpc(A, 'finish_match', { p_match: match });
  assert.equal(res2.players[0].payout, 180, 'settles once');
  const a1 = await balance(A);
  const b1 = await balance(B);
  assert.equal(a1.escrow, 0);
  assert.equal(b1.escrow, 0);
  assert.equal(a1.coins, await ledgerSum(A), 'balance = ledger sum');
  assert.equal(b1.coins, await ledgerSum(B));
  assert.equal(b1.coins - b0.coins <= -100 - 30 + 300, true);
  const roomAfter = await rpc(A, 'get_room', { p_room: room.id });
  assert.equal(roomAfter.status, 'lobby', 'room back in lobby for a rematch');
  ok('match: synced questions, early reveal, 50:50, scoring, 90 % pot, ledger consistent');

  // Rematch with the same group never reuses the last 3 matches' questions.
  await rpc(B, 'set_ready', { p_room: room.id, p_ready: true });
  const m2 = (await rpc(A, 'start_match', { p_room: room.id })).match_id;
  const [{ question_ids: q2 }] = await sql(`select question_ids from public.matches where id = $1`, [m2]);
  assert.ok(q2.every((q) => !seen.has(q)), 'fresh questions for the rematch');
  const [{ question_ids: q2all }] = await sql(`select question_ids from public.matches where id = $1`, [m2]);
  const units2 = await sql(`select unit from public.questions where id = any($1)`, [q2all]);
  assert.equal(units2.filter((u) => u.unit === 'tamil').length, 5);
  // Nobody answers: cron settles it as abandoned → full refund.
  await travel(m2, 4 + 10 * 20 + 40);
  const cron = await sql(`select app_private.cron_minutely() as r`);
  assert.equal(cron[0].r.settled, 1);
  const [{ status: s2 }] = await sql(`select status from public.matches where id = $1`, [m2]);
  assert.equal(s2, 'refunded');
  assert.equal((await balance(A)).escrow, 0);
  ok('rematch avoids recent questions; abandoned match refunded by cron');
}

// ---------------------------------------------------------------------------
// Chat moderation and friends
// ---------------------------------------------------------------------------
{
  const send = (body) => rpcError(A, 'send_room_chat', { p_room: room.id, p_body: body });
  assert.equal(await send('வணக்கம்! Ready?'), null);
  assert.equal(await send('join www.example.com'), 'links_not_allowed');
  assert.equal(await send('call me 98765 43210'), 'numbers_not_allowed');
  assert.equal(await send('pay me at arun@okaxis'), 'upi_not_allowed');
  assert.equal(await send('you are a b1tch'), 'message_blocked');
  assert.equal(await send('x'.repeat(201)), 'message_too_long');
  for (let i = 0; i < 4; i++) await send(`msg ${i}`);
  assert.equal(await send('one more'), 'rate_limited');
  const hist = await rpc(B, 'room_chat_history', { p_room: room.id });
  assert.ok(hist.length >= 5);
  ok('chat: links, phone numbers, UPI IDs, profanity, length and rate limit blocked');

  assert.equal(await rpcError(B, 'send_dm', { p_to: C, p_body: 'hi' }), 'not_friends');
  assert.equal(await rpc(B, 'friend_request', { p_user: C }), 'outgoing');
  const cf = await rpc(C, 'list_friends');
  assert.equal(cf.incoming.length, 1);
  assert.equal(await rpc(C, 'respond_friend', { p_user: B, p_accept: true }), 'friends');
  const dm = await rpc(B, 'send_dm', { p_to: C, p_body: 'நாளை 7 மணிக்கு படிக்கலாமா?' });
  assert.equal(dm.kind, 'text');
  const topic = `dm:${[B, C].sort()[0]}:${[B, C].sort()[1]}`;
  assert.ok((await sql(`select 1 from realtime.messages where topic = $1 and event = 'dm'`, [topic])).length === 1);
  const cList = await rpc(C, 'list_friends');
  assert.equal(cList.friends[0].unread, 1);
  await rpc(C, 'mark_dm_read', { p_peer: B });
  assert.equal((await rpc(C, 'dm_history', { p_peer: B })).length, 1);
  await rpc(C, 'block_user', { p_user: B });
  assert.equal(await rpcError(B, 'send_dm', { p_to: C, p_body: 'hello?' }), 'blocked');
  await rpc(C, 'unblock_user', { p_user: B });
  ok('friends: request/accept, DMs with read receipts, blocking');

  const lb = await rpc(A, 'leaderboard', { p_scope: 'state' });
  assert.ok(lb.total >= 3);
  const fl = await rpc(A, 'leaderboard', { p_scope: 'friends', p_unit: 'polity' });
  assert.equal(fl.total, 1);
  const home = await rpc(A, 'home_summary');
  assert.equal(home.profile.id, A);
  assert.equal(home.daily.played, true);
  const stats = await rpc(B, 'my_stats');
  assert.equal(stats.units.length, units.length);
  ok('leaderboards, home summary, stats');
}

// ---------------------------------------------------------------------------
// Admin: CSV import → two reviewers → live; reports
// ---------------------------------------------------------------------------
{
  assert.equal(await rpcError(A, 'admin_stats'), 'admin_only');
  await sql(`update public.profiles set is_admin = true where id in ($1, $2, $3)`, [A, B, C]);
  const imp = await rpc(A, 'admin_import_questions', { p_rows: JSON.stringify([
    { unit: 'polity', subtopic: 'Preamble', difficulty: '2', answer: 'B',
      text_en: 'Which word was added to the Preamble in 1976?', options_en: ['Republic', 'Socialist', 'Sovereign', 'Democratic'],
      text_ta: '1976-ல் முகவுரையில் சேர்க்கப்பட்ட சொல் எது?', options_ta: ['குடியரசு', 'சமதர்ம', 'இறையாண்மை', 'மக்களாட்சி'] },
    { unit: 'nope', subtopic: 'x', difficulty: '2', answer: 'A', text_en: 'x', options_en: ['a', 'b', 'c', 'd'] },
    { unit: 'tamil', subtopic: 'x', difficulty: '2', answer: 'A', text_en: 'English only', options_en: ['a', 'b', 'c', 'd'] },
  ]) });
  assert.equal(imp.inserted, 1);
  assert.equal(imp.errors.length, 2);
  const list = await rpc(B, 'admin_list_questions', { p_status: 'review' });
  const qid = list.items[0].id;
  assert.equal(list.items[0].answer, 1);
  assert.equal(await rpcError(A, 'admin_review', { p_question: qid, p_approve: true }), 'cannot_review_own');
  const r1 = await rpc(B, 'admin_review', { p_question: qid, p_approve: true });
  assert.equal(r1.status, 'review');
  const r2 = await rpc(C, 'admin_review', { p_question: qid, p_approve: true });
  assert.equal(r2.status, 'live', 'live after two reviewers');
  ok('admin: CSV import validation, two-reviewer rule');

  // Report a seen question → upheld → reporter +20
  const [{ question_id: seenQ }] = await sql(`select question_id from public.user_question_history where user_id = $1 limit 1`, [B]);
  await rpc(B, 'report_question', { p_question: seenQ, p_reason: 'wrong_answer' });
  const reports = await rpc(A, 'admin_list_reports', { p_status: 'open' });
  const before = (await balance(B)).coins;
  await rpc(A, 'admin_resolve_report', { p_report: reports[0].id, p_upheld: true });
  assert.equal((await balance(B)).coins - before, 20);
  ok('question report upheld pays the reporter 20 coins');

  // Three upheld message reports → 24 h mute
  const [{ id: msgId }] = await sql(`select id from public.chat_messages where sender_id = $1 and room_id is not null limit 1`, [A]);
  for (const u of [B, B, B]) await rpc(u, 'report_message', { p_message: msgId, p_reason: 'abuse' });
  for (const r of await rpc(C, 'admin_list_reports', { p_status: 'open' })) {
    await rpc(C, 'admin_resolve_report', { p_report: r.id, p_upheld: true });
  }
  assert.equal(await rpcError(A, 'send_room_chat', { p_room: room.id, p_body: 'hi' }), 'chat_muted');
  ok('three upheld reports auto-mute chat for 24 h');
}

// ---------------------------------------------------------------------------
// 3-player squad room: 70 / 20 split, Extra Time power-up
// ---------------------------------------------------------------------------
{
  const sq = await rpc(A, 'create_room', { p_size: 3, p_stake: 50, p_count: 5, p_subject: 'reasoning' });
  await rpc(B, 'join_room', { p_code: sq.code });
  await rpc(C, 'join_room', { p_code: sq.code });
  await rpc(B, 'set_ready', { p_room: sq.id, p_ready: true });
  await rpc(C, 'set_ready', { p_room: sq.id, p_ready: true });
  const m = (await rpc(A, 'start_match', { p_room: sq.id })).match_id;
  await travel(m, 4.2);
  for (let i = 0; i < 5; i++) {
    const s = await rpc(A, 'match_sync', { p_match: m });
    assert.equal(s.question.unit, 'reasoning');
    const right = async (u) => correctDisplay(`${m}:${u}:${i}`, s.question.id);
    if (i === 0) {
      const t = await rpc(C, 'use_powerup', { p_match: m, p_kind: 'time' });
      assert.ok(t.deadline_at);
      await rpc(A, 'submit_answer', { p_match: m, p_index: 0, p_choice: await right(A) });
      await rpc(B, 'submit_answer', { p_match: m, p_index: 0, p_choice: await right(B) });
      await travel(m, 17); // past the normal 15 s timer
      assert.equal((await rpc(A, 'match_sync', { p_match: m })).phase, 'question', 'others wait for Extra Time');
      const late = await rpc(C, 'submit_answer', { p_match: m, p_index: 0, p_choice: await right(C) });
      assert.equal(late.all_answered, true);
    } else {
      await rpc(A, 'submit_answer', { p_match: m, p_index: i, p_choice: await right(A) });
      await rpc(B, 'submit_answer', { p_match: m, p_index: i, p_choice: i < 3 ? await right(B) : ((await right(B)) + 1) % 4 });
      await rpc(C, 'submit_answer', { p_match: m, p_index: i, p_choice: ((await right(C)) + 1) % 4 });
    }
    await travel(m, 5.1);
  }
  const res = await rpc(C, 'finish_match', { p_match: m });
  const pay = Object.fromEntries(res.players.map((p) => [p.user_id, p.payout]));
  assert.equal(pay[A], 105, '1st: 70 % of 150');
  assert.equal(pay[B], 30, '2nd: 20 % of 150');
  assert.equal(pay[C], 0);
  for (const u of [A, B, C]) assert.equal((await balance(u)).coins, await ledgerSum(u));
  ok('3-player room: 70/20 split, Extra Time delays the reveal for others');
}

// ---------------------------------------------------------------------------
// Offline pack, mock, refill, cron
// ---------------------------------------------------------------------------
{
  const pack = await rpc(C, 'get_offline_pack');
  assert.ok(pack.questions.length >= 200);
  assert.ok(pack.questions[0].answer !== undefined, 'offline pack carries answers');
  const results = pack.questions.slice(0, 30).map((q, i) => ({ q: q.id, c: i < 25 ? q.answer : (q.answer + 1) % 4, t: 5000 }));
  results.push({ q: 999999, c: 0, t: 1 });
  const before = (await balance(C)).coins;
  const synced = await rpc(C, 'sync_offline', { p_pack: pack.pack_id, p_results: JSON.stringify(results) });
  assert.equal(synced.correct, 25);
  assert.equal(synced.coins, 100, 'capped at 100 per offline session');
  const twice = await rpc(C, 'sync_offline', { p_pack: pack.pack_id, p_results: JSON.stringify(results) });
  assert.equal(twice.answered, 0, 'cannot sync the same answers twice');
  assert.ok((await balance(C)).coins - before >= 100);
  ok('offline pack: server re-check, 100-coin cap, no double sync');

  const mock = await rpc(C, 'solo_start', { p_mode: 'mock' });
  assert.equal(mock.n, 200);
  assert.equal(mock.timer_s, null);
  const resumed = await rpc(C, 'solo_start', { p_mode: 'mock' });
  assert.equal(resumed.id, mock.id, 'mock resumes');
  for (let i = 0; i < 170; i++) {
    const q = await rpc(C, 'solo_question', { p_session: mock.id, p_index: i });
    await rpc(C, 'solo_answer', { p_session: mock.id, p_index: i, p_choice: await correctDisplay(`${mock.id}:${i}`, q.id) });
  }
  const msum = await rpc(C, 'solo_finish', { p_session: mock.id, p_elapsed_s: 5400 });
  assert.equal(msum.correct, 170);
  assert.equal(Number(msum.marks), 255);
  assert.equal(msum.coins, 500);
  assert.equal(msum.report.length, 9);
  ok('weekly mock: exam pattern, resumable, report, +500');

  await sql(`update public.profiles set coins = 10 where id = $1`, [B]);
  await sql(`insert into public.coin_ledger (user_id, amount, balance_after, reason) values ($1, 0, 10, 'test_adjust')`, [B]);
  const refill = await rpc(B, 'claim_refill');
  assert.equal(refill.balance, 200);
  assert.equal(await rpcError(B, 'claim_refill'), 'refill_not_needed');
  ok('bankruptcy refill to 200');

  const yesterday = await sql(`select app_private.ist_today() - 1 as d`);
  await sql(`update public.daily_challenges set day = $1`, [yesterday[0].d]);
  await sql(`update public.solo_sessions set daily_date = $1 where mode = 'daily'`, [yesterday[0].d]);
  const daily = await sql(`select app_private.cron_daily() as r`);
  assert.equal(daily[0].r.daily_paid, 2);
  const paid = await sql(`select user_id, amount from public.coin_ledger where reason = 'daily_rank' order by amount desc`);
  assert.equal(paid[0].user_id, A);
  assert.equal(paid[0].amount, 300);
  assert.equal(paid[1].amount, 100, 'with 2 players, 2nd is outside the top 40 %');
  ok('cron: daily challenge rank rewards paid');

  // Collusion: B always loses 250+ stakes to A
  for (let i = 0; i < 5; i++) {
    const mid = randomUUID();
    await sql(`insert into public.matches (id, stake, house_cut, question_ids, n, timer_s, reveal_s, powerups, language,
               cur_open_at, cur_reveal_at, status, settled_at) values ($1, 250, 0.1, '{}', 10, 15, 5, true, 'ta', now(), now(), 'settled', now())`, [mid]);
    await sql(`insert into public.match_players (match_id, user_id, seat, rank) values ($1, $2, 0, 1), ($1, $3, 1, 2)`, [mid, A, B]);
  }
  await sql(`select app_private.cron_hourly()`);
  const frozen = await sql(`select stakes_frozen from public.profiles where id in ($1, $2)`, [A, B]);
  assert.ok(frozen.every((f) => f.stakes_frozen));
  ok('cron: coin-dumping pair flagged and frozen');
}

// ---------------------------------------------------------------------------
// Phase 2: leagues, shop, Quick Match, web push
// ---------------------------------------------------------------------------
const give = (u, amount) => sql(`select app_private.post_coins($1, $2, 'test')`, [u, amount]);
{
  // Leagues: everyone who earned XP this week is in a Bronze group.
  const lg = await rpc(A, 'my_league');
  assert.equal(lg.joined, true);
  assert.equal(lg.tier, 0);
  assert.ok(lg.members.length >= 3);
  assert.equal(lg.members[0].rank, 1);
  const [{ wk }] = await sql(`select app_private.week_start(app_private.ist_today())::text as wk`);
  const settled = await sql(`select app_private.settle_leagues($1::date) as n`, [wk]);
  assert.equal(settled[0].n, lg.members.length);
  const top = lg.members[0].user.id;
  const [{ league_tier }] = await sql(`select league_tier from public.profiles where id = $1`, [top]);
  assert.equal(league_tier, 1, 'top of the group promoted');
  assert.equal((await sql(`select app_private.settle_leagues($1::date) as n`, [wk]))[0].n, 0, 'settles once');
  const after = await rpc(top === A ? A : top === B ? B : C, 'my_league');
  assert.equal(after.last_result.tier_after, 1);
  ok('leagues: XP joins a group, weekly promotion, settles once');
}
{
  const F = await newUser('fathima');
  const G = await newUser('gopal');
  const H = await newUser('hari');
  for (const [u, n] of [[F, 'fathima'], [G, 'gopal'], [H, 'hari']]) {
    await onboard(u, n);
    await give(u, 500);
  }

  // Shop
  const cat = await rpc(F, 'shop_catalog');
  assert.equal(cat.items.length, 20);
  assert.equal(await rpcError(F, 'buy_item', { p_key: 'fr_kolam' }), 'level_too_low');
  await rpc(F, 'buy_item', { p_key: 'fr_gold' });
  assert.equal(await rpcError(F, 'buy_item', { p_key: 'fr_gold' }), 'already_owned');
  assert.equal(await rpcError(F, 'equip_item', { p_kind: 'frame', p_key: 'fr_jasmine' }), 'not_owned');
  const eq = await rpc(F, 'equip_item', { p_kind: 'frame', p_key: 'fr_gold' });
  assert.equal(eq.equipped.frame, 'fr_gold');
  assert.equal(eq.balance, 300);
  await rpc(F, 'buy_item', { p_key: 'av_graduate' });
  await rpc(F, 'equip_item', { p_kind: 'avatar', p_key: 'av_graduate' });
  assert.equal(await rpcError(F, 'buy_item', { p_key: 'ep_study' }), 'insufficient_coins');
  await sql(`update public.profiles set level = 3, xp = 320 where id = $1`, [F]);
  await give(F, 1500);
  await rpc(F, 'buy_item', { p_key: 'th_temple' });
  await rpc(F, 'equip_item', { p_kind: 'theme', p_key: 'th_temple' });
  const room = await rpc(F, 'create_room', { p_size: 2, p_stake: 0 });
  const cos = await rpc(F, 'public_cosmetics', { p_users: `{${F}}`, p_room: room.id });
  assert.equal(cos.frames[F], 'fr_gold');
  assert.equal(cos.theme, 'th_temple');
  await rpc(F, 'leave_room', { p_room: room.id });
  assert.equal((await rpc(G, 'search_users', { p_q: 'fathima' }))[0].frame, 'fr_gold');
  ok('shop: level gates, ownership, frames, avatars, room themes');

  // Quick Match
  assert.equal((await rpc(F, 'quick_match')).status, 'waiting');
  const m = await rpc(G, 'quick_match');
  assert.equal(m.status, 'matched');
  const mf = await rpc(F, 'quick_match');
  assert.equal(mf.match_id, m.match_id, 'both players get the same match');
  assert.equal((await balance(F)).escrow, 50);
  assert.equal((await balance(G)).escrow, 50);
  assert.equal(await rpcError(G, 'quick_match'), 'in_match');
  assert.equal((await rpc(H, 'quick_match')).status, 'waiting');
  assert.equal((await rpc(H, 'quick_match_cancel')).status, 'cancelled');
  await sql(`select app_private.refund_match($1)`, [m.match_id]);
  ok('quick match: pairs two searching players, 50-coin escrow, cancel');

  // Web push
  await rpc(F, 'save_push_subscription', { p_endpoint: 'https://push.example/abc', p_p256dh: 'key', p_auth: 'auth' });
  assert.equal(await rpc(G, 'friend_request', { p_user: F }), 'outgoing');
  const [q] = await sql(`select payload from public.push_queue where user_id = $1`, [F]);
  assert.equal(q.payload.title, '👋 நண்பர் கோரிக்கை', 'push in the reader’s language');
  assert.equal(q.payload.url, '/friends');
  await assert.rejects(as(F, `select public.push_claim(10)`), /permission denied|forbidden/);
  await db.exec(`set role service_role`);
  await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  const claimed = (await db.query(`select public.push_claim(10) as r`)).rows[0].r;
  await db.query(`select public.push_drop(array['https://push.example/abc'])`);
  await db.query(`select set_config('request.jwt.claims', '', false)`);
  await db.exec(`reset role`);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].endpoint, 'https://push.example/abc');
  assert.equal((await sql(`select count(*)::int n from public.push_subscriptions`))[0].n, 0, 'gone endpoints dropped');
  await rpc(F, 'save_push_subscription', { p_endpoint: 'https://push.example/def', p_p256dh: 'k', p_auth: 'a' });
  await sql(`update public.profiles set streak_count = 3, streak_last_date = app_private.ist_today() - 1 where id = $1`, [F]);
  assert.equal((await sql(`select app_private.cron_streak_reminders() as n`))[0].n, 1);
  await sql(`select app_private.cron_minutely_phase2()`);
  ok('web push: subscriptions, friend-request push, service-role-only claim, streak reminders');
}

// ---------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------
{
  const E = await newUser('elango');
  await onboard(E, 'elango');
  await rpc(E, 'delete_my_account');
  assert.equal((await sql(`select 1 from public.profiles where id = $1`, [E])).length, 0);
  ok('account deletion cascades');
}

if (existsSync(join(root, 'supabase', 'seed.sql'))) {
  await db.exec(readFileSync(join(root, 'supabase', 'seed.sql'), 'utf8'));
  const [{ n }] = await sql(`select count(*)::int as n from public.questions where source like 'sample%'`);
  ok(`seed.sql loads (${n} sample questions)`);
}

console.log(`\n${passed} checks passed`);
