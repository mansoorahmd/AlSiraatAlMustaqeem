// Better Auth — AUTHENTICATION only (identity + sessions + magic-link tokens).
// Authorization (`users.role`) and the domain link (`users.local_id`) are ours and are
// deliberately NOT declared to Better Auth: our session middleware reads them straight from
// the users table. "Buy authentication, build authorization" (SHARED_RESEARCH.md §4).
//
// Invite-only is enforced two ways: `disableSignUp: true` means Better Auth will never create
// a user, and the only path that creates one is redeemInvite() (src/invites.ts).

import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { pool } from "./db.js";
import { config, crossSiteCookies } from "./config.js";
import { sendMail, resetEmail, magicLinkEmail } from "./mailer.js";

export const auth = betterAuth({
  database: pool,
  baseURL: config.baseUrl,
  secret: config.authSecret,
  trustedOrigins: config.trustedOrigins,

  // map Better Auth's identity model onto our snake_case `users` table
  user: {
    modelName: "users",
    fields: {
      name: "display_name",
      emailVerified: "email_verified",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  session: { modelName: "session", fields: { userId: "user_id", expiresAt: "expires_at", ipAddress: "ip_address", userAgent: "user_agent", createdAt: "created_at", updatedAt: "updated_at" },
    // sign in once, then work offline indefinitely: a long session, refreshed on use
    expiresIn: 60 * 60 * 24 * 365,
    updateAge: 60 * 60 * 24 * 7,
  },
  account: {
    modelName: "account",
    fields: {
      userId: "user_id", accountId: "account_id", providerId: "provider_id",
      accessToken: "access_token", refreshToken: "refresh_token",
      accessTokenExpiresAt: "access_token_expires_at",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      idToken: "id_token", createdAt: "created_at", updatedAt: "updated_at",
    },
  },
  verification: {
    modelName: "verification",
    fields: { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at" },
  },

  // Passwords are the everyday sign-in: no email transport needed, and on the desktop the app
  // can post credentials and get a session directly (a magic link would open in the system
  // browser and sign THAT in). Registration stays invite-only — the public /sign-up/email route
  // is blocked in app.ts, and the only caller of signUpEmail is the invite redemption endpoint.
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    autoSignIn: false,          // redeeming an invite shouldn't silently sign you in
    requireEmailVerification: false, // accounts come from invites, so the address is already vouched for
    // Forgotten password: POST /api/auth/request-password-reset {email, redirectTo} emails a
    // one-time link; it lands on this server's own /reset-password page (app.ts), which sets the
    // new password. Better Auth only sends when the account exists, and answers the same either
    // way, so it doesn't reveal who has an account.
    sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
      await sendMail(resetEmail(user.email, url));
    },
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,  // a reset signs out every other device
  },

  advanced: {
    // Over HTTPS the app (on the reader's localhost) and this server are different sites, so the
    // session cookie must be SameSite=None; Secure to be sent at all (config.ts).
    ...(crossSiteCookies
      ? { useSecureCookies: true, defaultCookieAttributes: { sameSite: "none" as const, secure: true } }
      : {}),
    database: {
      // Postgres mints the users uuid (gen_random_uuid); Better Auth generates the
      // text ids for its own session/account/verification rows.
      generateId: ({ model }: { model: string }) =>
        model === "users" || model === "user" ? false : crypto.randomUUID(),
    },
  },

  plugins: [
    magicLink({
      // Registration is invite-only: an invite must already have created the user.
      disableSignUp: true,
      expiresIn: 60 * 15,
      sendMagicLink: async ({ email, url }: { email: string; url: string }) => {
        // `disableSignUp` only stops account creation at VERIFY time, so Better Auth would
        // still issue a link for any address typed in. Registration is invite-only, so refuse
        // to send unless an account already exists — otherwise this is a spam vector and the
        // reader gets a link that silently fails later. We stay quiet about which addresses
        // exist (the API response is identical either way).
        const { rowCount } = await pool.query("SELECT 1 FROM users WHERE email = $1", [
          email.trim().toLowerCase(),
        ]);
        if (!rowCount) {
          console.log(`[magic-link] not sent — no account for ${email} (invite-only)`);
          return;
        }
        await sendMail(magicLinkEmail(email, url));   // console transport: printed to the log
      },
    }),
  ],
});

export type Auth = typeof auth;
