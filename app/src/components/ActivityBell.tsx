// One "activity" bell in the top bar — everything waiting on the reader in a single
// place: AI proposals to review (from the MCP server) and the reader's own unanswered
// questions across the Book. Replaces the two separate ❓ / ✦ buttons.

import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useAppDispatch } from "../state/store";
import { archive } from "../persistence/db";
import type { NoteRecord } from "../persistence/types";

const spaced = (r: string) => r.split("").join("\u00A0"); // nbsp: root letters must not wrap (ه د ي)
const vsort = (k: string) => {
  const [c, v] = k.split(":").map((n) => parseInt(n, 10) || 0);
  return c * 1000 + v;
};

export function ActivityBell() {
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const refresh = () => setVersion((v) => v + 1);

  const notesData = useAsync(() => archive.notes.all(), [version]);
  const proposed = useAsync(() => archive.proposed.all(), [version]);
  const chapters = useAsync(() => api.chapters(), []);

  const surahName = (verseKey: string) => {
    const id = parseInt(verseKey.split(":")[0] ?? "", 10);
    return chapters.data?.find((c) => c.id === id)?.name_simple ?? "";
  };

  const questions = (notesData.data ?? [])
    .filter((n) => n.kind === "question" && !n.resolved)
    .sort((a, b) => vsort(a.verseKey) - vsort(b.verseKey));
  const pNotes = proposed.data?.notes ?? [];
  const pInd = proposed.data?.indications ?? [];
  const reviewCount = pNotes.length + pInd.length;
  const count = reviewCount + questions.length;

  useEffect(() => { if (open) refresh(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const jump = (n: NoteRecord) => { dispatch({ type: "jumpToVerse", verseKey: n.verseKey, wordPosition: n.wordPosition }); setOpen(false); };
  const accept = async (kind: "note" | "indication", id: string) => { await archive.proposed.accept(kind, id); refresh(); };
  const discard = async (kind: "note" | "indication", id: string) => {
    if (kind === "note") await archive.notes.remove(id); else await archive.indications.remove(id);
    refresh();
  };

  return (
    <div className="activity-wrap" ref={ref}>
      <button
        className={`ctl activity-btn${open ? " active" : ""}${count > 0 ? " has" : ""}`}
        title={count > 0 ? `${count} item${count > 1 ? "s" : ""} awaiting you` : "Nothing awaiting you"}
        aria-label="Activity"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="activity-ic" aria-hidden>❖</span>
        {count > 0 && <span className="activity-count">{count}</span>}
      </button>

      {open && (
        <div className="activity-popover" role="menu">
          {count === 0 && (
            <p className="activity-empty">Nothing waiting — no proposals to review and every question is answered.</p>
          )}

          {reviewCount > 0 && (
            <section className="activity-sec">
              <div className="activity-sec-head">
                <span className="activity-sec-title">✦ Needs your review</span>
                <span className="activity-sec-sub">proposed by an AI · nothing applies until you accept</span>
              </div>

              {pInd.map((s) => (
                <div key={s.id} className="proposed-row">
                  <div className="proposed-main">
                    <span className="proposed-title">{s.label || "(unlabelled)"}</span>
                    {s.root && (
                      <button className="proposed-ref quran" title="Open this root"
                        onClick={() => { dispatch({ type: "openRoot", root: { buckwalter: s.root!, arabic: s.root! } }); setOpen(false); }}
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

              {pNotes.map((n) => (
                <div key={n.id} className="proposed-row">
                  <div className="proposed-main">
                    <button className="proposed-ref" title={`Read ${n.verseKey}`}
                      onClick={() => { dispatch({ type: "jumpToVerse", verseKey: n.verseKey }); setOpen(false); }}
                    >{n.verseKey}{n.wordPosition != null ? ` · w${n.wordPosition}` : ""}</button>
                    <span className="proposed-kind">{n.kind}</span>
                    <p className="proposed-text">{n.text}</p>
                  </div>
                  <div className="proposed-actions">
                    <button className="ctl" onClick={() => accept("note", n.id)}>✓ Accept</button>
                    <button className="ctl subtle" onClick={() => discard("note", n.id)}>Discard</button>
                  </div>
                </div>
              ))}
            </section>
          )}

          {questions.length > 0 && (
            <section className="activity-sec">
              <div className="activity-sec-head">
                <span className="activity-sec-title">❓ Open questions</span>
                <span className="activity-sec-sub">{questions.length} unanswered</span>
              </div>
              <ul className="oq-list">
                {questions.map((n) => (
                  <li key={n.id} className="oq-item">
                    <button className="oq-jump" onClick={() => jump(n)} title="Go to this ayah">
                      <span className="oq-text">{n.text}</span>
                      <span className="oq-loc">
                        {n.verseKey}{surahName(n.verseKey) ? ` · ${surahName(n.verseKey)}` : ""}
                        {n.wordPosition != null && n.lemma ? <span className="oq-word quran"> · {n.lemma}</span>
                          : n.wordPosition != null ? <span className="oq-word"> · word {n.wordPosition}</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
