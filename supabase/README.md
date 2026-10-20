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

`migrations/20261020000000_model_server_quota.sql` adds the hourly quota for the
move server (`serve/`): `consume_model_move()` spends one of a signed-in,
non-anonymous player's 200 moves per rolling hour and is the server's only
access to the database. Its log, `model_move_requests`, has no client grants.
