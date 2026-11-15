# TrojanWalk — Technical spec for Claude Code

Nov 15, 2026 · @Sketh

This tab is what the person coding has open next to the editor. It assumes the product PRD on the first tab and does not repeat it.

## How to use this with Claude Code

Export both tabs as Markdown, drop them in the repo as `docs/PRD.md` and `docs/SPEC.md`, and point Claude Code at the spec. Work through the prompts in the last section in order; each one is sized to finish and be tested before the next. Do not ask it to build the whole app in one go.

First prompt to paste

```markdown
You are building TrojanWalk, a mobile-web PWA for USC students. Read docs/PRD.md and docs/SPEC.md fully before writing code.

Rules for this repo:
- Stack and schema are fixed by docs/SPEC.md. Do not swap libraries or rename tables.
- Every feature ships with a way to exercise it from two browser tabs on one laptop (two fake users), because the demo is two phones.
- Location is only ever written to the server while a user's toggle is on or a session is active. Never add background tracking.
- Never send a requester's exact location to anyone who has not been approved or matched into a session with them.
- Keep a running CHECKLIST.md: what works end to end, what is stubbed, how to run it.

Start with Prompt 1 in docs/SPEC.md (Supabase schema and auth). Stop and show me the migration before applying it.
```

Two habits that save hours tonight: after each prompt, run the two-tab test yourself before moving on, and commit. When Claude Code drifts (a new state library, a native build, a chat feature), point it back at the Rules block.

## Stack, repo layout, environment

One Next.js app, one Supabase project. Everything that must be real for the demo runs on these two; everything else is a stub behind an interface.

| Piece | Choice | Notes |
| --- | --- | --- |
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind, PWA manifest | Mobile-first; test at 390 px wide |
| Map | MapLibre GL with the free OpenFreeMap or MapTiler tiles | Mapbox works too but needs a token |
| Backend | Supabase: Postgres + PostGIS, Auth, Realtime, Edge Functions (Deno) | One project; use the hosted free tier |
| Auth | Supabase email OTP / magic link, allow-list `@usc.edu` in a DB trigger | SSO later |
| LLM | Anthropic API, `claude-sonnet-4-5` or newer, called from an edge function only | Never from the browser |
| Push | Web Push (VAPID) for in-app users; Twilio SMS for chosen contacts | Twilio is a stub if no account by morning |
| Scheduling | `pg_cron` for TTL deletes and missed check-in sweeps | Runs every minute |
| Hosting | Vercel for the app, Supabase hosted | Both deploy from `main` |

Repo layout

```
trojanwalk/
  app/                    # Next.js routes
    (auth)/login
    map/                  # ambient map + toggle
    request/              # walk with me, broadcast
    session/[id]/         # live session + check-in
    walker/               # walker opt-in + profile
    admin/heatmap/        # demo slide data
  components/
  lib/
    supabase/             # client, server, types
    geo.ts                # haversine, bearing, geofence helpers
    push.ts               # web push + sms
    lyft.ts               # deep link builder
  supabase/
    migrations/           # SQL, numbered
    functions/            # edge functions (Deno)
      parse-request/
      fanout/
      broadcast/
      checkin-sweep/
      heatmap/
    seed/                 # demo users and routes
  docs/PRD.md, docs/SPEC.md, CHECKLIST.md
```

Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # edge functions only
ANTHROPIC_API_KEY=                 # edge functions only
NEXT_PUBLIC_MAP_STYLE_URL=
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
TWILIO_ACCOUNT_SID=                # optional, stub if missing
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
DPS_PHONE=+12137404321
DEMO_MODE=true                     # enables fake GPS positions
```

## Data model

Nine tables. `presence` is the only hot table and holds one row per user, overwritten every 5 s while the toggle is on. Precise location lives only in `presence` and `session_fixes`, and both are purged by cron.

```sql
create extension if not exists postgis;
create extension if not exists pg_cron;

