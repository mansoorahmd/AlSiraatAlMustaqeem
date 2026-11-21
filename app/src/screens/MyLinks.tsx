// My links — everything the reader has tied together across the Book, in one place:
//
//   Links     every kept link, both ends shown with their words lit; edit kind / group / note
//   Leads     links with one end still to find, oldest first — the "pursue later" list
//   Groups    the names links are grouped under (one image, one theme), with counts; rename
//   Coverage  every sūrah: how many of its āyāt are an end of a kept link
//   Speakers  who speaks and who is addressed, as the reader tagged it
//   Tensions  links the reader saved as "these seem to disagree (to me)": open ones first, each
//             settled in the reader's own words, or reopened
//
// Links are saved from the reader's Links panel (components/reader/LinksPanel.tsx). What the
// assistant proposed sits apart, with Accept / Dismiss, until the reader decides.

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { api, announcePlanLock } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useVerseTexts } from "../hooks/useVerseTexts";
import { useAppDispatch } from "../state/store";
import { useFeature, useFeatureCatalog, lockReason, type PlanFeature } from "../lib/features";
import { archive } from "../persistence/db";
import { PlanLock } from "../components/PlanLock";
import { FeatureGate } from "../components/FeatureGate";
import { VerseText } from "../components/VerseText";
import { tokenizeVerse } from "../components/reader/format";
import { DeleteButton, SAVED_KIND_OPTIONS } from "../components/reader/LinkForms";
import type { Chapter } from "../api/types";
import type { SavedLink, SavedLinkKind, SpeakerTag } from "../persistence/types";

type View = "links" | "leads" | "tensions" | "groups" | "coverage" | "speakers";
const VIEWS: { id: View; label: string }[] = [
  { id: "links", label: "Links" },
  { id: "leads", label: "Leads" },
  { id: "tensions", label: "Tensions" },
  { id: "groups", label: "Groups" },
  { id: "coverage", label: "Coverage" },
  { id: "speakers", label: "Speakers" },
];

const SPAN_WASH = "#fde68a";
const PAGE = 30;
const isLead = (l: SavedLink) => !l.b || l.status === "lead";
const chapterOf = (k: string) => parseInt(k.split(":")[0] ?? "", 10) || 0;
const verseNo = (k: string) => parseInt(k.split(":")[1] ?? "", 10) || 0;
const byPlace = (x: string, y: string) => chapterOf(x) - chapterOf(y) || verseNo(x) - verseNo(y);
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** The kind in plain words, read across the whole link (a → b). */
function kindText(l: SavedLink): string {
  if (l.kind === "defined" && l.b) return `explained in ${l.a.verseKey}, used in ${l.b.verseKey}`;
  return SAVED_KIND_OPTIONS.find((k) => k.id === l.kind)?.label ?? "Not said";
}

/** A change control's click: the action when the plan allows it, else a toast saying why. */
function useGate() {
  const catalog = useFeatureCatalog();
  return (ok: boolean, f: PlanFeature, fn: () => void) => (ok ? fn : () => announcePlanLock(lockReason(f, catalog)));
}

// ---------------------------------------------------------------- one end ----

