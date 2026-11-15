-- PostgREST returns geography as hex EWKB; expose plain lat/lng for the client.
-- security_invoker: the existing places_read policy (authenticated) still applies.
create view places_geo with (security_invoker = true) as
select slug, label, aliases, kind, staffed_hours,
       st_y(geom::geometry) as lat, st_x(geom::geometry) as lng
from places;
revoke all on places_geo from anon;
grant select on places_geo to authenticated;
