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

## Provisioning the hosted project

1. Create a project named **PyChess** at <https://supabase.com/dashboard>.
2. Apply the migration: SQL Editor → paste
   `migrations/20260903000000_init_pychess.sql` → run. (Or `supabase link
   --project-ref <ref>` then `supabase db push` after `supabase login`.)
3. **Email one-time codes**: Authentication → Emails → *Magic Link* template —
   make the body show `{{ .Token }}` (the 6-digit code) instead of the link,
   e.g. `<p>Your PyChess sign-in code is: <strong>{{ .Token }}</strong></p>`.
   The built-in mailer is fine for testing (a few emails/hour); configure
   custom SMTP for real traffic.
4. **Google sign-in**: Google Cloud Console → create an OAuth client
   (Web application) with redirect URI
   `https://<project-ref>.supabase.co/auth/v1/callback`, then paste the client
   ID + secret in Authentication → Sign In / Providers → Google.
5. **Redirect URLs**: Authentication → URL Configuration → set the site URL to
   the production domain and add
   `https://<your-domain>/auth/callback` and
   `http://localhost:3000/auth/callback` to the allow-list.
6. Copy the Project URL and publishable key (Project Settings → API) into
   `web/.env.local` and the Vercel project's environment variables as
   `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Local development

```sh
supabase start   # local stack; migrations apply automatically
```

One-time code emails land in the local mail-catcher at
<http://localhost:54324>.
