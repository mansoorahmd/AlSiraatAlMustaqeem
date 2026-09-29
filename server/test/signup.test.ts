// Open sign-up (signup.ts). What must hold: the profile is checked before any account exists
// (a real past date of birth, a plausible age, a country code, an optional gender); a new account
// is a READER on the FREE plan whatever the request says; the profile lands on the account and
// the admin list shows it; and one address can't mint accounts in bulk.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runMigrations, type SqlRunner } from "../src/migrate.js";
import { ageOn, validProfile, saveProfile, signupLimiter, SignupError } from "../src/signup.js";
import { listUsers } from "../src/admin.js";
import { pgliteRunner } from "./fixtures/corpus-fixture.js";

const MIGR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const TODAY = new Date(Date.UTC(2026, 8, 29)); // 2026-09-29
let r: SqlRunner;

beforeAll(async () => {
  r = pgliteRunner().r;
  await runMigrations(r, MIGR);
});
beforeEach(async () => { await r.exec("DELETE FROM users;"); });

const refused = (body: Record<string, unknown>) => {
  try { validProfile(body, TODAY); } catch (e) { return e instanceof SignupError ? e.message : "other"; }
  return null;
};

describe("sign-up profile", () => {
  it("derives age from the date of birth, counting the birthday itself", () => {
    expect(ageOn("2000-09-29", TODAY)).toBe(26);
    expect(ageOn("2000-09-30", TODAY)).toBe(25);
    expect(ageOn("2000-10-01", TODAY)).toBe(25);
  });

  it("accepts a real profile, normalising region and gender", () => {
    expect(validProfile({ birthDate: "1990-02-28", region: "pk", gender: "Female" }, TODAY))
      .toEqual({ birthDate: "1990-02-28", region: "PK", gender: "female" });
  });

  it("gender is optional", () => {
    expect(validProfile({ birthDate: "1990-02-28", region: "GB" }, TODAY).gender).toBeNull();
    expect(validProfile({ birthDate: "1990-02-28", region: "GB", gender: "" }, TODAY).gender).toBeNull();
  });

  it("refuses impossible, future and implausible dates of birth", () => {
    expect(refused({ birthDate: "2001-02-30", region: "PK" })).toMatch(/real date/);
    expect(refused({ birthDate: "29/09/2001", region: "PK" })).toMatch(/real date/);
    expect(refused({ birthDate: "2027-01-01", region: "PK" })).toMatch(/age/);
    expect(refused({ birthDate: "1890-01-01", region: "PK" })).toMatch(/age/);
  });

  it("refuses a missing region and an unknown gender", () => {
    expect(refused({ birthDate: "1990-01-01" })).toMatch(/region/);
    expect(refused({ birthDate: "1990-01-01", region: "Pakistan" })).toMatch(/region/);
    expect(refused({ birthDate: "1990-01-01", region: "PK", gender: "x" })).toMatch(/gender/);
  });

  it("a new account is a free reader, and its profile reaches the admin list", async () => {
    // Better Auth's signUpEmail inserts the users row; its defaults are what /signup relies on
    const [u] = (await r.query("INSERT INTO users (email) VALUES ('new@x.org') RETURNING id")) as [{ id: string }];
    await saveProfile(r, u.id, validProfile({ birthDate: "1995-06-15", region: "sa" }, TODAY));
    const [row] = await listUsers(r);
    expect(row).toMatchObject({
      email: "new@x.org", role: "reader", plan: "free",
      birthDate: "1995-06-15", region: "SA", gender: null,
    });
  });

  it("the database rejects a malformed region or gender outright", async () => {
    const [u] = (await r.query("INSERT INTO users (email) VALUES ('db@x.org') RETURNING id")) as [{ id: string }];
    await expect(r.query("UPDATE users SET region = 'pk' WHERE id = $1", [u.id])).rejects.toThrow();
    await expect(r.query("UPDATE users SET gender = 'other' WHERE id = $1", [u.id])).rejects.toThrow();
  });
});

describe("sign-up rate limit", () => {
  it("allows a few per address per window, then refuses until it passes", () => {
    const allow = signupLimiter(3, 1000);
    expect([allow("a", 0), allow("a", 1), allow("a", 2), allow("a", 3)]).toEqual([true, true, true, false]);
    expect(allow("b", 3)).toBe(true);        // another address is unaffected
    expect(allow("a", 1001)).toBe(true);     // the first hit has aged out
  });
});
