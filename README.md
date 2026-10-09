# Group 4 Quiz Battle · குரூப் 4 வினாடி வினா

A bilingual (Tamil + English) TNPSC Group 4 practice game. Players earn free coins in solo practice and spend them as entry in 2–4 player rooms with friends, with emoji and text chat, weekly leagues and a cosmetics shop. It ships as an installable web app (PWA) on free tiers: Supabase for the backend and Vercel for hosting.

This repository implements [plan.md](plan.md): the MVP scope plus the phase-2 features (leagues, web push, Quick Match with a practice bot, the shop, the extra 3D scenes, PostHog and Sentry). See [Not built yet](#not-built-yet).

## Quick start (demo mode, no backend)

```bash
npm install
npm run dev
```

Without Supabase keys the app runs in **demo mode**: language pick, home, solo practice on the 120 bundled sample questions, the practice bot, results, profile. Rooms, friends, leagues and the shop need the backend.

## Set up the backend (Supabase free plan)

1. **Create a project** at supabase.com. The plan prefers the **Mumbai (ap-south-1)** region; set `VITE_DATA_REGION` to whatever you chose so the Privacy page is accurate.
2. **Keys**: copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (the publishable key), `VITE_CONTACT_EMAIL`, `VITE_DATA_REGION`, and `SUPABASE_DB_URL` (Dashboard → Connect → **Session pooler** string; the direct one is IPv6-only). `SUPABASE_DB_URL` never reaches the browser.
3. **Apply the database**: `npm run db:apply`. It runs every pending migration in one transaction (and the sample questions on the first run), recording them in the same table the Supabase CLI uses. Re-run it after pulling new migrations. Alternative without a DB password: `npm run setup-sql` and paste `supabase/setup.sql` into the SQL Editor once.
4. **Sign-in: username + email + password** (no email links, no Google, no SMS). Players register with a username, email and password, and sign in with their username *or* email plus password. In Authentication → Sign In / Providers → **Email**: keep it enabled and turn **Confirm email OFF** (the app sends no emails, so no SMTP is needed). URL configuration: Site URL = your Vercel address.
   - Forgotten password: there is no reset email. An admin sets a temporary password (Admin → Moderation → Reset a player's password) and the player changes it in Profile → Change password.
   - Username sign-in goes through `resolve_login`, which returns the account email only for the correct password and locks a login for 15 minutes after 10 failures, so it cannot be used to collect emails or guess passwords.
5. **Realtime** (Realtime → Settings): turn off **Allow public access**. The app uses private channels only.
6. **Make yourself admin** after signing in once:
   ```sql
   update public.profiles set is_admin = true where username = 'your_username';
   ```
7. **Web push** (optional): `npm run push:setup` generates VAPID keys (into the gitignored `supabase/functions/.env`), sets `VITE_VAPID_PUBLIC_KEY` and stores the project URL and push secret in Supabase Vault. Then, after `npx supabase login` once:
   ```bash
   npx supabase secrets set --env-file supabase/functions/.env --project-ref <ref>
   npx supabase functions deploy send-push --no-verify-jwt --project-ref <ref>
   ```
8. **Check it end to end**: `npm run e2e:live` signs two temporary players in, plays a staked match over the real API and Realtime, and deletes them.

## Deploy (Vercel)

Import the GitHub repo in Vercel. `vercel.json` sets the Vite build, single-page-app routing (deep links like `/r/ABC234`) and cache/security headers. Add these Environment Variables (Production and Preview), copied from `.env.local`:

`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_CONTACT_EMAIL`, `VITE_DATA_REGION`, `VITE_VAPID_PUBLIC_KEY`, and optionally `VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`.

Never add `SUPABASE_DB_URL` or the secret key to Vercel; the app does not need them. After the first deploy, put the Vercel URL into Supabase → Authentication → URL Configuration.

## Crash reports and analytics

- **Sentry** (`VITE_SENTRY_DSN`): loads after the first screen; sends errors only (no user info, cookies, headers or query strings), tagged with the player's random id.
- **PostHog** (`VITE_POSTHOG_KEY`): opt-in only (checkbox at onboarding, toggle in Profile). Events: screen views (ids stripped), sets and matches finished, rooms created, Quick Match results, shop purchases, and average frame rate per 3D scene and device tier.
- Without the keys, neither library is even included in the build.

## GitHub Actions

| Workflow | What it does | Secrets |
| --- | --- | --- |
| `ci.yml` | Typecheck, unit tests, database tests, build, UI smoke test, Lighthouse budget (fails if first-load JS > 170 KB; warns if LCP > 2.5 s or interactive > 3 s, since those timings depend on the CI machine) | none |
| `backup.yml` | Nightly encrypted dump (roles, schema, data) pushed to a private repo, last 30 days kept | `SUPABASE_DB_URL`, `BACKUP_REPO`, `BACKUP_TOKEN`, `BACKUP_PASSPHRASE` |
| `keepalive.yml` | Pings the API every 3 days so a quiet free project is not paused | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |

## Tests

```bash
npm run check    # typecheck, unit, database, build, smoke — in order
npm test         # unit: scoring/levels mirror the SQL, CSV import, sample pack, strings, shop catalogue matches SQL
npm run test:db  # every migration in PGlite (in-process Postgres) + real game flows as signed-in players under RLS
npm run smoke    # builds a key-free demo bundle and drives it in headless Chrome/Edge at 360 px wide
npm run e2e:live # against your real Supabase project (needs SUPABASE_DB_URL)
```

`test:db` covers sign-up and starter coins, RLS, solo timing and coin caps, the daily challenge (incl. resume), staked 2- and 3-player matches (synchronised questions, early reveal, 50:50, Extra Time, pot splits), rematch freshness, refunds, chat moderation, friends and DMs, the two-reviewer queue, report rewards and auto-mute, offline sync caps, the mock test, refills, cron jobs, weekly leagues, the shop, Quick Match, the push queue and account deletion.

## Question bank

- **Upload**: Admin → Upload CSV. Template: [content/question-template.csv](content/question-template.csv) (save as "CSV UTF-8" so Tamil survives). Part A (`tamil`) needs Tamil text; General Studies needs both languages for the daily challenge.
- **Review**: a question goes live after **two different reviewers** approve it; authors cannot approve their own. Editing a live question sends it back to review.
- **Reports**: an upheld report pays the reporter 20 coins. Aim to clear reports within 48 hours.
- **Sample questions**: `content/questions.sample.json` holds 120 AI-drafted questions. `npm run seed` regenerates `supabase/seed.sql` and the demo pack. Before public launch, move them into review:
  ```sql
  update public.questions set status = 'review', reviewed_by = '{}' where source = 'sample-ai-draft';
  ```

## How it works

**The server is the only source of truth.** Every write and every read of questions goes through `SECURITY DEFINER` Postgres functions; RLS is on for every table and clients have no insert/update/delete rights. Helpers live in `app_private`, which the API cannot reach.

**Live match without a game server.** `start_match` checks balances and the daily entry cap, moves stakes to escrow, selects questions and writes the schedule in one transaction. The match is a lazy state machine on the database clock, advanced by any call or the minute cron. Questions arrive only after they open, answer keys only after they close, options are shuffled per player, and answers are timestamped by the database. `finish_match` settles exactly once: points, then total answer time; 10 % leaves the game; the rest pays 90 % (2 players), 70/20 (3) or 60/30 (4).

**Room question selection** follows the plan: exam-weight quotas, ±1 difficulty band, a 14-day cooldown across all players, never the group's last 3 matches, freshness weights, Efraimidis–Spirakis sampling with at most 2 per sub-topic, and the fallback order ±2 → 7 days → 3 days → oldest-seen. Tunable in Admin → Settings.

**Phase 2.** *Leagues*: earning XP puts a player in a group of up to 30 in their tier; every Monday 00:10 IST the top moves up, the bottom down, and the top 3 of groups of 10+ earn coins. *Quick Match*: searching players are paired by level (the gap widens while waiting) into a 50-coin room; after 30 s the app offers a labelled practice bot with no stakes. *Shop*: avatars, frames, emoji packs and room themes for coins only, some level-gated. *Push*: room invites, friend requests and a 19:30 IST streak reminder, queued in Postgres and sent by the `send-push` Edge Function via pg_net.

**Coins** are an append-only ledger with the balance cached on `profiles`. Nothing anywhere buys, sells, transfers or redeems coins, and the UI never says "bet" (a unit test enforces this).

**Phones.** The first screen paints from plain HTML; first-load JavaScript is about 95 KB gzipped, with the Supabase client (about 53 KB) loaded right after the first paint. Each screen is its own chunk. A short WebGL test puts the phone in a tier; high/medium tiers lazy-load the 3D scenes (stake pot and lobby table, podium, home treasure chest, level-up trophy); low tier and reduced motion get CSS versions; a scene below 30 fps for 2 s steps the phone down a tier.

### Where things are

| Path | Contents |
| --- | --- |
| `supabase/migrations/` | Schema + RLS, helpers, solo, rooms and matches, social, admin, realtime, leagues, shop, Quick Match, push, cron, grants |
| `supabase/functions/send-push/` | Edge Function that delivers web push |
| `src/lib/` | API client, server clock, router, strings (Tamil + English), session, solo engines, device tiers, offline pack, realtime, push, telemetry, cosmetics |
| `src/screens/` | All screens: the 14 MVP screens, mock, daily, Quick Match, practice bot, shop, admin, legal |
| `src/components/` | UI kit, question card, chat, 2D/3D scenes |
| `scripts/` | Database tests, seed and setup builders, `db:apply`, live end-to-end check, push setup, UI smoke test |

## Where this differs from the plan

- **Password accounts** (username + email + password; sign in with username or email). No Google, no SMS, no email links, so no email sending at all.
- **Game logic in Postgres functions**, not Edge Functions; the only Edge Function sends web push.
- **No Redis.** "Seen" history is an indexed Postgres table; enough at this scale.
- **Quota rounding** inside a part is weighted-random on the remainders, so small units still appear in 10-question matches.
- **Friendly rooms** (0 entry coins) were added.
- **Offline pack questions count as seen at download.**
- **2D animations are CSS** and the 3D scenes are procedural (no Lottie files, no model downloads).
- **Admin pages are English only.**

## Not built yet

The ML profanity classifier (the word list is in place), current-affairs content, the General English pack, a Play Store wrapper and Premium. The question bank needs about 2,900 more reviewed questions to reach the MVP target of 3,000.

## Before public launch

- Get the written opinion from a gaming-law advocate that the plan calls for, and register with the Online Gaming Authority if the Rules require it.
- Have the Terms and Privacy pages (`src/screens/Legal.tsx`) reviewed; set `VITE_CONTACT_EMAIL`.
- Move the sample questions into review and reach the 3,000-question target.
- If you later want self-service password reset, add custom SMTP and a "Forgot password" email flow.
- Add Tamil and Tanglish words to the profanity list (Admin → Moderation).
- Update `next_exam_date` in Admin → Settings when TNPSC announces the 2027 exam.
