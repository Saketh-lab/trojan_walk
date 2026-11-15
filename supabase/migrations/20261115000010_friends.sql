-- Prompt 8: friends. Friendships are only ever written by these functions (both directions).

-- My friends: first name and source only. Never an email, phone hash, or location.
create or replace view my_friends with (security_barrier = true) as
select f.b as friend_id, p.first_name, f.source, f.created_at
from friendships f
join profiles p on p.id = f.b
where f.a = auth.uid();
revoke all on my_friends from anon;
grant select on my_friends to authenticated;

-- Add by @usc.edu email. A block in either direction behaves like "not found".
create or replace function add_friend_by_email(p_email text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); e text := lower(trim(coalesce(p_email, ''))); other profiles%rowtype; had boolean;
begin
  if me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if e !~ '^[^@[:space:]]+@usc\.edu$' then return jsonb_build_object('status', 'invalid'); end if;
  select * into other from profiles where email = e;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if other.id = me then return jsonb_build_object('status', 'self'); end if;
  if exists (select 1 from blocks b where (b.blocker = me and b.blocked = other.id)
                                       or (b.blocker = other.id and b.blocked = me)) then
    return jsonb_build_object('status', 'not_found');
  end if;
  had := exists (select 1 from friendships where a = me and b = other.id);
  insert into friendships (a, b, source) values (me, other.id, 'in_app'), (other.id, me, 'in_app')
  on conflict do nothing;
  return jsonb_build_object('status', case when had then 'already' else 'added' end, 'first_name', other.first_name);
end $$;

create or replace function remove_friend(p_friend uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from friendships
   where (a = auth.uid() and b = p_friend) or (a = p_friend and b = auth.uid());
$$;

-- Why a pinged user was asked (walk requests only; broadcasts stay anonymous, so no reasons there).
create or replace view target_requests with (security_barrier = true) as
select r.id as request_id, r.kind, r.origin_label,
       case when r.kind = 'walk' then r.dest_label end as dest_label,
       r.leave_at, r.status, r.expires_at, t.rung, t.response,
       case when r.kind = 'walk' then p.first_name end as requester_first_name,
       case when r.kind = 'walk' then array_remove(array[
         case when exists (select 1 from friendships f where f.a = r.requester and f.b = t.user_id) then 'friend' end,
         case when exists (select 1 from shared_context x join shared_context y on x.kind = y.kind and x.value = y.value
                           where x.user_id = r.requester and y.user_id = t.user_id and x.kind = 'class') then 'class' end,
         case when exists (select 1 from shared_context x join shared_context y on x.kind = y.kind and x.value = y.value
                           where x.user_id = r.requester and y.user_id = t.user_id and x.kind = 'hall') then 'hall' end,
         case when t.rung = 3 then 'walker' end
       ], null) else '{}'::text[] end as reasons
from request_targets t
join requests r on r.id = t.request_id
join profiles p on p.id = r.requester
where t.user_id = auth.uid();

revoke execute on function add_friend_by_email(text), remove_friend(uuid) from public, anon;
grant execute on function add_friend_by_email(text), remove_friend(uuid) to authenticated;
