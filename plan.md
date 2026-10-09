# TNPSC Group 4 Quiz Battle — App Plan

Oct 8, 2026 · @Azhagar

## Overview

Build a bilingual (Tamil + English) quiz game, shipped as a web app that installs as a PWA, where TNPSC Group 4 aspirants earn virtual coins in solo practice, then stake those coins in 2, 3 or 4-player rooms against friends, with emoji and text chat. The aim is daily, habit-forming revision that feels like a game rather than a mock test.

**Constraints:** zero budget and one builder. Everything runs on free tiers, and there is no app store: players open a link in Chrome or Safari and tap Add to Home screen.

**Working name:** Group 4 Quiz Battle (placeholder).

**Target users**

- TNPSC Group 4 (CCSE-IV) aspirants, mostly 18–35, many in Tier 2/3 towns and villages of Tamil Nadu
- Budget Android phones (2–4 GB RAM) using Chrome, patchy 4G — the web app must load in under 3 s, install as a PWA and tolerate drops
- Study groups and friends preparing together, coaching-centre batches

**Goals for the first 6 months after launch**

- 50,000 registered players, 25% day-7 retention
- Average 15 minutes of play per active user per day
- Players who finish 30+ days show measurable score gains in the in-app full mock test

**What makes it different from existing test apps**

- Competition with known friends, not strangers, drives return visits
- Coins give practice a purpose: practise solo to afford bigger room bets
- Short 5–10 minute matches fit bus rides and tea breaks

## Core game modes

Solo mode is the coin faucet; room matches are where coins are staked and won. Every new player gets 500 starter coins so they can join a friend's room on day one.

| Mode | Players | Format | Coins |
| --- | --- | --- | --- |
| Solo Practice | 1 | 10 questions, one subject or mixed, 20 s each | +5 per correct, +20 completion bonus |
| Solo Daily Challenge | 1 | 15 questions, same set for everyone that day | +100 to +300 by rank tier; daily leaderboard |
| Solo Mock (weekly) | 1 | Full 200-question exam pattern, 3 h, pausable | +500 on completion; detailed report |
| Duel Room | 2 | 10 questions, 15 s each | Both stake; winner takes pot minus 10% |
| Squad Room (3 or 4) | 3–4 | 10–15 questions, 15 s each | Pot split 1st 60% / 2nd 30% (4p) or 1st 70% / 2nd 20% (3p) |
| Quick Match | 2 | Random online opponent of similar level | Fixed 50-coin stake |

**Room flow**

1. Host taps Create Room → picks size (2/3/4), subject (or mixed), difficulty, question count, language and stake (50 / 100 / 250 / 500 / 1000).
2. App generates a 6-character room code and a WhatsApp share link.
3. Friends join by code, link or from the in-app friends list; each must have coins ≥ stake.
4. Lobby shows avatars, a Ready toggle and lobby chat. Host starts when all are ready (min 2 players even in a 4-seat room).
5. Stakes are locked in escrow at start, not deducted until the match ends.
6. All players get the same question at the same moment; a live strip shows who has answered (not what).
7. After each question: correct answer, short explanation, live scoreboard.
8. Result screen: ranks, coins won, XP earned, Rematch button (same room, same stake).

**Scoring inside a match**

- Correct answer: 100 points + speed bonus up to 50 (linear over the timer)
- Streak of 3 correct in a row: +25 per question until broken
- Wrong or no answer: 0 (no negative marking, matching the real exam)
- Tie on points → faster total answer time wins

**Power-ups (bought with coins, max 1 of each per match)**

- 50:50 — remove two wrong options (30 coins)
- Extra Time — +10 s (20 coins)
- The host can switch power-ups off for a room

**Disconnects:** a player who drops has 30 s to reconnect and resume; after that their remaining questions count as unanswered. If the host drops, hosting passes to the next player. If the match cannot finish (server fault), all stakes are refunded.

## Coin economy and staking rules

Coins must stay a free, closed, in-game currency: never sold for money, never cashed out, never traded between players. That single rule keeps room staking legal; break it and the game becomes a banned online money game.

