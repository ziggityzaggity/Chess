# PyChess — Supabase backend

Auth (email one-time codes + Google) and the Postgres schema for profiles,
saved games (PGN), and friendships. The Next.js app in `web/` talks to Supabase
directly from the browser with the publishable (anon) key; row-level security
enforces access.

## Schema

`migrations/20260903000000_init_pychess.sql` creates:

- **`profiles`** — one row per auth user (auto-created by a trigger on
  `auth.users`): `nickname` (unique), `birth_date`, `avatar` (jsonb, free-form
  for future avatar details).
- **`games`** — saved games as PGN (`pgn`, `result`, `opponent`, `played_at`),
  owned by a profile.
- **`friendships`** — directed requests (`pending` / `accepted` / `blocked`);
  accepted rows form the friends list.

All tables have RLS: profiles are readable by any signed-in player (for friend
search) and writable only by their owner; games and friendships are only
visible to / editable by the users involved.
