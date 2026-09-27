// Everything you configure, in one place — reached from the top bar, as people expect.
//
// It used to live on Home, which turned the workbench into a settings page. Home is now for
// what you're in the middle of; this is for how the app behaves and where your work is kept.

import { useRef, useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useMe } from "../hooks/useMe";
import { Preferences } from "./Preferences";
import { fetchIdentity, myResearch, type ImportReport } from "../persistence/db";

const NAMES: Record<string, [string, string]> = {
  cases: ["case", "cases"], notes: ["note or question", "notes & questions"],
  word_indications: ["indication", "indications"], motifs: ["motif", "motifs"], trails: ["trail", "trails"],
  compare_sets: ["comparison", "comparisons"], user_root_meanings: ["root meaning", "root meanings"],
};
/** "12 notes & questions, 3 cases" — only what actually arrived. */
function describe(r: ImportReport): string {
  const parts = Object.entries(r.tables)
    .filter(([t, n]) => NAMES[t] && n.copied > 0)
    .map(([t, n]) => `${n.copied} ${NAMES[t]![n.copied === 1 ? 0 : 1]}`);
  return parts.length ? parts.join(", ") : "nothing new — it was all here already";
}

/** Save a Blob under a filename — the ordinary browser download. */
function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

/**
 * Your research: kept privately in your account on the research server. A copy out whenever you
 * like; research brought in from this computer's old research.db, or from a file.
 */
function YourResearch() {
  const { me } = useMe();
  const local = useAsync(() => myResearch.localFile(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [broughtIn, setBroughtIn] = useState(false);   // the offer goes once it's been taken
  const picker = useRef<HTMLInputElement>(null);

  const run = async (what: string, fn: () => Promise<string>) => {
    setBusy(what); setErr(null); setDone(null);
    try { setDone(await fn()); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const bring = (read: () => Promise<Blob>, localPath?: string) => run("import", async () => {
    const report = await myResearch.importFile(await read());
    if (localPath) await myResearch.markBroughtIn(localPath);
    setBroughtIn(true);
    return `Brought in: ${describe(report)}. Reload to see it everywhere.`;
  });

  if (!me) {
    return <p className="acct-hint">Sign in (Account, top right) to see your research — it’s kept in your account.</p>;
  }
  return (
    <>
      <p className="acct-hint">
        Kept privately in your account on the research server — nobody else can see it. Only what
        you publish is shared, and only once it’s approved.
      </p>

      {local.data && !broughtIn && (
        <div className="settings-callout">
          <strong>This computer has research from before.</strong>
          <span className="acct-hint">
            A research.db{local.data.owner ? ` (${local.data.owner.email})` : ""} is still on this
            computer. Bring it into your account — nothing in your account is overwritten, and the
            file itself stays exactly as it is.
          </span>
          <div className="acct-actions">
            <button className="ctl primary" disabled={!!busy} onClick={() => bring(local.data!.read, local.data!.path)}>
              {busy === "import" ? "Bringing it in…" : "Bring it into my account"}
            </button>
          </div>
        </div>
      )}

      <div className="acct-actions">
        <button className="ctl" disabled={!!busy}
          onClick={() => run("download", async () => {
            const { blob, filename } = await myResearch.download();
            save(blob, filename);
            return `Downloaded ${filename} (${(blob.size / 1024).toFixed(0)} KB) — a complete copy you can open in any SQLite tool, or bring back in later.`;
          })}>
          {busy === "download" ? "Preparing…" : "Download a copy"}
        </button>
        <button className="ctl" disabled={!!busy} onClick={() => picker.current?.click()}>
          Import a research.db…
        </button>
        <input ref={picker} type="file" accept=".db,application/vnd.sqlite3,application/x-sqlite3" hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void bring(async () => f);
          }} />
      </div>
      {done && <p className="acct-ok" role="status">{done}</p>}
      {err && <p className="acct-error" role="alert">{err}</p>}
    </>
  );
}

export function SettingsSheet() {
  const identity = useAsync(() => fetchIdentity().catch(() => null), []);
  const health = useAsync(() => api.health(), []);

  return (
    <div className="acct">
      <section className="settings-group">
        <h3>Reading</h3>
        <Preferences />
      </section>

      <section className="settings-group">
        <h3>Your research</h3>
        <YourResearch />
      </section>

      <section className="settings-group">
        <h3>About</h3>
        <div className="acct-row">
          <span className="acct-row-label">This app</span>
          <span className="acct-row-value">
            <span className={`dot ${health.loading ? "" : health.error ? "error" : "ok"}`} />{" "}
            {health.loading ? "connecting…"
              : health.error ? "unreachable"
              : `running · v${health.data?.version ?? "?"}`}
          </span>
        </div>
        {identity.data && (
          <div className="acct-row">
            <span className="acct-row-label">Your id</span>
            <span className="acct-row-value acct-muted" title={identity.data.localId}>
              <code>{identity.data.localId.slice(0, 8)}…</code>
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