-- Who
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null check (email ilike '%@usc.edu'),
  first_name text not null,
  photo_url text,
  gender text check (gender in ('woman','man','nonbinary','prefer_not')),
  class_year int,
  school text,                      -- Viterbi, Marshall, Dornsife, ...
  area text,                        -- Village, Lorenzo, Gateway, Cardinal Gardens, ...
  same_gender_only boolean not null default false,
  phone_hash text unique,           -- sha256(e164 phone + app salt)
  created_at timestamptz default now()
);

create table friendships (
  a uuid references profiles(id) on delete cascade,
  b uuid references profiles(id) on delete cascade,
  source text not null check (source in ('contacts','in_app')),
  created_at timestamptz default now(),
  primary key (a, b)
);  -- insert both directions

create table shared_context (
  user_id uuid references profiles(id) on delete cascade,
  kind text check (kind in ('class','hall','org')),
  value text,                       -- 'BUAD-304-14xxx', 'Lorenzo', 'HackSC'
  primary key (user_id, kind, value)
);

create table walkers (
  user_id uuid primary key references profiles(id) on delete cascade,
  verified boolean not null default false,   -- flag only for the demo
  hours int4range[],                          -- e.g. '{[22,25)}' = 10pm to 1am
  max_pings_per_night int not null default 3,
  pings_tonight int not null default 0,
  rating_avg numeric(3,2),
  rating_count int not null default 0,
  strikes int not null default 0,
  active boolean generated always as (verified and strikes = 0) stored
);

-- Where (hot)
create table presence (
  user_id uuid primary key references profiles(id) on delete cascade,
  geom geography(point, 4326) not null,
  heading_deg real,                 -- from last two fixes, null if still
  toggled_on boolean not null default false,
  updated_at timestamptz not null default now()
);
create index presence_geom_idx on presence using gist (geom);

-- Asks
create table requests (
  id uuid primary key default gen_random_uuid(),
  requester uuid references profiles(id) on delete cascade,
  kind text not null check (kind in ('walk','broadcast')),
  origin geography(point,4326) not null,
  origin_label text,                -- 'Leavey Library'
  dest geography(point,4326),
  dest_label text,                  -- 'The Lorenzo'
  leave_at timestamptz not null,
  raw_text text,                    -- what the user typed, for parse debugging
  status text not null default 'open'
    check (status in ('open','matched','expired','cancelled')),
  created_at timestamptz default now(),
  expires_at timestamptz not null   -- leave_at + 3 min for walk, + 10 min for broadcast
);

create table request_targets (       -- who was pinged, in which rung
  request_id uuid references requests(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  rung int not null check (rung between 2 and 4),
  notified_at timestamptz default now(),
  response text check (response in ('accepted','declined','applied')),
  responded_at timestamptz,
  primary key (request_id, user_id)
);

-- Walks
create table sessions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references requests(id),
  requester uuid references profiles(id),
  companion uuid references profiles(id),          -- null for watcher-only
  watcher_contact text,                             -- e164 phone, if watcher mode
  meeting_point text,
  dest geography(point,4326),
  state text not null default 'active'
    check (state in ('active','checkin_due','checkin_missed','escalated','arrived','ended')),
  checkin_interval_s int not null default 240,
  next_checkin_at timestamptz,
  started_at timestamptz default now(),
  ended_at timestamptz
);

create table session_fixes (          -- live dots during a session only
  session_id uuid references sessions(id) on delete cascade,
  user_id uuid references profiles(id),
  geom geography(point,4326) not null,
  at timestamptz not null default now()
);
create index session_fixes_idx on session_fixes (session_id, at desc);

create table checkins (
  session_id uuid references sessions(id) on delete cascade,
  user_id uuid references profiles(id),
  due_at timestamptz not null,
  answered_at timestamptz,
  primary key (session_id, user_id, due_at)
);

create table ratings (
  session_id uuid references sessions(id) on delete cascade,
  rater uuid references profiles(id),
  ratee uuid references profiles(id),
  stars int check (stars between 1 and 5),
  primary key (session_id, rater)
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid references profiles(id),
  reported uuid references profiles(id),
  session_id uuid references sessions(id),
  reason text,
  created_at timestamptz default now()
);

create table blocks (
  blocker uuid references profiles(id),
  blocked uuid references profiles(id),
  primary key (blocker, blocked)
);

