// ⌘K command palette — the fast way into everything: jump to an āyah (2:255) or a
// whole sūrah, open any screen, open a root, reopen a case, or run a search. Opens on ⌘K / Ctrl-K,
// on "/", or via the top-bar search affordance (which fires an `open-palette` event).

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useAppDispatch, type Tab } from "../state/store";
import { archive } from "../persistence/db";
import { foldAr } from "../lib/arabic";
import { useMe } from "../hooks/useMe";
import { GOTO } from "./Shortcuts";

interface Item {
  id: string;
  section: string;
  label: string;
  sub?: string;
  arabic?: string;
  run: () => void;
}

const spaced = (r: string) => r.split("").join("\u00A0"); // nbsp: root letters must not wrap (ه د ي)
// every screen, in the order the top bar shows them; `sub` says what it is
const DESTINATIONS: { tab: Tab; label: string; sub: string }[] = [
  { tab: "home", label: "Home", sub: "What you were reading and what you have in flight" },
  { tab: "read", label: "Read", sub: "The sūrahs, and the reader" },
  { tab: "search", label: "Search", sub: "By phrase, by related roots, or by grammar" },
  { tab: "investigate", label: "Investigate", sub: "Your cases and their evidence boards" },
  { tab: "roots", label: "Roots", sub: "Every root, its words and the dictionaries" },
  { tab: "links", label: "Rare links", sub: "What only a few āyāt share" },
  { tab: "mylinks", label: "My links", sub: "Your saved links, leads and speakers" },
  { tab: "spellings", label: "Spellings", sub: "Words written more than one way" },
  { tab: "rules", label: "Rule checks", sub: "A rule set against every place it applies" },
  { tab: "characters", label: "Characters", sub: "Names, titles and pronouns that point to one character" },
  { tab: "dialogue", label: "Dialogue", sub: "A sūrah as a script of who speaks to whom" },
  { tab: "supplications", label: "Supplications", sub: "Every place the Lord is addressed, and in which words" },
  { tab: "frame", label: "Opening and close", sub: "What a sūrah's first āyāt share with its last" },
  { tab: "motifs", label: "Motifs", sub: "Your groups of roots (بيوت)" },
  { tab: "compare", label: "Compare", sub: "Your side-by-side comparisons" },
  { tab: "vault", label: "Vault", sub: "The roots you have established" },
  { tab: "diverge", label: "Where I stand apart", sub: "Where your reading differs from the community's" },
  { tab: "guide", label: "Guide", sub: "How to use the app" },
];
/** g-chord key for each screen, shown beside it */
const CHORD = Object.fromEntries(Object.entries(GOTO).map(([k, t]) => [t, k])) as Partial<Record<Tab, string>>;