/** One place in the Book: its key and sūrah, the āyah with the span lit; a click opens the reader there. */
function EndView({ end, text, surahName, what }: {
  end: { verseKey: string; word: number; words: number | null };
  text: string | undefined;
  surahName: (k: string) => string;
  what?: string;
}) {
  const dispatch = useAppDispatch();
  const length = end.words ?? Math.max(1, (text ? tokenizeVerse(text).filter((t) => t.position !== null).length : end.word) - end.word + 1);
  const name = surahName(end.verseKey);
  return (
    <button
      className="search-row ml-end"
      onClick={() => dispatch({ type: "jumpToEcho", verseKey: end.verseKey, start: end.word, length })}
      title={`Read ${end.verseKey} with these words lit`}
    >
      <span className="search-ref">
        {what && <span className="ml-end-what">{what} · </span>}
        {end.verseKey}{name ? ` · ${name}` : ""}
      </span>
      <span className="search-verse quran" dir="rtl">
        {text === undefined
          ? "…"
          : <VerseText text={text} highlightRanges={[{ start: end.word, end: end.word + length - 1, color: SPAN_WASH }]} />}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- a link ----

function LinkCard({ l, texts, surahName, labels, canEdit, onChanged }: {
  l: SavedLink;
  texts: Map<string, string>;
  surahName: (k: string) => string;
  labels: string[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const gate = useGate();
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<SavedLinkKind>(l.kind);
  const [label, setLabel] = useState(l.label);
  const [note, setNote] = useState(l.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listId = `ml-groups-${l.id}`;

  const open = () => { setKind(l.kind); setLabel(l.label); setNote(l.note); setError(null); setEditing(true); };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await archive.links.save({ ...l, kind, label: label.trim(), note: note.trim() });
      setEditing(false);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
    else if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); void save(); }
  };

  return (
    <li className="ml-card">
      <div className="ml-ends">
        <EndView end={l.a} text={texts.get(l.a.verseKey)} surahName={surahName} what={l.b ? "First" : "Noticed"} />
        {l.b && <EndView end={l.b} text={texts.get(l.b.verseKey)} surahName={surahName} what="Second" />}
      </div>

      {editing ? (
        <div className="ml-edit" onKeyDown={keys}>
          {error && <p className="ml-error" role="alert">{error}</p>}
          <div className="ml-edit-grid">
            <div className="ml-field">
              <label htmlFor={`ml-kind-${l.id}`}>What they share</label>
              <select id={`ml-kind-${l.id}`} value={kind} onChange={(e) => setKind(e.target.value as SavedLinkKind)}>
                {SAVED_KIND_OPTIONS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
            </div>
            <div className="ml-field">
              <label htmlFor={`ml-label-${l.id}`}>Group</label>
              <input id={`ml-label-${l.id}`} list={listId} value={label} placeholder="none"
                onChange={(e) => setLabel(e.target.value)} autoFocus />
              <datalist id={listId}>{labels.map((x) => <option key={x} value={x} />)}</datalist>
            </div>
          </div>
          <div className="ml-field">
            <label htmlFor={`ml-note-${l.id}`}>Note</label>
            <textarea id={`ml-note-${l.id}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="ml-actions">
            <button className="ctl ml-secondary" onClick={() => setEditing(false)}>Cancel</button>
            <button className="ctl primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </div>
      ) : (
        <dl className="ml-values">
          <div><dt>What they share</dt><dd>{l.b ? kindText(l) : "Lead: the other end is still to find"}</dd></div>
          <div><dt>Group</dt><dd>{l.label || <span className="ml-none">none</span>}</dd></div>
          <div className="ml-wide"><dt>Note</dt><dd>{l.note || <span className="ml-none">none</span>}</dd></div>
        </dl>
      )}

      {!editing && (
        <div className="ml-item-actions">
          <button
            className={`ctl ml-secondary${canEdit ? "" : " plan-locked"}`}
            onClick={gate(canEdit, "links", open)}
            title="Edit what they share, the group and the note"
          >
            <span className="ml-ic" aria-hidden="true">✎</span>Edit{!canEdit && <> <PlanLock feature="links" /></>}
          </button>
          {canEdit && (
            <DeleteButton what={isLead(l) ? "lead" : "link"} onDelete={async () => { await archive.links.remove(l.id); onChanged(); }} />
          )}
        </div>
      )}
    </li>
  );
}

/** A list of links, a page at a time, with the āyah texts its visible rows need. */
function LinkList({ links, surahName, labels, canEdit, onChanged, empty }: {
  links: SavedLink[];
  surahName: (k: string) => string;
  labels: string[];
  canEdit: boolean;
  onChanged: () => void;
  empty: string;
}) {
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [links.length]);
  const page = links.slice(0, shown);
  const keys = useMemo(() => [...new Set(page.flatMap((l) => (l.b ? [l.a.verseKey, l.b.verseKey] : [l.a.verseKey])))], [page]);
  const texts = useVerseTexts(keys);
  if (links.length === 0) return <p className="home-empty">{empty}</p>;
  return (
    <>
      <ul className="ml-list">
        {page.map((l) => (
          <LinkCard key={l.id} l={l} texts={texts} surahName={surahName} labels={labels} canEdit={canEdit} onChanged={onChanged} />
        ))}
      </ul>
      {links.length > shown && (
        <div className="ml-more">
          <button className="ctl ml-secondary" onClick={() => setShown((s) => s + PAGE)}>
            Show {Math.min(PAGE, links.length - shown)} more
          </button>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------- proposals ----

function Proposals({ links, speech, surahName, onChanged }: {
  links: SavedLink[];
  speech: SpeakerTag[];
  surahName: (k: string) => string;
  onChanged: () => void;
}) {
  const gate = useGate();
  const canLinks = useFeature("links");
  const canSpeakers = useFeature("speakers");
  const keys = useMemo(() => [...new Set([
    ...links.flatMap((l) => (l.b ? [l.a.verseKey, l.b.verseKey] : [l.a.verseKey])),
    ...speech.map((t) => t.verseKey),
  ])], [links, speech]);
  const texts = useVerseTexts(keys);
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<void>) => async () => {
    setError(null);
    try { await fn(); onChanged(); } catch (e) { setError((e as Error).message); }
  };
  if (links.length === 0 && speech.length === 0) return null;

  return (
    <section className="ml-proposed" aria-label="Proposed by your assistant">
      <h2 className="ml-title">Proposed by your assistant</h2>
      <p className="ml-hint">Nothing here is yours until you accept it. Dismiss removes the proposal.</p>
      {error && <p className="ml-error" role="alert">{error}</p>}
      <ul className="ml-list">
        {links.map((l) => (
          <li key={l.id} className="ml-card proposed">
            <div className="ml-ends">
              <EndView end={l.a} text={texts.get(l.a.verseKey)} surahName={surahName} what={l.b ? "First" : "Noticed"} />
              {l.b && <EndView end={l.b} text={texts.get(l.b.verseKey)} surahName={surahName} what="Second" />}
            </div>
            <dl className="ml-values">
              <div><dt>What they share</dt><dd>{l.b ? kindText(l) : "Lead: the other end is still to find"}</dd></div>
              <div><dt>Group</dt><dd>{l.label || <span className="ml-none">none</span>}</dd></div>
              <div className="ml-wide"><dt>Note</dt><dd>{l.note || <span className="ml-none">none</span>}</dd></div>
            </dl>
            <div className="ml-item-actions">
              <button className={`ctl primary${canLinks ? "" : " plan-locked"}`}
                onClick={gate(canLinks, "links", act(() => archive.proposed.accept("link", l.id)))}>
                Accept{!canLinks && <> <PlanLock feature="links" /></>}
              </button>
              <button className={`ctl ml-secondary${canLinks ? "" : " plan-locked"}`}
                onClick={gate(canLinks, "links", act(() => archive.links.remove(l.id)))}>Dismiss</button>
            </div>
          </li>
        ))}
        {speech.map((t) => (
          <li key={t.id} className="ml-card proposed">
            <EndView end={t} text={texts.get(t.verseKey)} surahName={surahName}
              what={`${t.speaker || "someone"} speaks${t.addressee ? ` to ${t.addressee}` : ""}`} />
            {t.note && <p className="ml-note">{t.note}</p>}
            <div className="ml-item-actions">
              <button className={`ctl primary${canSpeakers ? "" : " plan-locked"}`}
                onClick={gate(canSpeakers, "speakers", act(() => archive.proposed.accept("speech", t.id)))}>
                Accept{!canSpeakers && <> <PlanLock feature="speakers" /></>}
              </button>
              <button className={`ctl ml-secondary${canSpeakers ? "" : " plan-locked"}`}
                onClick={gate(canSpeakers, "speakers", act(() => archive.speech.remove(t.id)))}>Dismiss</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ views ----

function LinksView({ kept, chapters, surahName, labels, canEdit, onChanged }: {
  kept: SavedLink[];
  chapters: Chapter[];
  surahName: (k: string) => string;
  labels: string[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [kind, setKind] = useState<"all" | SavedLinkKind>("all");
  const [group, setGroup] = useState<string>("all");
  const [surah, setSurah] = useState<number>(0);
  const surahsUsed = useMemo(() => {
    const s = new Set<number>();
    for (const l of kept) { s.add(chapterOf(l.a.verseKey)); if (l.b) s.add(chapterOf(l.b.verseKey)); }
    return chapters.filter((c) => s.has(c.id));
  }, [kept, chapters]);
  const list = kept.filter((l) =>
    (kind === "all" || l.kind === kind) &&
    (group === "all" || (group === "" ? !l.label : l.label === group)) &&
    (!surah || chapterOf(l.a.verseKey) === surah || (l.b && chapterOf(l.b.verseKey) === surah)));

  return (
    <>
      <div className="ml-filters">
        <div className="ml-field">
          <label htmlFor="ml-f-kind">What they share</label>
          <select id="ml-f-kind" value={kind} onChange={(e) => setKind(e.target.value as "all" | SavedLinkKind)}>
            <option value="all">any</option>
            {SAVED_KIND_OPTIONS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </div>
        <div className="ml-field">
          <label htmlFor="ml-f-group">Group</label>
          <select id="ml-f-group" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="all">any</option>
            <option value="">no group</option>
            {labels.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <div className="ml-field">
          <label htmlFor="ml-f-surah">Sūrah</label>
          <select id="ml-f-surah" value={surah} onChange={(e) => setSurah(Number(e.target.value))}>
            <option value={0}>any</option>
            {surahsUsed.map((c) => <option key={c.id} value={c.id}>{c.id}. {c.name_simple}</option>)}
          </select>
        </div>
      </div>
      <p className="search-count">
        {list.length === kept.length ? plural(kept.length, "link", "links") : `${list.length.toLocaleString()} of ${plural(kept.length, "link", "links")}`}
      </p>
      <LinkList
        links={list} surahName={surahName} labels={labels} canEdit={canEdit} onChanged={onChanged}
        empty={kept.length === 0
          ? "No links yet. In the reader, open an āyah's Links panel and save a link between two places."
          : "No link matches these filters."}
      />
    </>
  );
}

function LeadsView({ leads, surahName, canEdit, onChanged }: {
  leads: SavedLink[];
  surahName: (k: string) => string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const dispatch = useAppDispatch();
  const gate = useGate();
  const [shown, setShown] = useState(PAGE);
  const page = leads.slice(0, shown);
  const texts = useVerseTexts(useMemo(() => [...new Set(page.map((l) => l.a.verseKey))], [page]));
  if (leads.length === 0) {
    return <p className="home-empty">No leads. A lead is something you noticed in an āyah whose other end you have yet to find; keep one from the reader's Links panel.</p>;
  }
  return (
    <>
      <p className="search-count">{plural(leads.length, "lead", "leads")}, oldest first</p>
      <ul className="ml-list">
        {page.map((l) => (
          <li key={l.id} className="ml-card">
            <EndView end={l.a} text={texts.get(l.a.verseKey)} surahName={surahName}
              what={l.createdAt ? `Noticed ${new Date(l.createdAt).toISOString().slice(0, 10)}` : "Noticed"} />
            {(l.note || l.label) && (
              <dl className="ml-values">
                {l.label && <div><dt>Group</dt><dd>{l.label}</dd></div>}
                {l.note && <div className="ml-wide"><dt>Note</dt><dd>{l.note}</dd></div>}
              </dl>
            )}
            <div className="ml-item-actions">
              <button
                className="ctl primary"
                onClick={() => dispatch({ type: "jumpToEcho", verseKey: l.a.verseKey, start: l.a.word, length: l.a.words })}
              >Go to the āyah</button>
              {canEdit
                ? <DeleteButton what="lead" onDelete={async () => { await archive.links.remove(l.id); onChanged(); }} />
                : <button className="ctl ml-secondary plan-locked" onClick={gate(false, "links", () => {})}>Delete <PlanLock feature="links" /></button>}
            </div>
          </li>
        ))}
      </ul>
      {leads.length > shown && (
        <div className="ml-more">
          <button className="ctl ml-secondary" onClick={() => setShown((s) => s + PAGE)}>Show {Math.min(PAGE, leads.length - shown)} more</button>
        </div>
      )}
    </>
  );
}

/** One tension: both ends, the note, and how it was settled, or the way to settle it. */
function TensionCard({ l, texts, surahName, canEdit, onChanged }: {
  l: SavedLink;
  texts: Map<string, string>;
  surahName: (k: string) => string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const gate = useGate();
  const [settling, setSettling] = useState(false);
  const [how, setHow] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: Partial<SavedLink>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await archive.links.save({ ...l, ...patch });
      setSettling(false);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const settle = () => {
    if (!how.trim()) { setError("Say in one line how it was settled."); return; }
    void save({ resolved: true, resolution: how.trim() });
  };

  return (
    <li className={`ml-card ml-tension${l.resolved ? " settled" : ""}`}>
      <div className="ml-tension-head">
        <span className={`ml-tension-chip${l.resolved ? " settled" : ""}`}>{l.resolved ? "settled" : "open"}</span>
        {l.label && <span className="ml-tension-group">{l.label}</span>}
      </div>
      <div className="ml-ends">
        <EndView end={l.a} text={texts.get(l.a.verseKey)} surahName={surahName} what={l.b ? "One" : "Noticed"} />
        {l.b && <EndView end={l.b} text={texts.get(l.b.verseKey)} surahName={surahName} what="The other" />}
      </div>
      {error && <p className="ml-error" role="alert">{error}</p>}
      <dl className="ml-values">
        <div className="ml-wide"><dt>Note</dt><dd>{l.note || <span className="ml-none">none</span>}</dd></div>
        {l.resolved && (
          <div className="ml-wide"><dt>How it was settled</dt><dd>{l.resolution || <span className="ml-none">not said</span>}</dd></div>
        )}
      </dl>
      {settling ? (
        <div className="ml-edit" onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); setSettling(false); }
          else if (e.key === "Enter") { e.preventDefault(); settle(); }
        }}>
          <div className="ml-field">
            <label htmlFor={`ml-settle-${l.id}`}>How was it settled? (one line)</label>
            <input id={`ml-settle-${l.id}`} value={how} onChange={(e) => setHow(e.target.value)} autoFocus />
          </div>
          <div className="ml-actions">
            <button className="ctl ml-secondary" onClick={() => setSettling(false)}>Cancel</button>
            <button className="ctl primary" onClick={settle} disabled={busy}>{busy ? "Saving…" : "Mark as settled"}</button>
          </div>
        </div>
      ) : (
        <div className="ml-item-actions">
          {l.resolved ? (
            <button
              className={`ctl ml-secondary${canEdit ? "" : " plan-locked"}`}
              disabled={busy}
              onClick={gate(canEdit, "links", () => void save({ resolved: false }))}
            >
              <span className="ml-ic" aria-hidden="true">↺</span>Reopen{!canEdit && <> <PlanLock feature="links" /></>}
            </button>
          ) : (
            <button
              className={`ctl primary${canEdit ? "" : " plan-locked"}`}
              onClick={gate(canEdit, "links", () => { setHow(l.resolution ?? ""); setError(null); setSettling(true); })}
            >
              <span className="ml-ic" aria-hidden="true">✓</span>Mark as settled{!canEdit && <> <PlanLock feature="links" /></>}
            </button>
          )}
          {canEdit && <DeleteButton what="tension" onDelete={async () => { await archive.links.remove(l.id); onChanged(); }} />}
        </div>
      )}
    </li>
  );
}

function TensionsView({ tensions, surahName, canEdit, onChanged }: {
  tensions: SavedLink[];
  surahName: (k: string) => string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [shown, setShown] = useState(PAGE);
  const page = tensions.slice(0, shown);
  const keys = useMemo(() => [...new Set(page.flatMap((l) => (l.b ? [l.a.verseKey, l.b.verseKey] : [l.a.verseKey])))], [page]);
  const texts = useVerseTexts(keys);
  const open = tensions.filter((l) => !l.resolved).length;
  if (tensions.length === 0) {
    return (
      <p className="home-empty">
        No tensions saved. When two places seem to you to disagree, save a link between them in the reader's
        Links panel with “These seem to disagree (to me)”, and settle it here once you have worked it out.
      </p>
    );
  }
  return (
    <>
      <p className="search-count">{plural(open, "open tension", "open tensions")} · {tensions.length - open} settled</p>
      <ul className="ml-list">
        {page.map((l) => (
          <TensionCard key={l.id} l={l} texts={texts} surahName={surahName} canEdit={canEdit} onChanged={onChanged} />
        ))}
      </ul>
      {tensions.length > shown && (
        <div className="ml-more">
          <button className="ctl ml-secondary" onClick={() => setShown((s) => s + PAGE)}>Show {Math.min(PAGE, tensions.length - shown)} more</button>
        </div>
      )}
    </>
  );
}

function GroupsView({ own, surahName, labels, canEdit, onChanged }: {
  own: SavedLink[];
  surahName: (k: string) => string;
  labels: string[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const gate = useGate();
  const [open, setOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of own) if (l.label) m.set(l.label, (m.get(l.label) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [own]);
  const members = open ? own.filter((l) => l.label === open) : [];

  const rename = async () => {
    const to = name.trim();
    if (!open || !to || to === open || busy) { setRenaming(false); return; }
    setBusy(true);
    setError(null);
    try {
      for (const l of members) await archive.links.save({ ...l, label: to });
      setOpen(to);
      setRenaming(false);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (counts.length === 0) {
    return <p className="home-empty">No groups yet. Give links a group name (one image, one theme) when you save or edit them.</p>;
  }
  return (
    <>
      <div className="ml-groups">
        {counts.map(([g, n]) => (
          <button
            key={g}
            className={`ml-group${open === g ? " active" : ""}`}
            aria-pressed={open === g}
            onClick={() => { setOpen(open === g ? null : g); setRenaming(false); setError(null); }}
          >
            <span className="ml-group-name">{g}</span>
            <span className="ml-group-count">{plural(n, "link", "links")}</span>
          </button>
        ))}
      </div>
      {open && (
        <section className="ml-group-open">
          {error && <p className="ml-error" role="alert">{error}</p>}
          {renaming ? (
            <div className="ml-rename" onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void rename(); }
              if (e.key === "Escape") { e.preventDefault(); setRenaming(false); }
            }}>
              <div className="ml-field">
                <label htmlFor="ml-rename">New name for “{open}”</label>
                <input id="ml-rename" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </div>
              <div className="ml-actions">
                <button className="ctl ml-secondary" onClick={() => setRenaming(false)}>Cancel</button>
                <button className="ctl primary" onClick={rename} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
              </div>
            </div>
          ) : (
            <div className="ml-group-head">
              <h2 className="ml-title">{open}</h2>
              <button
                className={`ctl ml-secondary${canEdit ? "" : " plan-locked"}`}
                onClick={gate(canEdit, "links", () => { setName(open); setRenaming(true); })}
              >
                <span className="ml-ic" aria-hidden="true">✎</span>Rename{!canEdit && <> <PlanLock feature="links" /></>}
              </button>
            </div>
          )}
          <LinkList links={members} surahName={surahName} labels={labels} canEdit={canEdit} onChanged={onChanged} empty="This group is empty." />
        </section>
      )}
    </>
  );
}

function CoverageView({ chapters }: { chapters: Chapter[] }) {
  const dispatch = useAppDispatch();
  const coverage = useAsync(() => archive.links.coverage(), []);
  const [open, setOpen] = useState<number | null>(null);
  const byChapter = useMemo(() => new Map((coverage.data ?? []).map((c) => [c.chapter, c])), [coverage.data]);
  const totalAyat = chapters.reduce((s, c) => s + c.verses_count, 0);
  const linked = (coverage.data ?? []).reduce((s, c) => s + c.linked.length, 0);

  if (coverage.error) return <p className="ml-error" role="alert">Couldn't load coverage: {coverage.error.message}</p>;
  if (coverage.loading && !coverage.data) return <p className="loading">Counting…</p>;
  const sel = open ? chapters.find((c) => c.id === open) : undefined;
  const cov = open ? byChapter.get(open) : undefined;

  return (
    <>
      <p className="search-count">
        {linked.toLocaleString()} of {totalAyat.toLocaleString()} āyāt linked. The deeper the tint, the larger the
        share of the sūrah's āyāt that are an end of a kept link; a dashed edge means leads only.
      </p>
      <div className="ml-coverage">
        {chapters.map((c) => {
          const cv = byChapter.get(c.id);
          const n = cv?.linked.length ?? 0;
          const leadsOnly = n === 0 && (cv?.leads.length ?? 0) > 0;
          const share = c.verses_count ? n / c.verses_count : 0;
          return (
            <button
              key={c.id}
              className={`ml-cell${leadsOnly ? " leads" : ""}${open === c.id ? " active" : ""}`}
              style={n > 0 ? { background: `color-mix(in srgb, var(--gold) ${Math.round(10 + share * 40)}%, var(--paper))` } : undefined}
              onClick={() => setOpen(open === c.id ? null : c.id)}
              aria-pressed={open === c.id}
              title={`${c.id}. ${c.name_simple}: ${n} of ${c.verses_count} āyāt linked${leadsOnly ? " (leads only)" : ""}`}
            >
              <span className="ml-cell-name">{c.id}. {c.name_simple}</span>
              <span className="ml-cell-count">{n} / {c.verses_count}</span>
            </button>
          );
        })}
      </div>
      {sel && (
        <section className="ml-group-open">
          <h2 className="ml-title">{sel.id}. {sel.name_simple}</h2>
          {(cov?.linked.length ?? 0) > 0 ? (
            <div className="ml-chips">
              {[...(cov?.linked ?? [])].sort(byPlace).map((k) => (
                <button key={k} className="chip echo-chip" title={`Read ${k}`}
                  onClick={() => dispatch({ type: "jumpToVerse", verseKey: k })}>{k}</button>
              ))}
            </div>
          ) : <p className="ml-hint">No āyah in this sūrah is an end of a kept link yet.</p>}
          {(cov?.leads.length ?? 0) > 0 && (
            <>
              <p className="ml-hint">Leads here:</p>
              <div className="ml-chips">
                {[...(cov?.leads ?? [])].sort(byPlace).map((k) => (
                  <button key={k} className="chip echo-chip" title={`Read ${k}`}
                    onClick={() => dispatch({ type: "jumpToVerse", verseKey: k })}>{k}</button>
                ))}
              </div>
            </>
          )}
          <p className="ml-hint">{plural(sel.verses_count - (cov?.linked.length ?? 0), "āyah", "āyāt")} with no link yet.</p>
        </section>
      )}
    </>
  );
}

function SpeakersView({ surahName }: { surahName: (k: string) => string }) {
  const names = useAsync(() => archive.speech.speakers(), []);
  const [open, setOpen] = useState<string | null>(null);
  const spans = useAsync(async () => {
    if (!open) return null;
    const [speaks, addressed] = await Promise.all([archive.speech.bySpeaker(open), archive.speech.byAddressee(open)]);
    const own = (l: SpeakerTag[]) => l.filter((t) => t.source !== "ai").sort((a, b) => byPlace(a.verseKey, b.verseKey) || a.word - b.word);
    return { speaks: own(speaks), addressed: own(addressed) };
  }, [open]);
  const texts = useVerseTexts(useMemo(() => [...new Set([
    ...(spans.data?.speaks ?? []), ...(spans.data?.addressed ?? []),
  ].map((t) => t.verseKey))], [spans.data]));

  if (names.error) return <p className="ml-error" role="alert">Couldn't load speakers: {names.error.message}</p>;
  if (names.loading && !names.data) return <p className="loading">Loading…</p>;
  const list = names.data ?? [];
  if (list.length === 0) {
    return <p className="home-empty">No speakers tagged yet. In the reader's Links panel, tag who speaks in a span of an āyah and to whom.</p>;
  }
  const spanList = (items: SpeakerTag[], empty: string) => items.length === 0 ? <p className="ml-hint">{empty}</p> : (
    <ul className="ml-list">
      {items.map((t) => (
        <li key={t.id} className="ml-card">
          <EndView end={t} text={texts.get(t.verseKey)} surahName={surahName}
            what={`${t.speaker || "someone"} to ${t.addressee || "someone"}`} />
          {t.note && <p className="ml-note">{t.note}</p>}
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <div className="ml-groups">
        {list.map((s) => (
          <button key={s.name} className={`ml-group${open === s.name ? " active" : ""}`} aria-pressed={open === s.name}
            onClick={() => setOpen(open === s.name ? null : s.name)}>
            <span className="ml-group-name">{s.name}</span>
            <span className="ml-group-count">speaks {s.speaks} · addressed {s.addressed}</span>
          </button>
        ))}
      </div>
      {open && (
        <section className="ml-group-open">
          {spans.error && <p className="ml-error" role="alert">{spans.error.message}</p>}
          {spans.loading && !spans.data ? <p className="loading">Loading…</p> : (
            <>
              <h2 className="ml-title">{open} speaks</h2>
              {spanList(spans.data?.speaks ?? [], `No span where ${open} speaks.`)}
              <h2 className="ml-title">Addressed to {open}</h2>
              {spanList(spans.data?.addressed ?? [], `No span addressed to ${open}.`)}
            </>
          )}
        </section>
      )}
    </>
  );
}

// ----------------------------------------------------------------- screen ----

export function MyLinks() {
  const canLinks = useFeature("links");
  const [view, setView] = useState<View>("links");
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);

  const links = useAsync(() => archive.links.all(), [version]);
  const proposed = useAsync(() => archive.proposed.all(), [version]);
  const chapters = useAsync(() => api.chapters(), []);
  const surahName = (key: string) => chapters.data?.find((c) => c.id === chapterOf(key))?.name_simple ?? "";

  const own = useMemo(() => (links.data ?? []).filter((l) => l.source !== "ai"), [links.data]);
  const kept = useMemo(() => own.filter((l) => !isLead(l)).sort((x, y) => byPlace(x.a.verseKey, y.a.verseKey) || x.a.word - y.a.word), [own]);
  const leads = useMemo(() => own.filter(isLead).sort((x, y) => (x.createdAt ?? 0) - (y.createdAt ?? 0)), [own]);
  const labels = useMemo(() => [...new Set(own.map((l) => l.label).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [own]);
  // open tensions first, then the settled ones; each part in Book order
  const tensions = useMemo(() => own.filter((l) => l.kind === "tension")
    .sort((x, y) => Number(!!x.resolved) - Number(!!y.resolved) || byPlace(x.a.verseKey, y.a.verseKey) || x.a.word - y.a.word), [own]);
  const openTensions = tensions.filter((l) => !l.resolved).length;
  const count: Partial<Record<View, number>> = { links: kept.length, leads: leads.length, tensions: openTensions, groups: labels.length };

  return (
    <div className="sheet ml-screen">
      <header className="home-head">
        <h1>My links</h1>
        <p className="subtitle">
          The links you have saved between places in the Book, the leads you mean to follow up, and who
          speaks where. Save new ones from an āyah's Links panel in the reader.
        </p>
      </header>

      {(links.error || proposed.error) && (
        <p className="ml-error" role="alert">Couldn't load your links: {(links.error ?? proposed.error)!.message}</p>
      )}

      <Proposals links={proposed.data?.links ?? []} speech={proposed.data?.speech ?? []} surahName={surahName} onChanged={reload} />

      <div className="ml-views ml-views-6" role="tablist" aria-label="My links views">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={view === v.id}
            className={`ctl ml-view${view === v.id ? " active" : ""}`}
            onClick={() => setView(v.id)}
          >
            {v.label}{count[v.id] !== undefined && <span className="ml-view-count">{count[v.id]}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {links.loading && !links.data ? <p className="loading">Loading your links…</p> : (
          <>
            {view === "links" && <LinksView kept={kept} chapters={chapters.data ?? []} surahName={surahName} labels={labels} canEdit={canLinks} onChanged={reload} />}
            {view === "leads" && <LeadsView leads={leads} surahName={surahName} canEdit={canLinks} onChanged={reload} />}
            {view === "tensions" && <TensionsView tensions={tensions} surahName={surahName} canEdit={canLinks} onChanged={reload} />}
            {view === "groups" && <GroupsView own={own} surahName={surahName} labels={labels} canEdit={canLinks} onChanged={reload} />}
            {view === "coverage" && <CoverageView key={version} chapters={chapters.data ?? []} />}
            {view === "speakers" && (
              <FeatureGate feature="speakers" mode="readonly"><SpeakersView key={version} surahName={surahName} /></FeatureGate>
            )}
          </>
        )}
      </div>
    </div>
  );
}