-- Aggregates for USG/DPS (no user ids)
create table heatmap_cells (
  cell_id text,                     -- geohash precision 7 (~150 m)
  half_hour timestamptz,
  kind text,                        -- walk | broadcast
  n int not null default 0,
  primary key (cell_id, half_hour, kind)
);
```

Notes for Claude Code

- `requests.kind = 'broadcast'` reuses the same table; the approval gate is `request_targets.response = 'applied'` until the requester picks one, which creates the session.
- A missed check-in is a row in `checkins` with `answered_at` null past `due_at + 60 s`; the sweep function moves the session state. Keep state transitions in one function, not scattered in the client.
- `heatmap_cells` is written by a trigger on `requests` insert and never joins back to a user.

## Core queries

Three queries do the product. Put them in SQL functions so the edge functions and the client call the same thing.

Nearby dots (rung 1). Returns anonymous, rounded positions; never ids.

```sql
create or replace function nearby_dots(me uuid, lat double precision, lng double precision, radius_m int default 150)
returns table (lat double precision, lng double precision, heading_deg real, is_walker boolean)
language sql security definer as $$
  select
    round(st_y(p.geom::geometry)::numeric, 4)::double precision,   -- ~11 m; coarse on purpose
    round(st_x(p.geom::geometry)::numeric, 4)::double precision,
    p.heading_deg,
    exists (select 1 from walkers w where w.user_id = p.user_id and w.active)
  from presence p
  where p.toggled_on
    and p.user_id <> me
    and p.updated_at > now() - interval '20 seconds'
    and st_dwithin(p.geom, st_makepoint(lng, lat)::geography, radius_m)
    and not exists (select 1 from blocks b where (b.blocker = me and b.blocked = p.user_id)
                                             or (b.blocker = p.user_id and b.blocked = me));
$$;
```

Fan-out ranking (rungs 2 and 3). Called once when a walk request is created; returns who to ping and in which rung. The edge function sends rung 2 first and only sends rung 3 if nobody accepts within 120 s.

```sql
create or replace function fanout_candidates(req uuid)
returns table (user_id uuid, rung int, score numeric)
language sql security definer as $$
  with r as (select * from requests where id = req),
       me as (select * from profiles where id = (select requester from r)),
       bearing as (
         select degrees(st_azimuth(r.origin::geometry, r.dest::geometry)) as deg from r),
       live as (
         select p.user_id, p.geom, p.heading_deg
         from presence p, r
         where p.toggled_on and p.updated_at > now() - interval '20 seconds'
           and p.user_id <> r.requester
           and st_dwithin(p.geom, r.origin, 300)
           and not exists (select 1 from blocks b where (b.blocker = r.requester and b.blocked = p.user_id)
                                                    or (b.blocker = p.user_id and b.blocked = r.requester)))
  -- rung 2: friends, then shared context
  select l.user_id, 2,
         case when f.a is not null then 100 else 60 end
         + case when abs(((l.heading_deg - bearing.deg + 540)::int % 360) - 180) <= 45 then 10 else 0 end
  from live l, bearing, me
  left join friendships f on f.a = me.id and f.b = l.user_id
  left join lateral (select 1 from shared_context s1
                     join shared_context s2 on s1.kind = s2.kind and s1.value = s2.value
                     where s1.user_id = me.id and s2.user_id = l.user_id limit 1) sc on true
  where f.a is not null or sc is not null
  union all
  -- rung 3: active walkers within 100 m whose profile matches
  select l.user_id, 3,
         50 + case when pr.area = me.area then 10 else 0 end
            + case when abs(coalesce(pr.class_year,0) - coalesce(me.class_year,0)) <= 1 then 5 else 0 end
  from live l, me
  join walkers w on w.user_id = l.user_id and w.active and w.pings_tonight < w.max_pings_per_night
  join profiles pr on pr.id = l.user_id
  where st_dwithin(l.geom, (select origin from requests where id = req), 100)
    and (not me.same_gender_only or pr.gender = me.gender)
  order by rung, score desc;
