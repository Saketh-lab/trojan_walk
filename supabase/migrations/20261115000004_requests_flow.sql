-- Prompt 3: walk requests, rung timing, atomic accept.

-- Server decides expiry/status; clients cannot choose them. Walk requests need a route.
create or replace function requests_before_insert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.status := 'open';
  new.created_at := now();
  new.expires_at := now() + case new.kind when 'walk' then interval '180 seconds'
                                          else interval '10 minutes' end;
  if new.leave_at < now() - interval '1 minute' or new.leave_at > now() + interval '30 minutes' then
    raise exception 'leave_at out of range';
  end if;
  if new.kind = 'walk' and (new.origin is null or new.dest is null) then
    raise exception 'walk requests need an origin and a destination';
  end if;
  -- Free the one-open-request slot if the requester's previous request has lapsed.
  update requests set status = 'expired'
   where requester = new.requester and kind = new.kind and status = 'open' and expires_at < now();
  return new;
end $$;
create trigger requests_before_insert before insert on requests
  for each row execute function requests_before_insert();

-- At most one open request per user and kind (stops fan-out spam).
create unique index requests_one_open_per_user on requests (requester, kind) where status = 'open';

-- First accept wins. Row lock serialises racing accepts. Service role only.
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
  insert into sessions (request_id, requester, companion, meeting_point, dest, next_checkin_at)
  values (req, r.requester, actor, r.origin_label, r.dest, now() + interval '240 seconds')
  returning id into sid;
  update request_targets set response = 'accepted', responded_at = now()
   where request_id = req and user_id = actor;
  return sid;
end $$;

-- Requester can cancel their own open request.
create or replace function cancel_request(req uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  update requests set status = 'cancelled'
   where id = req and requester = auth.uid() and status = 'open';
$$;

-- Every 30 s: expire lapsed requests; at +120 s send rung 3 (matching Walkers) if still open.
create or replace function advance_requests() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update requests set status = 'expired' where status = 'open' and expires_at < now();

  with due as (
    select r.id from requests r
    where r.status = 'open' and r.kind = 'walk'
      and r.created_at <= now() - interval '120 seconds'
      and not exists (select 1 from request_targets t where t.request_id = r.id and t.rung = 3)),
  ins as (
    insert into request_targets (request_id, user_id, rung)
    select d.id, c.user_id, 3 from due d cross join lateral fanout_candidates(d.id) c
    where c.rung = 3
    on conflict do nothing
    returning user_id)
  update walkers set pings_tonight = pings_tonight + 1 where user_id in (select user_id from ins);
end $$;

select cron.schedule('advance-requests', '30 seconds', $$select advance_requests()$$);

revoke execute on function accept_request(uuid, uuid), advance_requests(), cancel_request(uuid),
  requests_before_insert() from public, anon, authenticated;
grant execute on function accept_request(uuid, uuid) to service_role;
grant execute on function cancel_request(uuid) to authenticated;
