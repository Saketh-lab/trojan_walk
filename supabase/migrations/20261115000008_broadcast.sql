-- Prompt 7: broadcast with approval gate.

-- Who gets the broadcast: live (toggled on, fresh) users within 400 m plus active opted-in Walkers
-- within 600 m, nearest first, capped at 40. Service role only: it returns user ids.
create or replace function broadcast_targets(req uuid)
returns table (user_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  with r as (select * from requests where id = req and kind = 'broadcast'),
  live as (
    select p.user_id as uid, st_distance(p.geom, r.origin) as d,
           exists (select 1 from walkers w where w.user_id = p.user_id and w.active and w.opted_in) as walker
    from presence p cross join r
    where p.toggled_on and p.updated_at > now() - interval '20 seconds'
      and p.user_id <> r.requester
      and st_dwithin(p.geom, r.origin, 600)
      and not exists (select 1 from blocks b
                      where (b.blocker = r.requester and b.blocked = p.user_id)
                         or (b.blocker = p.user_id and b.blocked = r.requester)))
  select uid as user_id from live where d <= 400 or walker order by d limit 40;
$$;

-- The approval gate. Only now does the chosen responder become a session member (and so able to read
-- the requester's live fixes). Everyone else is marked declined. One row lock makes this atomic.
create or replace function do_approve_broadcast(req uuid, actor uuid, responder uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare r requests%rowtype; sid uuid;
begin
  select * into r from requests where id = req for update;
  if not found or r.kind <> 'broadcast' or r.requester <> actor then
    raise exception 'not your broadcast' using errcode = '42501';
  end if;
  if r.status <> 'open' or r.expires_at < now() then
    raise exception 'this broadcast is no longer open' using errcode = '22023';
  end if;
  if not exists (select 1 from request_targets where request_id = req and user_id = responder and response = 'applied') then
    raise exception 'that person has not offered to come' using errcode = '22023';
  end if;

  update requests set status = 'matched' where id = req;
  insert into sessions (request_id, requester, companion, meeting_point, dest)
  values (req, actor, responder, r.origin_label, r.dest)          -- dest = nearest staffed safe spot
  returning id into sid;
  update sessions set next_checkin_at = now() + make_interval(secs => checkin_interval_s) where id = sid;

  update request_targets set response = 'accepted', responded_at = now()
   where request_id = req and user_id = responder;
  update request_targets set response = 'declined', responded_at = now()
   where request_id = req and user_id <> responder and (response is null or response = 'applied');
  return sid;
end $$;

-- What a pinged user may see. For broadcasts: area label only. No name, no destination, no coordinates.
create or replace view target_requests with (security_barrier = true) as
select r.id as request_id, r.kind, r.origin_label,
       case when r.kind = 'walk' then r.dest_label end as dest_label,
       r.leave_at, r.status, r.expires_at, t.rung, t.response,
       case when r.kind = 'walk' then p.first_name end as requester_first_name
from request_targets t
join requests r on r.id = t.request_id
join profiles p on p.id = r.requester
where t.user_id = auth.uid();

-- What a requester sees about people who accepted / offered to come. No names (a broadcast is anonymous
-- both ways until approval): year, Walker badge, rating, and distance rounded to 50 m. `first_name` stays
-- as a column (a view cannot drop one without dropping the view) but is always null.
create or replace view request_responders with (security_barrier = true) as
select t.request_id, t.user_id, t.response,
       null::text as first_name,
       p.photo_url, p.class_year,
       coalesce(w.active and w.opted_in, false) as is_walker, w.rating_avg, w.rating_count,
       (round(st_distance(pr.geom, r.origin) / 50) * 50)::int as distance_m
from requests r
join request_targets t on t.request_id = r.id and t.response in ('accepted','applied')
join profiles p on p.id = t.user_id
left join walkers w on w.user_id = t.user_id
left join presence pr on pr.user_id = t.user_id and pr.toggled_on
where r.requester = auth.uid();

revoke execute on function broadcast_targets(uuid), do_approve_broadcast(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function broadcast_targets(uuid), do_approve_broadcast(uuid, uuid, uuid) to service_role;
