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

## Hosted project

The hosted project is **PyChess** (ref `dowvjokcncfombjjozff`, org PyChess,
AWS us-east-1, free tier — it auto-pauses after a week of inactivity; resume it
from the dashboard). Already done (2026-09-03): migration applied, site URL set
to <https://pychess-py-chess.vercel.app>, `/auth/callback` redirect URLs
allow-listed (production + localhost), and the URL + publishable key wired into
Vercel env vars and `web/.env.local` as
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

Remaining manual steps:

1. **6-digit codes in email**: with the built-in mailer the sign-in email
   contains only a confirmation *link* (which works — the app signs you in when
   you open it). To also show the `{{ .Token }}` code, configure custom SMTP
   (Authentication → Emails → SMTP Settings; e.g. Resend), then edit the
   *Magic link or OTP* and *Confirm sign up* templates to include
   `<p>Your PyChess sign-in code is: <strong>{{ .Token }}</strong></p>`.
   The built-in mailer is also rate-limited to a few emails per hour.
2. **Google sign-in**: Google Cloud Console → create an OAuth client
   (Web application) with redirect URI
   `https://dowvjokcncfombjjozff.supabase.co/auth/v1/callback`, then paste the
   client ID + secret in Authentication → Sign In / Providers → Google.

## Local development

```sh
supabase start   # local stack; migrations apply automatically
```

One-time code emails land in the local mail-catcher at
<http://localhost:54324>.
