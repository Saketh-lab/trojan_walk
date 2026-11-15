-- Trigger functions must not be callable over /rest/v1/rpc; pin presence_touch search_path.
revoke execute on function auth_require_usc_email(), handle_new_user(), heatmap_on_request(), presence_touch()
  from public, anon, authenticated;
alter function presence_touch() set search_path = public, pg_temp;
