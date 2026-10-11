// Comparisons — named, saved boards of pinned āyāt and roots studied together.
// Two views: a list of saved comparisons, and a vertical "timeline" board where
// each pinned item is a node on a thread. Roots shared between an item and the
// one above are pinned atop the card (and washed in the verse); a node glows
// gold when its item shares a root with any other in the board. Pins land in the
// active comparison via "✚ Add to Compare" from anywhere an āyah or root shows.

import { useMemo, useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { archive } from "../persistence/db";
import { useAppState, useAppDispatch } from "../state/store";
import { compareTitle, createCompare, setActiveCompare } from "../compare/ops";
import type { CompareItemRow, Word } from "../api/types";
import { VerseText } from "../components/VerseText";
import { NotesPanel } from "../components/reader/NotesPanel";

const spaced = (r: string) => r.split("").join("\u00A0"); // nbsp: root letters must not wrap (ه د ي)
const cnum = (k: string) => parseInt(k.split(":")[0] ?? "", 10);

export function Compare() {
  const { activeCompareSetId, compareTick } = useAppState();
  const dispatch = useAppDispatch();
  const [openId, setOpenId] = useState<string | null>(null);

  const sets = useAsync(() => archive.compare.sets(), [compareTick]);
  const list = sets.data ?? [];

  const refresh = () => dispatch({ type: "bumpCompare" });

  const newComparison = async () => {
    const id = await createCompare();
    dispatch({ type: "setActiveCompare", id });
    refresh();
    setOpenId(id);
  };
  const remove = async (id: string) => {
    await archive.compare.removeSet(id);
    if (activeCompareSetId === id) dispatch({ type: "setActiveCompare", id: null });
    refresh();
  };

  if (openId) {
    return (
      <CompareBoard
        setId={openId}
        isActive={activeCompareSetId === openId}
        onBack={() => { setOpenId(null); refresh(); }}
        onChanged={refresh}
        onSetActive={async () => { await setActiveCompare(openId); dispatch({ type: "setActiveCompare", id: openId }); refresh(); }}
      />
    );
  }

  return (
    <div className="sheet compare-screen">
      <header className="home-head cmp-list-head">
        <div>
          <h1>Comparisons</h1>
          <p className="subtitle">Named boards of āyāt and roots studied side by side.</p>
        </div>
        <button className="ink-action" onClick={newComparison}>＋ New</button>
      </header>

      {sets.loading && <p className="loading">Opening your comparisons…</p>}

      {!sets.loading && list.length === 0 ? (
        <p className="home-empty">
          No comparisons yet. Use “✚ Add to Compare” on any āyah (in the reader or an echo panel) or on
          a root's page — it lands in your active comparison. Or create one now with ＋ New.
        </p>
      ) : (
        <div className="cmp-set-list">
          {list.map((s) => (
            <div key={s.id} className="cmp-set-row" onClick={() => setOpenId(s.id)}>
              <div className="cmp-set-main">
                <div className="cmp-set-title-row">
                  <span className="cmp-set-title">{compareTitle(s)}</span>
                  {activeCompareSetId === s.id && <span className="cmp-active-tag">active</span>}
                </div>
                <span className="cmp-set-meta">
                  {s.count} item{s.count === 1 ? "" : "s"} · updated {new Date(s.updatedAt).toISOString().slice(0, 10)}
                </span>
              </div>
              <button
                className="cmp-set-del"
                title="Delete comparison"
                onClick={(e) => { e.stopPropagation(); remove(s.id); }}
              >✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Resolved {
  item: CompareItemRow;
  roots: Set<string>;
  words: Word[]; // ayah only
}

function CompareBoard({
  setId, isActive, onBack, onChanged, onSetActive,
}: {
  setId: string; isActive: boolean; onBack: () => void; onChanged: () => void; onSetActive: () => void;
}) {
  const { reading, compareTick } = useAppState();
  const dispatch = useAppDispatch();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [localTick, setLocalTick] = useState(0);

  const chapters = useAsync(() => api.chapters(), []);
  const setsAsync = useAsync(() => archive.compare.sets(), [compareTick, localTick]);

  const resolved = useAsync(async (): Promise<Resolved[]> => {
    const items = await archive.compare.items(setId);
    return Promise.all(
      items.map(async (item) => {
        const roots = new Set<string>();
        let words: Word[] = [];
        if (item.kind === "ayah") {
          const v = await api.verse(item.ref, { words: true });
          words = ((v?.words ?? []) as Word[]).filter((w) => w.position != null);
          for (const w of words) if (w.root) roots.add(w.root);
        } else {
          const d = await api.root(item.ref).catch(() => null);
          if (d?.root_arabic) roots.add(d.root_arabic);
        }
        return { item, roots, words };
      }),
    );
  }, [setId, compareTick, localTick]);

  const rows = resolved.data ?? [];
  const meta = setsAsync.data?.find((s) => s.id === setId);

  const sharedAll = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of rows) for (const root of r.roots) count.set(root, (count.get(root) ?? 0) + 1);
    return new Set([...count.entries()].filter(([, c]) => c >= 2).map(([root]) => root));
  }, [rows]);

  const bumpLocal = () => setLocalTick((t) => t + 1);
  const drop = async (itemId: string) => { await archive.compare.removeItem(setId, itemId); bumpLocal(); onChanged(); };
  const clearAll = async () => {
    if (!confirm("Empty this comparison? It stays saved, just with no items.")) return;
    await archive.compare.clear(setId);
    bumpLocal();
    onChanged();
  };
  const saveTitle = async () => {
    await archive.compare.saveSet({ id: setId, title: titleDraft.trim() });
    setEditingTitle(false);
    bumpLocal();
    onChanged();
  };
  const toggle = (id: string) =>
    setCollapsed((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const surahName = (vk: string) => chapters.data?.find((c) => c.id === cnum(vk))?.name_simple ?? "";

  return (
    <div className="sheet compare-screen">
      <div className="cmp-board-bar">
        <button className="ctl" onClick={onBack}>‹ All</button>
        {editingTitle ? (
          <input
            className="cmp-title-input"
            autoFocus
            value={titleDraft}
            placeholder="name this comparison"
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setEditingTitle(false); }}
          />
        ) : (
          <button className="cmp-board-title" onClick={() => { setTitleDraft(meta?.title ?? ""); setEditingTitle(true); }}>
            {compareTitle(meta)} <span className="cmp-title-edit">✎</span>
          </button>
        )}
        <div className="spacer" />
        {isActive ? <span className="cmp-active-tag">active</span> : <button className="ctl" onClick={onSetActive}>Set active</button>}
      </div>

      {resolved.loading && <p className="loading">Laying out the thread…</p>}

      {!resolved.loading && rows.length === 0 ? (
        <p className="home-empty">Empty. Add āyāt or roots with “✚ Add to Compare” from anywhere.</p>
      ) : (
        <div className="cmp-timeline">
          {rows.map((r, i) => {
            const it = r.item;
            const isCollapsed = collapsed.has(it.id);
            const prev = i > 0 ? rows[i - 1]! : null;
            const sharedWithPrev = prev ? [...r.roots].filter((root) => prev.roots.has(root)) : [];
            const nodeShared = [...r.roots].some((root) => sharedAll.has(root));
            const first = i === 0;
            const last = i === rows.length - 1;
            const sharedSet = new Set(sharedWithPrev);
            return (
              <div key={it.id} className="cmp-tl-row">
                <div className="cmp-tl-gutter">
                  <span className={`cmp-tl-line${first ? " half-top" : ""}${last ? " half-bottom" : ""}`} />
                  <span className={`cmp-tl-node${nodeShared ? " shared" : ""}`} />
                </div>
                <section className="cmp-card">
                  {sharedWithPrev.length > 0 && (
                    <div className="cmp-merge">
                      <span className="cmp-merge-label">shares with above ↑</span>
                      <span className="cmp-merge-chips">
                        {sharedWithPrev.map((root) => (
                          <span key={root} className="cmp-merge-chip quran">{spaced(root)}</span>
                        ))}
                      </span>
                    </div>
                  )}
                  <div className="cmp-card-head" onClick={() => toggle(it.id)}>
                    <span className="cmp-caret">{isCollapsed ? "▸" : "▾"}</span>
                    <span className="cmp-kind">{it.kind === "ayah" ? "ĀYAH" : "ROOT"}</span>
                    <span className="cmp-card-key quran">
                      {it.kind === "ayah" ? `${it.ref} · ${surahName(it.ref)}` : spaced([...r.roots][0] ?? it.ref)}
                    </span>
                    <button className="cmp-x" title="Remove" onClick={(e) => { e.stopPropagation(); drop(it.id); }}>✕</button>
                  </div>

                  {!isCollapsed && (
                    it.kind === "ayah" ? (
                      <AyahBody
                        resolved={r}
                        shared={sharedSet}
                        translationOn={reading.translationOn}
                        translationId={reading.translationId}
                        script={reading.script}
                        noteOpen={noteFor === it.id}
                        onToggleNote={() => setNoteFor((cur) => (cur === it.id ? null : it.id))}
                        onRead={() => dispatch({ type: "jumpToVerse", verseKey: it.ref })}
                      />
                    ) : (
                      <RootBody buckwalter={it.ref} />
                    )
                  )}
                </section>
              </div>
            );
          })}
          <button className="cmp-clear-all" onClick={clearAll}>Clear all items</button>
        </div>
      )}
    </div>
  );
}

function AyahBody({
  resolved, shared, translationOn, translationId, script, noteOpen, onToggleNote, onRead,
}: {
  resolved: Resolved;
  shared: Set<string>;
  translationOn: boolean;
  translationId: number | null;
  script: import("../api/types").Script;
  noteOpen: boolean;
  onToggleNote: () => void;
  onRead: () => void;
}) {
  const vk = resolved.item.ref;
  const verse = useAsync(() => api.verse(vk, { script }), [vk, script]);
  const tr = useAsync(() => (translationOn ? api.verseTranslations(vk) : Promise.resolve([])), [vk, translationOn]);

  const translation = translationOn
    ? (translationId != null
        ? tr.data?.find((t) => t.resource_id === translationId)
        : tr.data?.find((t) => t.resource_type !== "tafsir")) ?? undefined
    : undefined;

  // wash the words whose root is shared with the item above
  const focusFor = shared.size
    ? (pos: number) => (resolved.words.some((w) => w.position === pos && w.root && shared.has(w.root)) ? ("shared" as const) : null)
    : undefined;

  return (
    <div className="cmp-body">
      <p className="cmp-verse quran" dir="rtl">
        <VerseText text={verse.data && typeof verse.data.text === "string" ? verse.data.text : ""} focusFor={focusFor} />
      </p>
      {translation && <p className="cmp-translation">{translation.text}</p>}
      <div className="cmp-card-actions">
        <button className="cmp-act" onClick={onToggleNote}>✎ Note</button>
        <button className="cmp-act" onClick={onRead}>Read →</button>
      </div>
      {noteOpen && (
        <div className="cmp-note-panel">
          <NotesPanel verseKey={vk} compact />
        </div>
      )}
    </div>
  );
}

function RootBody({ buckwalter }: { buckwalter: string }) {
  const dispatch = useAppDispatch();
  const detail = useAsync(() => api.root(buckwalter), [buckwalter]);
  const links = useAsync(() => api.rootLinkages(buckwalter, { scope: "ayah", limit: 8 }), [buckwalter]);
  const d = detail.data;

  return (
    <div className="cmp-body">
      {d && (
        <>
          <p className="cmp-root-ar quran">{spaced(d.root_arabic)}</p>
          <span className="cmp-sub">{d.total_occurrences} occ · {d.forms.length} forms</span>
          {d.meaning_en && <p className="cmp-root-meaning">{d.meaning_en}</p>}
          {d.meanings.slice(0, 2).map((m, i) => (
            <p key={i} className={`cmp-lex${m.language === "arabic" ? " quran" : ""}`} dir={m.language === "arabic" ? "rtl" : "ltr"}>
              <span className="cmp-lex-src">{m.source}</span> {m.meaning}
            </p>
          ))}
          {links.data && links.data.length > 0 && (
            <div className="cmp-colloc">
              <span className="cmp-sub">keeps company with</span>
              <div className="root-colloc">
                {links.data.map((l) => (
                  <button
                    key={l.root_buckwalter}
                    className="colloc-chip"
                    onClick={() => dispatch({ type: "openRoot", root: { buckwalter: l.root_buckwalter, arabic: l.root_arabic } })}
                  >
                    <span className="quran">{spaced(l.root_arabic)}</span>
                    <span className="colloc-strength">{l.cooccur}×</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="cmp-card-actions">
            <button className="cmp-act" onClick={() => dispatch({ type: "openRoot", root: { buckwalter, arabic: d.root_arabic } })}>
              Lexicon →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
