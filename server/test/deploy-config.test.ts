// A production server refuses to start on an unsafe or broken environment (config.ts), and the
// reset page carries the headers that keep its one-time token private.

import { describe, it, expect } from "vitest";
import { deployProblems } from "../src/config.js";
import { RESET_PAGE, RESET_PAGE_HEADERS } from "../src/reset-page.js";

const good = {
  AUTH_SECRET: "x".repeat(48),
  DATABASE_URL: "postgres://mqrg:pw@db:5432/researchgate",
  REMOTE_BASE_URL: "https://research.example.org",
  EMAIL_TRANSPORT: "smtp",
  SMTP_HOST: "smtp.example.org",
  SMTP_FROM: "MQRG <no-reply@example.org>",
};

describe("deployable configuration", () => {
  it("a complete environment passes", () => {
    expect(deployProblems(good)).toEqual([]);
  });

  it("names every problem, so one fix-up round is enough", () => {
    const p = deployProblems({ EMAIL_TRANSPORT: "smtp" });
    expect(p.join("\n")).toMatch(/AUTH_SECRET is not set/);
    expect(p.join("\n")).toMatch(/DATABASE_URL/);
    expect(p.join("\n")).toMatch(/REMOTE_BASE_URL must be the public https/);
    expect(p.join("\n")).toMatch(/SMTP_HOST/);
    expect(p.join("\n")).toMatch(/SMTP_FROM/);
  });

  it("refuses the dev secret, a short secret, plain http and an unknown transport", () => {
    expect(deployProblems({ ...good, AUTH_SECRET: "dev-only-insecure-secret-change-me" })[0]).toMatch(/not set/);
    expect(deployProblems({ ...good, AUTH_SECRET: "short" })[0]).toMatch(/shorter than 32/);
    expect(deployProblems({ ...good, REMOTE_BASE_URL: "http://research.example.org" })[0]).toMatch(/https/);
    expect(deployProblems({ ...good, EMAIL_TRANSPORT: "carrier-pigeon" })[0]).toMatch(/smtp or console/);
  });

  it("console email is allowed (resets are then only printed to the log)", () => {
    expect(deployProblems({ ...good, EMAIL_TRANSPORT: "console", SMTP_HOST: "", SMTP_FROM: "" })).toEqual([]);
  });
});

describe("the reset page", () => {
  it("never leaks its token: no referrer, no caching, nothing external", () => {
    expect(RESET_PAGE_HEADERS["referrer-policy"]).toBe("no-referrer");
    expect(RESET_PAGE_HEADERS["cache-control"]).toBe("no-store");
    expect(RESET_PAGE_HEADERS["content-security-policy"]).toMatch(/default-src 'none'.*connect-src 'self'/);
    expect(RESET_PAGE).not.toMatch(/https?:\/\//);          // no external assets at all
    expect(RESET_PAGE).toMatch(/history\.replaceState/);    // the token leaves the address bar
  });
});