$$;
```

Arrival geofence. Client calls it with each session fix; server decides.

```sql
create or replace function record_fix(sess uuid, lat double precision, lng double precision)
returns text language plpgsql security definer as $$
declare d double precision; st text;
begin
  insert into session_fixes (session_id, user_id, geom)
  values (sess, auth.uid(), st_makepoint(lng, lat)::geography);
  select st_distance(st_makepoint(lng, lat)::geography, dest) into d from sessions where id = sess;
  if d is not null and d < 40 then
    update sessions set state = 'arrived', ended_at = now() where id = sess and state not in ('arrived','ended');
    return 'arrived';
  end if;
  select state into st from sessions where id = sess;
  return st;
 end $$;
```

Heading is computed client-side from the last two fixes (bearing formula in `lib/geo.ts`) and sent with each presence write; null if the user moved less than 5 m.

## API (edge functions)

The client talks to Supabase directly for reads and presence writes (RLS does the gating). Anything that fans out, calls the LLM, or changes a session's state goes through an edge function with the service role.

| Function | Method and input | What it does | Returns |
| --- | --- | --- | --- |
| `parse-request` | POST `{ text, lat, lng }` | Calls the LLM with the place list; falls back to the form if confidence is low | `{ origin_label, dest_label, dest_lat, dest_lng, leave_in_s, confidence }` |
| `fanout` | POST `{ request_id }` | Runs `fanout_candidates`; pushes rung 2 now; schedules rung 3 at +120 s if still open; expires at +180 s with Lyft/watcher options | `{ rung2: n, rung3_scheduled: bool }` |
| `respond` | POST `{ request_id, response: accepted / declined / applied }` | For walk: first `accepted` wins, creates the session, notifies both, marks request matched. For broadcast: records `applied`, notifies requester | `{ session_id? }` |
| `broadcast` | POST `{ lat, lng, label }` | Creates a `broadcast` request; pushes area-only message to all toggled-on users within 400 m; writes DPS log row; returns nearest 3 safe spots | `{ request_id, safe_spots[] }` |
| `approve` | POST `{ request_id, user_id }` | Requester picks a responder; creates session; only now does the responder get the live location channel | `{ session_id }` |
| `checkin` | POST `{ session_id }` | Marks the current check-in answered; schedules the next | `{ next_checkin_at }` |
| `checkin-sweep` | cron, every 30 s | Finds `checkins` past `due_at + 60 s` unanswered; advances session state; on `checkin_missed` sends SMS to contacts; on second miss sets `escalated` | counts |
| `end-session` | POST `{ session_id, reason }` | Ends by either party; stops fixes; prompts rating | `{}` |
| `heatmap` | GET `?from&to` | Reads `heatmap_cells`, suppresses cells with `n < 5` | GeoJSON |
| `contacts-sync` | POST `{ phone_hashes[] }` | Matches hashes to profiles; inserts `friendships` both ways with source contacts | `{ matched: n }` |

Conventions

- All functions verify the JWT and use `auth.uid()` as the actor; the service role is used only for cross-user writes.
- Every push payload carries `type` and `request_id` or `session_id` so the client can deep-link.
- Rung timing lives in one place: `fanout` sets `expires_at` and enqueues the rung 3 and expiry jobs via `pg_cron` one-shot schedules (or a `jobs` table swept by `checkin-sweep` if `pg_cron` one-shots are awkward).

## Realtime and presence

Two kinds of channel. Presence for the ambient map is polled, not subscribed, because subscribing to every toggled-on user's row would leak ids. Sessions are subscribed, because both parties are already allowed to see each other.

| Client state | What it does | Cadence |
| --- | --- | --- |
| Toggle on | `upsert presence (geom, heading_deg, toggled_on = true)` from `watchPosition` | Every 5 s, or on 10 m of movement |
| Toggle on | Calls `nearby_dots(me, lat, lng)` and redraws anonymous dots | Every 5 s |
| Toggle off | `update presence set toggled_on = false` and stop watching | Once |
| Request open | Subscribes to `requests:id=eq.<id>` for status and to `request_targets:request_id=eq.<id>` for responses | Realtime |
| In session | Subscribes to `sessions:id=eq.<id>` for state and to `session_fixes:session_id=eq.<id>` for the other dot | Realtime |
| In session | Calls `record_fix(session, lat, lng)` | Every 5 s |
| Walker, hours active | Keeps a Web Push subscription; no polling | Push only |

Client rules

- `watchPosition` with `enableHighAccuracy: true`, `maximumAge: 3000`. On iOS Safari the PWA must be in the foreground for GPS; say this in onboarding.
- A stale presence row (`updated_at` older than 20 s) is treated as off by every query, so a closed tab disappears without a write.
- The other person's dot in a session comes only from `session_fixes` rows of that session, never from `presence`.

## Request parsing with the LLM

One call, structured output, with the campus place list in the prompt so nicknames resolve. If confidence is under 0.7 the client shows the two-field form prefilled with the best guess instead of guessing silently.

Places table (seed \~40 rows; this is also the destination picker)

```sql
create table places (
  slug text primary key,            -- 'lorenzo'
  label text not null,              -- 'The Lorenzo'
  aliases text[] not null,          -- '{the lo, lorenzo apts, lorenzo}'
  geom geography(point,4326) not null,
  kind text check (kind in ('library','housing','building','gate','safe_spot')),
  staffed_hours int4range          -- for safe spots, e.g. '[0,24)' for Leavey desk
);
```

System prompt for `parse-request`

```markdown
You turn a USC student's short message into a walk request. You are given the student's current location label and a list of campus places with aliases.

