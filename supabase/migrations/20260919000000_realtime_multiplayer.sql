-- PyChess realtime multiplayer: active games, long-term archive, atomic RPCs.
--
-- Design (reviewed): clients NEVER write game state. All mutations go through
-- SECURITY DEFINER RPCs (create/join/resign) or the service-role edge function
-- (apply_validated_move). Password hashes live in a separate secrets table with
-- no client grants. Realtime per-game channels are receive-only for clients;
-- only the service-role edge function broadcasts. Idle games are swept by
-- pg_cron. pgcrypto lives in the `extensions` schema, so it is schema-qualified
-- under the hardened `search_path = ''`.

-- ---------------------------------------------------------------------------
-- Extensions & schemas
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;          -- creates the `cron` schema
-- pgcrypto is already installed in the `extensions` schema.

create schema if not exists private;             -- internal helpers, never exposed
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

-- ---------------------------------------------------------------------------
-- active_games — short-term, frequently updated live matches.
-- ---------------------------------------------------------------------------
create table public.active_games (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  host_id       uuid not null references public.profiles (id) on delete cascade,
  guest_id      uuid references public.profiles (id) on delete cascade,
  host_color    text not null check (host_color in ('white', 'black')),
  status        text not null default 'waiting'
                check (status in ('waiting', 'active', 'finished')),
  fen           text not null
                default 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  moves         jsonb not null default '[]'::jsonb,     -- [{uci, san}] in order
  move_count    int not null default 0,                 -- half-moves; optimistic-lock token
  time_control  text not null,                          -- '1'|'3'|'5'|'10'|'unlimited'
  clock_white_ms int, clock_black_ms int,               -- display-only; null for unlimited
  result        text check (result in ('1-0', '0-1', '1/2-1/2', '*')),
  end_reason    text check (end_reason in
                ('checkmate', 'stalemate', 'draw', 'resignation', 'abandoned')),
  last_move_at  timestamptz not null default now(),      -- idle detection
  finished_at   timestamptz,
  created_at    timestamptz not null default now(),
  check (guest_id is null or guest_id <> host_id)
);

comment on table public.active_games is
  'Live/short-term games. Written only by SECURITY DEFINER RPCs and the service-role edge function.';

create index active_games_last_move_idx on public.active_games (last_move_at);
create index active_games_status_idx    on public.active_games (status);
create index active_games_host_idx      on public.active_games (host_id);
create index active_games_guest_idx     on public.active_games (guest_id);

-- Password hashes, isolated so clients can never read them (no grants + RLS deny).
create table public.active_game_secrets (
  game_id       uuid primary key references public.active_games (id) on delete cascade,
  password_hash text
);
comment on table public.active_game_secrets is
  'Bcrypt game-join password hashes; readable only by the service role / definer funcs.';
revoke all on table public.active_game_secrets from anon, authenticated;

