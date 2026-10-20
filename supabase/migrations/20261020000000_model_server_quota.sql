-- Hourly quota for the move server (serve/move_service.py on Modal).
--
-- Signed-in players can ask the server for moves from the large value network,
-- 200 per rolling hour each. The server calls consume_model_move() with the
-- player's own access token, so PostgREST verifies the token and auth.uid() is
-- the player; one call both authenticates the request and spends one move.
-- Anonymous (guest) sessions are refused. The request log is never readable
-- or writable by clients (no grants, RLS without policies).

create table public.model_move_requests (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
comment on table public.model_move_requests is
  'One row per move served by the model server; drives the hourly quota.';
create index model_move_requests_user_idx on public.model_move_requests (user_id, created_at desc);
revoke all on table public.model_move_requests from anon, authenticated;
alter table public.model_move_requests enable row level security;   -- deny-all (no policy)

-- Spend one move of the caller's quota. Returns
--   {"allowed": true,  "limit": 200, "remaining": <after this move>}
--   {"allowed": false, "limit": 200, "remaining": 0, "retry_after_s": <until a move frees up>}
-- and raises 401 (PT401) without a signed-in, non-anonymous session.
create or replace function public.consume_model_move()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid     uuid := auth.uid();
  v_limit constant int := 200;
  v_used  int;
  v_first timestamptz;
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception using errcode = 'PT401', message = 'sign_in_required';
  end if;
  -- One caller at a time per user, so parallel requests cannot overspend.
  perform pg_advisory_xact_lock(hashtextextended('model_move:' || uid::text, 0));
  select count(*), min(created_at) into v_used, v_first
    from public.model_move_requests
   where user_id = uid and created_at > now() - interval '1 hour';
  if v_used >= v_limit then
    return jsonb_build_object(
      'allowed', false, 'limit', v_limit, 'remaining', 0,
      'retry_after_s', greatest(1, ceil(extract(epoch from (v_first + interval '1 hour' - now())))::int));
  end if;
  insert into public.model_move_requests (user_id) values (uid);
  return jsonb_build_object('allowed', true, 'limit', v_limit, 'remaining', v_limit - v_used - 1);
end $$;

revoke all on function public.consume_model_move() from public, anon;
grant execute on function public.consume_model_move() to authenticated;

-- Rows older than the window are no longer needed.
select cron.schedule(
  'prune-model-move-requests', '23 * * * *',
  $$delete from public.model_move_requests where created_at < now() - interval '2 hours'$$
);
