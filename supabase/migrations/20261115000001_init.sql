-- TrojanWalk 0001: schema, privacy functions, RLS, cron.
-- Source: docs/SPEC.md (Data model, Core queries, Privacy enforcement).
-- Deviations from the spec text are marked `-- DEVIATION:` and explained in the PR/chat.

create extension if not exists postgis;   -- already installed in `public` on this project
create extension if not exists pg_cron;

----------------------------------------------------------------------------
-- Tables
----------------------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null check (email ilike '%@usc.edu'),
  first_name text not null,
  photo_url text,
  gender text check (gender in ('woman','man','nonbinary','prefer_not')),
  class_year int,
  school text,
  area text,
  same_gender_only boolean not null default false,
  phone_hash text unique,
  emergency_contacts text[] not null default '{}' check (cardinality(emergency_contacts) <= 3), -- referenced by SPEC "SMS (Twilio)"
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
  value text,
  primary key (user_id, kind, value)
);

create table walkers (
  user_id uuid primary key references profiles(id) on delete cascade,
  verified boolean not null default false,
  hours int4range[],
  max_pings_per_night int not null default 3,
  pings_tonight int not null default 0,
  rating_avg numeric(3,2),
  rating_count int not null default 0,
  strikes int not null default 0,
  active boolean generated always as (verified and strikes = 0) stored
);

create table presence (
  user_id uuid primary key references profiles(id) on delete cascade,
  geom geography(point, 4326) not null,
  heading_deg real,
  toggled_on boolean not null default false,
  updated_at timestamptz not null default now()
);
create index presence_geom_idx on presence using gist (geom);

create table requests (
  id uuid primary key default gen_random_uuid(),
  requester uuid references profiles(id) on delete cascade,
  kind text not null check (kind in ('walk','broadcast')),
  origin geography(point,4326),            -- DEVIATION: nullable, because the hourly job scrubs geometry after 24 h (spec says NOT NULL and also says to null it)
  origin_label text,
  dest geography(point,4326),
  dest_label text,
  leave_at timestamptz not null,
  raw_text text,
  status text not null default 'open'
    check (status in ('open','matched','expired','cancelled')),
  created_at timestamptz default now(),
  expires_at timestamptz not null
);
create index requests_status_expires_idx on requests (status, expires_at);

create table request_targets (
  request_id uuid references requests(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  rung int not null check (rung between 2 and 4),
  notified_at timestamptz default now(),
  response text check (response in ('accepted','declined','applied')),
  responded_at timestamptz,
  primary key (request_id, user_id)
);
create index request_targets_user_idx on request_targets (user_id);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references requests(id),
  requester uuid references profiles(id),
  companion uuid references profiles(id),
  watcher_contact text,
  meeting_point text,
  dest geography(point,4326),
  state text not null default 'active'
    check (state in ('active','checkin_due','checkin_missed','escalated','arrived','ended')),
  checkin_interval_s int not null default 240,
  next_checkin_at timestamptz,
  started_at timestamptz default now(),
  ended_at timestamptz
);
create index sessions_requester_idx on sessions (requester);
create index sessions_companion_idx on sessions (companion);

