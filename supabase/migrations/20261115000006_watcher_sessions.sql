-- Prompt 5: watcher-only sessions (no companion; a chosen contact watches via a signed link).

alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('missed','escalated','watching'));

-- Start a watched walk from a request that found no one. Service role only (called by the `watch` function).
create or replace function do_start_watcher(req uuid, actor uuid, contact text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare r requests%rowtype; sid uuid; tok text; phone text := regexp_replace(coalesce(contact, ''), '[\s().-]', '', 'g');
begin
  if phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Enter the number with country code, like +12135550123' using errcode = '22023';
  end if;
  select * into r from requests where id = req for update;
  if not found or r.requester <> actor or r.kind <> 'walk' then
    raise exception 'not your request' using errcode = '42501';
  end if;
  if r.status not in ('open','expired') or r.created_at < now() - interval '30 minutes' then
    raise exception 'this request is no longer available' using errcode = '22023';
  end if;
  if exists (select 1 from sessions where request_id = req) then
    raise exception 'this request already has a walk' using errcode = '22023';
  end if;

  update requests set status = 'matched' where id = req;   -- stops any further fan-out
  insert into sessions (request_id, requester, companion, watcher_contact, meeting_point, dest)
  values (req, actor, null, phone, r.origin_label, r.dest)
  returning id into sid;
  update sessions set next_checkin_at = now() + make_interval(secs => checkin_interval_s) where id = sid;

  insert into share_links (session_id, user_id) values (sid, actor) returning token into tok;
  insert into notifications (session_id, user_id, kind, to_phone, token)
  values (sid, actor, 'watching', phone, tok);
  return sid;
end $$;

-- session_status gains watcher_mode + the contact's last 4 digits.
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

revoke execute on function do_start_watcher(uuid, uuid, text) from public, anon, authenticated;
grant execute on function do_start_watcher(uuid, uuid, text) to service_role;
revoke execute on function session_status(uuid) from public, anon;
grant execute on function session_status(uuid) to authenticated;
