// Proposals an AI made through the MCP server, awaiting the reader's judgement.
// Nothing here is part of the reader's research until they accept it: an AI can
// add notes and indications, but never make one primary and never delete.

import { useState } from "react";
import { archive } from "../persistence/db";
import { useAsync } from "../hooks/useAsync";
import { useAppDispatch } from "../state/store";

const spaced = (r: string) => r.split("").join(" ");

export function Proposed() {
  const dispatch = useAppDispatch();
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState(false);
  const data = useAsync(() => archive.proposed.all(), [version]);
  const refresh = () => setVersion((v) => v + 1);

  const notes = data.data?.notes ?? [];
  const indications = data.data?.indications ?? [];
  const count = notes.length + indications.length;
  if (count === 0) return null;

  const accept = async (kind: "note" | "indication", id: string) => {
    await archive.proposed.accept(kind, id);
    refresh();
  };
  const discard = async (kind: "note" | "indication", id: string) => {
    if (kind === "note") await archive.notes.remove(id);
    else await archive.indications.remove(id);
    refresh();
  };

  return (
    <div className="proposed-wrap">
      <button
        className={`ctl proposed-btn${open ? " active" : ""}`}
        title="Notes and indications proposed by an AI, awaiting your review"
        onClick={() => setOpen((o) => !o)}
      >
        ✦ Proposed <span className="proposed-count">{count}</span>
      </button>

      {open && (
        <div className="proposed-panel">
          <p className="proposed-head">
            Proposed by an AI through the MCP server. Nothing here affects your reading until you
            accept it — no proposal can become the primary indication.
          </p>

          {indications.length > 0 && (
            <>
              <p className="se-section">Indications ({indications.length})</p>
              {indications.map((s) => (
                <div key={s.id} className="proposed-row">
                  <div className="proposed-main">
                    <span className="proposed-title">{s.label || "(unlabelled)"}</span>
                    {s.root && (
                      <button
                        className="proposed-ref quran"
                        title="Open this root"
                        onClick={() => dispatch({ type: "openRoot", root: { buckwalter: s.root!, arabic: s.root! } })}
                      >{spaced(s.root)}</button>
                    )}
                    {s.scope === "lemma" && s.lemma && (
                      <span className="proposed-scope">refinement of <span className="quran">{s.lemma}</span></span>
                    )}
                    {s.meaning && <p className="proposed-text">{s.meaning}</p>}
                  </div>
                  <div className="proposed-actions">
                    <button className="ctl" onClick={() => accept("indication", s.id)}>✓ Accept</button>
                    <button className="ctl subtle" onClick={() => discard("indication", s.id)}>Discard</button>
                  </div>
                </div>
              ))}
            </>
          )}

          {notes.length > 0 && (
            <>
              <p className="se-section">Notes &amp; questions ({notes.length})</p>
              {notes.map((n) => (
                <div key={n.id} className="proposed-row">
                  <div className="proposed-main">
                    <button
                      className="proposed-ref"
                      title={`Read ${n.verseKey}`}
                      onClick={() => dispatch({ type: "jumpToVerse", verseKey: n.verseKey })}
                    >
                      {n.verseKey}{n.wordPosition != null ? ` · w${n.wordPosition}` : ""}
                    </button>
                    <span className="proposed-kind">{n.kind}</span>
                    <p className="proposed-text">{n.text}</p>
                  </div>
                  <div className="proposed-actions">
                    <button className="ctl" onClick={() => accept("note", n.id)}>✓ Accept</button>
                    <button className="ctl subtle" onClick={() => discard("note", n.id)}>Discard</button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
