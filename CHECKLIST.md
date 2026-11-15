# TrojanWalk checklist

Last updated: 2026-11-15 (after SPEC Prompt 6)

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

## Check-in lapse test (Prompt 4)

Temporarily shorten the timers, give Ana a fake contact, then run the request flow above:
```sql
update profiles set emergency_contacts = '{+15555550100}' where email = 'demo1@usc.edu';
alter table sessions alter column checkin_interval_s set default 20;
alter table sessions alter column checkin_grace_s set default 15;
alter table sessions alter column escalate_after_s set default 15;
```
Ana does nothing, Ben taps "I'm good". Within ~2 min Ana goes check-in due > missed > escalated; her screen shows
the DPS call card, Ben's shows "Check on Ana". `select kind, delivery, body from notifications` shows the stub SMS.
**Restore after:** defaults 240 / 60 / 30 (see the same statements with those values).

## No-match test (Prompt 5)

Ana alone (nobody else toggled on): demo mode, pin Leavey, `/request`, pick The Lorenzo, Find company. After the
real 3-minute expiry she sees "No one yet" with **Open Lyft** and **Walk with a watcher**. The watcher form lists her
saved contact (or type a +1 number); Start watched walk opens `/session/<id>` in "Watched walk" mode. To see a lapse
without waiting 5 min, shorten that one session in SQL: `update sessions set next_checkin_at = now() + interval '10 seconds', checkin_grace_s = 10, escalate_after_s = 10 where id = '<id>'`.

## Walker rung-3 test (Prompt 6)

Four windows. Requester needs no friends online and (to test the gender rule) `same_gender_only`. Demo data used:
Cam (demo3) requests Leavey > Lorenzo; Ben (demo2) verified Walker with hours covering now (the demo flag
`walkers.verified` is set in SQL); Ana (demo1) Walker capped at 3/3 (`pings_tonight = 3`); Dee (demo4) Walker,
wrong gender. Walkers stay on `/map` with Walking alone ON, pinned within 100 m of Leavey. Only Ben is pinged,
about 2 min after the request (the 30 s cron adds up to 30 s). After the test set `opted_in = false` /
`pings_tonight = 0` on the extra Walkers.

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

- [x] Prompt 4 (Playwright, two windows): both see the other's dot from `session_fixes` via `session_status`
      (presence never read); lapse in Ana's window gave active > checkin_due > checkin_missed > escalated
      (timers 20/15/15 s); 2 notifications queued (missed, escalated), sent through the pg_net -> `checkin-sweep`
      path (`net._http_response` = 200 `{"processed":1}` twice), `delivery = stub`, body has a signed link and no
      coordinates; Ana's screen showed the DPS `tel:` card + "SMS sent (stub) to 1 contact", Ben's showed
      "Check on Ana". Arrival: walking Tuscany > Lorenzo ended the session for both at the geofence, one-tap
      5-star rating stored, no `session_fixes` written after arrival.
- [x] Access control: a non-member gets 42501 on `session_status`, `record_fix`, and `checkin`, reads no fixes;
      signed-out callers cannot run `sweep_checkins`; the public share link works only with a valid token.

