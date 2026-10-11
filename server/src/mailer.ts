// Outgoing email — password resets and magic links. Two transports (config.ts):
//   console  the message is printed to the server log (development; nothing is sent)
//   smtp     sent through any SMTP server (Workspace, Microsoft 365, Mailgun, SES, Postmark…)

import nodemailer, { type Transporter } from "nodemailer";
import { config } from "./config.js";

export interface Mail { to: string; subject: string; text: string; html?: string }

let smtp: Transporter | null = null;
function transport(): Transporter {
  smtp ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return smtp;
}

export async function sendMail(m: Mail): Promise<void> {
  if (config.emailTransport !== "smtp") {
    console.log(`\n[email to ${m.to}] ${m.subject}\n${m.text}\n`);
    return;
  }
  await transport().sendMail({ from: config.smtp.from, to: m.to, subject: m.subject, text: m.text, html: m.html });
}

/** Check the SMTP settings at startup, so a typo shows in the log now, not at the first reset. */
export async function verifyMailer(): Promise<void> {
  if (config.emailTransport !== "smtp") return;
  try {
    await transport().verify();
    console.log(`email: SMTP ready (${config.smtp.host}:${config.smtp.port})`);
  } catch (e) {
    console.error(`email: SMTP not working — password resets will fail (${(e as Error).message})`);
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The password-reset email. `url` is Better Auth's one-time link. */
export function resetEmail(to: string, url: string): Mail {
  return {
    to,
    subject: "Reset your MQ Research Gate password",
    text: `Someone (hopefully you) asked to reset the password for ${to}.\n\n` +
      `Choose a new one here — the link works once, for one hour:\n${url}\n\n` +
      `If you didn't ask, ignore this email; your password stays as it is.`,
    html: `<p>Someone (hopefully you) asked to reset the password for <b>${esc(to)}</b>.</p>` +
      `<p><a href="${esc(url)}">Choose a new password</a> — the link works once, for one hour.</p>` +
      `<p style="color:#666">If you didn't ask, ignore this email; your password stays as it is.</p>`,
  };
}

export function magicLinkEmail(to: string, url: string): Mail {
  return {
    to,
    subject: "Your MQ Research Gate sign-in link",
    text: `Sign in to MQ Research Gate (the link works once, for 15 minutes):\n${url}`,
    html: `<p><a href="${esc(url)}">Sign in to MQ Research Gate</a> — the link works once, for 15 minutes.</p>`,
  };
}
