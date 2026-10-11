// The trail strip: a fixed dock while following a thread. The 114 surahs as
// a map; hops are gold points joined by an ink path. Prev/next walks the
// subject's occurrences in mushaf order; the trail can be promoted to a case.

import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { archive } from "../../persistence/db";
import { useAsync } from "../../hooks/useAsync";
import { useAppState, useAppDispatch } from "../../state/store";
import { withHop } from "../../trails/ops";
import { openOrCreateRootCase, withAyahCardAdded, normalizeCase } from "../../cases/ops";
import type { TrailRecord } from "../../persistence/types";

const STRIP_W = 1140; // 114 cells × 10
const CELL = 10;

/** Manzil (1–7) of a surah — classical seven-part division. */
const MANZIL_LAST = [4, 9, 16, 25, 36, 49, 114];
function manzilOf(surah: number): number {
  return MANZIL_LAST.findIndex((last) => surah <= last) + 1;
}

export function TrailStrip({ trailId }: { trailId: string }) {
  const { reading } = useAppState();
  const dispatch = useAppDispatch();
  const [trail, setTrail] = useState<TrailRecord | null>(null);
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    archive.trails.get(trailId).then((t) => {
      if (!cancelled && t) setTrail(t);
    });
    return () => { cancelled = true; };
  }, [trailId]);

  // a word thread walks one exact written spelling; a root thread walks the family
  const isWordThread = trail?.subjectKind === "word";
  const occs = useAsync(
    async () =>
      !trail?.subject
        ? null
        : isWordThread
          ? api.wordOccurrences(trail.subject)
          : api.rootOccurrences(trail.subject, reading.script),
    [trail?.subject, isWordThread, reading.script],
  );

  if (!trail) return null;

  // how often the subject occurs per ayah — repeats deserve prominence
  const occPerVerse = new Map<string, number>();
  for (const o of occs.data ?? []) {
    occPerVerse.set(o.verse_key, (occPerVerse.get(o.verse_key) ?? 0) + 1);
  }

  const save = (t: TrailRecord) => {
    setTrail(t);
    void archive.trails.save(t);
  };

  const last = trail.hops[trail.hops.length - 1];
  const currentIdx = occs.data
    ? occs.data.findIndex(
        (o) =>
          o.verse_key === last?.verseKey &&
          (last?.wordPosition == null || o.word_position === last.wordPosition),
      )
    : -1;

  const goTo = (verseKey: string, wordPosition: number | null) => {
    save(withHop(trail, verseKey, wordPosition));
    dispatch({ type: "jumpToVerse", verseKey, wordPosition });
  };

  const step = (dir: 1 | -1) => {
    if (!occs.data || occs.data.length === 0) return;
    const next = occs.data[
      (currentIdx + dir + occs.data.length) % occs.data.length
    ];
    goTo(next.verse_key, next.word_position);
  };

  const promote = async () => {
    if (!trail.subject) return;
    let c = normalizeCase(await openOrCreateRootCase(trail.subject));
    for (const hop of trail.hops) {
      c = withAyahCardAdded(c, hop.verseKey, hop.wordPosition);
    }
    await archive.cases.save(c);
    dispatch({ type: "setActiveCase", caseId: c.id });
    dispatch({ type: "setTab", tab: "investigate" });
  };

  // hop geometry on the 114-surah map
  const pts = trail.hops.map((h, i) => {
    const chapter = parseInt(h.verseKey.split(":")[0], 10) || 1;
    return { x: (chapter - 1) * CELL + CELL / 2, y: 24, i, h };
  });
  const path = pts
    .map((p, i) => {
      if (i === 0) return `M ${p.x} ${p.y}`;
      const prev = pts[i - 1];
      const mx = (prev.x + p.x) / 2;
      const lift = Math.min(16, 4 + Math.abs(p.x - prev.x) / 18);
      return `Q ${mx} ${24 - lift} ${p.x} ${p.y}`;
    })
    .join(" ");

  return (
    <div className="trail-strip">
      <div className="trail-head">
        <span className="trail-glyph">➶</span>
        {renaming ? (
          <input
            className="board-input"
            autoFocus
            value={trail.name}
            onChange={(e) => setTrail({ ...trail, name: e.target.value })}
            onBlur={() => { setRenaming(false); save(trail); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") { setRenaming(false); save(trail); }
            }}
          />
        ) : (
          <button className="trail-name" onClick={() => setRenaming(true)} title="Rename trail">
            {trail.name} <span className="edit-hint">✎</span>
          </button>
        )}
        {trail.subject && (
          <span className="trail-subject quran" title={isWordThread ? "following this exact written word" : "following the whole root family"}>
            {isWordThread ? trail.subject : trail.subject.split("").join("\u00A0")}
            <span className="trail-kind">{isWordThread ? "word" : "root"}</span>
          </span>
        )}

        <span className="ctl-group">
          <button className="ctl" onClick={() => step(-1)} title="Previous occurrence">‹</button>
          <span className="trail-count">
            {occs.data
              ? `${currentIdx >= 0 ? currentIdx + 1 : "–"} / ${occs.data.length}`
              : "…"}
          </span>
          <button className="ctl" onClick={() => step(1)} title="Next occurrence">›</button>
        </span>

        <span className="trail-hops">{trail.hops.length} hops</span>
        <span className="spacer" />
        {!isWordThread && (
          <button className="ctl" onClick={promote} title="Open a case with every visited ayah as evidence">
            ⚖ promote to case
          </button>
        )}
        <button
          className="ctl"
          onClick={() => dispatch({ type: "setActiveTrail", trailId: null })}
          title="End the trail (it stays saved)"
        >
          ✕ end trail
        </button>
      </div>

      <svg
        className="trail-map"
        viewBox={`0 0 ${STRIP_W} 32`}
        preserveAspectRatio="none"
        aria-label="Trail across the 114 surahs"
      >
        {Array.from({ length: 114 }, (_, i) => (
          <rect
            key={i}
            x={i * CELL + 0.5}
            y={18}
            width={CELL - 1}
            height={12}
            className={`trail-cell m${manzilOf(i + 1)}${i + 1 === reading.surahId ? " here" : ""}`}
          >
            <title>{`Surah ${i + 1} · manzil ${manzilOf(i + 1)}`}</title>
          </rect>
        ))}
        {pts.length > 1 && <path d={path} className="trail-path" fill="none" />}
        {pts.map((p) => {
          const reps = occPerVerse.get(p.h.verseKey) ?? 1;
          const isCurrent = p.i === pts.length - 1;
          const r = (reps > 1 ? 4.2 : 2.4) + (isCurrent ? 1 : 0);
          return (
            <circle
              key={p.i}
              cx={p.x}
              cy={p.y}
              r={r}
              className={`trail-dot${isCurrent ? " current" : ""}${reps > 1 ? " multi" : ""}`}
              onClick={() => dispatch({ type: "jumpToVerse", verseKey: p.h.verseKey, wordPosition: p.h.wordPosition })}
            >
              <title>{`${p.h.verseKey}${reps > 1 ? ` — ${reps}× in this ayah` : ""}`}</title>
            </circle>
          );
        })}
      </svg>
    </div>
  );
}