Return only JSON matching the schema. Rules:
- origin defaults to the current location unless the message names a different start.
- Resolve nicknames using the aliases list; "the lo" is The Lorenzo, "the village" is USC Village.
- leave_in_s: "now" = 0, "in 2" or "in 2 min" = 120, "in a bit" = 300. Unknown = 120.
- group_size: how many people are walking with the requester already. Default 1.
- If the destination is not in the list or is ambiguous, set dest_slug to null and confidence below 0.5.
- Never invent a place.
```

JSON schema (use the API's structured output / tool-use with this schema)

```json
{
  "type": "object",
  "required": ["origin_slug", "dest_slug", "leave_in_s", "group_size", "confidence"],
  "properties": {
    "origin_slug": {"type": ["string", "null"]},
    "dest_slug": {"type": ["string", "null"]},
    "leave_in_s": {"type": "integer", "minimum": 0, "maximum": 1800},
    "group_size": {"type": "integer", "minimum": 1, "maximum": 6},
    "confidence": {"type": "number", "minimum": 0, "maximum": 1}
  }
}
```

Test lines Claude Code should make pass before moving on: "leaving leavey in 2, heading to the lo", "walking to the village now", "anyone going toward gateway in like 5", "heading home" (should return null dest, low confidence).

Demand prediction for the demo is not a model call. It is `select count(*) from requests where origin cell, dest cell, weekday, half hour match`, over seeded rows, shown as "3 people usually leave Leavey for the Village around 11:35 on weeknights." Label it as seeded in the UI footer.

## Session and check-in state machine

All transitions happen in two places only: `record_fix` (arrival) and `checkin-sweep` (timers). The client never sets `sessions.state` directly; it calls `checkin` or `end-session` and reads the result.

&#91;embedded content: session state machine · 6 states\]

Either party can call `end-session` from any state, which goes to `ended` and stops fix writes. `escalated` also fires the DPS phone intent on the requester's phone and a "check on them" prompt on the companion's. Anomaly detection (a stop over 90 s off a known waiting spot, or a reversal) moves `active` to `checkin_due` early instead of waiting for the 240 s timer; start it as rules in `checkin-sweep`.

## Broadcast with approval gate

The broadcast is the only rung that reaches people outside the requester's trusted set, so the gate is enforced server-side, not by the UI. Responders cannot read the requester's location until `approve` has created a session with them in it.

| Step | Requester sees | Responder sees | Server does |
| --- | --- | --- | --- |
| 1. Tap "I need someone now" | Confirmation sheet: "We will tell nearby Trojans someone near Leavey needs a person. Not your exact spot or name." | Nothing yet | `broadcast` creates request kind broadcast, `origin_label` = nearest place label, `expires_at` = +10 min |
| 2. Fan-out | Screen splits: top = nearest staffed safe spots with walk time; bottom = "Responders" list, empty | Push: "Someone near Leavey needs a person right now. Can you come?" with Can come / Can't buttons | Pushes to all `toggled_on` within 400 m plus active Walkers within 600 m; inserts DPS log row (`dps_log`: area label, time, request id) |
| 3. Responders apply | Cards appear: first name, photo, year, Walker badge, rating, distance (rounded to 50 m) | "Sent. Waiting for them to choose." | `respond` with `applied`; no location leaves the server |
| 4. Requester approves one | Session screen: responder's live dot, ETA, check-in timer, Emergency button | Session screen: requester's live dot and a route; others get "Someone else is on the way, thank you" | `approve` creates session (requester, companion); only now are both allowed to read `session_fixes` for it; other targets marked declined |
| 5a. Requester reaches a safe spot first | "You're at Leavey desk. Cancel the broadcast?" | "They're safe, thanks for responding" | `end-session` reason safe\_spot; request cancelled |
| 5b. Escalation | Emergency button or missed check-in | Prompt: "Check on them, DPS has been called" | Session state escalated; SMS to contacts; DPS phone intent |

Rules the code enforces

- Broadcast push payload contains `origin_label` and a 150 m geohash cell, never coordinates.
- `request_targets` for a broadcast are capped at 40 recipients, nearest first, so a dense area does not light up a whole block.
- A user can fire at most 2 broadcasts a night; a third shows the Emergency screen instead.
- Anyone who applies and is later reported on that broadcast is suspended pending review.
- Safe spots come from `places where kind = 'safe_spot'` filtered by `staffed_hours` at the current hour; the top 3 by walking distance are shown with minutes at 1.3 m/s.

## Push, SMS and the Lyft deep link

In-app users get Web Push; people who are not users (chosen contacts) get SMS. Lyft is a deep link, no API deal.

Web Push

- Service worker registers on first login; subscription stored in `push_subscriptions (user_id, endpoint, p256dh, auth)`.
- Payload shape: `{ type: 'walk_request' | 'broadcast' | 'accepted' | 'checkin' | 'escalated', request_id?, session_id?, title, body, actions: [{ action, title }] }`.
- Notification actions call the edge functions directly from the service worker so a Walker can accept from the lock screen.
- iOS requires the PWA to be installed to the Home Screen for push. Put that in onboarding with a screenshot; for the demo, both phones install it in the morning.

SMS (Twilio)

- Sent only on `checkin_missed` and `escalated`, to `profiles.emergency_contacts` (add column `emergency_contacts text[]`, e164, max 3).
- Message: "TrojanWalk: \<First> missed a safety check-in walking to \<dest>. Last location: \<maps link>. Call them, or DPS 213-740-4321." The maps link points to a signed, 30-minute URL that renders the last fix, so the SMS itself carries no coordinates.
- If Twilio keys are missing, `lib/push.ts` logs the message and returns ok; the UI shows "SMS sent (stub)" in demo mode.

Lyft handoff

- Built in `lib/lyft.ts`: `lyft://ridetype?id=lyft&pickup[latitude]=..&pickup[longitude]=..&destination[latitude]=..&destination[longitude]=..` with a web fallback to `https://lyft.com/ride?...` if the app is not installed.
- Note for the pitch: the free USC pass applies when the student picks Shared inside the boundary; the deep link prefills the trip, it cannot force the ride type. Say "opens Lyft with your trip ready," not "books a free Lyft."
- Shown when a walk request expires with no accept, and as a secondary button on every session screen.

