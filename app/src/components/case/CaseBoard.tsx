// The board — a clean, open canvas (CAD-style zoom/pan). Evidence cards and
// slips are dragged freely or auto-arranged by form; threads connect cards,
// slips, or specific WORDS; segments of an ayah can be painted with a
// highlighter. Machine suggestions stay dashed until accepted.

import { useEffect, useRef, useState } from "react";
import type { RootOccurrence } from "../../api/types";
import type { CaseRecord, EvidenceCardRecord, SlipRecord } from "../../persistence/types";
import {
  withCardRemoved, withCardMoved,
  withSlipAdded, withSlipUpdated, withSlipRemoved, withSlipMoved,
  withThreadAdded, withThreadUpdated, withThreadRemoved,
  withClusterAdded, withClusterRemoved,
  withCardHighlighted, arrangeBoard,
  suggestThreads, defaultPosition,
} from "../../cases/ops";
import { VerseText } from "../VerseText";
import { NotesPanel } from "../reader/NotesPanel";

interface ThreadAnchor { id: string; word: number | null; token: string | null }

type Mode =
  | { kind: "idle" }
  | { kind: "thread"; from: ThreadAnchor | null }
  | { kind: "cluster"; selected: string[] }
  | { kind: "highlight"; color: string | null; pending: { cardId: string; position: number } | null };

interface Props {
  caseRec: CaseRecord;
  occById: Map<string, RootOccurrence>;
  /** verse texts for evidence added from outside the root's occurrences */
  extraTexts: Map<string, string>;
  /** add any ayah by verse key; resolves false if the key is invalid */
  onAddAyah: (verseKey: string) => Promise<boolean>;
  /** tap a word on an evidence card → the ink-stamp menu (any root) */
  onWordTap?: (verseKey: string, position: number, token: string, rect: DOMRect) => void;
  mutate: (next: CaseRecord) => void;
}

const CARD_W = 260;
const PALETTE = ["#fde68a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#ddd6fe"];

