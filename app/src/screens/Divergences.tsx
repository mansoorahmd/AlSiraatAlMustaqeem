// ⚖ Where I stand apart — forms I have established whose meaning differs from the group's.
//
// This is the most valuable list in the app, and the clearest expression of what the whole
// design is for: it is NOT a conflict to resolve. Both readings are shown, side by side, and
// neither is changed. You may adopt theirs, keep yours, or simply know that you differ — that
// last one is a legitimate, permanent outcome.

import { useCallback, useEffect, useState } from "react";
import { group, type Divergence, type GroupState } from "../persistence/db";
import { remote, RemoteOffline } from "../api/remote";
import { useAppDispatch } from "../state/store";

const spaced = (r: string) => r.split("").join(" ");

/**
 * An empty list has four quite different causes, and saying only "nothing" reads as breakage.
 * Each branch names the ONE thing missing, so the reader knows whether to act or to be content.
 */
function explainEmpty(st: GroupState | null): string {
  if (!st) return "Loading…";
  if (st.cursor === 0) return "Nothing pulled yet. Sync to see what the group has established.";
  if (st.theirs === 0) {
    return "Synced — the group hasn't established any readings yet, so there is nothing to compare against.";
  }
  if (st.mine === 0) {
    return `Synced. The group holds ${st.theirs} reading${st.theirs === 1 ? "" : "s"}, but you haven't established any form meanings of your own yet — establish one in a case and it will be compared here.`;
  }
  if (st.overlap === 0) {
    return `Synced. You and the group have both settled meanings, but not for any of the same forms yet — no overlap, so nothing to compare.`;
  }
  return `Your established meanings agree with the group's on all ${st.overlap} form${st.overlap === 1 ? "" : "s"} you have both settled.`;
}

export function Divergences() {
  const dispatch = useAppDispatch();
  const [rows, setRows] = useState<Divergence[]>([]);
  const [st, setSt] = useState<GroupState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [d, s] = await Promise.all([group.divergences(), group.state()]);
      setRows(d); setSt(s);
    } catch (e) { setErr((e as Error).message); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /** Fetch pages from the remote and hand each to the local server to apply. */
  const sync = async () => {
    setBusy(true); setErr(null); setNote(null);
    try {
      let { cursor } = await group.state();
      let forms = 0, dissents = 0, peers = 0, pages = 0;
      for (;;) {
        const page = await remote.pull(cursor);
        const applied = await group.apply(page);
        forms += applied.globalForms; dissents += applied.dissents;
        peers += applied.peerIndications;
        cursor = applied.cursor; pages++;
        if (!page.more || pages > 50) break;      // guard against a runaway loop
      }
      const n = (c: number, one: string) => `${c} ${one}${c === 1 ? "" : "s"}`;
      setNote(
        `Received ${n(forms, "established reading")}, ${n(peers, "community indication")} and ${n(dissents, "dissent")}.`);
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
              <span className="resume-ayah">
                {" "}· {st?.groupReadings ?? 0} group reading{st?.groupReadings === 1 ? "" : "s"} held
              </span>
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
          <p className="home-empty">{explainEmpty(st)}</p>
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
