// Loads the Supabase connection details the auth-flow tests need.
//
// NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY come from .env.local (public by design).
// SUPABASE_SERVICE_ROLE_KEY is a secret and is NEVER committed — supply it in
// the environment when you want the full end-to-end email-OTP tests to run
// (those that create and delete real users). Without it, only the checks that
// need no privileged access run; the rest are skipped with a clear message.

import { config } from "dotenv";
import { resolve } from "node:path";

// dotenv does not override already-set vars, so the first file loaded wins:
//   .env.local  — developer machine (gitignored), takes precedence
//   .env.test   — committed public URL + anon key, so CI needs no setup
//   .env        — last-ditch fallback
config({ path: resolve(__dirname, "../.env.local") });
config({ path: resolve(__dirname, "../.env.test") });
config({ path: resolve(__dirname, "../.env") });
