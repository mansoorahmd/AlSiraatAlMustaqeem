// The evidence drawer: every occurrence of the subject as a pullable card.
// Filter by word form (lemma), sort by mushaf or revelation order.

import { useMemo, useState } from "react";
import { api } from "../../api/client";
import { useAsync } from "../../hooks/useAsync";
import { useAppState } from "../../state/store";
import type { Chapter, RootOccurrence } from "../../api/types";
import type { CaseRecord } from "../../persistence/types";
import { cardIdFor } from "../../cases/ops";
import { EvidenceCard } from "./EvidenceCard";

type SortMode = "mushaf" | "revelation";

interface Props {
  root: string;
  caseRec: CaseRecord;
  chapters: Chapter[];
  onToggle: (occ: RootOccurrence) => void;
}

export function EvidenceDrawer({ root, caseRec, chapters, onToggle }: Props) {
  const { reading } = useAppState();
  const occs = useAsync(
    () => api.rootOccurrences(root, reading.script),
    [root, reading.script],
  );
  const [form, setForm] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>("mushaf");

  const revOrder = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of chapters) m.set(c.id, c.revelation_order);
    return m;
  }, [chapters]);

  const forms = useMemo(() => {
    if (!occs.data) return [];
    const counts = new Map<string, number>();
    for (const o of occs.data) {
      const f = o.lemma_arabic ?? "?";
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [occs.data]);

  const shown = useMemo(() => {
    if (!occs.data) return [];
    let list = form
      ? occs.data.filter((o) => (o.lemma_arabic ?? "?") === form)
      : occs.data.slice();
    if (sort === "revelation") {
      list.sort(
        (a, b) =>
          (revOrder.get(a.chapter_id) ?? 999) - (revOrder.get(b.chapter_id) ?? 999) ||
          a.verse_number - b.verse_number ||
          a.word_position - b.word_position,
      );
    }
    return list;
  }, [occs.data, form, sort, revOrder]);

  const onDeskIds = useMemo(
    () => new Set(caseRec.cards.map((c) => c.id)),
    [caseRec.cards],
  );

  return (
    <section className="drawer">
      <header className="drawer-head">
        <h2>Evidence drawer</h2>
        {occs.data && (
          <span className="drawer-count">
            {shown.length} of {occs.data.length} clues
          </span>
        )}
        <span className="spacer" />
        <span className="ctl-group" role="radiogroup" aria-label="Sort order">
          <button
            className={`ctl${sort === "mushaf" ? " active" : ""}`}
            onClick={() => setSort("mushaf")}
          >
            mushaf order
          </button>
          <button
            className={`ctl${sort === "revelation" ? " active" : ""}`}
            onClick={() => setSort("revelation")}
          >
            revelation order
          </button>
        </span>
      </header>

      {forms.length > 1 && (
        <div className="form-chips">
          <button
            className={`chip${form === null ? " active" : ""}`}
            onClick={() => setForm(null)}
          >
            all forms
          </button>
          {forms.map(([f, n]) => (
            <button
              key={f}
              className={`chip${form === f ? " active" : ""}`}
              onClick={() => setForm(form === f ? null : f)}
            >
              <span className="quran chip-ar">{f}</span> ×{n}
            </button>
          ))}
        </div>
      )}

      {occs.loading && <p className="loading">Opening the drawer…</p>}
      {occs.error && (
        <p className="error-note">Could not fetch occurrences ({occs.error.message}).</p>
      )}

      <div className="drawer-cards">
        {shown.map((o) => (
          <EvidenceCard
            key={cardIdFor(o)}
            occ={o}
            onDesk={onDeskIds.has(cardIdFor(o))}
            onToggle={onToggle}
          />
        ))}
      </div>
    </section>
  );
}
