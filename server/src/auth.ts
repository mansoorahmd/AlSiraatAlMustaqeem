// Better Auth — AUTHENTICATION only (identity + sessions + magic-link tokens).
// Authorization (`users.role`) and the domain link (`users.local_id`) are ours and are
// deliberately NOT declared to Better Auth: our session middleware reads them straight from
// the users table. "Buy authentication, build authorization" (SHARED_RESEARCH.md §4).
//
// Accounts are created by our own code only, never by Better Auth (`disableSignUp: true`): open
// sign-up (POST /signup, src/signup.ts) makes a free reader, and redeeming an invite
// (src/invites.ts) makes an account with the invite's role.

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
  // browser and sign THAT in). Better Auth's own /sign-up/email route is blocked in app.ts; the only
  // callers of signUpEmail are /signup and the invite redemption endpoint.
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    autoSignIn: false,          // redeeming an invite shouldn't silently sign you in
    requireEmailVerification: false, // not yet: open sign-up doesn't verify the email address
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
      // A magic link only signs in an existing account; it never creates one.
      disableSignUp: true,
      expiresIn: 60 * 15,
      sendMagicLink: async ({ email, url }: { email: string; url: string }) => {
        // `disableSignUp` only stops account creation at VERIFY time, so Better Auth would
        // still issue a link for any address typed in. A link can't create an account, so refuse
        // to send unless an account already exists — otherwise this is a spam vector and the
        // reader gets a link that silently fails later. We stay quiet about which addresses
        // exist (the API response is identical either way).
        const { rowCount } = await pool.query("SELECT 1 FROM users WHERE email = $1", [
          email.trim().toLowerCase(),
        ]);
        if (!rowCount) {
          console.log(`[magic-link] not sent: no account for ${email}`);
          return;
        }
        await sendMail(magicLinkEmail(email, url));   // console transport: printed to the log
      },
    }),
  ],
});

export type Auth = typeof auth;
