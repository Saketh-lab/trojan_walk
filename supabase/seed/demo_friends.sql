-- DEMO_MODE only: Ana and Ben are friends (both directions) so rung 2 picks them up.
insert into friendships (a, b, source)
select x.id, y.id, 'in_app' from profiles x, profiles y
where (x.email, y.email) in (('demo1@usc.edu','demo2@usc.edu'), ('demo2@usc.edu','demo1@usc.edu'))
on conflict do nothing;
