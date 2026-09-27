// ⚖ Where I stand apart — forms I have established whose meaning differs from the group's.
//
// This is the most valuable list in the app, and the clearest expression of what the whole
// design is for: it is NOT a conflict to resolve. Both readings are shown, side by side, and
// neither is changed. You may adopt theirs, keep yours, or simply know that you differ — that
// last one is a legitimate, permanent outcome.
//
// Monetization: the group's readings are a PAID, ONLINE layer. Nothing of theirs is stored
// locally; this screen computes divergence live on the remote (your established forms diffed
// against the group's current readings). Signed out, unpaid, or offline, it says so and shows
// nothing of the group's — your own established meanings are untouched and remain fully offline.

import { useCallback, useEffect, useState } from "react";
import { group, type Divergence, type GroupState } from "../persistence/db";
import { RemoteOffline, RemoteError } from "../api/remote";
import { useAppDispatch } from "../state/store";

const spaced = (r: string) => r.split("").join(" "); // nbsp: root letters must not wrap (ه د ي)

/**
 * An empty list has several quite different causes, and saying only "nothing" reads as breakage.
 * Each branch names the ONE thing missing, so the reader knows whether to act or to be content.
 */
function explainEmpty(st: GroupState | null): string {
  if (!st) return "Loading…";
  if (st.theirs === 0) {
    return "The group hasn't established any readings yet, so there is nothing to compare against.";
  }
  if (st.mine === 0) {
    return `The group holds ${st.theirs} reading${st.theirs === 1 ? "" : "s"}, but you haven't established any form meanings of your own yet — establish one in a case and it will be compared here.`;
  }
  if (st.overlap === 0) {
    return "You and the group have both settled meanings, but not for any of the same forms yet — no overlap, so nothing to compare.";
  }
  return `Your established meanings agree with the group's on all ${st.overlap} form${st.overlap === 1 ? "" : "s"} you have both settled.`;
}

export function Divergences() {
  const dispatch = useAppDispatch();
  const [rows, setRows] = useState<Divergence[]>([]);
  const [st, setSt] = useState<GroupState | null>(null);
  const [busy, setBusy] = useState(false);
  /** A gate message that replaces the list entirely (signed out / unpaid / offline). */
  const [gate, setGate] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true); setErr(null); setGate(null);
    try {
      const { rows, state } = await group.divergences();
      setRows(rows); setSt(state);
    } catch (e) {
      // The community layer is optional and paid: distinguish "not reachable" and "not entitled"
      // from a real error, and in each case show the group nothing rather than a broken screen.
      if (e instanceof RemoteOffline) {
        setGate("The research community isn't reachable — you may be offline. Your own work is unaffected.");
      } else if (e instanceof RemoteError && e.status === 401) {
        setGate("Sign in to the research community to compare your readings with the group's.");
      } else if (e instanceof RemoteError && e.status === 402) {
        setGate("Comparing with the community is part of the research plan. Upgrade to see where you stand apart.");
      } else {
        setErr((e as Error).message);
      }
      setRows([]); setSt(null);
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="sheet home">
      <header className="home-hero">
        <div className="resume" style={{ cursor: "default" }}>
          <span className="resume-body">
            <span className="resume-label">Where I stand apart</span>
            <span className="resume-ref">
              {rows.length} form{rows.length === 1 ? "" : "s"}
              <span className="resume-ayah">
                {" "}· {st?.theirs ?? 0} group reading{st?.theirs === 1 ? "" : "s"} held
              </span>
            </span>
          </span>
          <div className="diverge-actions">
            <button className="ctl primary" disabled={busy} onClick={() => void refresh()}>
              {busy ? "Checking…" : "Refresh"}
            </button>
          </div>
        </div>
        {err && <p className="acct-error" role="alert">{err}</p>}
      </header>

      {gate ? (
        <section className="home-card">
          <p className="home-empty">{gate}</p>
        </section>
      ) : rows.length === 0 ? (
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