export function CommandPalette() {
  const dispatch = useAppDispatch();
  const { me } = useMe();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // open on ⌘K / Ctrl-K / "/" (not while typing), and on the top-bar event
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault(); setOpen((o) => !o); return;
      }
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault(); setOpen(true); return;
      }
    };
    const onEvent = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-palette", onEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-palette", onEvent);
    };
  }, []);

  // reset + focus each time it opens
  useEffect(() => {
    if (open) { setQ(""); setSel(0); requestAnimationFrame(() => inputRef.current?.focus()); }
  }, [open]);

  // data, loaded lazily the first time the palette opens
  const chapters = useAsync(() => (open ? api.chapters() : Promise.resolve([])), [open]);
  const roots = useAsync(() => (open ? api.listRoots({ limit: 2000 }) : Promise.resolve([])), [open]);
  const cases = useAsync(() => (open ? archive.cases.all() : Promise.resolve([])), [open]);

  const close = () => setOpen(false);
  const go = (fn: () => void) => { fn(); close(); };

  const items = useMemo<Item[]>(() => {
    const query = q.trim();
    const out: Item[] = [];
    const screens = me?.role === "maintainer"
      ? [...DESTINATIONS, { tab: "admin" as Tab, label: "Admin", sub: "Members, plans and access" }]
      : DESTINATIONS;
    const screen = (d: (typeof DESTINATIONS)[number]): Item => ({
      id: `go-${d.tab}`, section: "Screens", label: d.label,
      sub: CHORD[d.tab] ? `${d.sub} · g ${CHORD[d.tab]}` : d.sub,
      run: () => go(() => dispatch({ type: "setTab", tab: d.tab })),
    });
    if (!query) return screens.map(screen);

    // āyah key "2:255" or a bare surah number
    const key = /^(\d{1,3}):(\d{1,3})$/.exec(query);
    const surahNum = /^(\d{1,3})$/.exec(query);
    if (key) {
      const vk = `${key[1]}:${key[2]}`;
      out.push({ id: "ayah", section: "Go to", label: `Āyah ${vk}`,
        run: () => go(() => dispatch({ type: "jumpToVerse", verseKey: vk })) });
    } else if (surahNum) {
      const n = Number(surahNum[1]);
      const ch = chapters.data?.find((c) => c.id === n);
      if (n >= 1 && n <= 114) {
        out.push({ id: "surah", section: "Go to", label: `Sūrah ${n}${ch ? ` · ${ch.name_simple}` : ""}`,
          run: () => go(() => dispatch({ type: "jumpToVerse", verseKey: `${n}:1` })) });
      }
    }

    // screens by name or by what they are ("rare", "links", "guide"…)
    const ql = query.toLowerCase();
    for (const d of screens.filter((d) => d.label.toLowerCase().includes(ql) || d.sub.toLowerCase().includes(ql)).slice(0, 4)) {
      out.push(screen(d));
    }

    // surah by name
    for (const c of (chapters.data ?? []).filter((c) => c.name_simple.toLowerCase().includes(ql)).slice(0, 4)) {
      out.push({ id: `ch-${c.id}`, section: "Sūrahs", label: `${c.id}. ${c.name_simple}`,
        sub: `${c.verses_count} āyāt`, run: () => go(() => dispatch({ type: "jumpToVerse", verseKey: `${c.id}:1` })) });
    }

    // roots — by folded Arabic or buckwalter
    const qf = foldAr(query);
    const isArabic = /[؀-ۿ]/.test(query);
    for (const r of (roots.data ?? [])
      .filter((r) => (isArabic ? foldAr(r.root_arabic).includes(qf) : (r.root_buckwalter ?? "").includes(ql)))
      .slice(0, 6)) {
      out.push({ id: `root-${r.root_buckwalter}`, section: "Roots", label: spaced(r.root_arabic),
        arabic: r.root_arabic, sub: r.meaning_en ?? undefined,
        run: () => go(() => dispatch({ type: "openRoot", root: { buckwalter: r.root_buckwalter, arabic: r.root_arabic } })) });
    }

    // cases — by title or subject
    for (const c of (cases.data ?? [])
      .filter((c) => c.title?.toLowerCase().includes(ql) || c.subject?.value?.includes(query))
      .slice(0, 5)) {
      out.push({ id: `case-${c.id}`, section: "Cases", label: c.title || c.subject.value,
        sub: `${c.status} · ${c.cards.length} on board`,
        run: () => go(() => { dispatch({ type: "setActiveCase", caseId: c.id }); dispatch({ type: "setTab", tab: "investigate" }); }) });
    }

    // always offer to search the Book for the query
    out.push({ id: "search", section: "Actions", label: `Search the Book for “${query}”`,
      run: () => go(() => { dispatch({ type: "setSearchQuery", query }); dispatch({ type: "setTab", tab: "search" }); }) });
    return out;
  }, [q, chapters.data, roots.data, cases.data, dispatch, me?.role]);

  useEffect(() => { setSel((s) => Math.min(s, Math.max(0, items.length - 1))); }, [items.length]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); items[sel]?.run(); }
  };

  // group items by section, preserving order
  const sections: { name: string; items: Item[] }[] = [];
  for (const it of items) {
    let g = sections.find((s) => s.name === it.section);
    if (!g) { g = { name: it.section, items: [] }; sections.push(g); }
    g.items.push(it);
  }
  let flat = -1;

  return (
    <div className="cmdk-overlay" onMouseDown={close}>
      <div className="cmdk-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmdk-input-row">
          <span className="cmdk-search-ic" aria-hidden>⌕</span>
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Jump to an āyah (2:255), a sūrah, a root, a case, a screen — or search"
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={onKeyDown}
          />
          <span className="cmdk-esc">esc</span>
        </div>
        <div className="cmdk-list" role="listbox">
          {items.length === 0 && <p className="cmdk-empty">No matches.</p>}
          {sections.map((s) => (
            <div key={s.name} className="cmdk-section">
              <div className="cmdk-section-title">{s.name}</div>
              {s.items.map((it) => {
                flat++;
                const active = flat === sel;
                const idx = flat;
                return (
                  <button
                    key={it.id}
                    className={`cmdk-item${active ? " active" : ""}`}
                    onMouseEnter={() => setSel(idx)}
                    onClick={() => it.run()}
                  >
                    {it.arabic
                      ? <span className="cmdk-ar quran">{it.label}</span>
                      : <span className="cmdk-label">{it.label}</span>}
                    {it.sub && <span className="cmdk-sub">{it.sub}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="cmdk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
