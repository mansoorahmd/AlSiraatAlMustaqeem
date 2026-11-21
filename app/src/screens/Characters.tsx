// Characters: someone the reader names, and the places in the Book that point to them.
//
//   list       every character, with how many places are established and how many potential
//   character  its names, titles and descriptions (each a scope the corpus finds), the places
//              filed under it (grouped by name, then sūrah), and "Who uses which name": the
//              character's places crossed with the reader's own speaker tags, counted by speaker
//
// Filing is cheap and reversible: a name's places go in as POTENTIAL. Only the reader makes one
// ESTABLISHED. An assistant's mentions are suggestions until the reader accepts them. The app
// counts; it never says what a count means.

import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useVerseTexts } from "../hooks/useVerseTexts";
import { useAppDispatch, useAppState } from "../state/store";
import { useFeature } from "../lib/features";
import { archive, newId } from "../persistence/db";
import { PlanLock } from "../components/PlanLock";
import { FeatureGate } from "../components/FeatureGate";
import { DeleteButton } from "../components/reader/LinkForms";
import {
  SCOPE_KIND_LABEL, scopeShown, typedScope, MatchInput, PlaceText, ConfirmButton, useGate,
  byPlace, chapterOf, plural, type MatchKind,
} from "../components/research/places";
import type { Chapter } from "../api/types";
import type { Character, Designation, Mention, MentionStatus, SpeakerTag } from "../persistence/types";

const PAGE = 40;
type As = Designation["as"];
const AS_LABEL: Record<As, string> = { name: "Name", title: "Title", description: "Description" };
const AS_OPTIONS: As[] = ["name", "title", "description"];
const BY_HAND = "";

const isAi = (m: Mention) => m.source === "ai";
/** what is sent back when the character itself is saved (never its mentions or counts) */
function characterDoc(c: Character): Character {
  const { mentions: _m, counts: _c, ...rest } = c;
  return rest;
}
const sameScope = (a: Designation, b: { kind: string; key: string }) => a.kind === b.kind && a.key === b.key;

// --------------------------------------------------------- one designation ----

