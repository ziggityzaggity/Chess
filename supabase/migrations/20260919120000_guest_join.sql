-- Guest join: let players who are NOT signed in join a game with just the code
-- + password. The client signs such a player in via Supabase ANONYMOUS AUTH, so
-- they still get a real auth.users row (and, via on_auth_user_created, a
-- public.profiles row) — keeping the guest_id FK, RLS, realtime authorization
-- and the edge-function identity intact. Guests may join/play/resign, NOT host.
--
-- Revised after an adversarial review. Key hardening:
--   * Display names for BOTH players are snapshotted onto active_games, so
--     NEITHER client needs to read the profiles table for online play. That in
--     turn lets us lock anonymous sessions out of profiles (they otherwise hold
--     the 'authenticated' role and could enumerate every user's birth_date/PII).
--   * A per-CODE join throttle (not just per-user) so password brute-forcing
--     can't be reset by rotating throwaway anonymous identities.
--   * Anonymous users are blocked from HOSTING (lifetime cap is meaningless for
--     throwaway accounts).
--   * The guest display name is sanitized (control + zero-width/bidi) and the
--     generic fallback distinguishes anonymous guests ('Guest') from registered
--     accounts with no nickname yet ('Player').

-- ---------------------------------------------------------------------------
-- 1. Display-name snapshots on the live game (both sides).
-- ---------------------------------------------------------------------------
alter table public.active_games
  add column if not exists host_name text;
alter table public.active_games
  add column if not exists guest_name text
  check (guest_name is null or char_length(guest_name) <= 40);

-- ---------------------------------------------------------------------------
-- 2. Per-code component for the join throttle (anti-brute-force that survives
--    anonymous-identity rotation).
-- ---------------------------------------------------------------------------
alter table public.game_join_attempts add column if not exists code text;
create index if not exists game_join_attempts_code_idx
  on public.game_join_attempts (code, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Lock ANONYMOUS sessions out of the profiles table. Anonymous auth makes the
--    'authenticated' role reachable by anyone with the public anon key, and the
--    existing SELECT policy is USING (true) over all rows (incl. birth_date).
--    Guests never need profiles now (names come from the game/archive snapshots),
--    so deny them both read and write. Registered users are unaffected.
-- ---------------------------------------------------------------------------
alter policy "profiles are readable by signed-in users" on public.profiles
  using (coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false);
alter policy "users can update their own profile" on public.profiles
  using ((select auth.uid()) = id
         and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false)
  with check ((select auth.uid()) = id
         and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false);

-- ---------------------------------------------------------------------------
-- 4. finalize_game: names come straight from the row snapshots (no profiles read).
-- ---------------------------------------------------------------------------
create or replace function private.finalize_game(
  p_game_id uuid, p_result text, p_end_reason text,
  p_idle_cutoff timestamptz default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare g public.active_games; w_name text; b_name text;
begin
  update public.active_games
     set status = 'finished', result = p_result, end_reason = p_end_reason, finished_at = now()
   where id = p_game_id
     and status = 'active'
     and (p_idle_cutoff is null or last_move_at < p_idle_cutoff)
   returning * into g;
  if not found then
    return false;                                  -- already finished, or refreshed by a move
  end if;

  if g.host_color = 'white' then
    w_name := coalesce(g.host_name, 'Player'); b_name := coalesce(g.guest_name, 'Guest');
  else
    w_name := coalesce(g.guest_name, 'Guest'); b_name := coalesce(g.host_name, 'Player');
  end if;

  insert into public.game_archive
    (active_game_id, white_id, black_id, white_name, black_name,
     result, end_reason, pgn, moves, time_control, played_at, finished_at)
  values
    (g.id,
     case when g.host_color = 'white' then g.host_id  else g.guest_id end,
     case when g.host_color = 'white' then g.guest_id else g.host_id  end,
     w_name, b_name,
     p_result, p_end_reason, private.assemble_pgn(g.moves, p_result), g.moves,
     g.time_control, g.created_at, now());
  return true;
end $$;

revoke all on function private.finalize_game(uuid, text, text, timestamptz) from public;

-- ---------------------------------------------------------------------------
-- 5. create_hosted_game: reject anonymous callers; snapshot the host's name.
-- ---------------------------------------------------------------------------
create or replace function public.create_hosted_game(
  p_password text, p_host_color text, p_time_control text
) returns table (id uuid, code text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare uid uuid := (select auth.uid());
        v_lifetime int; v_hour int; v_code text; v_id uuid; tries int := 0; v_clock int;
begin
  if uid is null then raise exception using errcode = 'PT401', message = 'not_authenticated'; end if;
  -- Anonymous (guest) accounts are throwaway, so the lifetime cap can't bind
  -- them — keep hosting to real, registered accounts.
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception using errcode = 'PT403', message = 'guest_cannot_host'; end if;
  if p_host_color not in ('white', 'black') then
    raise exception using errcode = 'PT400', message = 'bad_color'; end if;
  if p_time_control not in ('3', '10', '30', 'unlimited') then
    raise exception using errcode = 'PT400', message = 'bad_time_control'; end if;

  -- Serialize per user so concurrent creates cannot slip past the counts.
  perform pg_advisory_xact_lock(hashtextextended('host:' || uid::text, 0));
  -- Lifetime cap counts only games that actually started (a guest joined).
  select count(*) into v_lifetime from public.hosted_games
    where host_id = uid and activated_at is not null;
  if v_lifetime >= 100 then raise exception using errcode = 'PT429', message = 'limit_lifetime'; end if;
  select count(*) into v_hour from public.hosted_games
    where host_id = uid and created_at > now() - interval '1 hour';
  if v_hour >= 5 then raise exception using errcode = 'PT429', message = 'limit_hour'; end if;

  loop
    tries := tries + 1;
    v_code := private.gen_code();
    exit when not exists (select 1 from public.active_games ag where ag.code = v_code);
    if tries > 20 then raise exception using errcode = 'PT500', message = 'code_generation_failed'; end if;
  end loop;

  v_clock := case when p_time_control = 'unlimited' then null
                  else p_time_control::int * 60 * 1000 end;

  insert into public.active_games
    (code, host_id, host_color, time_control, clock_white_ms, clock_black_ms, host_name)
  values
    (v_code, uid, p_host_color, p_time_control, v_clock, v_clock,
     coalesce((select nickname from public.profiles where id = uid), 'Player'))
  returning active_games.id into v_id;

  insert into public.active_game_secrets (game_id, password_hash)
  values (v_id, case when coalesce(p_password, '') <> ''
                     then extensions.crypt(p_password, extensions.gen_salt('bf', 10))
                     else null end);

  insert into public.hosted_games (host_id, active_game_id) values (uid, v_id);
  return query select v_id, v_code;
end $$;

revoke all on function public.create_hosted_game(text, text, text) from public, anon, authenticated;
grant execute on function public.create_hosted_game(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. join_active_game: per-code throttle + sanitized display-name snapshot.
--    Signature changes (added param), so drop the old overload first, then
--    re-assert grants (a re-created function inherits Supabase's default
--    anon+authenticated EXECUTE grant, which we tighten).
-- ---------------------------------------------------------------------------
drop function if exists public.join_active_game(text, text);

create or replace function public.join_active_game(
  p_code text, p_password text, p_guest_name text default null
)
returns table (ok boolean, reason text, id uuid, host_color text, status text, fen text,
               moves jsonb, move_count int, time_control text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare uid uuid := (select auth.uid());
        g public.active_games; v_hash text; v_recent int; v_code_recent int;
        v_is_anon boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
        v_name text;
begin
  if uid is null then raise exception using errcode = 'PT401', message = 'not_authenticated'; end if;

  perform pg_advisory_xact_lock(hashtextextended('join:' || uid::text, 0));
  insert into public.game_join_attempts (user_id, code) values (uid, upper(p_code));
  -- Per-user throttle.
  select count(*) into v_recent from public.game_join_attempts
    where user_id = uid and created_at > now() - interval '1 minute';
  if v_recent > 30 then raise exception using errcode = 'PT429', message = 'too_many_join_attempts'; end if;
  -- Per-code throttle: cannot be reset by minting fresh anonymous identities.
  select count(*) into v_code_recent from public.game_join_attempts
    where code = upper(p_code) and created_at > now() - interval '1 minute';
  if v_code_recent > 30 then raise exception using errcode = 'PT429', message = 'too_many_join_attempts'; end if;

  select * into g from public.active_games where code = upper(p_code) and status = 'waiting' for update;
  if not found then
    return query select false, 'game_not_found', null::uuid, null::text, null::text,
                 null::text, null::jsonb, null::int, null::text, null::timestamptz;
    return;
  end if;
  if g.host_id = uid then
    return query select false, 'cannot_join_own_game', null::uuid, null::text, null::text,
                 null::text, null::jsonb, null::int, null::text, null::timestamptz;
    return;
  end if;

  select password_hash into v_hash from public.active_game_secrets where game_id = g.id;
  if v_hash is not null and (p_password is null or extensions.crypt(p_password, v_hash) <> v_hash) then
    return query select false, 'wrong_password', null::uuid, null::text, null::text,
                 null::text, null::jsonb, null::int, null::text, null::timestamptz;
    return;
  end if;

  -- Sanitize the optional display name: strip ASCII/C1 controls (Cc) AND the
  -- dangerous Unicode format chars (Cf: zero-width, bidi override/isolate, soft
  -- hyphen, BOM), trim, cap at 40. Then prefer typed name > real nickname >
  -- a generic label that reflects whether this is a true anonymous guest.
  v_name := btrim(coalesce(p_guest_name, ''));
  v_name := regexp_replace(v_name, '[[:cntrl:]]', '', 'g');
  v_name := translate(
    v_name,
    E'­​‌‍‎‏⁠‪‫‬‭‮⁦⁧⁨⁩﻿',
    '');
  v_name := nullif(left(btrim(v_name), 40), '');
  v_name := coalesce(
    v_name,
    (select nickname from public.profiles where id = uid),
    case when v_is_anon then 'Guest' else 'Player' end);

  update public.active_games ag
     set guest_id = uid, status = 'active', last_move_at = now(), guest_name = v_name
   where ag.id = g.id and ag.status = 'waiting' and ag.guest_id is null;
  if not found then
    return query select false, 'already_taken', null::uuid, null::text, null::text,
                 null::text, null::jsonb, null::int, null::text, null::timestamptz;
    return;
  end if;

  -- Mark the hosting record as a real (started) game for the lifetime cap.
  update public.hosted_games set activated_at = now()
   where active_game_id = g.id and activated_at is null;

  return query
    select true, null::text, g.id, g.host_color, 'active'::text, g.fen, g.moves,
           g.move_count, g.time_control, g.created_at;
end $$;

revoke all on function public.join_active_game(text, text, text) from public, anon, authenticated;
grant execute on function public.join_active_game(text, text, text) to authenticated;

-- Refresh PostgREST's schema cache so the new signature is callable immediately.
notify pgrst, 'reload schema';
