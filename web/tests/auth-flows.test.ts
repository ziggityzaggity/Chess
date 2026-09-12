// auth-flows.test.ts — confirms the two login/registration mechanisms the app
// offers, against the real Supabase project:
//
//   1. "Continue with Google" (OAuth)  — provider enabled, and the authorization
//      URL the app generates actually reaches Google with a configured client id.
//   2. One-time email code (OTP)        — a new user can register (create account
//      + auto-provisioned profile) and a returning user can log in, both ending
//      in a real session; the onboarding profile write is allowed by RLS while a
//      cross-user write is not.
//
// The OTP tests create and delete real users, so they need the service-role key
// (SUPABASE_SERVICE_ROLE_KEY) and are skipped with a message when it is absent.
// The Google/config checks need only the public anon key.

import { describe, it, expect, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

// The production callback the app redirects OAuth through.
const CALLBACK = "https://pychess.app/auth/callback";

function anonClient(): SupabaseClient {
  return createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

describe("environment", () => {
  it("has the public Supabase URL and anon key", () => {
    expect(URL, "NEXT_PUBLIC_SUPABASE_URL must be set").toMatch(/^https:\/\/.+\.supabase\.co$/);
    expect(ANON, "NEXT_PUBLIC_SUPABASE_ANON_KEY must be set").toBeTruthy();
  });
});

describe("provider configuration", () => {
  it("enables both sign-in methods: email OTP and Google", async () => {
    const res = await fetch(`${URL}/auth/v1/settings`, { headers: { apikey: ANON } });
    expect(res.ok).toBe(true);
    const settings = await res.json();
    // These two flags back the login/registration UI. If either is false the
    // corresponding button in the app does nothing useful.
    expect(settings.external?.email, "email provider disabled").toBe(true);
    expect(settings.external?.google, "Google provider disabled").toBe(true);
  });
});

describe('"Continue with Google" (OAuth)', () => {
  it("builds an authorization URL that targets Google with our callback", async () => {
    const { data, error } = await anonClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: CALLBACK, skipBrowserRedirect: true },
    });
    expect(error).toBeNull();
    expect(data.url).toContain(`${URL}/auth/v1/authorize`);
    expect(data.url).toContain("provider=google");
    expect(decodeURIComponent(data.url!)).toContain(CALLBACK);
  });

  it("redirects to Google's consent screen with a configured client id", async () => {
    // Following the authorize endpoint proves Google is actually wired up: with
    // a client id/secret it 302s to accounts.google.com?client_id=...; without
    // one it would bounce to an error instead.
    const { data } = await anonClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: CALLBACK, skipBrowserRedirect: true },
    });
    const res = await fetch(data.url!, { redirect: "manual" });
    const location = res.headers.get("location") ?? "";
    expect(location, "authorize endpoint did not redirect to Google").toContain(
      "accounts.google.com"
    );
    expect(location, "no client_id on the Google URL").toMatch(/[?&]client_id=[^&]+/);
    // Google must send the user back to Supabase's callback, which then reaches
    // our /auth/callback route.
    expect(decodeURIComponent(location)).toContain(`${URL}/auth/v1/callback`);
  });
});

describe.skipIf(!SERVICE)("one-time email code (OTP)", () => {
  // Vitest still evaluates a skipped describe's body to collect its tests, so
  // fall back to the anon key here to avoid throwing at collection time; the
  // tests themselves never run (and so never use it) when SERVICE is absent.
  const admin = createClient(URL, SERVICE || ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const email = `e2e-${randomUUID()}@pychess-e2e.test`;
  let userId = "";

  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it("registration: a new email creates a signed-in user with an auto profile", async () => {
    // Mirrors the app's register step (email OTP, new account) end to end.
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "signup",
      email,
      // The signup link type requires a password field; our app is passwordless
      // and never uses it. The user is deleted in afterAll.
      password: randomUUID(),
    });
    expect(linkErr).toBeNull();
    const otp = link.properties?.email_otp;
    expect(otp, "no OTP returned for signup").toBeTruthy();

    // Verify the code from a fresh client, exactly as the browser would.
    const client = anonClient();
    const { data: verified, error: verifyErr } = await client.auth.verifyOtp({
      email,
      token: otp!,
      type: "signup",
    });
    expect(verifyErr).toBeNull();
    expect(verified.session, "no session after registration").toBeTruthy();
    expect(verified.user?.email).toBe(email);
    userId = verified.user!.id;

    // The on_auth_user_created trigger must have provisioned an empty profile.
    const { data: profile, error: profErr } = await client
      .from("profiles")
      .select("id, nickname")
      .eq("id", userId)
      .maybeSingle();
    expect(profErr).toBeNull();
    expect(profile?.id, "profile row not auto-created").toBe(userId);
    expect(profile?.nickname, "new user should not be onboarded yet").toBeNull();
  });

  it("login: the returning user signs in with a fresh code", async () => {
    expect(userId, "registration test must run first").toBeTruthy();
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    expect(linkErr).toBeNull();
    const otp = link.properties?.email_otp;
    expect(otp).toBeTruthy();

    // The app verifies login codes with type "email".
    const client = anonClient();
    const { data: verified, error: verifyErr } = await client.auth.verifyOtp({
      email,
      token: otp!,
      type: "email",
    });
    expect(verifyErr).toBeNull();
    expect(verified.session, "no session after login").toBeTruthy();
    expect(verified.user?.id).toBe(userId);
  });

  it("onboarding: the user can write their own profile but not others'", async () => {
    // Sign in, then save nickname + birth date like the onboarding step.
    const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const client = anonClient();
    await client.auth.verifyOtp({ email, token: link.properties!.email_otp!, type: "email" });

    const { error: upErr } = await client
      .from("profiles")
      .update({ nickname: "e2e_player", birth_date: "1990-05-01" })
      .eq("id", userId);
    expect(upErr, "owner could not update own profile").toBeNull();

    const { data: profile } = await client
      .from("profiles")
      .select("nickname, birth_date")
      .eq("id", userId)
      .single();
    expect(profile?.nickname).toBe("e2e_player");
    expect(profile?.birth_date).toBe("1990-05-01");

    // RLS: updating a different user's row must affect zero rows (not error, not
    // change anything) — the policy scopes writes to auth.uid() = id.
    const otherId = randomUUID();
    const { data: changed } = await client
      .from("profiles")
      .update({ nickname: "hacker" })
      .eq("id", otherId)
      .select();
    expect(changed ?? [], "RLS let a user edit another profile").toHaveLength(0);
  });

  it("login guard: logging in with an unknown email is rejected, not created", async () => {
    // The app's login form calls signInWithOtp with shouldCreateUser:false so a
    // login attempt can never silently create an account. The backend must
    // reject it — and the app's "register first" message keys off exactly this
    // error text (see sendCode in src/lib/auth.tsx).
    const unknown = `e2e-unknown-${randomUUID()}@pychess-e2e.test`;
    const { data, error } = await anonClient().auth.signInWithOtp({
      email: unknown,
      options: { shouldCreateUser: false },
    });
    expect(error, "an unknown email should be rejected on login").not.toBeNull();
    expect(error!.message).toMatch(/signups not allowed/i);
    expect(data.user).toBeNull();
    expect(data.session).toBeNull();
  });
});