function DesignationRow({ ch, d, mentions, canEdit, onChanged }: {
  ch: Character;
  d: Designation;
  /** the mentions filed under this designation */
  mentions: Mention[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const gate = useGate();
  const occ = useAsync(() => api.occurrences(d, { limit: 6000 }), [d.kind, d.key, JSON.stringify(d.query ?? null)]);
  const filed = new Set(mentions.map((m) => `${m.verseKey}|${m.word}`));
  const established = mentions.filter((m) => m.status === "established" && !isAi(m)).length;
  const unfiled = (occ.data?.places ?? []).filter((p) => !filed.has(`${p.verseKey}|${p.word}`));
  const [error, setError] = useState<string | null>(null);

  const fileUnfiled = async () => {
    setError(null);
    try {
      await archive.mentions.add(unfiled.map((p) => ({
        characterId: ch.id, verseKey: p.verseKey, word: p.word, words: p.words, kind: d.as, designation: d.text,
      })));
      onChanged();
    } catch (e) { setError((e as Error).message); }
  };
  const removeDesignation = async () => {
    await archive.characters.save({ ...characterDoc(ch), designations: ch.designations.filter((x) => !sameScope(x, d)) });
    onChanged();
  };

  return (
    <li className="ml-card chr-desig">
      <div className="chr-desig-head">
        <span className="chr-as">{AS_LABEL[d.as]}</span>
        <span className="rx-ar" dir="rtl">{scopeShown(d)}</span>
        <span className="rc-kind">{SCOPE_KIND_LABEL[d.kind]}</span>
      </div>
      {error && <p className="ml-error" role="alert">{error}</p>}
      {occ.error && <p className="ml-error" role="alert">Couldn't count its places: {occ.error.message}</p>}
      <div className="rc-stats chr-stats">
        <span className="rc-stat"><span className="rc-stat-n">{occ.data ? occ.data.total : "…"}</span>in the Book</span>
        <span className="rc-stat"><span className="rc-stat-n">{mentions.length}</span>filed</span>
        <span className="rc-stat"><span className="rc-stat-n">{established}</span>established</span>
        <span className="rc-stat"><span className="rc-stat-n">{occ.data ? unfiled.length : "…"}</span>not filed yet</span>
      </div>
      <div className="ml-item-actions">
        {unfiled.length > 0 && (
          <button className={`ctl ml-secondary${canEdit ? "" : " plan-locked"}`} onClick={gate(canEdit, "characters", () => void fileUnfiled())}>
            <span className="ml-ic" aria-hidden="true">＋</span>File the {unfiled.length.toLocaleString()} not filed yet as potential
            {!canEdit && <> <PlanLock feature="characters" /></>}
          </button>
        )}
        {canEdit && <DeleteButton what={`${AS_LABEL[d.as].toLowerCase()} (the places filed under it stay)`} verb="Remove" onDelete={removeDesignation} />}
      </div>
    </li>
  );
}

/** "Add a name or title": type it, choose how to match, see how many places, file them all. */
function AddDesignation({ ch, onDone, onCancel }: { ch: Character; onDone: () => void; onCancel: () => void }) {
  const [as, setAs] = useState<As>("name");
  const [kind, setKind] = useState<MatchKind>("form");
  const [text, setText] = useState("");
  const scope = typedScope(kind, text);
  const sig = scope ? `${scope.kind} ${scope.key}` : "";
  const [countFor, setCountFor] = useState<string | null>(null);
  const occ = useAsync(async () => (countFor && scope && countFor === sig ? api.occurrences(scope, { limit: 6000 }) : null), [countFor, sig]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counted = countFor === sig ? occ.data : null;
  const already = scope ? ch.designations.some((d) => sameScope(d, scope)) : false;

  const file = async () => {
    if (!scope || !counted || busy) return;
    setBusy(true);
    setError(null);
    try {
      const d: Designation = { ...scope, as };
      if (!already) await archive.characters.save({ ...characterDoc(ch), designations: [...ch.designations, d] });
      if (counted.places.length > 0) {
        await archive.mentions.add(counted.places.map((p) => ({
          characterId: ch.id, verseKey: p.verseKey, word: p.word, words: p.words, kind: as, designation: d.text,
        })));
      }
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ml-card rc-new" aria-label="Add a name or title" onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } }}>
      <h2 className="ml-title">Add a name or title</h2>
      {error && <p className="ml-error" role="alert">{error}</p>}
      <div className="ml-field">
        <span className="rx-label" id="chr-as">It is a</span>
        <div className="rx-seg rx-seg-3" role="group" aria-labelledby="chr-as">
          {AS_OPTIONS.map((a) => (
            <button key={a} className={`ctl${as === a ? " active" : ""}`} aria-pressed={as === a} onClick={() => setAs(a)}>{AS_LABEL[a]}</button>
          ))}
        </div>
      </div>
      <MatchInput kind={kind} text={text} onKind={setKind} onText={setText} onEnter={() => scope && setCountFor(sig)} />
      <div className="rc-preview">
        <button className="ctl ml-secondary" disabled={!scope} onClick={() => setCountFor(sig)}>
          <span className="ml-ic" aria-hidden="true">⌕</span>Count the places
        </button>
        {countFor === sig && occ.loading && <span className="ml-hint">Counting…</span>}
        {countFor === sig && occ.error && <span className="ml-error" role="alert">{occ.error.message}</span>}
        {counted && (
          <span className="ml-hint">
            {counted.total === 0
              ? "Found nowhere in the Book. Check the spelling, or match it another way."
              : `${plural(counted.total, "place", "places")} in ${plural(counted.ayahs, "āyah", "āyāt")}.`}
            {counted.truncated ? ` Only the first ${counted.places.length.toLocaleString()} can be filed at once.` : ""}
            {already ? " This one is already among its names; filing adds only the places not filed yet." : ""}
          </span>
        )}
      </div>
      <div className="ml-actions">
        <button className="ctl ml-secondary" onClick={onCancel}>Cancel</button>
        <button className="ctl primary" disabled={busy || !counted || counted.places.length === 0} onClick={file}>
          {busy ? "Filing…" : counted ? `File all ${counted.places.length.toLocaleString()} as potential` : "File as potential"}
        </button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------- the places ----

function MentionRow({ m, text, surahName, canEdit, onChanged }: {
  m: Mention;
  text: string | undefined;
  surahName: (k: string) => string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const dispatch = useAppDispatch();
  const gate = useGate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (status: MentionStatus) => async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await archive.mentions.setStatus([m.id], status); onChanged(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const name = surahName(m.verseKey);
  const ai = isAi(m);
  return (
    <li className={`chr-mention${ai ? " suggested" : ""}`}>
      <button
        className="rc-place"
        title={`Read ${m.verseKey} with these words lit`}
        onClick={() => dispatch({ type: "jumpToEcho", verseKey: m.verseKey, start: m.word, length: m.words })}
      >
        <span className="search-ref">
          {m.verseKey}{name ? ` · ${name}` : ""}{m.kind === "pronoun" ? (m.part > 1 ? ` · pronoun ${m.part} of the word` : " · pronoun") : ""}
        </span>
        <PlaceText text={text} word={m.word} words={m.words} />
      </button>
      {error && <p className="ml-error" role="alert">{error}</p>}
      {m.note && <p className="ml-note">{m.note}</p>}
      <div className="ml-item-actions">
        {ai ? <span className="rc-sugg-chip">suggestion</span> : <StatusChip status={m.status} />}
        {ai ? (
          <>
            <button className={`ctl ml-secondary${canEdit ? "" : " plan-locked"}`} disabled={busy}
              onClick={gate(canEdit, "characters", set("potential"))}>Accept as potential</button>
            {canEdit && <DeleteButton what="suggestion" verb="Dismiss" onDelete={async () => { await archive.mentions.remove([m.id]); onChanged(); }} />}
          </>
        ) : (
          <>
            {m.status === "established" ? (
              <button className={`ctl ml-secondary${canEdit ? "" : " plan-locked"}`} disabled={busy}
                onClick={gate(canEdit, "characters", set("potential"))}>Back to potential</button>
            ) : (
              <button className={`ctl ml-secondary${canEdit ? "" : " plan-locked"}`} disabled={busy}
                onClick={gate(canEdit, "characters", set("established"))}>
                <span className="ml-ic" aria-hidden="true">✓</span>Establish
              </button>
            )}
            {canEdit && <DeleteButton what="place" verb="Remove" onDelete={async () => { await archive.mentions.remove([m.id]); onChanged(); }} />}
          </>
        )}
      </div>
    </li>
  );
}

export function StatusChip({ status }: { status: MentionStatus }) {
  return <span className={`chr-status ${status}`}>{status === "established" ? "established" : "potential"}</span>;
}

/** "Establish all N here", asked in the page first. Only the reader's own potential places. */
function EstablishAll({ mentions, canEdit, onChanged, where }: {
  mentions: Mention[]; canEdit: boolean; onChanged: () => void; where: string;
}) {
  const gate = useGate();
  const potential = mentions.filter((m) => m.status !== "established" && !isAi(m));
  if (potential.length === 0) return null;
  if (!canEdit) {
    return (
      <button className="ctl ml-secondary plan-locked" onClick={gate(false, "characters", () => {})}>
        Establish all {potential.length} <PlanLock feature="characters" />
      </button>
    );
  }
  return (
    <ConfirmButton
      question={`Establish all ${plural(potential.length, "potential place", "potential places")} ${where}?`}
      confirm={`Establish ${potential.length.toLocaleString()}`}
      onConfirm={async () => { await archive.mentions.setStatus(potential.map((m) => m.id), "established"); onChanged(); }}
    >
      <span className="ml-ic" aria-hidden="true">✓</span>Establish all in this group
    </ConfirmButton>
  );
}

interface Group { key: string; label: string; as: As | null; mentions: Mention[] }

/** Mentions grouped by the designation they were filed under, in the character's order. */
function groupsOf(ch: Character, mentions: Mention[]): Group[] {
  const by = new Map<string, Mention[]>();
  for (const m of mentions) {
    const k = m.designation ?? BY_HAND;
    const l = by.get(k);
    if (l) l.push(m); else by.set(k, [m]);
  }
  const out: Group[] = [];
  for (const d of ch.designations) {
    const l = by.get(d.text);
    if (!l) continue;
    out.push({ key: d.text, label: scopeShown(d), as: d.as, mentions: l });
    by.delete(d.text);
  }
  for (const [k, l] of by) {
    if (k === BY_HAND) continue;
    out.push({ key: k, label: k, as: null, mentions: l });
  }
  const hand = by.get(BY_HAND);
  if (hand) out.push({ key: BY_HAND, label: "Pointed by hand (pronouns and others)", as: null, mentions: hand });
  for (const g of out) g.mentions.sort((a, b) => byPlace(a.verseKey, b.verseKey) || a.word - b.word);
  return out;
}

function GroupView({ g, chapters, surahName, canEdit, onChanged }: {
  g: Group;
  chapters: Chapter[];
  surahName: (k: string) => string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const page = open ? g.mentions.slice(0, shown) : [];
  const texts = useVerseTexts(useMemo(() => [...new Set(page.map((m) => m.verseKey))], [page]));
  const established = g.mentions.filter((m) => m.status === "established" && !isAi(m)).length;
  // the page's rows, in sūrah sub-groups
  const bySurah: [number, Mention[]][] = [];
  for (const m of page) {
    const c = chapterOf(m.verseKey);
    const last = bySurah[bySurah.length - 1];
    if (last && last[0] === c) last[1].push(m); else bySurah.push([c, [m]]);
  }
  const allInSurah = (c: number) => g.mentions.filter((m) => chapterOf(m.verseKey) === c);
  const surahLabel = (c: number) => { const ch = chapters.find((x) => x.id === c); return ch ? `${c}. ${ch.name_simple}` : `Sūrah ${c}`; };

  return (
    <li className="ml-card chr-group">
      <div className="chr-group-head">
        <button className="chr-group-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="chr-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
          {g.as && <span className="chr-as">{AS_LABEL[g.as]}</span>}
          <span className={g.as ? "rx-ar" : "chr-group-name"} dir={g.as ? "rtl" : undefined}>{g.label}</span>
          <span className="chr-group-count">{plural(g.mentions.length, "place", "places")} · {established} established</span>
        </button>
        <EstablishAll mentions={g.mentions} canEdit={canEdit} onChanged={onChanged} where={`filed under ${g.as ? g.label : "this group"}`} />
      </div>
      {open && (
        <>
          {bySurah.map(([c, rows]) => (
            <section key={c} className="chr-surah">
              <div className="chr-surah-head">
                <h3 className="chr-surah-name">{surahLabel(c)} <span className="chr-group-count">{allInSurah(c).length}</span></h3>
                <EstablishAll mentions={allInSurah(c)} canEdit={canEdit} onChanged={onChanged} where={`in ${surahLabel(c)}`} />
              </div>
              <ul className="chr-mentions">
                {rows.map((m) => (
                  <MentionRow key={m.id} m={m} text={texts.get(m.verseKey)} surahName={surahName} canEdit={canEdit} onChanged={onChanged} />
                ))}
              </ul>
            </section>
          ))}
          {g.mentions.length > shown && (
            <div className="ml-more">
              <button className="ctl ml-secondary" onClick={() => setShown((s) => s + PAGE)}>Show {Math.min(PAGE, g.mentions.length - shown)} more</button>
            </div>
          )}
        </>
      )}
    </li>
  );
}

// ------------------------------------------------------- who uses which name ----

function WhoUsesView({ groups }: { groups: Group[] }) {
  const speech = useAsync(() => archive.speech.all(), []);
  const [only, setOnly] = useState<"all" | "established">("all");
  if (speech.error) return <p className="ml-error" role="alert">Couldn't load your speaker tags: {speech.error.message}</p>;
  if (speech.loading && !speech.data) return <p className="loading">Counting…</p>;
  const tags = (speech.data ?? []).filter((t) => t.source !== "ai");
  const byVerse = new Map<string, SpeakerTag[]>();
  for (const t of tags) { const l = byVerse.get(t.verseKey); if (l) l.push(t); else byVerse.set(t.verseKey, [t]); }
  const speakersAt = (m: Mention): string[] => {
    const out = new Set<string>();
    for (const t of byVerse.get(m.verseKey) ?? []) {
      if (m.word >= t.word && (t.words == null || m.word < t.word + t.words)) out.add(t.speaker || "not said");
    }
    return [...out];
  };

  return (
    <>
      <p className="ml-hint">
        For each name, how many of its places fall inside a span you tagged with a speaker, counted by
        speaker. Only your own speaker tags are counted.
      </p>
      <div className="rx-seg rx-seg-2 chr-only" role="group" aria-label="Which places">
        <button className={`ctl${only === "all" ? " active" : ""}`} aria-pressed={only === "all"} onClick={() => setOnly("all")}>All filed places</button>
        <button className={`ctl${only === "established" ? " active" : ""}`} aria-pressed={only === "established"} onClick={() => setOnly("established")}>Established only</button>
      </div>
      {tags.length === 0 && <p className="home-empty">No speaker tags yet. Tag who speaks in an āyah's Links panel, or in Dialogue.</p>}
      <ul className="ml-list">
        {groups.map((g) => {
          const ms = g.mentions.filter((m) => !isAi(m) && (only === "all" || m.status === "established"));
          const counts = new Map<string, number>();
          let outside = 0;
          for (const m of ms) {
            const sp = speakersAt(m);
            if (sp.length === 0) outside++;
            for (const s of sp) counts.set(s, (counts.get(s) ?? 0) + 1);
          }
          const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
          return (
            <li key={g.key} className="ml-card chr-who">
              <div className="chr-desig-head">
                {g.as && <span className="chr-as">{AS_LABEL[g.as]}</span>}
                <span className={g.as ? "rx-ar" : "chr-group-name"} dir={g.as ? "rtl" : undefined}>{g.label}</span>
                <span className="chr-group-count">{plural(ms.length, "place", "places")}</span>
              </div>
              {ms.length === 0 ? <p className="ml-hint">No places to count.</p> : (
                <table className="chr-who-table">
                  <thead><tr><th scope="col">Speaker of the span</th><th scope="col">Places</th></tr></thead>
                  <tbody>
                    {rows.map(([s, n]) => <tr key={s}><td>{s}</td><td>{n}</td></tr>)}
                    <tr className="chr-who-outside"><td>not inside a tagged span</td><td>{outside}</td></tr>
                  </tbody>
                </table>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ----------------------------------------------------------- one character ----

type CharView = "names" | "places" | "who";

function CharacterView({ id, onBack }: { id: string; onBack: () => void }) {
  const canEdit = useFeature("characters");
  const gate = useGate();
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);
  const res = useAsync(() => archive.characters.get(id), [id, version]);
  const chapters = useAsync(() => api.chapters(), []);
  const surahName = (k: string) => chapters.data?.find((c) => c.id === chapterOf(k))?.name_simple ?? "";
  const [view, setView] = useState<CharView>("names");
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<"all" | MentionStatus | "suggested">("all");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // keep the last loaded character on screen while a reload is in flight
  const [ch, setCh] = useState<Character | null>(null);
  useEffect(() => { if (res.data) setCh(res.data); }, [res.data]);

  const mentions = ch?.mentions ?? [];
  const groups = useMemo(() => (ch ? groupsOf(ch, mentions) : []), [ch, mentions]);
  const shownGroups = useMemo(() => groups
    .map((g) => ({
      ...g,
      mentions: g.mentions.filter((m) =>
        filter === "all" ? true : filter === "suggested" ? isAi(m) : !isAi(m) && (filter === "established" ? m.status === "established" : m.status !== "established")),
    }))
    .filter((g) => g.mentions.length > 0), [groups, filter]);
  const own = mentions.filter((m) => !isAi(m));
  const nEst = own.filter((m) => m.status === "established").length;
  const nSugg = mentions.length - own.length;

  const saveCh = async () => {
    if (!ch || busy) return;
    if (!draft.name.trim()) { setError("A character needs a name."); return; }
    setBusy(true);
    setError(null);
    try {
      await archive.characters.save({ ...characterDoc(ch), name: draft.name.trim(), note: draft.note.trim() });
      setEditing(false);
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (res.error && !ch) {
    return (
      <div className="sheet ml-screen">
        <div className="rc-top"><button className="ctl ml-secondary" onClick={onBack}>← All characters</button></div>
        <p className="ml-error" role="alert">Couldn't load the character: {res.error.message}</p>
      </div>
    );
  }
  if (!ch) return <div className="sheet ml-screen"><p className="loading">Loading…</p></div>;

  const VIEWS: { id: CharView; label: string; n?: number }[] = [
    { id: "names", label: "Names and titles", n: ch.designations.length },
    { id: "places", label: "Places", n: mentions.length },
    { id: "who", label: "Who uses which name" },
  ];
  const FILTERS: { id: typeof filter; label: string; n: number }[] = [
    { id: "all", label: "All", n: mentions.length },
    { id: "potential", label: "Potential", n: own.length - nEst },
    { id: "established", label: "Established", n: nEst },
    { id: "suggested", label: "AI suggestions", n: nSugg },
  ];

  return (
    <div className="sheet ml-screen chr-screen">
      <div className="rc-top"><button className="ctl ml-secondary" onClick={onBack}>← All characters</button></div>
      {error && <p className="ml-error" role="alert">{error}</p>}
      {res.error && <p className="ml-error" role="alert">Couldn't refresh: {res.error.message}</p>}

      <section className="ml-card rc-head" aria-label="The character">
        {editing ? (
          <div className="ml-edit" onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
            else if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); void saveCh(); }
          }}>
            <div className="ml-field">
              <label htmlFor="chr-e-name">Name</label>
              <input id="chr-e-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
            </div>
            <div className="ml-field">
              <label htmlFor="chr-e-note">Note</label>
              <textarea id="chr-e-note" rows={2} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
            </div>
            <div className="ml-actions">
              <button className="ctl ml-secondary" onClick={() => setEditing(false)}>Cancel</button>
              <button className="ctl primary" onClick={saveCh} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        ) : (
          <>
            <h1 className="rc-title">{ch.name}</h1>
            <p className="rc-tally-head">
              {plural(nEst, "place", "places")} established · {plural(own.length - nEst, "place", "places")} potential
              {nSugg > 0 ? ` · ${plural(nSugg, "AI suggestion", "AI suggestions")} waiting` : ""}
            </p>
            <dl className="ml-values">
              <div className="ml-wide"><dt>Note</dt><dd>{ch.note || <span className="ml-none">none</span>}</dd></div>
            </dl>
            <div className="ml-item-actions">
              <button className={`ctl ml-secondary${canEdit ? "" : " plan-locked"}`}
                onClick={gate(canEdit, "characters", () => { setDraft({ name: ch.name, note: ch.note ?? "" }); setEditing(true); })}>
                <span className="ml-ic" aria-hidden="true">✎</span>Edit{!canEdit && <> <PlanLock feature="characters" /></>}
              </button>
              {canEdit && <DeleteButton what="character and every place filed under it" onDelete={async () => { await archive.characters.remove(ch.id); onBack(); }} />}
            </div>
          </>
        )}
      </section>

      <div className="ml-views chr-views" role="tablist" aria-label="Character views">
        {VIEWS.map((v) => (
          <button key={v.id} role="tab" aria-selected={view === v.id}
            className={`ctl ml-view${view === v.id ? " active" : ""}`} onClick={() => setView(v.id)}>
            {v.label}{v.n !== undefined && <span className="ml-view-count">{v.n}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {view === "names" && (
          <div className="chr-pane">
            {adding ? (
              <AddDesignation ch={ch} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />
            ) : (
              <div className="rc-top">
                <button className={`ctl primary${canEdit ? "" : " plan-locked"}`} onClick={gate(canEdit, "characters", () => setAdding(true))}>
                  <span className="ml-ic" aria-hidden="true">＋</span>Add a name or title{!canEdit && <> <PlanLock feature="characters" /></>}
                </button>
              </div>
            )}
            {ch.designations.length === 0 ? (
              <p className="home-empty">
                No names or titles yet. Add one: type it in Arabic, choose how to match it, and file the places
                the Book has for it as potential. You decide which ones to establish.
              </p>
            ) : (
              <ul className="ml-list">
                {ch.designations.map((d) => (
                  <DesignationRow key={`${d.kind} ${d.key}`} ch={ch} d={d}
                    mentions={mentions.filter((m) => m.designation === d.text)} canEdit={canEdit} onChanged={reload} />
                ))}
              </ul>
            )}
          </div>
        )}

        {view === "places" && (
          <div className="chr-pane">
            <div className="rx-seg rx-seg-4" role="group" aria-label="Show">
              {FILTERS.map((f) => (
                <button key={f.id} className={`ctl${filter === f.id ? " active" : ""}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label}<span className="ml-view-count">{f.n}</span>
                </button>
              ))}
            </div>
            {shownGroups.length === 0 ? (
              <p className="home-empty">
                {mentions.length === 0
                  ? "No places filed yet. Add a name or title, or point a pronoun to this character in an āyah's Links panel."
                  : "No place matches this filter."}
              </p>
            ) : (
              <ul className="ml-list">
                {shownGroups.map((g) => (
                  <GroupView key={`${g.key}|${filter}`} g={g} chapters={chapters.data ?? []} surahName={surahName} canEdit={canEdit} onChanged={reload} />
                ))}
              </ul>
            )}
          </div>
        )}

        {view === "who" && (
          <FeatureGate feature="speakers" mode="readonly"><WhoUsesView groups={groups} /></FeatureGate>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- screen ----

function NewCharacter({ onSaved, onCancel }: { onSaved: (c: Character) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (busy) return;
    if (!name.trim()) { setError("A character needs a name."); return; }
    setBusy(true);
    setError(null);
    try {
      onSaved(await archive.characters.save({ id: newId("char"), name: name.trim(), note: note.trim(), designations: [] }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ml-card rc-new" aria-label="New character" onKeyDown={(e) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      else if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); void save(); }
    }}>
      <h2 className="ml-title">New character</h2>
      {error && <p className="ml-error" role="alert">{error}</p>}
      <div className="ml-field">
        <label htmlFor="chr-name">Name</label>
        <input id="chr-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="the name you will know it by" />
      </div>
      <div className="ml-field">
        <label htmlFor="chr-note">Note (optional)</label>
        <textarea id="chr-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="ml-actions">
        <button className="ctl ml-secondary" onClick={onCancel}>Cancel</button>
        <button className="ctl primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </section>
  );
}

export function Characters() {
  const canEdit = useFeature("characters");
  const gate = useGate();
  const openId = useAppState().openItemId;
  const dispatch = useAppDispatch();
  const setOpenId = (id: string | null) => dispatch({ type: "openItem", tab: "characters", id });
  const [creating, setCreating] = useState(false);
  const list = useAsync(() => archive.characters.all(), [openId]);
  const notFound = !!openId && !list.loading && !!list.data &&!list.data.some((c) => c.id === openId);

  if (openId && !notFound) return <CharacterView id={openId} onBack={() => setOpenId(null)} />;
  const chars = [...(list.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="sheet ml-screen chr-screen">
      <header className="home-head">
        <h1>Characters</h1>
        <p className="subtitle">
          Someone you name, and the places in the Book that point to them: names, titles, descriptions and
          pronouns. Places go in as potential; you establish the ones you are sure of.
        </p>
      </header>
      {list.error && <p className="ml-error" role="alert">Couldn't load your characters: {list.error.message}</p>}
      {notFound && <p className="ml-hint">That character was not found.</p>}
      {creating ? (
        <NewCharacter onCancel={() => setCreating(false)} onSaved={(c) => { setCreating(false); setOpenId(c.id); }} />
      ) : (
        <div className="rc-top">
          <button className={`ctl primary${canEdit ? "" : " plan-locked"}`} onClick={gate(canEdit, "characters", () => setCreating(true))}>
            <span className="ml-ic" aria-hidden="true">＋</span>New character{!canEdit && <> <PlanLock feature="characters" /></>}
          </button>
        </div>
      )}
      {list.loading && !list.data ? <p className="loading">Loading…</p> : chars.length === 0 ? (
        <p className="home-empty">No characters yet. Name one with New character, or point a pronoun to a new one from an āyah's Links panel.</p>
      ) : (
        <div className="ml-groups">
          {chars.map((c) => (
            <button key={c.id} className="ml-group" onClick={() => setOpenId(c.id)}>
              <span className="ml-group-name">{c.name}</span>
              <span className="ml-group-count">
                {c.counts?.established ?? 0} established · {c.counts?.potential ?? 0} potential
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