**Why this matters.** India's Promotion and Regulation of Online Gaming Act, 2025 bans online money games, with up to 3 years' jail or a ₹1 crore fine for offering one. Its definition of "other stakes" covers coins and tokens, real or virtual, that are bought with money directly or indirectly. The 2026 Rules also look at whether in-game rewards can be redeemed or monetised outside the game. A free-coin quiz for recreation and skill development fits the Act's "online social game" category instead. ([PRS summary](https://prsindia.org/billtrack/the-promotion-and-regulation-of-online-gaming-bill-2025), [Act text](https://taxguru.in/corporate-law/promotion-regulation-online-gaming-act-2025.html), [2026 Rules note](https://webiis10.mondaq.com/india/social-media/1785870/the-promotion-and-regulation-of-online-gaming-act-2025-and-the-promotion-and-regulation-of-online-gaming-rules-2026))

**Hard rules (built into the product, not just the terms)**

- No coin packs, no "buy coins" button, no coins bundled with any paid plan
- No redemption: coins never convert to cash, recharge, vouchers or physical prizes
- No gifting or transferring coins between accounts
- In the UI say "stake", "entry" or "challenge", never "bet" or "wager"
- Get a written opinion from a gaming-law advocate before launch; register with the Online Gaming Authority if the Rules require it for social games

**Coin sources (faucets)**

| Source | Coins | Limit |
| --- | --- | --- |
| Sign-up bonus | 500 | Once |
| Solo practice | 5 per correct + 20 completion | 300 per day |
| Daily login streak | 20, rising to 100 on day 7 | Daily |
| Daily challenge rank | 100–300 | Daily |
| Weekly mock completed | 500 | Weekly |
| Achievements / level-ups | 50–1,000 | Per achievement |
| Refer a friend who plays 3 matches | 200 | 10 referrals |
| Bankruptcy refill (balance below 50) | Top-up to 200 | Once per 24 h |

**Coin sinks (keep inflation down)**

- 10% house cut on every room pot
- Power-ups (20–30 coins)
- Cosmetics: avatars, frames, chat emoji packs, room themes (200–5,000)
- Higher stake tiers unlock only at higher levels (1,000-coin rooms from level 10)

**Staking mechanics**

- Everyone in a room stakes the same amount, chosen by the host
- Coins move to escrow when the match starts; settled by the server only, never the phone
- Pot = stakes × players; house keeps 10%; the rest is paid by rank (see Core game modes)
- Abandoned or crashed match → full refund
- Daily staking cap (e.g. 5,000 coins) to prevent compulsive play and coin farming

**Monetisation that stays clear of coins**

- Premium plan (₹49–99/month through Razorpay, after launch): ad-free, full explanations, unlimited mocks, analytics, PDF notes — no coins included
- Google AdSense banner ads on the free tier, never mid-question
- Coaching-centre plan: private batch leagues and teacher dashboards
- Rewarded ads that grant power-ups or a hint, not coins (confirm with counsel whether ad-for-coins is safe)

## Chat: emoji and text

Chat lives in three places — room lobby, during the match (emoji only), and one-to-one friend chat — so players can talk without leaving the game.

| Where | Allowed | Why |
| --- | --- | --- |
| Room lobby and result screen | Text + emoji + quick phrases | Banter, rematch talk |
| During a question | Emoji reactions only (floating over avatar) | Stops answers being shared in text |
| Between questions | Emoji + quick phrases | Keeps pace, no typing delay |
| Friend chat (1:1) | Text + emoji + room invites | Planning study sessions |

**Features**

- 12 free reaction emojis; extra themed packs (Tamil cinema-style expressions, festival packs) bought with coins
- Quick phrases in Tamil and English: "நல்லா விளையாடினே!", "Rematch?", "Too easy 😎"
- Tamil keyboard support (Unicode), messages up to 200 characters
- Read receipts and typing indicator in friend chat
- Room invite card inside chat with one-tap join

**Moderation and safety**

- Profanity filter for Tamil, Tanglish and English, maintained as a word list plus a lightweight ML classifier
- Block numbers, links and UPI IDs in text chat to stop off-platform coin trading and scams
- Mute, block and report on every message; three verified reports → auto-mute for 24 h
- Chat with non-friends is off by default
- Chat history kept 30 days, then deleted
- Rate limit: 5 messages per 10 s

