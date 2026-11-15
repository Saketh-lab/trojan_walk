-- Prompt 4: live session, check-in state machine, sweep, SMS outbox, signed last-fix links.
create extension if not exists pg_net with schema extensions;

alter table sessions
  add column checkin_grace_s int not null default 60,      -- countdown after a check-in is due
  add column escalate_after_s int not null default 30,     -- second buzz before escalating
  add column missed_at timestamptz,
  add column escalated_at timestamptz;

-- SMS outbox. The sweep (SQL) queues rows; the checkin-sweep edge function sends them.
create table notifications (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,   -- the walker who missed
  kind text not null check (kind in ('missed','escalated')),
  to_phone text not null,
  token text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivery text check (delivery in ('twilio','stub','failed')),
  body text,
  unique (session_id, user_id, kind, to_phone)
);
alter table notifications enable row level security;
revoke all on notifications from anon, authenticated;

-- 30-minute unguessable links; the SMS carries the link, never coordinates.
create table share_links (
  token text primary key default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  session_id uuid not null references sessions(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '30 minutes'
);
alter table share_links enable row level security;
revoke all on share_links from anon, authenticated;

-- accept_request: first check-in is checkin_interval_s after the session starts.
create or replace function accept_request(req uuid, actor uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare r requests%rowtype; sid uuid;
begin
  select * into r from requests where id = req for update;
  if not found or r.kind <> 'walk' or r.status <> 'open' or r.expires_at < now() then
    return null;
  end if;
  if not exists (select 1 from request_targets where request_id = req and user_id = actor) then
    raise exception 'not targeted' using errcode = '42501';
  end if;
  update requests set status = 'matched' where id = req;
  insert into sessions (request_id, requester, companion, meeting_point, dest)
  values (req, r.requester, actor, r.origin_label, r.dest)
  returning id into sid;
  update sessions set next_checkin_at = now() + make_interval(secs => checkin_interval_s) where id = sid;
  update request_targets set response = 'accepted', responded_at = now()
   where request_id = req and user_id = actor;
  return sid;
end $$;

-- Check-in answered. Clears a due/missed state once everyone has answered. Service role only.
create or replace function do_checkin(sess uuid, actor uuid) returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare s sessions%rowtype;
begin
  select * into s from sessions where id = sess and actor in (requester, companion) for update;
  if not found then raise exception 'not a member of this session' using errcode = '42501'; end if;
  if s.state in ('arrived','ended') then return null; end if;

  update checkins set answered_at = now()
   where session_id = sess and user_id = actor and answered_at is null;

  if s.state in ('checkin_due','checkin_missed')
     and not exists (select 1 from checkins where session_id = sess and answered_at is null) then
    update sessions
       set state = 'active', missed_at = null,
           next_checkin_at = now() + make_interval(secs => checkin_interval_s)
     where id = sess
    returning next_checkin_at into s.next_checkin_at;
  end if;
  return s.next_checkin_at;   -- escalated stays escalated until someone ends the walk
end $$;

create or replace function do_end_session(sess uuid, actor uuid, reason text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare s sessions%rowtype;
begin
  select * into s from sessions where id = sess and actor in (requester, companion) for update;
  if not found then raise exception 'not a member of this session' using errcode = '42501'; end if;
  if s.state not in ('arrived','ended') then
    update sessions set state = 'ended', ended_at = now() where id = sess;
    return 'ended';
  end if;
  return s.state;
end $$;

-- Queue SMS for every walker who has an unanswered check-in: their emergency contacts plus the
-- watcher contact (if they asked for one), each with a fresh signed link.
create or replace function notify_contacts(p_sess uuid, p_kind text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s sessions%rowtype; m record; tok text; phone text;
begin
  select * into s from sessions where id = p_sess;
  for m in select distinct c.user_id from checkins c where c.session_id = p_sess and c.answered_at is null loop
    insert into share_links (session_id, user_id) values (p_sess, m.user_id) returning token into tok;
    for phone in
      select distinct x from (
        select unnest(p.emergency_contacts) as x from profiles p where p.id = m.user_id
        union all
        select s.watcher_contact where s.requester = m.user_id
      ) q where x is not null
    loop
      insert into notifications (session_id, user_id, kind, to_phone, token)
      values (p_sess, m.user_id, p_kind, phone, tok)
      on conflict do nothing;
    end loop;
  end loop;
end $$;

-- All timer transitions live here (arrival lives in record_fix). Runs every 30 s from pg_cron.
create or replace function sweep_checkins() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare s sessions%rowtype; n int := 0;
begin
  -- 1. check-in due
  for s in select * from sessions
           where state = 'active' and next_checkin_at is not null and next_checkin_at <= now()
           for update skip locked loop
    update sessions set state = 'checkin_due' where id = s.id;
    insert into checkins (session_id, user_id, due_at)
    select s.id, m, now() from unnest(array[s.requester, s.companion]) m where m is not null
    on conflict do nothing;
    n := n + 1;
  end loop;

  -- 2. first miss: someone did not answer within the countdown
  for s in select x.* from sessions x
           where x.state = 'checkin_due'
             and exists (select 1 from checkins c where c.session_id = x.id and c.answered_at is null
                           and c.due_at + make_interval(secs => x.checkin_grace_s) <= now())
           for update skip locked loop
    update sessions set state = 'checkin_missed', missed_at = now() where id = s.id;
    perform notify_contacts(s.id, 'missed');
    n := n + 1;
  end loop;

  -- 3. second miss: still nothing after the second buzz
  for s in select x.* from sessions x
           where x.state = 'checkin_missed'
             and x.missed_at + make_interval(secs => x.escalate_after_s) <= now()
             and exists (select 1 from checkins c where c.session_id = x.id and c.answered_at is null)
           for update skip locked loop
    update sessions set state = 'escalated', escalated_at = now() where id = s.id;
    perform notify_contacts(s.id, 'escalated');
    n := n + 1;
  end loop;

  -- 4. hand queued SMS to the edge function (it claims rows atomically, so repeats are harmless)
  if exists (select 1 from notifications where sent_at is null) then
    perform net.http_post(
      url := 'https://ycuqduwmzrsztrrnodcp.supabase.co/functions/v1/checkin-sweep',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljdXFkdXdtenJzenRycm5vZGNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ3MjE2MTYsImV4cCI6MjExMDI5NzYxNn0.hThYQMrbsx1S-81sFABjWR0-tINkPtDI7JeBBvy-Wbg'),
      body := '{}'::jsonb);
  end if;
  return n;
end $$;

-- Everything the session screen needs in one call. Members only.
create or replace function session_status(sess uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s sessions%rowtype; me uuid := auth.uid(); due timestamptz; peer uuid;
begin
  select * into s from sessions where id = sess and me in (requester, companion);
  if not found then raise exception 'not a member of this session' using errcode = '42501'; end if;
  peer := case when s.requester = me then s.companion else s.requester end;
  select min(due_at) into due from checkins where session_id = sess and user_id = me and answered_at is null;

  return jsonb_build_object(
    'state', s.state,
    'server_now', now(),
    'meeting_point', s.meeting_point,
    'dest_label', (select dest_label from requests where id = s.request_id),
    'dest_lat', st_y(s.dest::geometry),
    'dest_lng', st_x(s.dest::geometry),
    'next_checkin_at', s.next_checkin_at,
    'grace_s', s.checkin_grace_s,
    'my_due_at', due,
    'i_missed', due is not null and due + make_interval(secs => s.checkin_grace_s) <= now(),
    'peer_missed', peer is not null and exists (
        select 1 from checkins c where c.session_id = sess and c.user_id = peer and c.answered_at is null
          and c.due_at + make_interval(secs => s.checkin_grace_s) <= now()),
    'i_am_requester', s.requester = me,
    'peer_first_name', (select first_name from profiles where id = peer),
    'notices', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'recipients', n, 'stub', stub)), '[]'::jsonb)
                from (select kind, count(*) as n, bool_or(delivery = 'stub') as stub
                      from notifications where session_id = sess and user_id = me group by kind) t),
    'fixes', case when s.state = 'ended' then '[]'::jsonb else (
        select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'lat', lat, 'lng', lng, 'at', at)), '[]'::jsonb)
        from (select distinct on (user_id) user_id, st_y(geom::geometry) as lat, st_x(geom::geometry) as lng, at
              from session_fixes where session_id = sess order by user_id, at desc) f) end,
    'ended_at', s.ended_at);
