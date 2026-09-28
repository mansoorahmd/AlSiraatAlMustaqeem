// Personal API tokens — how the MCP acts as its user. What must hold: the secret is shown once and
// never stored or listed; a token resolves to its owner; a revoked, malformed or unknown token
// resolves to nobody; you can only revoke your OWN tokens. Against real Postgres (PGlite).

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runMigrations, type SqlRunner } from "../src/migrate.js";
import { createToken, listTokens, revokeToken, userForToken, TOKEN_PREFIX } from "../src/api-tokens.js";
import { pgliteRunner } from "./fixtures/corpus-fixture.js";

const MIGR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
let r: SqlRunner;
let amina: string, bilal: string;

beforeAll(async () => {
  r = pgliteRunner().r;
  await runMigrations(r, MIGR);
});

beforeEach(async () => {
  await r.exec("DELETE FROM api_tokens; DELETE FROM users;");
  const rows = await r.query(
    `INSERT INTO users (email) VALUES ('amina@x.org'), ('bilal@x.org') RETURNING id, email`);
  amina = String(rows.find((u) => u.email === "amina@x.org")!.id);
  bilal = String(rows.find((u) => u.email === "bilal@x.org")!.id);
});

describe("api tokens", () => {
  it("mints a token that resolves to its owner", async () => {
    const t = await createToken(r, amina, "my MCP");
    expect(t.token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(t.token.length).toBeGreaterThan(40);
    expect(await userForToken(r, t.token)).toBe(amina);
  });

  it("stores only a hash — the secret is nowhere in the database", async () => {
    const t = await createToken(r, amina, "x");
    const rows = await r.query("SELECT * FROM api_tokens");
    expect(JSON.stringify(rows)).not.toContain(t.token);
  });

  it("lists a user's tokens without the secret, newest first", async () => {
    await createToken(r, amina, "first");
    const second = await createToken(r, amina, "second");
    const list = await listTokens(r, amina);
    expect(list.map((t) => t.label)).toEqual(["second", "first"]);
    expect(JSON.stringify(list)).not.toContain(second.token);
    expect(list[0]!.prefix).toBe(second.token.slice(0, TOKEN_PREFIX.length + 6));
  });

  it("a revoked token stops working at once", async () => {
    const t = await createToken(r, amina, "x");
    expect(await revokeToken(r, amina, t.id)).toBe(true);
    expect(await userForToken(r, t.token)).toBeNull();
    expect((await listTokens(r, amina))[0]!.revokedAt).not.toBeNull();
  });

  it("you can't revoke someone else's token", async () => {
    const t = await createToken(r, amina, "x");
    expect(await revokeToken(r, bilal, t.id)).toBe(false);
    expect(await userForToken(r, t.token)).toBe(amina);
  });

  it("unknown or malformed tokens resolve to nobody", async () => {
    expect(await userForToken(r, "mqrg_" + "a".repeat(43))).toBeNull();
    expect(await userForToken(r, "not-a-token")).toBeNull();
    expect(await userForToken(r, "mqrg_short")).toBeNull();
  });

  it("notes when a token was last used", async () => {
    const t = await createToken(r, amina, "x");
    expect((await listTokens(r, amina))[0]!.lastUsedAt).toBeNull();
    await userForToken(r, t.token);
    expect((await listTokens(r, amina))[0]!.lastUsedAt).not.toBeNull();
  });
});