- [x] Prompt 5 (Playwright, Ana alone): real expiry at ~192 s showed both options. Lyft link =
      `lyft://ridetype?id=lyft&pickup[latitude]=..&pickup[longitude]=..&destination[latitude]=..&destination[longitude]=..`
      (web fallback `https://lyft.com/ride?...`, same params); on the session screen the button has the same link.
      Clicking with no Lyft app installed fell back to the web link after ~1.5 s and Lyft redirected to
      `ride.lyft.com/not-supported?destination=34.0265,-118.28&origin=...` (it parsed our prefilled trip; the
      "not supported" page is Lyft's response to a headless desktop browser, not verified on a phone).
      Bad phone number rejected with a clear message. Watched walk: session has no companion, `watcher_contact`
      set, request `matched`; the "watching" stub SMS went out immediately with a signed link and no coordinates;
      the public link read "You're watching Ana's walk"; a lapse gave check_due > missed > escalated and queued the
      missed + escalated texts to the watcher; Ana's screen showed the DPS card and the SMS notice.

- [x] Prompt 6: `/walker` (opt-in switch, 4 profile questions + same-gender switch, hours presets + from/until,
      push prompt, "Verification pending" status, N of 3 pings tonight) saved and reloaded correctly as Ben.
      Rung 3 (Playwright, 4 windows, no friends online): read-only `fanout_candidates` on the live request returned
      nobody while Ben's hours excluded now, Ana was capped, and Dee was the wrong gender; after Ben's hours were
      set to include now it returned only Ben (rung 3). Ben's banner appeared 134.8 s after the request; Ana and Dee
      stayed at no banner; Ben's accept matched the request and both windows landed on the same session. Ben's
      `pings_tonight` went 0 > 1 (cap counter works); `push-pending` was poked by cron and returned
      `claimed 1, sent 0, skipped "no VAPID keys"`.

## Written but NOT yet exercised

- [ ] Web Push end to end (subscribe, VAPID secrets as edge secrets, send, receive). The prompt on `/walker`
      only reaches the permission step; nothing was subscribed in headless Chrome.
- [ ] Rung-3 negatives not hit in the live run: `opted_in = false`, unverified, strike, a Walker 100-300 m away,
      hours that wrap past midnight, and a friend who is also a Walker (lowest rung wins).

- [ ] Lyft deep link on a real phone with the Lyft app installed (and whether the free USC pass applies).
- [ ] Watcher link auto-refresh in a browser over time (page polls every 10 s; only fetched once in the test).
- [ ] The watched walk's arrival (geofence ends it; no rating card for watcher walks).

- [ ] Real Twilio SMS (no TWILIO_* secrets; stub only). Edge env `APP_URL` is unset so SMS links point at
      `http://localhost:3000`; set it for a real deployment.
- [ ] Late answer during `checkin_missed` returning the walk to `active`; ending a walk with "End walk" button;
      a watcher-only session (Prompt 5).
- [ ] The console line `[SMS stub]` in edge logs (connector's log query did not surface it; DB outbox and pg_net
      responses confirm the send path ran).
- [ ] Anomaly detection (early check-in on a stop/reversal); spec says start as rules in the sweep. Not built.

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

- Lyft button shows while a walk is live (hidden after arrival/end, where it has no use).
- Only the "Walk with me" ladder row does anything (links to `/request`); Share my walk / Broadcast / Emergency do not. "Good evening" is static text.
- `/history`, `/walker`, `/profile` (has Sign out) are placeholders. `/request/broadcast`, `/admin/heatmap` do not exist yet.
- "Call DPS" on escalation is a `tel:` button, not an automatic dial (browsers block non-gesture dialing).
- Place coordinates in `places.sql` are hand-estimated; verify before the demo.
- Map card is a 340 px rounded card (matches the UI shell), not full-bleed.

## Decisions / gotchas

- Being matched as a Walker needs the app open with Walking alone ON: matching uses live presence (spec query),
  so a closed app cannot be found. Push only helps once they are in range. `/walker` says so.
- Opting out is a flag (`walkers.opted_in`), not a delete, so a strike record cannot be reset by re-opting in.
- Walkers are "verified" by a database flag only (demo). Real vetting is a v1 item in the PRD.
- Rung-3 banner says "leaving in 0 min" when the leave time has already passed (cosmetic, not changed).

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
- [x] Prompt 4: live session, check-in, sweep, SMS stub, arrival + rating
- [x] Prompt 5: Lyft handoff + watcher walk on request expiry
- [x] Prompt 6: /walker + rung 3 (Walker ping at +120 s)
- [ ] Prompts 7 to 10
- [ ] History screen (deferred to the end by request)