## Privacy enforcement

The privacy rules in the PRD are not UI promises; they are RLS policies and cron jobs. Claude Code should write these in the first migration, before any feature.

Row-level security

```sql
alter table presence enable row level security;
-- a user may write only their own presence row
create policy presence_own on presence for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- nobody reads presence directly; the map goes through nearby_dots (security definer, rounded, no ids)

alter table session_fixes enable row level security;
create policy fixes_write on session_fixes for insert with check (user_id = auth.uid());
create policy fixes_read on session_fixes for select using (
  exists (select 1 from sessions s where s.id = session_id
          and (s.requester = auth.uid() or s.companion = auth.uid())
          and s.state not in ('ended')));

alter table requests enable row level security;
create policy requests_own on requests for select using (requester = auth.uid());
create policy requests_targeted on requests for select using (
  exists (select 1 from request_targets t where t.request_id = id and t.user_id = auth.uid()));
-- targeted readers get labels only: expose a view that nulls origin/dest geometry unless requester or session member

alter table profiles enable row level security;
create policy profiles_self on profiles for all using (id = auth.uid());
create policy profiles_session_peer on profiles for select using (
  exists (select 1 from sessions s where (s.requester = auth.uid() and s.companion = id)
                                      or (s.companion = auth.uid() and s.requester = id)));
-- responder cards for a broadcast read from a view: first_name, photo_url, class_year, walker badge, rating only
```