-- Per-user join-attempt log (brute-force throttle for game codes/passwords).
create table public.game_join_attempts (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  created_at timestamptz not null default now()
);
create index game_join_attempts_user_idx on public.game_join_attempts (user_id, created_at desc);
revoke all on table public.game_join_attempts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- game_archive — long-term store for review. Two named players, colors, date.
-- ---------------------------------------------------------------------------
create table public.game_archive (
  id             uuid primary key default gen_random_uuid(),
  active_game_id uuid,                               -- reference only; active row is gone
  white_id       uuid references public.profiles (id) on delete set null,
  black_id       uuid references public.profiles (id) on delete set null,
  white_name     text not null,                      -- nickname snapshot (survives changes)
  black_name     text not null,
  result         text not null check (result in ('1-0', '0-1', '1/2-1/2', '*')),
  end_reason     text check (end_reason in
                 ('checkmate', 'stalemate', 'draw', 'resignation', 'abandoned')),
  pgn            text not null,
  moves          jsonb not null,                     -- [{uci, san}]
  time_control   text not null,
  played_at      timestamptz not null,               -- game start (the "date of the game")
  finished_at    timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

comment on table public.game_archive is
  'Finished/abandoned multiplayer games for review: both players, colors, date, PGN.';

create index game_archive_white_idx  on public.game_archive (white_id, finished_at desc);
create index game_archive_black_idx  on public.game_archive (black_id, finished_at desc);
create index game_archive_active_idx on public.game_archive (active_game_id);

-- Rate-limit log: one row per hosted game. Every creation counts toward the
-- hourly cap (anti-spam), but only games a guest actually joined (activated_at
-- set) count toward the lifetime cap, so cancelled/never-joined games don't
-- permanently consume a player's lifetime allowance.
create table public.hosted_games (
  id             uuid primary key default gen_random_uuid(),
  host_id        uuid not null references public.profiles (id) on delete cascade,
  active_game_id uuid,
  activated_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index hosted_games_host_idx on public.hosted_games (host_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security. Participants may READ their games; NO client writes at
-- all — every mutation flows through the definer RPCs / service role.
-- ---------------------------------------------------------------------------
alter table public.active_games       enable row level security;
alter table public.game_archive       enable row level security;
alter table public.hosted_games       enable row level security;
alter table public.active_game_secrets enable row level security;   -- deny-all (no policy)
alter table public.game_join_attempts  enable row level security;   -- deny-all (no policy)

create policy "participants read their active game"
  on public.active_games for select to authenticated
  using ((select auth.uid()) in (host_id, guest_id));

create policy "participants read their archived game"
  on public.game_archive for select to authenticated
  using ((select auth.uid()) in (white_id, black_id));

create policy "host reads own hosting log"
  on public.hosted_games for select to authenticated
  using ((select auth.uid()) = host_id);

-- ---------------------------------------------------------------------------
-- Realtime authorization: participants may RECEIVE (select) broadcasts on their
-- game's private channel `game:<uuid>`. No insert policy => clients cannot send;
-- only the service-role edge function broadcasts. Text compare avoids uuid-cast
-- errors on malformed topics.
-- ---------------------------------------------------------------------------
create policy "participants receive game broadcasts"
  on realtime.messages for select to authenticated
  using (
    realtime.topic() like 'game:%'
    and exists (
      select 1 from public.active_games g
      where g.id::text = substring(realtime.topic() from 6)
        and (select auth.uid()) in (g.host_id, g.guest_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Internal helpers (private schema; not reachable via PostgREST).
-- ---------------------------------------------------------------------------

-- Random 6-char join code from an unambiguous 32-char alphabet.
create or replace function private.gen_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- 32 chars, no I/O/0/1
  b bytea; s text := ''; i int;
begin
  b := extensions.gen_random_bytes(6);
  for i in 0..5 loop
    s := s || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  return s;
end $$;

-- Assemble PGN movetext from stored SAN (startpos assumed; result token appended).
create or replace function private.assemble_pgn(p_moves jsonb, p_result text)
returns text language sql immutable set search_path = '' as $$
  select coalesce(
    string_agg(
      (case when ((ord - 1) % 2) = 0 then (((ord - 1) / 2) + 1)::text || '. ' else '' end)
        || (m ->> 'san'),
      ' ' order by ord),
    '')
    || (case when coalesce(p_result, '') <> '' then ' ' || p_result else '' end)
  from jsonb_array_elements(p_moves) with ordinality as t(m, ord);
$$;

-- Guarded terminal transition + archival. Flips exactly one 'active' -> 'finished'
-- and archives it, all in one transaction. Optional p_idle_cutoff makes the
-- transition also require the game to still be idle (used by cleanup so a
-- freshly-moved game is not abandoned). Returns true iff THIS call finalized it.
create or replace function private.finalize_game(
  p_game_id uuid, p_result text, p_end_reason text,
  p_idle_cutoff timestamptz default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare g public.active_games; w_id uuid; b_id uuid; w_name text; b_name text;
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

  if g.host_color = 'white' then w_id := g.host_id; b_id := g.guest_id;
                            else w_id := g.guest_id; b_id := g.host_id; end if;
  select coalesce(nickname, 'Player') into w_name from public.profiles where id = w_id;
  select coalesce(nickname, 'Player') into b_name from public.profiles where id = b_id;

  insert into public.game_archive
    (active_game_id, white_id, black_id, white_name, black_name,
     result, end_reason, pgn, moves, time_control, played_at, finished_at)
  values
    (g.id, w_id, b_id, coalesce(w_name, 'Player'), coalesce(b_name, 'Player'),
     p_result, p_end_reason, private.assemble_pgn(g.moves, p_result), g.moves,
     g.time_control, g.created_at, now());
  return true;
end $$;

-- pg_cron sweep: free idle waiting codes, archive idle active games (unfinished),
-- drop finished rows past the reconnect grace, prune old join attempts.
create or replace function private.cleanup_idle_games()
returns void language plpgsql security definer set search_path = '' as $$
declare r record; cutoff timestamptz := now() - interval '10 minutes';
begin
  delete from public.active_games
   where status = 'waiting' and last_move_at < cutoff;         -- never joined; free code

  for r in select id from public.active_games
            where status = 'active' and last_move_at < cutoff loop
    begin
      perform private.finalize_game(r.id, '*', 'abandoned', cutoff);
    exception when others then
      raise warning 'cleanup finalize failed for %: %', r.id, sqlerrm;
    end;
  end loop;

  delete from public.active_games
   where status = 'finished' and finished_at < now() - interval '5 minutes';   -- past grace
  delete from public.game_join_attempts
   where created_at < now() - interval '1 hour';
end $$;

-- ---------------------------------------------------------------------------
-- Client-facing RPCs (SECURITY DEFINER; auth.uid() is the actor).
-- ---------------------------------------------------------------------------

-- Host a game: atomic rate-limit (5/hr, 100/lifetime) + code + optional bcrypt pw.
create or replace function public.create_hosted_game(
  p_password text, p_host_color text, p_time_control text
) returns table (id uuid, code text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare uid uuid := (select auth.uid());
        v_lifetime int; v_hour int; v_code text; v_id uuid; tries int := 0; v_clock int;
begin
  if uid is null then raise exception using errcode = 'PT401', message = 'not_authenticated'; end if;
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

  insert into public.active_games (code, host_id, host_color, time_control, clock_white_ms, clock_black_ms)
  values (v_code, uid, p_host_color, p_time_control, v_clock, v_clock)
  returning active_games.id into v_id;

  insert into public.active_game_secrets (game_id, password_hash)
  values (v_id, case when coalesce(p_password, '') <> ''
                     then extensions.crypt(p_password, extensions.gen_salt('bf', 10))
                     else null end);

  insert into public.hosted_games (host_id, active_game_id) values (uid, v_id);
  return query select v_id, v_code;
end $$;

-- Join a waiting game by code (+ optional password). Race-safe single-winner.
-- Returns an OUTCOME row (ok/reason) rather than raising for credential/lookup
-- failures, so the throttle log row commits even when the attempt fails (a
-- RAISE would roll it back, making brute-force throttling inert).
create or replace function public.join_active_game(p_code text, p_password text)
returns table (ok boolean, reason text, id uuid, host_color text, status text, fen text,
               moves jsonb, move_count int, time_control text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare uid uuid := (select auth.uid()); g public.active_games; v_hash text; v_recent int;
begin
  if uid is null then raise exception using errcode = 'PT401', message = 'not_authenticated'; end if;

  perform pg_advisory_xact_lock(hashtextextended('join:' || uid::text, 0));
  insert into public.game_join_attempts (user_id) values (uid);
  select count(*) into v_recent from public.game_join_attempts
    where user_id = uid and created_at > now() - interval '1 minute';
  if v_recent > 30 then raise exception using errcode = 'PT429', message = 'too_many_join_attempts'; end if;

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

  update public.active_games ag
     set guest_id = uid, status = 'active', last_move_at = now()
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

-- Resign (or cancel a still-waiting game as its host).
create or replace function public.resign_active_game(p_game_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); g public.active_games; v_result text;
begin
  if uid is null then raise exception using errcode = 'PT401', message = 'not_authenticated'; end if;
  select * into g from public.active_games where id = p_game_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'game_not_found'; end if;
  if uid <> g.host_id and uid is distinct from g.guest_id then
    raise exception using errcode = 'PT403', message = 'not_a_participant'; end if;

  if g.status = 'waiting' then
    if uid <> g.host_id then raise exception using errcode = 'PT403', message = 'not_host'; end if;
    delete from public.active_games where id = p_game_id;      -- cancel; secret cascades
    return 'cancelled';
  elsif g.status = 'active' then
    -- Resigner loses. white resigns -> '0-1', black resigns -> '1-0'.
    if (g.host_color = 'white' and uid = g.host_id)
       or (g.host_color = 'black' and uid = g.guest_id)
    then v_result := '0-1'; else v_result := '1-0'; end if;
    if not private.finalize_game(p_game_id, v_result, 'resignation') then
      raise exception using errcode = 'PT409', message = 'already_finished'; end if;
    return v_result;
  else
    raise exception using errcode = 'PT409', message = 'already_finished';
  end if;
end $$;

-- Apply a move the edge function already validated with the WASM engine.
-- Callable ONLY by the service role. Re-guards move_count / status / turn as
-- defense in depth; finalizes atomically when the move ends the game.
create or replace function public.apply_validated_move(
  p_game_id uuid, p_user_id uuid, p_expected_move_count int,
  p_uci text, p_san text, p_new_fen text,
  p_clock_white_ms int, p_clock_black_ms int,
  p_game_over boolean, p_result text, p_end_reason text
) returns table (move_count int, status text, result text, end_reason text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare g public.active_games; side_to_move text; mover_color text;
begin
  select * into g from public.active_games where id = p_game_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'game_not_found'; end if;

  -- Idempotent retry: the exact move at this count already landed.
  if g.move_count = p_expected_move_count + 1
     and (g.moves -> (g.move_count - 1) ->> 'uci') = p_uci then
    return query select g.move_count, g.status, g.result, g.end_reason;
    return;
  end if;

  if g.status <> 'active' then raise exception using errcode = 'PT409', message = 'not_active'; end if;
  if g.move_count <> p_expected_move_count then
    raise exception using errcode = 'PT409', message = 'stale_move_count'; end if;
  if p_user_id not in (g.host_id, g.guest_id) then
    raise exception using errcode = 'PT403', message = 'not_a_participant'; end if;

  side_to_move := split_part(g.fen, ' ', 2);       -- 'w' | 'b'
  if g.host_color = 'white'
     then mover_color := case when p_user_id = g.host_id then 'w' else 'b' end;
     else mover_color := case when p_user_id = g.host_id then 'b' else 'w' end; end if;
  if side_to_move <> mover_color then
    raise exception using errcode = 'PT409', message = 'not_your_turn'; end if;

  update public.active_games
     set fen = p_new_fen,
         moves = moves || jsonb_build_object('uci', p_uci, 'san', p_san),
         move_count = move_count + 1,
         clock_white_ms = p_clock_white_ms,
         clock_black_ms = p_clock_black_ms,
         last_move_at = now()
   where id = p_game_id and move_count = p_expected_move_count and status = 'active';
  if not found then raise exception using errcode = 'PT409', message = 'stale_move_count'; end if;

  if p_game_over then
    perform private.finalize_game(p_game_id, p_result, p_end_reason);
  end if;

  return query select ag.move_count, ag.status, ag.result, ag.end_reason
               from public.active_games ag where ag.id = p_game_id;
end $$;

-- ---------------------------------------------------------------------------
-- EXECUTE grants. Client RPCs to authenticated only; the apply/internal
-- functions to the service role only.
-- ---------------------------------------------------------------------------
-- Supabase's default privileges grant EXECUTE on every new public function to
-- anon + authenticated, so `revoke ... from public` is not enough — revoke the
-- role grants explicitly, then grant back only what each function needs.
revoke all on function public.create_hosted_game(text, text, text) from public, anon, authenticated;
revoke all on function public.join_active_game(text, text)          from public, anon, authenticated;
revoke all on function public.resign_active_game(uuid)              from public, anon, authenticated;
grant execute on function public.create_hosted_game(text, text, text) to authenticated;
grant execute on function public.join_active_game(text, text)          to authenticated;
grant execute on function public.resign_active_game(uuid)              to authenticated;

-- apply_validated_move trusts a server-validated move, so it must be reachable
-- ONLY by the service-role edge function — never by a client (which could forge
-- the FEN/result and bypass the WASM validator).
revoke all on function public.apply_validated_move(uuid, uuid, int, text, text, text, int, int, boolean, text, text) from public, anon, authenticated;
grant execute on function public.apply_validated_move(uuid, uuid, int, text, text, text, int, int, boolean, text, text) to service_role;

revoke all on function private.finalize_game(uuid, text, text, timestamptz) from public;
revoke all on function private.cleanup_idle_games()                          from public;
revoke all on function private.gen_code()                                    from public;
revoke all on function private.assemble_pgn(jsonb, text)                     from public;

-- ---------------------------------------------------------------------------
-- Scheduled idle sweep (every minute).
-- ---------------------------------------------------------------------------
select cron.schedule('pychess-cleanup-idle', '* * * * *', $$ select private.cleanup_idle_games(); $$);
