-- Broadcast walks do not auto-end at the safe spot (SPEC 5a: the requester is prompted to end it).
-- Walk-with-me sessions keep the 40 m arrival geofence.
create or replace function record_fix(sess uuid, lat double precision, lng double precision)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare s sessions%rowtype; pt geography; is_bcast boolean;
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

  select exists (select 1 from requests where id = s.request_id and kind = 'broadcast') into is_bcast;
  if not is_bcast and s.dest is not null and st_distance(pt, s.dest) < 40 then
    update sessions set state = 'arrived', ended_at = now()
     where id = sess and state not in ('arrived','ended');
    return 'arrived';
  end if;
  return s.state;
end $$;

-- session_status gains is_broadcast so the screen can show the safe-spot prompt and the right wording.
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
    'is_broadcast', exists (select 1 from requests where id = s.request_id and kind = 'broadcast'),
    'peer_first_name', (select first_name from profiles where id = peer),
    'watcher_mode', s.companion is null,
    'watcher_last4', case when s.requester = me and s.watcher_contact is not null then right(s.watcher_contact, 4) end,
    'notices', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'recipients', n, 'stub', stub)), '[]'::jsonb)
                from (select kind, count(*) as n, bool_or(delivery = 'stub') as stub
                      from notifications where session_id = sess and user_id = me group by kind) t),
    'fixes', case when s.state = 'ended' then '[]'::jsonb else (
        select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'lat', lat, 'lng', lng, 'at', at)), '[]'::jsonb)
        from (select distinct on (user_id) user_id, st_y(geom::geometry) as lat, st_x(geom::geometry) as lng, at
              from session_fixes where session_id = sess order by user_id, at desc) f) end,
    'ended_at', s.ended_at);
end $$;

revoke execute on function record_fix(uuid, double precision, double precision), session_status(uuid) from public, anon;
grant execute on function record_fix(uuid, double precision, double precision), session_status(uuid) to authenticated;