TTL and sweeps (`pg_cron`)

| Job | Schedule | Statement |
| --- | --- | --- |
| Stale presence off | every minute | `update presence set toggled_on = false where updated_at < now() - interval '2 minutes'` |
| Session fixes purge | every 10 minutes | `delete from session_fixes f using sessions s where s.id = f.session_id and s.ended_at < now() - interval '1 hour'` |
| Expire requests | every minute | `update requests set status = 'expired' where status = 'open' and expires_at < now()` |
| Reset walker counters | daily 06:00 | `update walkers set pings_tonight = 0` |
| Heatmap roll-up | hourly | upsert into `heatmap_cells` from requests created in the last hour, grouped by geohash7 and half hour, then null out `requests.origin/dest` geometry older than 24 h |

What the client never receives: another user's `presence` row, any `session_fixes` for a session they are not in, a requester's coordinates on a broadcast before approval, a reporter's identity.

## Demo seeding and fallbacks

The demo must survive bad GPS indoors and venue wifi. `DEMO_MODE=true` makes both problems go away without faking the parts that matter.

Seed (`supabase/seed/`)

- 12 demo profiles with first names and photos (use generated avatars), 3 flagged as verified Walkers, 2 marked as friends of the presenter's account via `friendships`.
- `places`: Leavey, Doheny, USC Village, The Lorenzo, Icon Plaza, Tuscany, Gateway, Cardinal Gardens, Jefferson/McClintock gate, Figueroa gate, and safe spots: Leavey 24-hour desk, Village security kiosk, DPS station (3667 McClintock), two blue-light phone positions.
- 8 presence rows toggled on, scattered along Leavey to Village and Leavey to Lorenzo, with headings set toward those destinations, refreshed by a tiny loop so they never go stale.
- 300 historical `requests` over two synthetic weeks, weighted to 10pm to 1am and to those two corridors, so the heatmap and the "3 people usually leave around 11:35" line have something behind them.

Demo mode behaviour

- A hidden panel (triple-tap the logo) lets each phone pick a fixed position from the places list and a destination. Presence writes use that instead of GPS. The request, fan-out, accept, session, check-in and arrival flows are all real server round trips.
- A "Walk" button in the panel advances the fixed position 30 m along the route every 2 s, so the dots move on stage and the arrival geofence actually fires.
- Push falls back to an in-app banner if the notification permission was denied on the venue phone.

Fallbacks to have ready

- Both phones on cellular, not venue wifi, with the app installed to the Home Screen before 1pm.
- A 60-second screen recording of the full flow 2 and flow 4, recorded in the morning, on the laptop that drives the slides.
- A laptop tab logged in as a third demo user so a responder can apply to the broadcast even if the second phone dies.

## Build order: Claude Code prompts

Ten prompts, each one testable from two browser tabs before the next. Prompts 1 to 6 are the demo; 7 to 10 are the rest of the pitch. If you are behind at 09:00, ship 1 to 6 and talk through 7 to 10 on a slide.