create table session_fixes (
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

create table heatmap_cells (
  cell_id text,
  half_hour timestamptz,
  kind text,
  n int not null default 0,
  primary key (cell_id, half_hour, kind)
);

-- Referenced by the spec but not in its table list ---------------------------
create table places (
  slug text primary key,
  label text not null,
  aliases text[] not null,
  geom geography(point,4326) not null,
  kind text check (kind in ('library','housing','building','gate','safe_spot')),
  staffed_hours int4range
);

create table dps_log (                     -- silent log row when a broadcast fires (no user id)
  id uuid primary key default gen_random_uuid(),
  request_id uuid references requests(id) on delete set null,
  area_label text not null,
  created_at timestamptz not null default now()
);

create table push_subscriptions (
  user_id uuid references profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  primary key (user_id, endpoint)
);

----------------------------------------------------------------------------
-- Auth: @usc.edu only, and a profile row for every user
----------------------------------------------------------------------------

create or replace function auth_require_usc_email() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.email is null or new.email !~* '^[^@[:space:]]+@usc\.edu$' then
    raise exception 'Only @usc.edu email addresses can sign up';
  end if;
  return new;
end $$;

create trigger require_usc_email
  before insert or update of email on auth.users
  for each row execute function auth_require_usc_email();

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into profiles (id, email, first_name)
  values (new.id, lower(new.email), initcap(split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

----------------------------------------------------------------------------
-- Triggers
----------------------------------------------------------------------------

-- Clients cannot back-date or future-date presence; staleness checks rely on this.
create or replace function presence_touch() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger presence_touch before insert or update on presence
  for each row execute function presence_touch();

-- heatmap_cells is written here and nowhere else (never joins back to a user).
create or replace function heatmap_on_request() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.origin is null then return new; end if;
  insert into heatmap_cells (cell_id, half_hour, kind, n)
  values (st_geohash(new.origin::geometry, 7),
          date_bin('30 minutes', new.created_at, timestamptz '2000-01-01 00:00+00'),
          new.kind, 1)
  on conflict (cell_id, half_hour, kind) do update set n = heatmap_cells.n + 1;
  return new;
end $$;
create trigger heatmap_on_request after insert on requests
  for each row execute function heatmap_on_request();

----------------------------------------------------------------------------
-- Core queries
----------------------------------------------------------------------------

-- Rung 1: anonymous dots around the CALLER'S OWN fresh presence row.
-- DEVIATION: spec signature was (me, lat, lng, radius). Taking `me` from the client
-- lets anyone dodge block lists, and taking lat/lng lets anyone pan the whole campus.
-- Now: caller identity is auth.uid(), centre is the caller's own toggled-on presence,
-- radius is clamped to 150 m. Positions are snapped to a ~20 m grid (PRD says ~25 m;
-- spec's 4-decimal rounding was ~11 m).
create or replace function nearby_dots(p_radius_m int default 150)
returns table (lat double precision, lng double precision, heading_deg real, is_walker boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  with me as (
    select geom from presence
    where user_id = auth.uid() and toggled_on and updated_at > now() - interval '20 seconds')
  select
    (round(st_y(p.geom::geometry) / 0.0002) * 0.0002)::double precision,
    (round(st_x(p.geom::geometry) / 0.0002) * 0.0002)::double precision,
    p.heading_deg,
    exists (select 1 from walkers w where w.user_id = p.user_id and w.active)
  from presence p cross join me
  where p.toggled_on
    and p.user_id <> auth.uid()
    and p.updated_at > now() - interval '20 seconds'
    and st_dwithin(p.geom, me.geom, least(greatest(p_radius_m, 1), 150))
    and not exists (select 1 from blocks b
                    where (b.blocker = auth.uid() and b.blocked = p.user_id)
                       or (b.blocker = p.user_id and b.blocked = auth.uid()));
$$;

-- Rungs 2 and 3. Service role only: it returns user ids.
-- DEVIATION: the spec body mixes comma and JOIN syntax, which Postgres rejects
-- ("invalid reference to FROM-clause entry"); rewritten with explicit joins, plus
-- one row per user (lowest rung wins), walker hours honoured (null = always on).
create or replace function fanout_candidates(req uuid)
returns table (user_id uuid, rung int, score numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with r as (select * from requests where id = req),
  me as (select p.* from profiles p join r on p.id = r.requester),
  brg as (select case when r.dest is null then null
                      else degrees(st_azimuth(r.origin::geometry, r.dest::geometry)) end as deg
          from r),
  clock as (select extract(hour from now() at time zone 'America/Los_Angeles')::int as hr),
  live as (
    select p.user_id as uid, p.geom, p.heading_deg
    from presence p cross join r
    where p.toggled_on and p.updated_at > now() - interval '20 seconds'
      and p.user_id <> r.requester
      and st_dwithin(p.geom, r.origin, 300)
      and not exists (select 1 from blocks b
                      where (b.blocker = r.requester and b.blocked = p.user_id)
                         or (b.blocker = p.user_id and b.blocked = r.requester))),
  cand as (
    select l.uid, 2 as rung,
           ((case when f.a is not null then 100 else 60 end)
            + (case when brg.deg is not null and l.heading_deg is not null
                     and abs(mod((l.heading_deg - brg.deg + 540)::numeric, 360) - 180) <= 45
                    then 10 else 0 end))::numeric as score
    from live l
    cross join me
    cross join brg
    left join friendships f on f.a = me.id and f.b = l.uid
    left join lateral (
      select 1 as one from shared_context s1
      join shared_context s2 on s1.kind = s2.kind and s1.value = s2.value
      where s1.user_id = me.id and s2.user_id = l.uid limit 1) sc on true
    where f.a is not null or sc.one is not null
    union all
    select l.uid, 3,
           (50 + (case when pr.area = me.area then 10 else 0 end)
               + (case when abs(coalesce(pr.class_year,0) - coalesce(me.class_year,0)) <= 1
                       then 5 else 0 end))::numeric
    from live l
    cross join me
    cross join r
    cross join clock
    join walkers w on w.user_id = l.uid and w.active and w.pings_tonight < w.max_pings_per_night
    join profiles pr on pr.id = l.uid
    where st_dwithin(l.geom, r.origin, 100)
      and (not me.same_gender_only or pr.gender = me.gender)
      and (w.hours is null
           or exists (select 1 from unnest(w.hours) h
                      where h @> clock.hr or h @> clock.hr + 24)))
  select c.uid as user_id, c.rung, c.score
  from (select distinct on (uid) uid, rung, score from cand order by uid, rung, score desc) c
  order by c.rung, c.score desc;
$$;

-- Arrival geofence. DEVIATION: spec version let ANY authenticated user insert fixes into
-- (and end) ANY session. Now the caller must be a member and the session still live.
create or replace function record_fix(sess uuid, lat double precision, lng double precision)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare s sessions%rowtype; pt geography;
begin
  if lat not between -90 and 90 or lng not between -180 and 180 then
    raise exception 'bad coordinates';
  end if;
  select * into s from sessions
   where id = sess and (requester = auth.uid() or companion = auth.uid());
  if not found then
    raise exception 'not a member of this session' using errcode = '42501';
  end if;
  if s.state in ('arrived','ended') then return s.state; end if;

  pt := st_makepoint(lng, lat)::geography;
  insert into session_fixes (session_id, user_id, geom) values (sess, auth.uid(), pt);

  if s.dest is not null and st_distance(pt, s.dest) < 40 then
    update sessions set state = 'arrived', ended_at = now()
     where id = sess and state not in ('arrived','ended');
    return 'arrived';
  end if;
  return s.state;
end $$;

----------------------------------------------------------------------------
-- Restricted views: the only way other users' data reaches a client.
-- Owned by the migration role, so they bypass table RLS; each filters on auth.uid().
----------------------------------------------------------------------------

-- What a pinged user may see about a request. No coordinates, ever; no name on broadcasts.
create view target_requests with (security_barrier = true) as
select r.id as request_id, r.kind, r.origin_label, r.dest_label, r.leave_at,
       r.status, r.expires_at, t.rung, t.response,
       case when r.kind = 'walk' then p.first_name end as requester_first_name
from request_targets t
join requests r on r.id = t.request_id
join profiles p on p.id = r.requester
where t.user_id = auth.uid();

-- What a requester sees about people who accepted / applied.
create view request_responders with (security_barrier = true) as
select t.request_id, t.user_id, t.response,
       p.first_name, p.photo_url, p.class_year,
       coalesce(w.active, false) as is_walker, w.rating_avg, w.rating_count,
       (round(st_distance(pr.geom, r.origin) / 50) * 50)::int as distance_m
from requests r
join request_targets t on t.request_id = r.id and t.response in ('accepted','applied')
join profiles p on p.id = t.user_id
left join walkers w on w.user_id = t.user_id
left join presence pr on pr.user_id = t.user_id and pr.toggled_on
where r.requester = auth.uid();

-- DEVIATION: replaces the spec's profiles_session_peer policy, which would expose the
-- peer's whole profile row (email, phone hash, contacts). Peers get a card only.
create view session_peers with (security_barrier = true) as
select s.id as session_id, p.id as user_id, p.first_name, p.photo_url, p.class_year,
       coalesce(w.active, false) as is_walker, w.rating_avg, w.rating_count
from sessions s
join profiles p on p.id = case when s.requester = auth.uid() then s.companion else s.requester end
left join walkers w on w.user_id = p.id
where auth.uid() in (s.requester, s.companion);

----------------------------------------------------------------------------
-- Row-level security (every table; no policy = no client access)
----------------------------------------------------------------------------

alter table profiles           enable row level security;
alter table friendships        enable row level security;
alter table shared_context     enable row level security;
alter table walkers            enable row level security;
alter table presence           enable row level security;
alter table requests           enable row level security;
alter table request_targets    enable row level security;
alter table sessions           enable row level security;
alter table session_fixes      enable row level security;
alter table checkins           enable row level security;
alter table ratings            enable row level security;
alter table reports            enable row level security;
alter table blocks             enable row level security;
alter table heatmap_cells      enable row level security;   -- service role / heatmap fn only
alter table places             enable row level security;
alter table dps_log            enable row level security;   -- service role only
alter table push_subscriptions enable row level security;

create policy profiles_self_select on profiles for select using (id = auth.uid());
create policy profiles_self_update on profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy friendships_own on friendships for select using (a = auth.uid());
create policy shared_context_own on shared_context for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy walkers_self_select on walkers for select using (user_id = auth.uid());
create policy walkers_self_insert on walkers for insert
  with check (user_id = auth.uid() and verified = false and strikes = 0 and pings_tonight = 0
              and rating_avg is null and rating_count = 0 and max_pings_per_night = 3);
create policy walkers_self_update on walkers for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A user may write only their own presence row; nobody reads presence directly.
create policy presence_own on presence for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- DEVIATION: the spec's `requests_targeted` policy is NOT created. It would let every
-- pinged user SELECT the raw row, including the requester's exact origin, before approval.
-- Targets read `target_requests` instead.
create policy requests_own on requests for select using (requester = auth.uid());
create policy requests_insert_walk on requests for insert
  with check (requester = auth.uid() and kind = 'walk');

create policy request_targets_own on request_targets for select using (user_id = auth.uid());
create policy request_targets_requester on request_targets for select using (
  response in ('accepted','applied')
  and exists (select 1 from requests r where r.id = request_id and r.requester = auth.uid()));

create policy sessions_member on sessions for select using (requester = auth.uid() or companion = auth.uid());

-- DEVIATION: no direct insert policy on session_fixes; fixes go through record_fix().
create policy fixes_read on session_fixes for select using (
  exists (select 1 from sessions s where s.id = session_id
          and (s.requester = auth.uid() or s.companion = auth.uid())
          and s.state <> 'ended'));

create policy checkins_own on checkins for select using (user_id = auth.uid());

create policy ratings_insert on ratings for insert with check (
  rater = auth.uid()
  and exists (select 1 from sessions s where s.id = session_id
              and ((s.requester = rater and s.companion = ratee) or (s.companion = rater and s.requester = ratee))));
create policy ratings_own on ratings for select using (rater = auth.uid());

-- Reporters can file; nobody (reported user included) can read reports from the client.
create policy reports_insert on reports for insert with check (reporter = auth.uid());

create policy blocks_own on blocks for all using (blocker = auth.uid()) with check (blocker = auth.uid());

create policy places_read on places for select to authenticated using (true);
create policy push_subscriptions_own on push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

----------------------------------------------------------------------------
-- Grants
----------------------------------------------------------------------------

revoke all on profiles, friendships, shared_context, walkers, presence, requests, request_targets,
  sessions, session_fixes, checkins, ratings, reports, blocks, heatmap_cells, places, dps_log,
  push_subscriptions from anon;
revoke all on target_requests, request_responders, session_peers from anon;
grant select on target_requests, request_responders, session_peers to authenticated;

-- Users may edit only the harmless columns; never email, verified, strikes, ratings.
revoke update on profiles from authenticated;
grant update (first_name, photo_url, gender, class_year, school, area, same_gender_only,
              phone_hash, emergency_contacts) on profiles to authenticated;
revoke update on walkers from authenticated;
grant update (hours) on walkers to authenticated;

-- Functions: nobody but the intended caller.
revoke execute on function nearby_dots(int), record_fix(uuid, double precision, double precision),
  fanout_candidates(uuid) from public, anon;
grant execute on function nearby_dots(int), record_fix(uuid, double precision, double precision) to authenticated;
revoke execute on function fanout_candidates(uuid) from authenticated;
grant execute on function fanout_candidates(uuid) to service_role;

----------------------------------------------------------------------------
-- Realtime (RLS applies to what each subscriber receives)
----------------------------------------------------------------------------

alter publication supabase_realtime add table sessions, session_fixes, requests, request_targets;

----------------------------------------------------------------------------
-- pg_cron (UTC). checkin-sweep is an edge function and arrives in Prompt 4.
----------------------------------------------------------------------------

-- DEVIATION: delete stale presence instead of flipping toggled_on. The PRD says location
-- is dropped when the toggle goes off; leaving the last position in the table is retention.
select cron.schedule('presence-stale-purge', '* * * * *',
  $$delete from presence where updated_at < now() - interval '2 minutes'$$);

select cron.schedule('session-fixes-purge', '*/10 * * * *',
  $$delete from session_fixes f using sessions s
     where s.id = f.session_id and s.ended_at < now() - interval '1 hour'$$);

select cron.schedule('requests-expire', '* * * * *',
  $$update requests set status = 'expired' where status = 'open' and expires_at < now()$$);

select cron.schedule('walkers-reset-pings', '0 14 * * *',   -- 06:00 PST
  $$update walkers set pings_tonight = 0$$);

-- DEVIATION: the spec's hourly roll-up would double count with the insert trigger above,
-- so the trigger is the only writer and this job only scrubs geometry after 24 h.
select cron.schedule('requests-geometry-scrub', '5 * * * *',
  $$update requests set origin = null, dest = null
     where created_at < now() - interval '24 hours' and (origin is not null or dest is not null)$$);