## Content: syllabus and question bank

The question bank mirrors the real paper: 200 SSLC-standard MCQs for 300 marks, with Tamil Eligibility-cum-Scoring (100 questions) as Part A and General Studies plus Aptitude (75 + 25) as Part B. Match questions are drawn in these same proportions so playing the game is also exam practice. ([Group 4 syllabus PDF](https://professoracademy.com/wp-content/uploads/2026/04/tnpsc_group_4_syllabus.pdf), [exam pattern](https://prepp.in/tnpsc-group-iv-exam))

| Part | Unit | Questions in exam | Launch bank target |
| --- | --- | --- | --- |
| A | Tamil Eligibility-cum-Scoring Test (இலக்கணம், இலக்கியம், தமிழறிஞர்கள்) | 100 | 6,000 |
| B – GS | General Science | 5 | 600 |
| B – GS | Geography | 5 | 600 |
| B – GS | History, Culture of India, National Movement | 10 | 1,000 |
| B – GS | Indian Polity | 15 | 1,200 |
| B – GS | Indian Economy and Development Administration in Tamil Nadu | 20 | 1,400 |
| B – GS | History, Culture, Heritage and Socio-Political Movements of Tamil Nadu | 20 | 1,400 |
| B – Aptitude | Aptitude (simplification, percentage, HCF/LCM, ratio, interest, area, time and work) | 15 | 1,200 |
| B – Aptitude | Reasoning (logical reasoning, puzzles, dice, visual reasoning, number series) | 10 | 800 |
| — | Current affairs (rolling, last 12 months) | within GS | 50 new per week |
|  | **Total** | **200** | **\~14,200 + weekly** |

The English-medium differently-abled option (General English instead of Part A) is a phase 2 pack.

**Question data per item**

- Text in Tamil and English (Part A in Tamil only), 4 options, correct answer, 2–3 line explanation in both languages
- Tags: unit, sub-topic, difficulty (1–5), source (PYQ year or original), Samacheer Kalvi book/chapter reference
- Optional image (maps, figures for reasoning)
- Stats tracked live: times shown, % correct, average time — used to recalibrate difficulty

**Sourcing pipeline**

1. Previous-year Group 4, Group 2 and Group 1 prelim questions (2012 onwards), re-checked against current answer keys
2. Original questions written by you and 3–5 volunteer aspirants or teachers (credited in the app, free Premium for life) from Samacheer Kalvi 6th–10th (and 11th–12th for history/polity) books
3. AI-assisted drafting allowed only as first draft; every question passes two human reviewers before going live
4. Player "Report question" button → review queue within 48 h; reporter gets 20 coins if the report is upheld

**Difficulty matching:** each player has a hidden rating per unit; rooms use the average rating of players, so mixed-level friends still get fair questions.

## Room question selection algorithm

A room match only uses questions that no player in the room has seen in the last 14 days. This keeps matches fresh, and it keeps them fair, because nobody gets an advantage from having just met a question in solo practice.

**What the server tracks per player**

- `user_question_history` in PostgreSQL: user\_id, question\_id, last\_seen\_at, times\_seen, last\_correct (one row per pair, upserted after every answer)
- A Redis sorted set `seen:{user_id}`, with question\_id as the member and last\_seen time as the score. It is trimmed to 90 days, so lookups take milliseconds.
- Every question shown counts as seen: solo, daily challenge, mock and rooms

**Selection steps (run by the game server when the host taps Start)**

1. **Set quotas.** Split the N questions across units by exam weight (Tamil 50%, General Studies 37.5%, Aptitude 12.5%, then by unit within General Studies), using largest-remainder rounding. If the room has a single subject, its sub-topics share the N questions.
2. **Build candidates.** For each unit, take live questions in the room's language with difficulty within ±1 of the room's average player rating.
3. **Exclude recent questions.** Remove any question seen by any player in the room within the cooldown, which is 14 days. Also remove the questions used in this group's last 3 matches together, whatever their age.
4. **Score what remains** with freshness weight = average across players of min(days since seen, 60) ÷ 60, where never seen = 1.0. Multiply by 1.2 if no player has ever seen it, and by 0.8 if its report rate is above 2%.
5. **Pick by weighted random sampling** without replacement (Efraimidis–Spirakis), so friends cannot predict the set. Allow at most 2 questions from one sub-topic per match.
6. **Fallback if a unit runs short:** first widen the difficulty band to ±2, then relax the cooldown in steps (14 → 7 → 3 days), then take the oldest-seen questions first. The no-repeat rule for the group's last 3 matches is never relaxed.
7. **Lock and record.** Store the chosen IDs on the match and mark them seen for every player as each question is shown. A question a player never reached (disconnect) does not count as seen.

```text
select_room_questions(room, players, N):
    quotas   = split_by_exam_weight(N, room.subject)
    recent   = UNION(seen[p] since now - cooldown for p in players)
    recent  += questions_in_last_matches(players, 3)
    chosen   = []
    for unit, k in quotas:
        pool = live_questions(unit, room.language,
                              room.rating - 1 .. room.rating + 1)
        cand = pool - recent
        while len(cand) < k and cooldown > 3 days:
            cooldown = next_lower(cooldown)        # 14 -> 7 -> 3
            cand = pool - recent_within(cooldown) - last_3_matches
        for q in cand:
            q.w = mean(min(days_since_seen(p, q), 60) / 60 for p in players)
            if unseen_by_all(q): q.w *= 1.2
            if q.report_rate > 0.02: q.w *= 0.8
        chosen += weighted_sample(cand, k, max_per_subtopic = 2)
    return shuffle(chosen)
```

**Settings (tunable from the admin panel)**

| Parameter | Default | Note |
| --- | --- | --- |
| Cooldown for room questions | 14 days | Raise to 30 days once the bank passes 20,000 questions |
| Group no-repeat window | Last 3 matches | Never relaxed |
| Difficulty band | Room rating ±1 | Widened to ±2 before the cooldown is relaxed |
| Max per sub-topic | 2 per match | Keeps matches varied |
| Unseen bonus / reported penalty | ×1.2 / ×0.8 | Applied to the freshness weight |

**Performance:** candidate sets per unit and difficulty are kept in Redis. The exclusion is a set difference against the union of 2–4 players' seen sets, so selection finishes in under 50 ms even with 15,000 questions.

**Solo is different:** solo practice deliberately brings back questions a player got wrong, through the spaced-repetition revision deck. Rooms always favour fresh questions, and solo favours weak ones.

## Gamification layer

Coins measure wealth; XP measures effort and never goes down. Keeping them separate means a player who loses coins in rooms still sees steady progress.

**XP and levels**

- 10 XP per correct answer, 2 XP per attempt, ×1.5 in room matches
- 50 levels named after Tamil Nadu government ranks for flavour: Aspirant → Typist → Junior Assistant → VAO → Bill Collector → … → "Group 4 Champion"
- Each level unlocks something: stake tiers, emoji packs, avatar frames, 4-player room hosting (level 3)

**Streaks**

- Daily streak for playing at least one solo set; coin reward grows to day 7, then resets the cycle
- One free Streak Shield per week; extra shields cost 150 coins
- Room streak: consecutive room wins give a flame badge visible to friends

**Leaderboards**

- Friends leaderboard (weekly XP) — the main one shown on home
- District leaderboard (all 38 districts) and state leaderboard
- Subject leaderboards (e.g. top Polity players this week)
- Weekly leagues of 30 players: Bronze → Silver → Gold → Diamond → Champion; top 5 promoted, bottom 5 relegated

**Badges and achievements (examples)**

- Polity Pro: 500 correct Polity answers
- Tamil Scholar: 90% accuracy over 200 Part A questions
- Speed Demon: 10 correct answers under 5 s each in one match
- Comeback King: win a room after trailing by 300+ points
- Study Buddy: play 25 rooms with the same friend

**Study-first features (so the game helps scores)**

- Weak-topic radar: after every match, the 3 weakest sub-topics with a one-tap practice set
- Revision deck: every wrong answer goes into a spaced-repetition deck
- Exam countdown on home screen with a suggested daily plan
- Monthly full mock with predicted score band and estimated cut-off comparison
- Group study rooms: friends play the same set and see a combined weak-topic report

## Screens and user flows

The MVP needs 14 screens; a new player should finish their first solo set within 60 seconds of opening the app.

| # | Screen | Key elements |
| --- | --- | --- |
| 1 | Splash + language pick | தமிழ் / English toggle, remembered |
| 2 | Sign-in | Google sign-in or email magic link (both free; SMS OTP costs money per message); name, district, target exam year |
| 3 | Home | Coin and XP bar, exam countdown, Play Solo, Create Room, Join Room, daily challenge card, friends online |
| 4 | Solo setup | Subject/unit picker, mixed mode, difficulty |
| 5 | Question screen | Timer ring, question, 4 options, power-ups, progress dots |
| 6 | Answer reveal | Correct option, explanation, Add to revision deck |
| 7 | Solo result | Score, coins and XP earned, weak topics, Play again |
| 8 | Create room | Size 2/3/4, subject, stake, question count, power-ups on/off |
| 9 | Lobby | Room code, share to WhatsApp, player seats, Ready, chat |
| 10 | Live match | Question screen + opponent avatars, answered ticks, emoji bar |
| 11 | Match result | Podium, pot split, rematch, chat |
| 12 | Friends and chat | Friends list, requests, search by username, 1:1 chat |
| 13 | Leaderboards and leagues | Friends / district / state / subject tabs |
| 14 | Profile and stats | Level, badges, accuracy per unit, coin history, settings |

**First-time flow:** open link → language → Google or email sign-in → 3-question demo quiz → 500 coins awarded → prompt to invite a friend or play solo.

**Friend-room flow:** home → Create Room → settings → share link on WhatsApp → friend taps link (opens the room in the browser or the installed PWA) → lobby → ready → match → result → rematch or chat.

**Design notes**

- Large tap targets and Tamil-friendly fonts (Noto Sans Tamil / Mukta Malar) at 16 sp minimum
- Bright, festive palette with clear correct/wrong colours plus icons (not colour alone)
- Sound effects and light haptics, all mutable
- A service worker caches the app shell and 200 solo questions, so solo practice works offline; coins sync when back online

**PWA install and notifications**

- Web app manifest with Tamil and English names, icons and a splash colour; opens full-screen like an app
- Show an Add to Home screen prompt after the first finished match, not on first visit
- iPhone: install through Safari's Share → Add to Home Screen; web push works only after install (iOS 16.4 and later)
- Room invites and streak reminders go out as web push; WhatsApp links remain the main invite path

## Mobile performance, 3D and animation

3D is used on reward moments (staking, results, level-ups), never on the question screen, and it loads only on phones that can run it smoothly. Questions stay plain 2D so they are fast and easy to read on a ₹8,000 Android phone.

**Performance budget (checked on every deploy)**

| Measure | Target |
| --- | --- |
| First load on 4G, budget Android | Interactive in under 3 s (Largest Contentful Paint under 2.5 s) |
| JavaScript on first load | Under 170 KB gzipped; 3D engine loaded later, only when needed |
| Frame rate | 60 fps target, never below 30 fps in a match |
| 3D assets per scene | Under 500 KB, under 5,000 triangles per model |
| Memory | Under 150 MB on a 3 GB RAM phone |
| Question-to-question transition | Under 100 ms (next question prefetched) |

**Where 3D appears**

| Moment | 3D object | Animation |
| --- | --- | --- |
| Room stake | Stack of gold coins | Coins drop into a central pot as each player joins |
| Match result | Podium with player avatars | Avatars rise to 1st/2nd/3rd, coins burst from the pot toward the winner |
| Home screen | Treasure chest showing coin balance | Lid opens when daily reward is collected |
| Level up | Spinning badge or trophy | Flip and glow, then settles into profile |
| Lobby | Round table with 2–4 seats | Seat lights up when a player taps Ready |

The MVP ships two scenes, the stake pot and the results podium; the rest come in phase 2.

**3D tech (free)**

- Three.js through React Three Fiber and drei, loaded as a separate chunk only on screens that use 3D
- Models in glTF/GLB with Meshopt or Draco compression; textures in KTX2; one shared texture atlas
- Low-poly style fits the budget and looks good small; free CC0 models from Kenney, Quaternius and Poly Pizza, or made in Blender
- Baked lighting into textures, no real-time shadows or post-processing on mid and low phones
- Render only while something moves (`frameloop="demand"`), cap pixel ratio at 1.5, pause when the tab is hidden, free GPU memory when leaving the screen

**Device tiers (decided on first launch, stored on the device)**

| Tier | How it is detected | What players get |
| --- | --- | --- |
| High | 6+ GB RAM (`navigator.deviceMemory`), 8 cores, a short test render above 55 fps | Full 3D, particle effects, pixel ratio up to 1.5 |
| Medium | 4 GB RAM or test render 35–55 fps | 3D at pixel ratio 1, fewer particles |
| Low | Under 4 GB, test render below 35 fps, or Data Saver on | No 3D download; same moments as light 2D Lottie animations |
| Reduced motion | Phone setting `prefers-reduced-motion` | Static images and simple fades |

If frame rate drops below 30 fps for 2 seconds during a scene, the app steps down one tier for that player automatically. Players can also pick "Battery saver" in settings.

**2D animation**

- Motion (Framer Motion) for screen transitions, option taps, score counters and scoreboard reordering
- dotLottie files for confetti, coin bursts, streak flame and emoji reactions (small vector files)
- Animate only `transform` and `opacity`, so the phone's GPU handles it without re-layout
- Timer ring drawn with SVG and CSS, so it stays smooth even when the network is slow
- Correct answer: green pulse + light vibration (`navigator.vibrate`, Android); wrong: short shake

**Mobile-first layout**

- Designed at 360 px wide first; portrait locked in the PWA manifest
- Answer buttons in the bottom half of the screen within thumb reach, at least 48 px tall
- Respects notches and gesture bars (`safe-area-inset`), uses `dvh` units so the browser toolbar never hides buttons
- No hover-only actions; long Tamil text wraps cleanly with `Noto Sans Tamil` at 16 px minimum

**Loading and caching**

- Code split per screen; 3D, chat and admin load only when opened
- Next question's images prefetched during the reveal
- Tamil font subset to needed characters (WOFF2), images in WebP/AVIF
- Service worker precaches the app shell; 3D models cached after first download so they never load twice
- Cloudflare serves everything compressed from its edge, near Chennai

**Testing on real phones**

- Lighthouse CI in GitHub Actions (free) fails the build if the budget above is broken
- Chrome DevTools with 4× CPU slowdown and slow 4G for daily checks
- Weekly test on two real low-end Android phones (e.g. a 3 GB Redmi or Samsung A-series) borrowed from beta testers
- Small in-app frame-rate logger sends average fps per tier to PostHog, so tiers can be tuned with real data

## Tech architecture

Build one React web app, installable as a PWA and hosted free on Cloudflare Pages, on top of Supabase's free plan for sign-in, database, real-time rooms and server functions. There is no server to rent: game rules run as database functions and Edge Functions, so the browser never sees an answer before the question closes.

&#91;embedded content: system architecture · MVP\]

The browser calls functions over HTTPS to start matches and submit answers, and listens on a Realtime channel for questions, scores and chat. All coins and scores are written in PostgreSQL by those functions only.

**Recommended stack**

| Layer | Choice | Cost |
| --- | --- | --- |
| Front end | React + Vite + TypeScript, Tailwind CSS | Free |
| PWA | vite-plugin-pwa (Workbox): manifest, offline cache, install prompt | Free |
| Hosting | Cloudflare Pages, free `*.pages.dev` address | Free |
| Backend | Supabase Free: 500 MB database, 50,000 monthly active users, 200 concurrent realtime connections, 2 million realtime messages a month | Free |
| Game logic | Supabase Edge Functions + PostgreSQL functions (RPC), pg\_cron for clean-up jobs | Included |
| Sign-in | Supabase Auth: Google + email magic link | Included |
| Images | Supabase Storage (1 GB) | Included |
| Push | Web Push (VAPID keys) sent from an Edge Function | Free |
| Analytics / errors | Cloudflare Web Analytics, PostHog free, Sentry free | Free |
| Code, deploys, backups | GitHub + GitHub Actions; nightly database dump to a private repo (the free plan has no automatic backups) | Free |

Free-plan figures from [Supabase pricing summaries, Aug 2026](https://www.cloudzero.com/blog/supabase-pricing/) and [FocusReactive](https://focusreactive.com/blog/supabase-price/); check the live pricing page before building.

**Live match sequence**

1. Host taps Start → Edge Function `start_match` checks every balance, moves stakes to escrow and picks the questions (see the selection algorithm) in one database transaction. It saves a fixed schedule: question *i* opens at start + *i* × (timer + 5 s reveal).
2. The function broadcasts "match started" with the schedule on the room's Realtime channel.
3. When each question opens, browsers call RPC `get_question(match, i)`; it returns text and options only once the database clock has passed the open time, and never the answer.
4. Players answer through RPC `submit_answer`, which timestamps with the database clock, scores speed and streak, and rejects late answers. It broadcasts only "player answered" ticks.
5. After close, RPC `reveal(match, i)` returns the correct answer, explanation and scoreboard.
6. After the last question, any player's browser calls `finish_match`; it settles the pot once (repeat calls do nothing). A pg\_cron job every minute settles or refunds matches nobody finished.

Because the schedule lives in the database, no always-on game server is needed.

**Core data model**

- users (id, phone, name, district, language, level, xp, rating per unit)
- coin\_ledger (id, user\_id, amount ±, reason, match\_id, created\_at) — balance = sum, cached on users
- questions (id, unit, subtopic, difficulty, text\_ta, text\_en, options, answer, explanation, source, status)
- rooms (id, code, host\_id, size, stake, settings, status)
- matches, match\_players, match\_answers (per player per question: choice, time\_ms, points)
- user\_question\_history, friendships, chat\_messages, reports, achievements, user\_achievements

**What the free plan can carry:** 200 concurrent realtime connections is about 200 players in lobbies, matches or chat at the same moment (50–100 rooms). Solo practice does not hold a realtime connection, so open one only on lobby, match and chat screens. At an estimated 500 delivered messages per 4-player match including chat, 2 million messages is roughly 4,000 such matches a month. Move to Supabase Pro ($25/month) when peaks pass about 150 connections or the database nears 400 MB.

## Anti-cheat, security and privacy

The server is the only source of truth for answers, scores and coins; the phone only displays. That one decision blocks most cheating.

**Anti-cheat**

- Correct answers never sent to the phone before a question closes; options shuffled per player
- Answer timestamps taken on the server; answers under 0.8 s on long questions flagged
- Offline solo play earns coins only after server re-check on sync, capped at 100 coins per offline session
- Collusion detection: the same pair repeatedly staking high with one side always losing (coin dumping) → stakes frozen and reviewed
- One account per Google account or email; a browser fingerprint limits repeat sign-up bonuses
- Anyone can open a web app's developer tools, so nothing secret reaches the browser: answers sit in a table only database functions can read, enforced by row-level security
- Screenshot sharing during live matches can't be fully blocked, so room questions are drawn fresh from a large pool

**Security**

- Supabase Auth (Google or email link) with short-lived tokens; row-level security on every table so players can only read and write their own rows
- All coin changes written as an append-only ledger with transaction IDs, so balances can be audited and rolled back
- HTTPS everywhere (free on Cloudflare Pages), secret keys only in Edge Function settings, admin pages gated by an admin role in the database

**Privacy (Digital Personal Data Protection Act, 2023)**

- Collect only email, name, district and exam year
- Clear consent screen and in-app account deletion
- Users under 18: verifiable parental consent required under the DPDP Act, or set the minimum age at 18 (Group 4 applicants must be 18+ anyway)
- Create the Supabase project in the Mumbai region

## Roadmap, team, budget and risks

A public launch on 15 April 2027 is realistic for one builder using free tools and an AI coding assistant; the MVP cannot be ready for the 20 December 2026 Group 4 exam, so the target is aspirants preparing for the 2027 cycle. The 2026 notification is scheduled for 6 October with the exam on 20 December ([TNPSC planner summary](https://www.taiyarho.in/exams/tnpsc-group-4/)).

&#91;embedded content: roadmap · Oct 2026 to Jun 2027\]

The MVP ships solo play, coins and 2-player duels to the beta; 3 and 4-player rooms, full chat and leagues follow before public launch.

**MVP scope (must ship to beta)**

- [ ] Google and email sign-in, Tamil/English UI
- [ ] PWA: manifest, icons, offline solo practice, install prompt
- [ ] Solo practice, daily challenge, coin ledger with escrow
- [ ] 2-player rooms with code + WhatsApp link, emoji reactions, quick phrases
- [ ] 3,000 reviewed questions across all units, then about 100 more a week
- [ ] Friends list, friends leaderboard, profile stats
- [ ] Admin pages: CSV question upload, review queue, reports
- [ ] Terms of use and privacy policy published (free templates, adapted)
- [ ] Nightly database backup running on GitHub Actions

**Who does what**

| Role | Who | Cost |
| --- | --- | --- |
| Product, development, deployment | You, with an AI coding assistant | ₹0 |
| Question writing and review | You + 3–5 volunteer aspirants or teachers, credited in the app, free Premium for life | ₹0 |
| Beta testers | Your study group, Telegram and WhatsApp prep groups | ₹0 |
| Design | Google Fonts (Tamil), free open-licence icons and illustrations | ₹0 |
| Marketing | YouTube Shorts, Instagram reels, Telegram channels, tie-ups with local coaching centres | ₹0 |

**Budget: ₹0 to launch**

| Item | Free option now | When money is needed |
| --- | --- | --- |
| Hosting | Cloudflare Pages free plan | Not at this scale |
| Backend | Supabase Free | Pro at $25/month (about ₹2,100) once peaks pass \~150 live players or the database nears 400 MB |
| Web address | `yourapp.pages.dev` | Optional `.in` domain, roughly ₹800 a year |
| Sign-in | Google + email magic link | SMS OTP only if players demand it (paid per SMS) |
| Legal check | Self-check the design against the Act's definitions | Paid gaming-law opinion once earnings allow, before any paid feature |
| App store | Not needed; the PWA installs from the browser | Optional Play Store listing via a Trusted Web Activity wrapper ($25 one-time) |

**Paying for growth:** apply for Google AdSense once the site has steady traffic; add Premium through Razorpay after launch; spend the first earnings on Supabase Pro and the domain.

**Success metrics**

| Metric | Target at 3 months after launch |
| --- | --- |
| Day-1 / day-7 / day-30 retention | 40% / 25% / 12% |
| Rooms created per daily active user | 0.3 |
| Invite links that turn into a joined player | 30% |
| Average play time per active user | 15 min/day |
| Crash-free sessions | 99.5% |
| Questions reported as wrong | under 1% of questions shown |

**Risks and responses**

| Risk | Response |
| --- | --- |
| Coin staking treated as an online money game | Coins never sold or redeemed; no paid feature touches coins; get a legal opinion before adding Premium |
| Free-tier limits hit (200 live connections, 2 million messages a month) | Realtime only on lobby, match and chat screens; a "rooms are busy, try solo" message at the cap; upgrade from first earnings |
| Supabase pauses a free project after 7 idle days | Daily players keep it awake; a GitHub Actions ping during quiet weeks |
| No automatic backups on the free plan | Nightly dump to a private GitHub repo |
| One builder runs out of time | Strict MVP scope, volunteers for questions, release solo mode first if rooms slip |
| Wrong answers damage trust | Two-reviewer process, 48-hour report fix, explanations cite the textbook chapter |
| Too few players online for Quick Match | Lead with friend rooms; Quick Match falls back to a clearly labelled practice bot with no stakes |
| iPhone PWA limits | Push only after install on iOS 16.4+; WhatsApp links stay the main invite path |
| Cheating and coin farming | Server-side scoring, row-level security, ledger audits, collusion detection |