- [ ] Prompt 1, schema and auth (target 01:00). "Create the Supabase migration from the Data model and Privacy enforcement sections of docs/SPEC.md exactly: all tables, PostGIS, the three SQL functions in Core queries, RLS policies, and the pg\_cron jobs. Add a trigger that rejects profile inserts without an @usc.edu email. Set up Supabase email OTP login in Next.js with a /login page and a protected /map route. Seed the places table from Demo seeding. Show me the migration before applying it."
- [ ] Prompt 2, ambient map (02:00). "Build /map: MapLibre full-screen, a Walking alone toggle, watchPosition writing presence every 5 s with heading from lib/geo.ts, and anonymous dots from nearby\_dots polled every 5 s. Add DEMO\_MODE: a hidden panel (triple-tap the logo) that pins this device to a place from the places table and a Walk button that moves it 30 m every 2 s. Test: two tabs, two users, each sees the other's dot and heading."
- [ ] Prompt 3, walk request and fan-out (03:30). "Build /request: a text box plus destination picker. Call the parse-request edge function (write it: Anthropic API, system prompt and JSON schema from the spec; fall back to the form under 0.7 confidence). Create the request, call fanout. Write fanout: rung 2 now, rung 3 at +120 s, expire at +180 s. Write respond: first accepted creates a session. Push via Web Push with the payload shape in the spec; fall back to an in-app banner. Test: tab A requests, tab B (a friend) gets the banner, accepts, both land on /session/\[id\]."
- [ ] Prompt 4, session and check-in (04:30). "Build /session/\[id\]: both dots from session\_fixes via realtime, record\_fix every 5 s, meeting point label, a check-in prompt every 240 s with a 60 s countdown calling checkin, arrival ends the session and shows a one-tap rating. Write checkin-sweep (cron every 30 s): one miss sets checkin\_missed and sends SMS via lib/push.ts (stub if no Twilio), second miss sets escalated. Test: let a check-in lapse in tab A and confirm the state changes and the stub SMS logs."
- [ ] Prompt 5, no-match and Lyft (05:00). "When a request expires with no accept, show two options: Lyft (lib/lyft.ts deep link with web fallback, destination prefilled) and Walk with a watcher (session with watcher\_contact and no companion; the contact gets the stub SMS with the signed last-fix link). Add the Lyft button as secondary on every session screen."
- [ ] Prompt 6, walkers and matching (05:45). "Build /walker: opt-in, the five-question profile (gender, year, school, area, same\_gender\_only), hours, and a Web Push subscription. Make rung 3 in fanout use fanout\_candidates' walker branch with the profile match and the 3-a-night cap. Test: with no friends online, tab B as an active Walker within 100 m gets the ping at +120 s."
- [ ] Sleep 06:00 to 09:00.
- [ ] Prompt 7, broadcast with approval gate (10:00). "Implement the Broadcast section of the spec: /request/broadcast with the confirmation sheet, broadcast edge function (area-only push to toggled-on users within 400 m and Walkers within 600 m, cap 40, dps\_log row, top 3 staffed safe spots with walk minutes), responder cards from the restricted view, approve creating the session, and the 'someone else is on the way' message to the others. Enforce in RLS that no coordinates are readable by responders before approval. Test: three tabs, one requester, two responders, approve one."
- [ ] Prompt 8, contacts sync and friends (11:00). "Add contacts-sync: client hashes e164 numbers with the app salt, posts hashes, server matches profiles.phone\_hash and inserts friendships both ways. Add an in-app add-friend by email. Show on a match card why this person was pinged (friend, same class, same hall, Walker)."
- [ ] Prompt 9, heatmap and prediction (11:45). "Write the heatmap edge function (heatmap\_cells, suppress n < 5, GeoJSON) and /admin/heatmap rendering it on MapLibre with a time slider. Add the demand line on /map: count of seeded requests matching origin cell, dest cell, weekday, half hour, rendered as 'N people usually leave X for Y around HH:MM', with a 'seeded' footer."
- [ ] Prompt 10, hardening for the stage (12:30). "Install-to-Home-Screen onboarding with iOS screenshot, notification permission flow with banner fallback, stale presence handling, error toasts on every edge call, and a CHECKLIST.md run-through. Then walk me through the two-phone demo script from docs/PRD.md and tell me what will break."

After each prompt: run the two-tab test it names, commit, and tick the box here.