end $$;

-- Public (anon) read for the SMS link: valid token only, last fix of that one walker.
create or replace function share_link_fix(tok text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'first_name', p.first_name,
    'dest_label', r.dest_label,
    'lat', f.lat, 'lng', f.lng, 'at', f.at,
    'state', s.state,
    'expires_at', l.expires_at)
  from share_links l
  join profiles p on p.id = l.user_id
  join sessions s on s.id = l.session_id
  left join requests r on r.id = s.request_id
  left join lateral (select st_y(geom::geometry) as lat, st_x(geom::geometry) as lng, at
                     from session_fixes x where x.session_id = l.session_id and x.user_id = l.user_id
                     order by at desc limit 1) f on true
  where l.token = tok and l.expires_at > now();
$$;

revoke execute on function do_checkin(uuid, uuid), do_end_session(uuid, uuid, text),
  notify_contacts(uuid, text), sweep_checkins(), session_status(uuid), share_link_fix(text)
  from public, anon, authenticated;
grant execute on function do_checkin(uuid, uuid), do_end_session(uuid, uuid, text) to service_role;
grant execute on function session_status(uuid) to authenticated;
grant execute on function share_link_fix(text) to anon, authenticated;

select cron.schedule('sweep-checkins', '30 seconds', $$select sweep_checkins()$$);
