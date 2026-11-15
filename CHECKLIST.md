# TrojanWalk checklist

Last updated: 2026-11-15 (after SPEC Prompt 3)

## How to run

```
npm install          # postinstall copies the MapLibre worker to public/vendor/
npm run dev          # http://localhost:3000
```

Needs `.env.local`: Supabase URL + anon key, `DEMO_MODE=true`, `DEMO_PASSWORD` (random, local only).
Supabase project: `trojanwalk` (`ycuqduwmzrsztrrnodcp`). Migrations in `supabase/migrations/`
(applied through the Supabase MCP); seed in `supabase/seed/`. Test at 390 px wide.

## Two-user test (one laptop)

Tabs in one window share a session, so use **two isolated windows** (normal + private):

1. Each window: `/login` > "Demo users" > pick a different user (Ana, Ben, ...).
2. Each window: triple-tap the TROJANWALK wordmark > Demo mode sheet > check "Use fake position",
   pick "Start at" and "Walk toward". Suggested: Ana at Leavey Library, Ben at Blue-light phone
   (Jefferson), both walking toward Leavey Library (~95 m apart, inside the 150 m radius).
3. Flip "Walking alone" on in both. Each sees the other's dot within ~5 s.
4. In Ben's sheet press Walk: he moves 30 m every 2 s; Ana sees his arrow point the way he moves.
5. Turn Ana's toggle off: her dot vanishes for Ben and her presence row is deleted.

## Walk request test (Prompt 3)

Needs demo1 (Ana) and demo2 (Ben) as friends (`supabase/seed/demo_friends.sql`, already applied).
1. Ben's window: demo mode, pin "Blue-light phone (Jefferson)", turn Walking alone ON, stay on `/map`.
2. Ana's window: demo mode, pin Leavey Library, tap "Walk with me", type
   "leaving leavey in 2, heading to the lo", Find company (confirm the form if it appears).
3. Ben sees the "Walk together?" banner on any app page; Yes lands both on `/session/<same id>`.

## Works end to end (verified)

- [x] Schema, RLS on all tables, cron jobs, realtime publication (Prompt 1).
- [x] `@usc.edu` gate in the database; unauthenticated `/map` redirects to `/login`.
- [x] DEMO_MODE login as demo1-4@usc.edu (`/api/dev-login`; 404 unless DEMO_MODE=true).
- [x] `/map`: real MapLibre map (OpenFreeMap tiles, dark treatment), Walking alone toggle,
      presence upsert every 5 s (+ on 10 m movement), anonymous dots from `nearby_dots` every 5 s.
- [x] Heading from the last two fixes >= 5 m apart (`lib/geo.ts`), null while still.
- [x] Demo panel: pin to a place, Walk 30 m / 2 s toward a destination.
- [x] Automated two-context run (Playwright): both see 1 dot; Ben's heading seen by Ana = 172 deg
      vs. expected 171.6; toggling off removes the dot; client only ever POSTs/DELETEs `presence`
      (never reads it).

- [x] Prompt 3 (Playwright, two isolated windows): request row has the right origin/dest/labels,
      leave_in 120 s, window 180 s; rung-2 fan-out targeted only Ben (friend, within 300 m, presence
      fresh); Ben's in-app banner showed "Ana wants company, Leavey Library to The Lorenzo, leaving
      in 2 min."; his accept set status `matched`, created one session (Ana requester, Ben companion,
      meeting point Leavey); both windows landed on the same `/session/<id>`.
- [x] Privacy as Ben (target): `requests` and `presence` return `[]`; `target_requests` has labels only;
      `fanout_candidates` is permission denied.

## Written but NOT yet exercised

- [ ] **parse-request with the real model.** Edge env `ANTHROPIC_API_KEY` is empty (Anthropic answers
      "x-api-key header is required"), so every parse used the offline alias fallback (confidence <= 0.5,
      always shows the form). Set the secret in Supabase > Edge Functions > Secrets, then re-test.
- [ ] Rung 3 (Walkers at +120 s) and expiry at +180 s via `advance_requests()` (30 s pg_cron).
- [ ] Web Push (service worker, subscribe on toggle, send from `fanout`). Needs `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
      and `VAPID_PRIVATE_KEY` as Supabase edge secrets too. Banner is the tested path.
- [ ] Decline path; two people accepting at once (SQL row lock should give the second "taken").

- [ ] Real-GPS path (`watchPosition`) on a phone. Headless run only used demo pins.
- [ ] Real @usc.edu magic-link / code sign-in round trip.
- [ ] `fanout_candidates`, `record_fix`, other RLS paths with two users.

## Stubbed / mock

- Only the "Walk with me" ladder row does anything (links to `/request`); Share my walk / Broadcast / Emergency do not. "Good evening" is static text.
- `/history`, `/walker`, `/profile` (has Sign out) are placeholders. `/session/[id]` is a placeholder (peer name, meeting point, state; real session is Prompt 4),
  `/request/broadcast`, `/admin/heatmap` do not exist yet.
- Place coordinates in `places.sql` are hand-estimated; verify before the demo.
- Map card is a 340 px rounded card (matches the UI shell), not full-bleed.

## Decisions / gotchas

- Location is read locally whenever `/map` is open (to centre the map and name the nearest place),
  but sent to the server only while Walking alone is on. Leaving the screen deletes the presence row.
- Toggle state is not remembered across reloads (starts off on purpose).
- `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` is **rejected by the project** ("Invalid API key").
  Not needed so far (demo login uses the anon key + a password). Needed from Prompt 3 for
  edge functions: get the current secret key from Supabase > Settings > API Keys.
- Demo users have a password in the DB. Delete them (`delete from auth.users where email like 'demo_@usc.edu'`)
  and unset DEMO_MODE before any real deployment.
- MapLibre 6.x: worker is served from `public/vendor` (gitignored, copied by `scripts/`).
- Supabase Auth: add `http://localhost:3000/auth/callback` to redirect URLs; add `{{ .Token }}`
  to the email template for code entry.
- `spatial_ref_sys` (PostGIS) has RLS off per the advisor; left alone pending a decision.
- PRD says requests lose their user id after a while; spec has no job for it. Not built.

## Build order

- [x] Prompt 1: schema and auth
- [x] Prompt 2: ambient map (real GPS path untested)
- [x] Prompt 3: walk request + fan-out (parser on fallback, push untested)
- [ ] Prompts 4 to 10
- [ ] History screen (deferred to the end by request)
