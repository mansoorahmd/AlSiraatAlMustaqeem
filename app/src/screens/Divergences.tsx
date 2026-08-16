// ⚖ Where I stand apart — forms I have established whose meaning differs from the group's.
//
// This is the most valuable list in the app, and the clearest expression of what the whole
// design is for: it is NOT a conflict to resolve. Both readings are shown, side by side, and
// neither is changed. You may adopt theirs, keep yours, or simply know that you differ — that
// last one is a legitimate, permanent outcome.

import { useCallback, useEffect, useState } from "react";
import { group, type Divergence } from "../persistence/db";
import { remote, RemoteOffline } from "../api/remote";
import { useAppDispatch } from "../state/store";

const spaced = (r: string) => r.split("").join(" ");

export function Divergences() {
  const dispatch = useAppDispatch();
  const [rows, setRows] = useState<Divergence[]>([]);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [d, s] = await Promise.all([group.divergences(), group.state()]);
      setRows(d); setCount(s.groupReadings);
    } catch (e) { setErr((e as Error).message); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /** Fetch pages from the remote and hand each to the local server to apply. */
  const sync = async () => {
    setBusy(true); setErr(null); setNote(null);
    try {
      let { cursor } = await group.state();
      let forms = 0, dissents = 0, pages = 0;
      for (;;) {
        const page = await remote.pull(cursor);
        const applied = await group.apply(page);
        forms += applied.globalForms; dissents += applied.dissents;
        cursor = applied.cursor; pages++;
        if (!page.more || pages > 50) break;      // guard against a runaway loop
      }
      setNote(`Received ${forms} reading${forms === 1 ? "" : "s"} and ${dissents} dissent${dissents === 1 ? "" : "s"}.`);
      await refresh();
    } catch (e) {
      setErr(e instanceof RemoteOffline
        ? "The research server isn't reachable — you may be offline, or not signed in."
        : (e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="sheet home">
      <header className="home-hero">
        <div className="resume" style={{ cursor: "default" }}>
          <span className="resume-body">
            <span className="resume-label">Where I stand apart</span>
            <span className="resume-ref">
              {rows.length} form{rows.length === 1 ? "" : "s"}
              <span className="resume-ayah"> · {count} group reading{count === 1 ? "" : "s"} held</span>
            </span>
          </span>
          <button className="ctl primary" disabled={busy} onClick={sync}>
            {busy ? "Syncing…" : "Sync with the group"}
          </button>
        </div>
        {note && <p className="acct-hint">{note}</p>}
        {err && <p className="acct-error" role="alert">{err}</p>}
      </header>

      {rows.length === 0 ? (
        <section className="home-card">
          <p className="home-empty">
            {count === 0
              ? "Nothing pulled yet. Sync to see what the group has established."
              : "Your established meanings agree with the group's, everywhere they overlap."}
          </p>
        </section>
      ) : (
        <section className="home-card">
          <h2 className="home-card-title">Your reading · the group's</h2>
          <ul className="home-list">
            {rows.map((d) => (
              <li key={d.lemma} className="diverge">
                <button
                  className="diverge-word quran"
                  title="Open the case where you established it"
                  onClick={() => {
                    if (d.caseId) {
                      dispatch({ type: "setActiveCase", caseId: d.caseId });
                      dispatch({ type: "setTab", tab: "investigate" });
                    }
                  }}
                >
                  {d.lemma}
                  {d.root && <span className="diverge-root">{spaced(d.root)}</span>}
                </button>

                <div className="diverge-readings">
                  <p className="diverge-mine"><span className="diverge-tag">mine</span>{d.mine}</p>
                  <p className="diverge-theirs">
                    <span className="diverge-tag">group</span>{d.theirs}
                    {d.dissents > 0 && (
                      <span className="diverge-dissent" title="objections filed against the group's reading">
                        {d.dissents} dissent{d.dissents === 1 ? "" : "s"}
                      </span>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <p className="acct-hint">
            Nothing here needs resolving. Your establishment is your own dated record of what you
            held; the group's is theirs. They may differ permanently.
          </p>
        </section>
      )}
    </div>
  );
}