export function CaseBoard({ caseRec, occById, extraTexts, onAddAyah, onWordTap, mutate }: Props) {
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [drag, setDrag] = useState<{
    id: string; dx: number; dy: number; ox: number; oy: number; x: number; y: number;
  } | null>(null);
  const [editThread, setEditThread] = useState<{ id: string; label: string } | null>(null);
  const [editSlip, setEditSlip] = useState<string | null>(null);
  const [clusterName, setClusterName] = useState("");
  const [ayahKey, setAyahKey] = useState("");
  const [ayahError, setAyahError] = useState(false);
  const [hoverCluster, setHoverCluster] = useState<string | null>(null);
  const [notesCardId, setNotesCardId] = useState<string | null>(null);
  const cardEls = useRef(new Map<string, HTMLDivElement>());
  const [, bump] = useState(0);

  // ---- CAD-style zoom & pan ----
  const boardRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  const panRef = useRef<{ sx: number; sy: number; sl: number; st: number } | null>(null);

  useEffect(() => { bump((x) => x + 1); }, [caseRec.cards.length, caseRec.slips.length]);

  // migrate pre-board cards that were all stacked at (0,0)
  useEffect(() => {
    const zeros = caseRec.cards.filter((c) => c.x === 0 && c.y === 0);
    if (zeros.length > 1) {
      let i = 0;
      mutate({
        ...caseRec,
        cards: caseRec.cards.map((c) =>
          c.x === 0 && c.y === 0 ? { ...c, ...defaultPosition(i++) } : c,
        ),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseRec.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setMode({ kind: "idle" }); setEditThread(null); setEditSlip(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ctrl/cmd + wheel (or trackpad pinch) zooms toward the cursor
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // plain wheel = normal scroll
      e.preventDefault();
      const old = scaleRef.current;
      const next = Math.min(1.75, Math.max(0.25, old * Math.exp(-e.deltaY * 0.0015)));
      if (next === old) return;
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      el.scrollLeft = (el.scrollLeft + cx) * (next / old) - cx;
      el.scrollTop = (el.scrollTop + cy) * (next / old) - cy;
      setScale(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // drag empty canvas to pan
  const onBoardPointerDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest(".board-card") || t.closest(".thread-label")) return;
    const el = boardRef.current;
    if (!el) return;
    panRef.current = { sx: e.clientX, sy: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
    el.classList.add("panning");
    const onMove = (ev: PointerEvent) => {
      const p = panRef.current;
      if (!p || !boardRef.current) return;
      boardRef.current.scrollLeft = p.sl - (ev.clientX - p.sx);
      boardRef.current.scrollTop = p.st - (ev.clientY - p.sy);
    };
    const onUp = () => {
      panRef.current = null;
      boardRef.current?.classList.remove("panning");
      window.removeEventListener("pointermove", onMove);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  const zoomTo = (next: number) => {
    const el = boardRef.current;
    const old = scaleRef.current;
    const ns = Math.min(1.75, Math.max(0.25, next));
    if (el) {
      const cx = el.clientWidth / 2, cy = el.clientHeight / 2;
      el.scrollLeft = (el.scrollLeft + cx) * (ns / old) - cx;
      el.scrollTop = (el.scrollTop + cy) * (ns / old) - cy;
    }
    setScale(ns);
  };

  // ---- dragging (cards and slips) ----
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const k = scaleRef.current;
      setDrag((d) => d && {
        ...d,
        x: Math.max(0, d.ox + (e.clientX - d.dx) / k),
        y: Math.max(0, d.oy + (e.clientY - d.dy) / k),
      });
    };
    const onUp = () => {
      setDrag((d) => {
        if (d) {
          mutate(
            d.id.startsWith("slip")
              ? withSlipMoved(caseRec, d.id, d.x, d.y)
              : withCardMoved(caseRec, d.id, d.x, d.y),
          );
        }
        return null;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, caseRec, mutate]);

  const startDrag = (e: React.PointerEvent, obj: { id: string; x: number; y: number }) => {
    if (mode.kind !== "idle") return;
    e.preventDefault();
    setDrag({ id: obj.id, dx: e.clientX, dy: e.clientY, ox: obj.x, oy: obj.y, x: obj.x, y: obj.y });
  };

  // ---- clicks on objects & words, per mode ----
  const completeThread = (from: ThreadAnchor, to: ThreadAnchor) => {
    const label =
      from.token && to.token ? `${from.token} ↔ ${to.token}` : "";
    const next = withThreadAdded(
      caseRec, from.id, to.id, label, "user", true, undefined,
      from.word, to.word,
    );
    mutate(next);
    setEditThread({ id: next.threads[next.threads.length - 1].id, label });
    setMode({ kind: "idle" });
  };

  const onObjectClick = (id: string, word: number | null = null, token: string | null = null) => {
    if (mode.kind === "thread") {
      const anchor: ThreadAnchor = { id, word, token };
      if (mode.from === null) setMode({ kind: "thread", from: anchor });
      else if (mode.from.id !== id || mode.from.word !== word) completeThread(mode.from, anchor);
    } else if (mode.kind === "cluster") {
      const sel = mode.selected.includes(id)
        ? mode.selected.filter((k) => k !== id)
        : [...mode.selected, id];
      setMode({ kind: "cluster", selected: sel });
    } else if (mode.kind === "highlight") {
      if (!id.startsWith("ev_") || word === null) return;
      if (mode.pending && mode.pending.cardId === id) {
        mutate(withCardHighlighted(caseRec, id, mode.pending.position, word, mode.color));
        setMode({ ...mode, pending: null });
      } else {
        setMode({ ...mode, pending: { cardId: id, position: word } });
      }
    }
  };

  // ---- geometry ----
  const findObj = (id: string): { x: number; y: number } | null =>
    caseRec.cards.find((c) => c.id === id) ?? caseRec.slips.find((s) => s.id === id) ?? null;

  const posOf = (id: string, word?: number | null) => {
    const obj = findObj(id);
    if (!obj) return { cx: 0, cy: 0 };
    const el = cardEls.current.get(id);
    const x = drag?.id === id ? drag.x : obj.x;
    const y = drag?.id === id ? drag.y : obj.y;
    // word anchor: locate the word span inside the card
    if (word != null && el && innerRef.current) {
      const span = el.querySelector(`[data-pos="${word}"]`) as HTMLElement | null;
      if (span) {
        const wr = span.getBoundingClientRect();
        const ir = innerRef.current.getBoundingClientRect();
        const k = scaleRef.current;
        return {
          cx: (wr.left + wr.width / 2 - ir.left) / k,
          cy: (wr.top + wr.height / 2 - ir.top) / k,
        };
      }
    }
    const w = el?.offsetWidth ?? CARD_W;
    const h = el?.offsetHeight ?? 120;
    return { cx: x + w / 2, cy: y + h / 2 };
  };

  // labels live NEAR THEIR SOURCE CARD: a short way out along the line,
  // stacking outward when several threads leave the same card — so they
  // never sit on top of another card's text
  const labelPos = (
    a: { cx: number; cy: number },
    b: { cx: number; cy: number },
    siblingIdx: number,
  ) => {
    const dx = b.cx - a.cx, dy = b.cy - a.cy;
    const len = Math.hypot(dx, dy) || 1;
    const d = Math.min(150 + siblingIdx * 30, len * 0.45);
    const px = a.cx + (dx / len) * d;
    const py = a.cy + (dy / len) * d;
    const off = 14;
    return { left: px + (dy / len) * off, top: py + (-dx / len) * off };
  };

  // per-source-card counters so sibling labels stack instead of overlap
  const labelIdx = new Map<string, number>();
  const nextLabelIdx = (fromId: string) => {
    const i = labelIdx.get(fromId) ?? 0;
    labelIdx.set(fromId, i + 1);
    return i;
  };
  labelIdx.clear();

  // ---- spelling variants: same form written differently (e.g. dagger alif) ----
  // Compare the STEM's written form from the morphology data (prefixes like
  // \u0648\u064E are separate segments, so an attached waw never false-flags).
  // Strip short vowels/tanwin/sukun but KEEP letters + dagger alif (U+0670).
  const skeleton = (t: string) => t.replace(/[\u064B-\u0652\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]/g, "");
  const subjectSpelling = (card: EvidenceCardRecord): string | null => {
    const form = occById.get(card.id)?.form_arabic;
    return form ? skeleton(form) : null;
  };
  const spellingInfo = (() => {
    const byLemma = new Map<string, Map<string, number>>();
    const spellingOf = new Map<string, string>();
    for (const card of caseRec.cards) {
      const lemma = occById.get(card.id)?.lemma_arabic;
      const sp = subjectSpelling(card);
      if (!lemma || !sp) continue;
      spellingOf.set(card.id, sp);
      const m = byLemma.get(lemma) ?? new Map<string, number>();
      m.set(sp, (m.get(sp) ?? 0) + 1);
      byLemma.set(lemma, m);
    }
    const variant = new Map<string, string>(); // cardId → majority spelling
    for (const card of caseRec.cards) {
      const lemma = occById.get(card.id)?.lemma_arabic;
      const sp = spellingOf.get(card.id);
      if (!lemma || !sp) continue;
      const census = byLemma.get(lemma)!;
      if (census.size < 2) continue;
      const [majority] = [...census.entries()].sort((a, b) => b[1] - a[1])[0];
      if (sp !== majority) variant.set(card.id, majority);
    }
    return variant;
  })();

  const allObjs = [
    ...caseRec.cards.map((c) => ({ x: c.x, y: c.y, id: c.id })),
    ...caseRec.slips.map((s) => ({ x: s.x, y: s.y, id: s.id })),
  ];
  const extentW = Math.max(900, ...allObjs.map((o) => (drag?.id === o.id ? drag.x : o.x) + CARD_W + 80));
  const extentH = Math.max(420, ...allObjs.map((o) => (drag?.id === o.id ? drag.y : o.y) + 320));

  const suggestions = suggestThreads(caseRec, occById);
  const inkThreads = caseRec.threads.filter((t) => t.accepted);

  const clustersOf = (id: string) =>
    caseRec.clusters.filter((g) => g.cardIds.includes(id));

  const saveCluster = () => {
    if (mode.kind !== "cluster" || mode.selected.length < 2 || !clusterName.trim()) return;
    mutate(withClusterAdded(caseRec, clusterName.trim(), mode.selected));
    setClusterName("");
    setMode({ kind: "idle" });
  };

  const formOptions = [...new Set(
    [...occById.values()].map((o) => o.lemma_arabic).filter((l): l is string => !!l),
  )];

  const addSlip = (kind: "comment" | "reference") => {
    const next = withSlipAdded(caseRec, kind, null);
    mutate(next);
    setEditSlip(next.slips[next.slips.length - 1].id);
  };

  const editingSlip = editSlip ? caseRec.slips.find((s) => s.id === editSlip) ?? null : null;

  const objClasses = (id: string) => {
    const inHover = hoverCluster !== null &&
      caseRec.clusters.some((g) => g.id === hoverCluster && g.cardIds.includes(id));
    const selected = mode.kind === "cluster" && mode.selected.includes(id);
    const threadFrom = mode.kind === "thread" && mode.from?.id === id;
    const hlPending = mode.kind === "highlight" && mode.pending?.cardId === id;
    return [
      drag?.id === id ? "dragging" : "",
      inHover ? "cluster-hover" : "",
      selected ? "cluster-selected" : "",
      threadFrom ? "thread-from" : "",
      hlPending ? "thread-from" : "",
      mode.kind !== "idle" ? "pickable" : "",
    ].join(" ");
  };

  // word taps route by mode: idle → ink-stamp menu; thread/highlight → anchor
  const wordTapFor = (card: EvidenceCardRecord) => {
    if (mode.kind === "thread" || mode.kind === "highlight") {
      return (pos: number, tok: string) => onObjectClick(card.id, pos, tok);
    }
    if (mode.kind === "idle" && onWordTap) {
      return (pos: number, tok: string, rect: DOMRect) =>
        onWordTap(card.verseKey, pos, tok, rect);
    }
    return undefined;
  };

  return (
    <div className="board-wrap">
      {/* toolbar */}
      <div className="board-toolbar">
        <span className="tb-group">
          <button className="tbtn" onClick={() => addSlip("comment")} title="Add a comment slip">
            <span className="tbtn-ic">✎</span> Comment
          </button>
          <button className="tbtn" onClick={() => addSlip("reference")} title="Add a cited reference">
            <span className="tbtn-ic">🔖</span> Reference
          </button>
        </span>

        <span className="tb-group">
          <button
            className={`tbtn${mode.kind === "thread" ? " on" : ""}`}
            onClick={() =>
              setMode(mode.kind === "thread" ? { kind: "idle" } : { kind: "thread", from: null })
            }
            title="Connect two cards, slips — or specific words"
          >
            <span className="tbtn-ic">🧵</span> Thread
          </button>
          <button
            className={`tbtn${mode.kind === "cluster" ? " on" : ""}`}
            onClick={() =>
              setMode(mode.kind === "cluster" ? { kind: "idle" } : { kind: "cluster", selected: [] })
            }
            title="Group cards under a name"
          >
            <span className="tbtn-ic">◎</span> Cluster
          </button>
          <button
            className={`tbtn${mode.kind === "highlight" ? " on" : ""}`}
            onClick={() =>
              setMode(
                mode.kind === "highlight"
                  ? { kind: "idle" }
                  : { kind: "highlight", color: PALETTE[0], pending: null },
              )
            }
            title="Paint a word range on a card"
          >
            <span className="tbtn-ic">🖍</span> Highlight
          </button>
        </span>

        <span className="tb-group">
          <button
            className="tbtn"
            onClick={() =>
              mutate(
                arrangeBoard(caseRec, occById, (id) =>
                  cardEls.current.get(id)?.offsetHeight,
                ),
              )
            }
            title="Auto-arrange: grouped by form, mushaf order inside; slips beside their evidence"
          >
            <span className="tbtn-ic">⇤</span> Arrange
          </button>
          <span className="ctl-group add-ayah">
            <input
              className={`board-input ayah-key-input${ayahError ? " invalid" : ""}`}
              placeholder="＋ Ayah e.g. 24:35"
              value={ayahKey}
              onChange={(e) => { setAyahKey(e.target.value); setAyahError(false); }}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && /^\d{1,3}:\d{1,3}$/.test(ayahKey.trim())) {
                  const ok = await onAddAyah(ayahKey.trim());
                  if (ok) setAyahKey(""); else setAyahError(true);
                }
              }}
            />
            <button
              className="tbtn"
              disabled={!/^\d{1,3}:\d{1,3}$/.test(ayahKey.trim())}
              onClick={async () => {
                const ok = await onAddAyah(ayahKey.trim());
                if (ok) setAyahKey(""); else setAyahError(true);
              }}
            >
              add
            </button>
          </span>
        </span>

        <span className="tb-group zoom-ctl" aria-label="Zoom">
          <button className="tbtn" onClick={() => zoomTo(scale / 1.2)} title="Zoom out">−</button>
          <button className="tbtn zoom-pct" onClick={() => zoomTo(1)} title="Reset to 100%">
            {Math.round(scale * 100)}%
          </button>
          <button className="tbtn" onClick={() => zoomTo(scale * 1.2)} title="Zoom in">＋</button>
          <button
            className="tbtn"
            onClick={() => {
              const el = boardRef.current;
              if (!el) return;
              const ns = Math.min(1, Math.max(0.25, Math.min(
                (el.clientWidth - 24) / extentW,
                (el.clientHeight - 24) / extentH,
              )));
              setScale(ns);
              el.scrollLeft = 0;
              el.scrollTop = 0;
            }}
            title="Fit the whole board"
          >
            ⊡ fit
          </button>
        </span>

        {mode.kind === "thread" && (
          <span className="board-hint">
            {mode.from === null
              ? "pick a card, slip — or click a specific word…"
              : "now pick what to connect it to (Esc cancels)"}
          </span>
        )}
        {mode.kind === "highlight" && (
          <span className="tb-group palette">
            {PALETTE.map((col) => (
              <button
                key={col}
                className={`swatch${mode.color === col ? " on" : ""}`}
                style={{ backgroundColor: col }}
                onClick={() => setMode({ ...mode, color: col })}
                title="Highlight color"
              />
            ))}
            <button
              className={`swatch eraser${mode.color === null ? " on" : ""}`}
              onClick={() => setMode({ ...mode, color: null })}
              title="Eraser"
            >
              ⌫
            </button>
            <span className="board-hint">
              {mode.pending ? "…now click the last word of the segment" : "click the first word of a segment"}
            </span>
          </span>
        )}
        {mode.kind === "cluster" && (
          <>
            <span className="board-hint">select ({mode.selected.length}) then name the group</span>
            <input
              className="board-input"
              placeholder="cluster name…"
              value={clusterName}
              onChange={(e) => setClusterName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveCluster(); }}
            />
            <button className="tbtn" disabled={mode.selected.length < 2 || !clusterName.trim()} onClick={saveCluster}>
              save group
            </button>
          </>
        )}
        {mode.kind === "idle" && suggestions.length > 0 && (
          <span className="board-hint pencil">
            {suggestions.length} suggested link{suggestions.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* cluster chips */}
      {caseRec.clusters.length > 0 && (
        <div className="cluster-chips">
          {caseRec.clusters.map((g) => (
            <span
              key={g.id}
              className={`chip cluster-chip${hoverCluster === g.id ? " active" : ""}`}
              onMouseEnter={() => setHoverCluster(g.id)}
              onMouseLeave={() => setHoverCluster(null)}
            >
              {g.name} ×{g.cardIds.length}
              <button className="chip-x" title="Dissolve this cluster"
                onClick={() => mutate(withClusterRemoved(caseRec, g.id))}>✕</button>
            </span>
          ))}
        </div>
      )}

      {/* thread label editor */}
      {editThread && (
        <div className="thread-editor">
          <span>label this thread:</span>
          <input
            className="board-input" autoFocus value={editThread.label}
            placeholder="e.g. both about covenant…"
            onChange={(e) => setEditThread({ ...editThread, label: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                mutate(withThreadUpdated(caseRec, editThread.id, editThread.label.trim()));
                setEditThread(null);
              }
            }}
          />
          <button className="tbtn" onClick={() => {
            mutate(withThreadUpdated(caseRec, editThread.id, editThread.label.trim()));
            setEditThread(null);
          }}>save</button>
          <button className="tbtn" onClick={() => {
            mutate(withThreadRemoved(caseRec, editThread.id));
            setEditThread(null);
          }}>remove thread</button>
        </div>
      )}

      {/* slip editor */}
      {editingSlip && (
        <div className="thread-editor slip-editor">
          <span>{editingSlip.kind === "comment" ? "✎ comment" : "🔖 reference"}</span>
          {editingSlip.kind === "reference" && (
            <>
              <input className="board-input" placeholder="source (e.g. Lane's Lexicon, Tafsir al-Tabari)…"
                value={editingSlip.source ?? ""}
                onChange={(e) => mutate(withSlipUpdated(caseRec, editingSlip.id, { source: e.target.value }))} />
              <input className="board-input" placeholder="locator (page, entry, URL)…"
                value={editingSlip.locator ?? ""}
                onChange={(e) => mutate(withSlipUpdated(caseRec, editingSlip.id, { locator: e.target.value }))} />
            </>
          )}
          <textarea className="board-input slip-text-input" autoFocus={editingSlip.kind === "comment"} rows={2}
            placeholder={editingSlip.kind === "comment" ? "your observation…" : "what this source contributes…"}
            value={editingSlip.text}
            onChange={(e) => mutate(withSlipUpdated(caseRec, editingSlip.id, { text: e.target.value }))} />
          <select className="board-input slip-form-select" value={editingSlip.form ?? ""}
            onChange={(e) => mutate(withSlipUpdated(caseRec, editingSlip.id, { form: e.target.value || null }))}>
            <option value="">(the subject itself)</option>
            {formOptions.map((f) => (<option key={f} value={f}>{f}</option>))}
          </select>
          <button className="tbtn" onClick={() => setEditSlip(null)}>done</button>
          <button className="tbtn" onClick={() => { mutate(withSlipRemoved(caseRec, editingSlip.id)); setEditSlip(null); }}>
            discard slip
          </button>
        </div>
      )}

      {/* the canvas */}
      <div className="board" role="application" aria-label="Case board"
        ref={boardRef} onPointerDown={onBoardPointerDown}>
        <div style={{ width: extentW * scale, height: extentH * scale }}>
          <div
            ref={innerRef}
            className="board-inner"
            style={{ width: extentW, height: extentH, transform: `scale(${scale})`, transformOrigin: "0 0" }}
          >
            <svg className="board-svg" width={extentW} height={extentH}>
              {inkThreads.map((t) => {
                const a = posOf(t.fromCardId, t.fromWord);
                const b = posOf(t.toCardId, t.toWord);
                return <line key={t.id} x1={a.cx} y1={a.cy} x2={b.cx} y2={b.cy} className="thread-ink" />;
              })}
              {suggestions.map((s) => {
                const a = posOf(s.fromCardId), b = posOf(s.toCardId);
                return <line key={s.id} x1={a.cx} y1={a.cy} x2={b.cx} y2={b.cy} className="thread-pencil" />;
              })}
            </svg>

            {inkThreads.map((t) => {
              const a = posOf(t.fromCardId, t.fromWord);
              const b = posOf(t.toCardId, t.toWord);
              return (
                <button key={t.id} className="thread-label"
                  style={labelPos(a, b, nextLabelIdx(t.fromCardId))}
                  title="Edit this thread"
                  onClick={() => setEditThread({ id: t.id, label: t.label })}>
                  {t.label || "…"}
                </button>
              );
            })}

            {suggestions.map((s) => {
              const a = posOf(s.fromCardId), b = posOf(s.toCardId);
              return (
                <span key={s.id} className="thread-label pencil"
                  style={labelPos(a, b, nextLabelIdx(s.fromCardId))}>
                  {s.reason}
                  <button className="chip-x ok" title="Accept"
                    onClick={() => mutate(withThreadAdded(caseRec, s.fromCardId, s.toCardId, s.reason, "suggested", true, s.id))}>✓</button>
                  <button className="chip-x" title="Dismiss"
                    onClick={() => mutate(withThreadAdded(caseRec, s.fromCardId, s.toCardId, s.reason, "suggested", false, s.id))}>✕</button>
                </span>
              );
            })}

            {/* evidence cards */}
            {caseRec.cards.map((card: EvidenceCardRecord) => {
              const occ = occById.get(card.id);
              const text = occ?.verse_text ?? extraTexts.get(card.verseKey) ?? null;
              const x = drag?.id === card.id ? drag.x : card.x;
              const y = drag?.id === card.id ? drag.y : card.y;
              const clusterNames = clustersOf(card.id).map((g) => g.name);
              return (
                <div key={card.id}
                  ref={(el) => { if (el) cardEls.current.set(card.id, el); else cardEls.current.delete(card.id); }}
                  className={`desk-card board-card ${objClasses(card.id)}${card.source === "ai" ? " by-ai" : ""}`}
                  title={card.source === "ai" ? "Added by an AI through the MCP server" : undefined}
                  style={{ left: x, top: y, width: CARD_W }}
                  onClick={(e) => {
                    // in thread mode, clicking non-word card area anchors the whole card
                    if (mode.kind === "thread" && !(e.target as HTMLElement).closest(".word")) {
                      onObjectClick(card.id);
                    } else if (mode.kind === "cluster") {
                      onObjectClick(card.id);
                    }
                  }}>
                  <div className="ec-head board-card-head" onPointerDown={(e) => startDrag(e, card)}>
                    <span className="stamp">{card.verseKey}</span>
                    {spellingInfo.has(card.id) && (
                      <span
                        className="variant-chip"
                        title={`Written ${subjectSpelling(card)} here — usually ${spellingInfo.get(card.id)}`}
                      >
                        ✍ variant spelling
                      </span>
                    )}
                    <button className="tbtn tiny" title="Return to the drawer"
                      onClick={(e) => { e.stopPropagation(); mutate(withCardRemoved(caseRec, card.id)); }}>✕</button>
                  </div>
                  {text && (
                    <p className="ec-text quran" dir="rtl">
                      <VerseText
                        text={text}
                        highlightPosition={card.wordPosition}
                        highlightRanges={card.highlights}
                        onWordTap={wordTapFor(card)}
                      />
                    </p>
                  )}
                  {clusterNames.length > 0 && (
                    <div className="card-clusters">{clusterNames.join(" · ")}</div>
                  )}
                  <div
                    className="card-notes"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      className="tbtn tiny card-notes-toggle"
                      title="Notes & questions on this ayah"
                      onClick={() =>
                        setNotesCardId((id) => (id === card.id ? null : card.id))
                      }
                    >
                      ✎ notes
                    </button>
                    {notesCardId === card.id && (
                      <NotesPanel verseKey={card.verseKey} compact />
                    )}
                  </div>
                </div>
              );
            })}

            {/* slips */}
            {caseRec.slips.map((slip: SlipRecord) => {
              const x = drag?.id === slip.id ? drag.x : slip.x;
              const y = drag?.id === slip.id ? drag.y : slip.y;
              const clusterNames = clustersOf(slip.id).map((g) => g.name);
              return (
                <div key={slip.id}
                  ref={(el) => { if (el) cardEls.current.set(slip.id, el); else cardEls.current.delete(slip.id); }}
                  className={`board-card slip slip-${slip.kind} ${objClasses(slip.id)}${slip.author === "ai" ? " by-ai" : ""}`}
                  title={slip.author === "ai" ? "Added by an AI through the MCP server" : undefined}
                  style={{ left: x, top: y, width: CARD_W - 30 }}
                  onClick={() => {
                    if (mode.kind === "thread" || mode.kind === "cluster") onObjectClick(slip.id);
                  }}>
                  <div className="ec-head board-card-head" onPointerDown={(e) => startDrag(e, slip)}>
                    <span className="slip-kind">
                      {slip.kind === "comment" ? "✎" : "🔖"}
                      {slip.form ? <span className="slip-form quran"> {slip.form}</span> : " subject"}
                    </span>
                    <button className="tbtn tiny" title="Edit this slip"
                      onClick={(e) => { e.stopPropagation(); setEditSlip(slip.id); }}>✎</button>
                  </div>
                  {slip.kind === "reference" && (slip.source || slip.locator) && (
                    <div className="slip-source">{slip.source}{slip.locator ? ` — ${slip.locator}` : ""}</div>
                  )}
                  <p className="slip-text">{slip.text || "…"}</p>
                  {clusterNames.length > 0 && (
                    <div className="card-clusters">{clusterNames.join(" · ")}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
