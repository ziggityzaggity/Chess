-- PyChess initial schema: profiles, games, friendships.
--
-- Auth itself lives in Supabase's managed `auth` schema; these tables hold the
-- application data keyed off auth.users. All tables use row-level security so
-- the browser can talk to PostgREST directly with the publishable (anon) key.

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user, created automatically on signup.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  nickname   text unique
             check (nickname is null or nickname ~ '^[A-Za-z0-9 _.-]{2,24}$'),
  birth_date date
             check (birth_date is null or birth_date <= current_date),
  -- Avatar details (style, colors, image ref, …) — free-form so the avatar
  -- feature can evolve without migrations.
  avatar     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Application profile for each auth user: nickname, birth date, avatar details.';

-- Keep updated_at fresh on every change.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create an empty profile whenever a user signs up (email OTP or Google).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

-- Any signed-in player may look up other players (nickname/avatar power the
-- friends list and game history); only the owner may change their profile.
create policy "profiles are readable by signed-in users"
  on public.profiles for select
  to authenticated
  using (true);

create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ---------------------------------------------------------------------------
-- games — finished games in PGN, owned by the user who saved them.
-- ---------------------------------------------------------------------------
create table public.games (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  pgn        text not null check (length(pgn) between 1 and 65536),
  -- Redundant with the PGN tags but cheap to query for a game-history list.
  result     text check (result in ('1-0', '0-1', '1/2-1/2', '*')),
  opponent   text,
  played_at  timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.games is
  'Games saved by a player, stored as PGN with a few list-friendly columns.';

create index games_owner_played_idx on public.games (owner_id, played_at desc);

alter table public.games enable row level security;

create policy "users manage their own games"
  on public.games for all
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- ---------------------------------------------------------------------------
-- friendships — directed friend requests; a row is a request from
-- requester -> addressee, accepted when status = 'accepted'.
-- ---------------------------------------------------------------------------
create type public.friendship_status as enum ('pending', 'accepted', 'blocked');

create table public.friendships (
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status       public.friendship_status not null default 'pending',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

comment on table public.friendships is
  'Friend requests between players; accepted rows form the friends list.';

create index friendships_addressee_idx on public.friendships (addressee_id);

create trigger friendships_set_updated_at
  before update on public.friendships
  for each row execute function public.set_updated_at();

alter table public.friendships enable row level security;

create policy "users see friendships they are part of"
  on public.friendships for select
  to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));

create policy "users send friend requests as themselves"
  on public.friendships for insert
  to authenticated
  with check ((select auth.uid()) = requester_id);

-- Either side may update (accept/block); neither may reassign the pair.
create policy "participants update their friendships"
  on public.friendships for update
  to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id))
  with check ((select auth.uid()) in (requester_id, addressee_id));

create policy "participants remove their friendships"
  on public.friendships for delete
  to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));
