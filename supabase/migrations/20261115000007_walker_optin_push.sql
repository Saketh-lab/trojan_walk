-- Prompt 6: Walker opt-in/out, rung-3 push, and every query honouring opt-in.

-- Opting out must not erase a strike record (a delete + re-insert would), so it is a flag.
alter table walkers add column opted_in boolean not null default true;
revoke update on walkers from authenticated;
grant update (hours, opted_in) on walkers to authenticated;

-- Push is claimed once per target so repeated pokes never double-send.
alter table request_targets add column pushed_at timestamptz;

-- Anonymous dots: Walker badge only for opted-in, verified Walkers.
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
    exists (select 1 from walkers w where w.user_id = p.user_id and w.active and w.opted_in)
  from presence p cross join me
  where p.toggled_on
    and p.user_id <> auth.uid()
    and p.updated_at > now() - interval '20 seconds'
    and st_dwithin(p.geom, me.geom, least(greatest(p_radius_m, 1), 150))
    and not exists (select 1 from blocks b
                    where (b.blocker = auth.uid() and b.blocked = p.user_id)
                       or (b.blocker = p.user_id and b.blocked = auth.uid()));
$$;

-- Rungs 2 and 3. Rung 3 = active, opted-in Walkers within 100 m, inside their hours, under the
-- nightly cap, and (if the requester asked) the same gender. Area and year only affect ranking.
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
    join walkers w on w.user_id = l.uid and w.active and w.opted_in
                  and w.pings_tonight < w.max_pings_per_night
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

-- Same behaviour as before, plus: poke push-pending when new rung-3 targets were created.
create or replace function advance_requests() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
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
  get diagnostics n = row_count;

  if n > 0 then
    perform net.http_post(
      url := 'https://ycuqduwmzrsztrrnodcp.supabase.co/functions/v1/push-pending',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljdXFkdXdtenJzenRycm5vZGNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ3MjE2MTYsImV4cCI6MjExMDI5NzYxNn0.hThYQMrbsx1S-81sFABjWR0-tINkPtDI7JeBBvy-Wbg'),
      body := '{}'::jsonb);
  end if;
end $$;

-- Responder / peer cards: badge only for opted-in Walkers.
create or replace view request_responders with (security_barrier = true) as
select t.request_id, t.user_id, t.response,
       p.first_name, p.photo_url, p.class_year,
       coalesce(w.active and w.opted_in, false) as is_walker, w.rating_avg, w.rating_count,
       (round(st_distance(pr.geom, r.origin) / 50) * 50)::int as distance_m
from requests r
join request_targets t on t.request_id = r.id and t.response in ('accepted','applied')
join profiles p on p.id = t.user_id
left join walkers w on w.user_id = t.user_id
left join presence pr on pr.user_id = t.user_id and pr.toggled_on
where r.requester = auth.uid();

create or replace view session_peers with (security_barrier = true) as
select s.id as session_id, p.id as user_id, p.first_name, p.photo_url, p.class_year,
       coalesce(w.active and w.opted_in, false) as is_walker, w.rating_avg, w.rating_count
from sessions s
join profiles p on p.id = case when s.requester = auth.uid() then s.companion else s.requester end
left join walkers w on w.user_id = p.id
where auth.uid() in (s.requester, s.companion);

revoke execute on function nearby_dots(int), fanout_candidates(uuid), advance_requests() from public, anon;
grant execute on function nearby_dots(int) to authenticated;
revoke execute on function fanout_candidates(uuid) from authenticated;
grant execute on function fanout_candidates(uuid) to service_role;
revoke execute on function advance_requests() from authenticated;
