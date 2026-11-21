// Links: everything this āyah shares with the rest of the Book, rarest first (corpus-core/src/links.ts).
// A shared phrase, a pair of words, a written word, a word, a root — each with the number of
// āyāt that carry it. A thing found in only two āyāt ties exactly those two. The panel only finds
// and counts; it never says what a link means.
//
// The panel has four parts, as tabs, each with how many it holds; it opens on Links:
//   Links       the reader's saved links and leads on this āyah, then what the āyah shares with
//               the rest of the Book (each row: save a link, keep a lead, check as a rule), the lens
//   Speakers    who speaks here, to whom, who else hears, and whether the text says so
//   Characters  the places in this āyah filed under a character, potential or established
//   Pronouns    every pronoun here, and which character the reader points each one to
// What an assistant proposed is kept apart until the reader accepts it.
//
// Mounted only while open, so nothing is fetched until then. Pointing at or tapping a row lights
// its words in the āyah above, through `onLight`.

import { useEffect, useMemo, useState } from "react";
import { api, announcePlanLock } from "../../api/client";
import { useAsync } from "../../hooks/useAsync";
import { useAppState, useAppDispatch } from "../../state/store";
import { useFeature, useFeatureCatalog, lockReason, type PlanFeature } from "../../lib/features";
import { archive, newId } from "../../persistence/db";
import { PlanLock } from "../PlanLock";
import { EchoCompare } from "./EchoPanel";
import { startTrail, startWordTrail } from "../../trails/ops";
import { LinkForm, SpeechForm, DeleteButton, savedKindLabel, spanText, basisLabel } from "./LinkForms";
import { offerRuleScope } from "../../lib/ruleHandoff";
import type { AsyncState } from "../../hooks/useAsync";
import type { LinksTab } from "../../state/store";
import type { AyahPronouns, CommonLink, LinkKind, LinkMarker, LinkPlace, PronounInAyah, Word } from "../../api/types";
import type { Character, LinkEnd, Mention, MentionStatus, SavedLink, SpeakerTag } from "../../persistence/types";

const commonId = (c: CommonLink) => `common ${c.kind} ${c.text}`;

/** word spans to light in the āyah above: each start position, `length` words long */
export interface LinkLight { positions: number[]; length: number }

const FIRST_ROWS = 8;
const FIRST_CHIPS = 12;

/** the plain name of each kind of link */
export const LINK_KIND_LABEL: Record<LinkKind, string> = {
  phrase: "phrase",
  pair: "two words",
  form: "written word",
  lemma: "word",
  root: "root",
};

const spaced = (r: string) => r.split("").join(" "); // nbsp: root letters must not wrap (ه د ي)
const shown = (kind: LinkKind | "lemma", text: string) => (kind === "root" ? spaced(text) : text);

function rarity(ayahs: number): string {
  return ayahs === 2 ? "only 2 āyāt in the Book" : `in ${ayahs} āyāt`;
}

/** A lead has no other end yet (or was saved as one). */
export const isLead = (l: SavedLink) => !l.b || l.status === "lead";

/** This āyah's end of a saved link (a link may touch the āyah at either end). */
export function endHere(l: SavedLink, verseKey: string): LinkEnd {
  return l.a.verseKey === verseKey || !l.b ? l.a : l.b;
}
function endThere(l: SavedLink, verseKey: string): LinkEnd | null {
  if (!l.b) return null;
  return l.a.verseKey === verseKey ? l.b : l.a;
}

/** A change control: the action when the plan allows it, else a click that says why it's locked. */
function useGate() {
  const catalog = useFeatureCatalog();
  return (ok: boolean, f: PlanFeature, fn: () => void) => (ok ? fn : () => announcePlanLock(lockReason(f, catalog)));
}

type Lit = { id: string; light: LinkLight } | null;
interface LightProps {
  activeId: string | null;
  hoverFor: (id: string, light: LinkLight) => (on: boolean) => void;
  toggleFor: (id: string, light: LinkLight) => () => void;
}

function LinkRow({ m, verseKey, lit, onHover, onToggle, surahName, canSave, labels, already, onSaved }: {
  m: LinkMarker;
  verseKey: string;
  lit: boolean;
  onHover: (on: boolean) => void;
  onToggle: () => void;
  surahName: (k: string) => string;
  canSave: boolean;
  labels: string[];
  /** āyāt this āyah is already linked to on this row's marker */
  already: string[];
  onSaved: () => void;
}) {
  const dispatch = useAppDispatch();
  const gate = useGate();
  const canRules = useFeature("rules");
  const [compare, setCompare] = useState(false);
  const [allChips, setAllChips] = useState(false);
  const [saving, setSaving] = useState(false);
  const [leadBusy, setLeadBusy] = useState(false);
  const chips = allChips ? m.places : m.places.slice(0, FIRST_CHIPS);
  const hidden = m.places.length - chips.length;
  // the server lists at most 40 places; `ayahs` is the true total (this āyah included)
  const unlisted = m.ayahs - 1 - m.places.length;
  const label = LINK_KIND_LABEL[m.kind];
  const here: LinkEnd = { verseKey, word: m.positions[0] ?? 1, words: m.length };
  const marker = { kind: m.kind, key: m.key, text: m.text };

  const keepLead = async () => {
    if (leadBusy) return;
    setLeadBusy(true);
    try {
      await archive.links.save({
        id: newId("link"),
        a: here, b: null, kind: "", marker, label: "", note: "", status: "lead", source: "me",
      });
      onSaved();
    } finally {
      setLeadBusy(false);
    }
  };

  return (
    <li
      className={`links-row${lit ? " lit" : ""}`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <button
        className="links-row-head"
        aria-pressed={lit}
        title="Light these words in the āyah above"
        onClick={onToggle}
        onFocus={() => onHover(true)}
        onBlur={() => onHover(false)}
      >
        <span className={`links-rarity${m.ayahs === 2 ? " only-two" : ""}`}>{rarity(m.ayahs)}</span>
        <span className="links-kind">{label}</span>
        <span className="links-text quran" dir="rtl">{shown(m.kind, m.text)}</span>
      </button>
      <div className="links-places">
        <span className="links-places-label">also in</span>
        {chips.map((p) => {
          const name = surahName(p.verseKey);
          return (
            <button
              key={p.verseKey}
              className="chip echo-chip"
              title={`Go to ${p.verseKey}${name ? ` · ${name}` : ""} with this ${label} lit`}
              onClick={() => dispatch({ type: "jumpToEcho", verseKey: p.verseKey, start: p.start, length: m.length, from: verseKey, fromPanel: true })}
            >
              {p.verseKey}
            </button>
          );
        })}
        {hidden > 0 && (
          <button className="links-link" onClick={() => setAllChips(true)}>+{hidden} more</button>
        )}
        {unlisted > 0 && <span className="links-note">and {unlisted} not listed</span>}
        <button className="links-link" aria-expanded={compare} onClick={() => setCompare((c) => !c)}>
          {compare ? "hide the āyāt" : "compare here"}
        </button>
        <span className="links-row-save">
          <button
            className={`links-link${canSave ? "" : " plan-locked"}`}
            aria-expanded={saving}
            onClick={gate(canSave, "links", () => setSaving((s) => !s))}
          >Save link{!canSave && <> <PlanLock feature="links" /></>}</button>
          <button
            className={`links-link${canSave ? "" : " plan-locked"}`}
            title="Save what this āyah shares, and find the other end later"
            disabled={leadBusy}
            onClick={gate(canSave, "links", keepLead)}
          >Keep as a lead</button>
          <button
            className={`links-link${canRules ? "" : " plan-locked"}`}
            title={`State a rule about this ${label} and check it against every place it occurs`}
            onClick={gate(canRules, "rules", () => {
              offerRuleScope({ kind: m.kind, key: m.key, text: m.text });
              dispatch({ type: "setTab", tab: "rules" });
            })}
          >Check as a rule{!canRules && <> <PlanLock feature="rules" /></>}</button>
        </span>
      </div>
      {saving && (
        <LinkForm
          verseKey={verseKey}
          here={here}
          marker={marker}
          choices={m.places}
          length={m.length}
          labels={labels}
          already={already}
          surahName={surahName}
          onDone={() => { setSaving(false); onSaved(); }}
          onCancel={() => setSaving(false)}
        />
      )}
      {compare && <EchoCompare places={m.places} length={m.length} surahName={surahName} from={verseKey} fromPanel />}
    </li>
  );
}

/** One of the reader's saved links, or a lead, as seen from this āyah. */
function SavedItem({ l, verseKey, words, light, canEdit, labels, choicesFor, onChanged }: {
  l: SavedLink;
  verseKey: string;
  words: Word[] | null;
  light: LightProps;
  canEdit: boolean;
  labels: string[];
  /** the other āyāt a lead's marker is found in, from the rows below */
  choicesFor: (l: SavedLink) => { places: LinkPlace[]; length: number };
  onChanged: () => void;
}) {
  const dispatch = useAppDispatch();
  const gate = useGate();
  const [editing, setEditing] = useState(false);
  const here = endHere(l, verseKey);
  const there = endThere(l, verseKey);
  const lead = isLead(l);
  const ai = l.source === "ai";
  const id = `saved ${l.id}`;
  const lit = { positions: [here.word], length: here.words };
  const text = l.marker ? shown(l.marker.kind, l.marker.text) : spanText(words, here.word, here.words);
  const { places, length } = choicesFor(l);

  return (
    <li
      className={`links-saved-item${light.activeId === id ? " lit" : ""}${ai ? " proposed" : ""}`}
      onMouseEnter={() => light.hoverFor(id, lit)(true)}
      onMouseLeave={() => light.hoverFor(id, lit)(false)}
    >
      <div className="links-saved-main">
        <button
          className="links-saved-text"
          dir="rtl"
          title="Light these words in the āyah above"
          aria-pressed={light.activeId === id}
          onClick={light.toggleFor(id, lit)}
        >{text || `word ${here.word}`}</button>
        {there ? (
          <>
            <span className="links-saved-kind">{savedKindLabel(l, verseKey)}</span>
            <button
              className="chip echo-chip"
              title={`Go to ${there.verseKey} with the linked words lit`}
              onClick={() => dispatch({ type: "jumpToEcho", verseKey: there.verseKey, start: there.word, length: there.words, from: verseKey, fromPanel: true })}
            >{there.verseKey}</button>
          </>
        ) : (
          <span className="links-saved-kind">lead</span>
        )}
        {l.label && <span className="links-group-tag" title="Group">{l.label}</span>}
      </div>
      {l.note && <p className="links-saved-note">{l.note}</p>}
      {lead && !ai && !editing && (
        <p className="links-help">
          Find the other end: look in the rows below for one that shares it, or read on, then choose
          <em> Complete</em> and name the āyah.
        </p>
      )}
      <div className="links-item-actions">
        {ai ? (
          <>
            <button
              className={`ctl links-btn${canEdit ? "" : " plan-locked"}`}
              onClick={gate(canEdit, "links", async () => { await archive.proposed.accept("link", l.id); onChanged(); })}
            >Accept{!canEdit && <> <PlanLock feature="links" /></>}</button>
            {canEdit && <DeleteButton what="proposal" verb="Dismiss" onDelete={async () => { await archive.links.remove(l.id); onChanged(); }} />}
          </>
        ) : (
          <>
            <button
              className={`links-link${canEdit ? "" : " plan-locked"}`}
              aria-expanded={editing}
              onClick={gate(canEdit, "links", () => setEditing((e) => !e))}
            >{lead ? "Complete" : "Edit"}{!canEdit && <> <PlanLock feature="links" /></>}</button>
            {canEdit && <DeleteButton what={lead ? "lead" : "link"} onDelete={async () => { await archive.links.remove(l.id); onChanged(); }} />}
          </>
        )}
      </div>
      {editing && (
        <LinkForm
          verseKey={verseKey}
          here={here}
          marker={l.marker}
          choices={places}
          length={length}
          initial={l}
          labels={labels}
          onDone={() => { setEditing(false); onChanged(); }}
          onCancel={() => setEditing(false)}
        />
      )}
    </li>
  );
}

/** Who speaks here: the reader's speaker tags on this āyah, and the form to add one. */
function SpeakersSection({ verseKey, words, light, tags, reload }: {
  verseKey: string;
  words: Word[] | null;
  light: LightProps;
  /** this āyah's tags, loaded by the panel (its tab shows the count) */
  tags: AsyncState<SpeakerTag[]>;
  reload: () => void;
}) {
  const canSpeakers = useFeature("speakers");
  const gate = useGate();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const formOpen = adding || editing !== null;
  const names = useAsync(
    async () => (formOpen ? (await archive.speech.speakers()).map((s) => s.name) : []),
    [formOpen],
  );
  // the last real word (the word list ends with the āyah's end mark, which has no text)
  const last = [...(words ?? [])].reverse().find((w) => w.arabic)?.position ?? 1;
  const list = tags.data ?? [];
  const own = list.filter((t) => t.source !== "ai");
  const proposed = list.filter((t) => t.source === "ai");

  const item = (t: SpeakerTag) => {
    const id = `speech ${t.id}`;
    const length = t.words ?? last - t.word + 1;
    const lit = { positions: [t.word], length };
    const ai = t.source === "ai";
    return (
      <li
        key={t.id}
        className={`links-saved-item${light.activeId === id ? " lit" : ""}${ai ? " proposed" : ""}`}
        onMouseEnter={() => light.hoverFor(id, lit)(true)}
        onMouseLeave={() => light.hoverFor(id, lit)(false)}
      >
        <div className="links-saved-main">
          <span className="links-speaker">{t.speaker || "?"}</span>
          <span className="links-saved-kind" aria-label="speaks to">→</span>
          <span className="links-speaker">{t.addressee || "not said"}</span>
          <button
            className="links-saved-text"
            dir="rtl"
            title="Light these words in the āyah above"
            aria-pressed={light.activeId === id}
            onClick={light.toggleFor(id, lit)}
          >{t.word === 1 && t.words == null ? "the whole āyah" : spanText(words, t.word, t.words)}</button>
          {basisLabel(t.basis) && <span className={`lp-basis ${t.basis}`}>{basisLabel(t.basis)}</span>}
        </div>
        {t.listeners && <p className="links-saved-note">Also heard by {t.listeners}</p>}
        {t.note && <p className="links-saved-note">{t.note}</p>}
        <div className="links-item-actions">
          {ai ? (
            <>
              <button
                className={`ctl links-btn${canSpeakers ? "" : " plan-locked"}`}
                onClick={gate(canSpeakers, "speakers", async () => { await archive.proposed.accept("speech", t.id); reload(); })}
              >Accept{!canSpeakers && <> <PlanLock feature="speakers" /></>}</button>
              {canSpeakers && <DeleteButton what="proposal" verb="Dismiss" onDelete={async () => { await archive.speech.remove(t.id); reload(); }} />}
            </>
          ) : (
            <>
              <button
                className={`links-link${canSpeakers ? "" : " plan-locked"}`}
                aria-expanded={editing === t.id}
                onClick={gate(canSpeakers, "speakers", () => { setAdding(false); setEditing((e) => (e === t.id ? null : t.id)); })}
              >Edit{!canSpeakers && <> <PlanLock feature="speakers" /></>}</button>
              {canSpeakers && <DeleteButton what="tag" onDelete={async () => { await archive.speech.remove(t.id); reload(); }} />}
            </>
          )}
        </div>
        {editing === t.id && (
          <SpeechForm
            verseKey={verseKey}
            words={words}
            initial={t}
            names={names.data ?? []}
            onDone={() => { setEditing(null); reload(); }}
            onCancel={() => setEditing(null)}
          />
        )}
      </li>
    );
  };

  return (
    <section className="links-section" aria-label="Who speaks here">
      <div className="links-section-head">
        <span className="links-section-title">Who speaks here</span>
        {!tags.loading && list.length === 0 && <span className="links-note">not tagged yet</span>}
        <button
          className={`links-link${canSpeakers ? "" : " plan-locked"}`}
          aria-expanded={adding}
          onClick={gate(canSpeakers, "speakers", () => { setEditing(null); setAdding((a) => !a); })}
        >Add{!canSpeakers && <> <PlanLock feature="speakers" /></>}</button>
      </div>
      {tags.error && <p className="acct-error" role="alert">Could not load the speakers ({tags.error.message}).</p>}
      {adding && (
        <SpeechForm
          verseKey={verseKey}
          words={words}
          names={names.data ?? []}
          onDone={() => { setAdding(false); reload(); }}
          onCancel={() => setAdding(false)}
        />
      )}
      {own.length > 0 && <ul className="links-saved-list">{own.map(item)}</ul>}
      {proposed.length > 0 && (
        <>
          <p className="links-proposed-label">Proposed by your assistant</p>
          <ul className="links-saved-list">{proposed.map(item)}</ul>
        </>
      )}
    </section>
  );
}

/** A mention's status, or "suggestion" while it is still an assistant's. */
function MentionChip({ m }: { m: Mention }) {
  if (m.source === "ai") return <span className="lp-chip sugg">suggestion</span>;
  return <span className={`lp-chip ${m.status}`}>{m.status === "established" ? "established" : "potential"}</span>;
}

/** Establish / back to potential / remove one mention (accept or dismiss an assistant's). */
function MentionActions({ m, canEdit, onChanged }: { m: Mention; canEdit: boolean; onChanged: () => void }) {
  const gate = useGate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (status: MentionStatus) => async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try { await archive.mentions.setStatus([m.id], status); onChanged(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const ai = m.source === "ai";
  return (
    <span className="links-item-actions">
      {err && <span className="acct-error" role="alert">{err}</span>}
      {ai ? (
        <button className={`ctl links-btn${canEdit ? "" : " plan-locked"}`} disabled={busy}
          onClick={gate(canEdit, "characters", set("potential"))}>Accept{!canEdit && <> <PlanLock feature="characters" /></>}</button>
      ) : m.status === "established" ? (
        <button className={`links-link${canEdit ? "" : " plan-locked"}`} disabled={busy}
          onClick={gate(canEdit, "characters", set("potential"))}>Back to potential</button>
      ) : (
        <button className={`links-link${canEdit ? "" : " plan-locked"}`} disabled={busy}
          onClick={gate(canEdit, "characters", set("established"))}>Establish{!canEdit && <> <PlanLock feature="characters" /></>}</button>
      )}
      {canEdit && (
        <DeleteButton what={ai ? "suggestion" : "place from the character"} verb={ai ? "Dismiss" : "Remove"}
          onDelete={async () => { await archive.mentions.remove([m.id]); onChanged(); }} />
      )}
    </span>
  );
}

/** Characters here: the places in this āyah filed under a character, with their status. */
function CharactersSection({ mentions, characters, words, light, onChanged }: {
  mentions: AsyncState<Mention[]>;
  characters: Character[];
  words: Word[] | null;
  light: LightProps;
  onChanged: () => void;
}) {
  const dispatch = useAppDispatch();
  const canEdit = useFeature("characters");
  const nameOf = (id: string) => characters.find((c) => c.id === id)?.name ?? "a character";
  const list = [...(mentions.data ?? [])].sort((a, b) => a.word - b.word);
  return (
    <section className="links-section" aria-label="Characters here">
      <div className="links-section-head">
        <span className="links-section-title">Characters here</span>
        {!mentions.loading && list.length === 0 && (
          <span className="links-note">none filed in this āyah; point a pronoun to one, or file a name in Characters</span>
        )}
        <button className="links-link" onClick={() => dispatch({ type: "setTab", tab: "characters" })}>Open Characters</button>
      </div>
      {mentions.error && <p className="acct-error" role="alert">Could not load the characters here ({mentions.error.message}).</p>}
      {list.length > 0 && (
        <ul className="links-saved-list">
          {list.map((m) => {
            const id = `mention ${m.id}`;
            const lit = { positions: [m.word], length: m.words };
            return (
              <li
                key={m.id}
                className={`links-saved-item${light.activeId === id ? " lit" : ""}${m.source === "ai" ? " proposed" : ""}`}
                onMouseEnter={() => light.hoverFor(id, lit)(true)}
                onMouseLeave={() => light.hoverFor(id, lit)(false)}
              >
                <div className="links-saved-main">
                  <button
                    className="links-speaker links-link"
                    title={`Open ${nameOf(m.characterId)} in Characters`}
                    onClick={() => dispatch({ type: "openItem", tab: "characters", id: m.characterId })}
                  >{nameOf(m.characterId)}</button>
                  <span className="links-saved-kind">{m.kind === "pronoun" ? (m.part > 1 ? `pronoun ${m.part}` : "pronoun") : m.kind}</span>
                  <button
                    className="links-saved-text"
                    dir="rtl"
                    title="Light these words in the āyah above"
                    aria-pressed={light.activeId === id}
                    onClick={light.toggleFor(id, lit)}
                  >{spanText(words, m.word, m.words) || `word ${m.word}`}</button>
                  <MentionChip m={m} />
                </div>
                {m.note && <p className="links-saved-note">{m.note}</p>}
                <MentionActions m={m} canEdit={canEdit} onChanged={onChanged} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const PERSON: Record<string, string> = { "1": "1st person", "2": "2nd person", "3": "3rd person" };
const NUMBER: Record<string, string> = { S: "singular", D: "dual", P: "plural" };
const GENDER: Record<string, string> = { M: "masculine", F: "feminine" };
const PRON_TYPE: Record<PronounInAyah["type"], string> = { separate: "separate word", attached: "attached", verb: "inside the verb" };
/** "attached · 3rd person plural masculine": grammar as the corpus tags it, nothing more */
function pronounWhat(p: PronounInAyah): string {
  const g = [p.person && (PERSON[p.person] ?? p.person), p.number && (NUMBER[p.number] ?? p.number), p.gender && (GENDER[p.gender] ?? p.gender)]
    .filter(Boolean).join(" ");
  return [PRON_TYPE[p.type] ?? p.type, g].filter(Boolean).join(" · ");
}

const NEW_CHAR = "__new";

/** a pronoun mention answers one pronoun row: same word and same part (part 0 is the word itself) */
const isPointing = (m: Mention, p: PronounInAyah) => m.kind === "pronoun" && m.part > 0 && m.word === p.word && m.part === p.part;

/** Point one pronoun at a character: an existing one, or a new one named here. */
function PointTo({ verseKey, p, characters, onDone }: {
  verseKey: string;
  p: PronounInAyah;
  characters: Character[];
  onDone: () => void;
}) {
  const canEdit = useFeature("characters");
  const gate = useGate();
  // the reader's choice, else the first character (the list may arrive after the row)
  const [chosen, setPick] = useState<string | null>(null);
  const pick = chosen && (chosen === NEW_CHAR || characters.some((c) => c.id === chosen)) ? chosen : characters[0]?.id ?? NEW_CHAR;
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const point = async () => {
    if (busy) return;
    setErr(null);
    let characterId = pick;
    if (pick === NEW_CHAR) {
      if (!name.trim()) { setErr("Name the character."); return; }
    }
    setBusy(true);
    try {
      if (pick === NEW_CHAR) {
        characterId = (await archive.characters.save({ id: newId("char"), name: name.trim(), note: "", designations: [] })).id;
      }
      await archive.mentions.add([{ characterId, verseKey, word: p.word, words: 1, part: p.part, kind: "pronoun", designation: "", status: "potential" }]);
      setName("");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="lp-point" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void gate(canEdit, "characters", () => void point())(); } }}>
      {err && <span className="acct-error lp-point-wide" role="alert">{err}</span>}
      <select className="links-input" aria-label="Points to" value={pick} onChange={(e) => setPick(e.target.value)}>
        {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        <option value={NEW_CHAR}>New character…</option>
      </select>
      {pick === NEW_CHAR && (
        <input className="links-input" aria-label="New character's name" placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
      )}
      <button className={`ctl links-btn${canEdit ? "" : " plan-locked"}`} disabled={busy}
        onClick={gate(canEdit, "characters", () => void point())}>
        {busy ? "Saving…" : "Point"}{!canEdit && <> <PlanLock feature="characters" /></>}
      </button>
    </span>
  );
}

/** Pronouns: every pronoun in this āyah, and which character the reader says each points to. */
function PronounsSection({ verseKey, pronouns, withVerbs, setWithVerbs, mentions, characters, light, onChanged }: {
  verseKey: string;
  pronouns: AsyncState<AyahPronouns>;
  withVerbs: boolean;
  setWithVerbs: (on: boolean) => void;
  mentions: Mention[];
  characters: Character[];
  light: LightProps;
  onChanged: () => void;
}) {
  const canEdit = useFeature("characters");
  const list = pronouns.data?.pronouns ?? [];
  const pointedAt = (p: PronounInAyah) => mentions.filter((m) => isPointing(m, p));
  const pointed = list.filter((p) => pointedAt(p).length > 0).length;
  const nameOf = (id: string) => characters.find((c) => c.id === id)?.name ?? "a character";
  return (
    <section className="links-section" aria-label="Pronouns">
      <div className="links-section-head">
        <span className="links-section-title">Pronouns</span>
        {pronouns.data && <span className="links-note">{pointed} of {list.length} pointed</span>}
        <label className="lp-verbs">
          <input type="checkbox" checked={withVerbs} onChange={(e) => setWithVerbs(e.target.checked)} />
          Include pronouns inside verbs
        </label>
      </div>
      {pronouns.loading && !pronouns.data && <p className="links-loading">Finding the pronouns…</p>}
      {pronouns.error && <p className="acct-error" role="alert">Could not load the pronouns ({pronouns.error.message}).</p>}
      {pronouns.data && list.length === 0 && (
        <p className="links-note">No pronoun in this āyah{withVerbs ? "" : " as a word or attached to one; try including those inside verbs"}.</p>
      )}
      {list.length > 0 && (
        <div className="lp-pron" role="table" aria-label="Pronouns in this āyah">
          <div className="lp-pron-row lp-pron-headrow" role="row">
            <span role="columnheader">Word</span>
            <span role="columnheader">Pronoun</span>
            <span role="columnheader">Points to</span>
          </div>
          {list.map((p, i) => {
            const id = `pronoun ${p.word} ${p.part} ${i}`;
            const lit = { positions: [p.word], length: 1 };
            const ms = pointedAt(p);
            return (
              <div
                key={id}
                role="row"
                className={`lp-pron-row${light.activeId === id ? " lit" : ""}`}
                onMouseEnter={() => light.hoverFor(id, lit)(true)}
                onMouseLeave={() => light.hoverFor(id, lit)(false)}
              >
                <button
                  role="cell"
                  className="links-saved-text lp-pron-word"
                  dir="rtl"
                  title="Light this word in the āyah above"
                  aria-pressed={light.activeId === id}
                  onClick={light.toggleFor(id, lit)}
                >{p.text}</button>
                <span role="cell" className="lp-pron-what">
                  <span className="links-only-ar" dir="rtl">{p.pronoun}</span>
                  <span className="links-saved-kind">{pronounWhat(p)}</span>
                </span>
                <span role="cell" className="lp-pron-to">
                  {ms.length > 0 ? ms.map((m) => (
                    <span key={m.id} className="lp-pointed">
                      <span className="links-speaker">{nameOf(m.characterId)}</span>
                      <MentionChip m={m} />
                      <MentionActions m={m} canEdit={canEdit} onChanged={onChanged} />
                    </span>
                  )) : (
                    <PointTo verseKey={verseKey} p={p} characters={characters} onDone={onChanged} />
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** A widespread marker, once chosen: how many āyāt carry it, and the ways to walk them. They are
 *  too many to list here, so the panel hands over to the tools made for long walks. */
function CommonDetail({ c, verseKey }: { c: CommonLink; verseKey: string }) {
  const dispatch = useAppDispatch();
  const gate = useGate();
  const canFollowRoot = useFeature("follow-root");
  const canFollowWord = useFeature("follow-word");
  const canSearch = useFeature("search");
  const canRoots = useFeature("roots");
  const position = c.positions[0] ?? 1;
  const follow = (start: () => Promise<{ id: string }>) => async () => {
    const t = await start();
    dispatch({ type: "setActiveTrail", trailId: t.id });
    dispatch({ type: "jumpToVerse", verseKey, wordPosition: position });
  };
  return (
    <div className="links-common-detail">
      <p className="links-common-what">
        <span className="links-only-ar quran" dir="rtl">{shown(c.kind, c.text)}</span>
        <span>
          This {LINK_KIND_LABEL[c.kind]} is in {c.ayahs.toLocaleString()} āyāt, this one included. It is lit in the
          āyah above. That is too many to list here; walk them one by one instead:
        </span>
      </p>
      <div className="links-common-actions">
        {c.kind === "root" && (
          <>
            <button className="ctl links-btn" onClick={gate(canFollowRoot, "follow-root", follow(() => startTrail(c.text, verseKey, position)))}>
              Follow this root{!canFollowRoot && <> <PlanLock feature="follow-root" /></>}
            </button>
            <button
              className="ctl links-btn"
              onClick={gate(canRoots, "roots", () => dispatch({ type: "openRoot", root: { buckwalter: c.text, arabic: c.text } }))}
            >
              Open the root's page{!canRoots && <> <PlanLock feature="roots" /></>}
            </button>
          </>
        )}
        {(c.kind === "form" || c.kind === "lemma") && (
          <button className="ctl links-btn" onClick={gate(canFollowWord, "follow-word", follow(() => startWordTrail(c.text, verseKey, position)))}>
            Follow this word{!canFollowWord && <> <PlanLock feature="follow-word" /></>}
          </button>
        )}
        {(c.kind === "phrase" || c.kind === "pair") && (
          <button
            className="ctl links-btn"
            onClick={gate(canSearch, "search", () => {
              dispatch({ type: "setSearchQuery", query: c.text });
              dispatch({ type: "setTab", tab: "search" });
            })}
          >
            Find this phrase in Search{!canSearch && <> <PlanLock feature="search" /></>}
          </button>
        )}
      </div>
    </div>
  );
}

export function LinksPanel({ verseKey, words, saved, canLens, onLight, onSavedChanged }: {
  verseKey: string;
  /** the āyah's words, for spans and the speaker form */
  words: Word[] | null;
  /** the reader's saved links with an end in this āyah (the reader loads them all once) */
  saved: SavedLink[];
  /** the corpus links need the "lens" plan feature; saved links and speakers do not */
  canLens: boolean;
  onLight: (l: LinkLight | null) => void;
  onSavedChanged: () => void;
}) {
  const { focusAyahKey, reopenLinksFor, reopenLinksTab } = useAppState();
  const dispatch = useAppDispatch();
  const canLinks = useFeature("links");
  // the panel's parts; it opens on Links unless a jump asked for another part of THIS āyah
  const [tab, setTab] = useState<LinksTab>(() => (reopenLinksFor === verseKey && reopenLinksTab) || "links");
  useEffect(() => {
    if (reopenLinksFor === verseKey && reopenLinksTab) setTab(reopenLinksTab);
  }, [reopenLinksFor, reopenLinksTab, verseKey]);
  // what the other parts hold, loaded with the panel so each tab can say how many
  const [speechV, setSpeechV] = useState(0);
  const tags = useAsync(() => archive.speech.forVerse(verseKey), [verseKey, speechV]);
  const [mentionsV, setMentionsV] = useState(0);
  const mentions = useAsync(() => archive.mentions.forVerse(verseKey), [verseKey, mentionsV]);
  const [withVerbs, setWithVerbs] = useState(false);
  const pronouns = useAsync(() => api.pronouns(verseKey, { verbs: withVerbs }), [verseKey, withVerbs]);
  const wantsCharacters = tab === "characters" || tab === "pronouns";
  const characters = useAsync(
    async () => (wantsCharacters ? archive.characters.all() : null),
    [wantsCharacters, mentionsV],
  );
  const reloadMentions = () => setMentionsV((v) => v + 1);
  const data = useAsync(
    () => (canLens ? api.verseLinks(verseKey) : Promise.resolve(null)),
    [verseKey, canLens],
  );
  const chapters = useAsync(() => api.chapters(), []);
  const labelsData = useAsync(
    async () => (canLinks ? (await archive.links.labels()).map((l) => l.label) : []),
    [canLinks, saved],
  );
  const labels = labelsData.data ?? [];
  const surahName = (key: string) => {
    const id = parseInt(key.split(":")[0] ?? "", 10);
    return chapters.data?.find((c) => c.id === id)?.name_simple ?? "";
  };

  const [order, setOrder] = useState<"rare" | "reading">("rare");
  const [showAll, setShowAll] = useState(false);
  const [commonOpen, setCommonOpen] = useState(false);
  // what is lit in the āyah above: the row pointed at, else the row tapped
  const [hover, setHover] = useState<Lit>(null);
  const [pinned, setPinned] = useState<Lit>(null);
  const active = hover ?? pinned;
  useEffect(() => { onLight(active?.light ?? null); }, [active, onLight]);
  useEffect(() => () => onLight(null), [onLight]);

  const links = useMemo(() => {
    const all = data.data?.links ?? [];
    if (order === "rare") return all; // the server already sorts rarest first
    return [...all].sort((a, b) => a.positions[0]! - b.positions[0]! || a.ayahs - b.ayahs);
  }, [data.data, order]);

  const hoverFor = (id: string, light: LinkLight) => (on: boolean) =>
    setHover((h) => (on ? { id, light } : h?.id === id ? null : h));
  const toggleFor = (id: string, light: LinkLight) => () =>
    setPinned((p) => (p?.id === id ? null : { id, light }));
  const lightProps: LightProps = { activeId: active?.id ?? null, hoverFor, toggleFor };

  // a lead completes from the row that shares its marker, when that row is listed below
  const choicesFor = (l: SavedLink) => {
    const row = l.marker ? (data.data?.links ?? []).find((m) => m.kind === l.marker!.kind && m.key === l.marker!.key) : undefined;
    return row ? { places: row.places, length: row.length } : { places: [], length: 1 };
  };

  const own = saved.filter((l) => l.source !== "ai");
  const kept = own.filter((l) => !isLead(l));
  const leads = own.filter(isLead);
  const proposed = saved.filter((l) => l.source === "ai");

  const isLens = focusAyahKey === verseKey;
  const rows = showAll ? links : links.slice(0, FIRST_ROWS);
  const common = data.data?.common ?? [];
  // the widespread marker the reader chose (tapped), if any
  const pinnedCommon = common.find((c) => pinned?.id === commonId(c)) ?? null;
  const onlyHere = data.data?.onlyHere ?? [];
  const savedItem = (l: SavedLink) => (
    <SavedItem
      key={l.id}
      l={l}
      verseKey={verseKey}
      words={words}
      light={lightProps}
      canEdit={canLinks}
      labels={labels}
      choicesFor={choicesFor}
      onChanged={onSavedChanged}
    />
  );

  // each part says how many it holds; pronouns say how many of them are pointed
  const pronounList = pronouns.data?.pronouns ?? [];
  const pronounMentions = (mentions.data ?? []).filter((m) => m.kind === "pronoun");
  const pointedCount = pronounList.filter((p) => pronounMentions.some((m) => isPointing(m, p))).length;
  const TABS: { id: LinksTab; label: string; count: string }[] = [
    { id: "links", label: "Links", count: String(own.length) },
    { id: "speakers", label: "Speakers", count: tags.data ? String(tags.data.length) : tags.error ? "–" : "…" },
    { id: "characters", label: "Characters", count: mentions.data ? String(mentions.data.length) : mentions.error ? "–" : "…" },
    { id: "pronouns", label: "Pronouns", count: pronouns.data ? `${pointedCount}/${pronounList.length}` : pronouns.error ? "–" : "…" },
  ];
  const choose = (t: LinksTab) => { setTab(t); setPinned(null); setHover(null); };

  return (
    <div className="links-panel">
      <div className="lp-tabs" role="tablist" aria-label={`What to look at in ${verseKey}`}>
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`ctl lp-tab${tab === t.id ? " active" : ""}`}
            title={t.id === "pronouns" ? "Pronouns pointed to a character, of all the pronouns here" : undefined}
            onClick={() => choose(t.id)}
          >
            {t.label}<span className="lp-tab-count">{t.count}</span>
          </button>
        ))}
      </div>

      {tab === "links" && (
        <>
      {/* the reader's own links on this āyah: one quiet line when there are none */}
      <section className="links-section" aria-label="Your saved links">
        <div className="links-section-head">
          <span className="links-section-title">Your saved links</span>
          {saved.length === 0 && (
            <span className="links-note">none on this āyah yet; use <em>Save link</em> on a row below</span>
          )}
        </div>
        {kept.length > 0 && <ul className="links-saved-list">{kept.map(savedItem)}</ul>}
        {leads.length > 0 && (
          <>
            <p className="links-proposed-label">Leads: the other end still to find</p>
            <ul className="links-saved-list">{leads.map(savedItem)}</ul>
          </>
        )}
        {proposed.length > 0 && (
          <>
            <p className="links-proposed-label">Proposed by your assistant</p>
            <ul className="links-saved-list">{proposed.map(savedItem)}</ul>
          </>
        )}
      </section>

      <div className="links-head">
        <span className="links-title">Shared with the rest of the Book</span>
        {canLens && (
          <div className="links-order" role="group" aria-label="Order">
            <button
              className={`ctl${order === "rare" ? " active" : ""}`}
              aria-pressed={order === "rare"}
              onClick={() => setOrder("rare")}
            >Rarest first</button>
            <button
              className={`ctl${order === "reading" ? " active" : ""}`}
              aria-pressed={order === "reading"}
              onClick={() => setOrder("reading")}
            >Reading order</button>
          </div>
        )}
      </div>

      {!canLens && <LensLockNote />}
      {data.loading && <p className="links-loading">Finding what this āyah shares…</p>}
      {data.error && (
        <p className="acct-error" role="alert">Could not load the links ({data.error.message}).</p>
      )}

      {data.data && (
        <>
          {links.length === 0 && (
            <p className="links-note">Nothing in this āyah is shared by 20 or fewer āyāt.</p>
          )}
          {links.length > 0 && (
            <ul className="links-list">
              {rows.map((m) => {
                const id = `${m.kind} ${m.key}`;
                const light = { positions: m.positions, length: m.length };
                return (
                  <LinkRow
                    key={id}
                    m={m}
                    verseKey={verseKey}
                    lit={active?.id === id}
                    onHover={hoverFor(id, light)}
                    onToggle={toggleFor(id, light)}
                    surahName={surahName}
                    canSave={canLinks}
                    labels={labels}
                    already={saved
                      .filter((l) => l.b && l.source !== "ai" && l.marker?.kind === m.kind && l.marker.key === m.key)
                      .map((l) => (l.a.verseKey === verseKey ? l.b!.verseKey : l.a.verseKey))}
                    onSaved={onSavedChanged}
                  />
                );
              })}
            </ul>
          )}
          {links.length > FIRST_ROWS && (
            <button className="links-link links-more" onClick={() => setShowAll((s) => !s)}>
              {showAll ? `Show the first ${FIRST_ROWS}` : `Show all ${links.length}`}
            </button>
          )}

          {onlyHere.length > 0 && (
            <div className="links-only">
              <span className="links-places-label">found only here</span>
              {onlyHere.map((o) => {
                const id = `only ${o.kind} ${o.text} ${o.position}`;
                const light = { positions: [o.position], length: 1 };
                return (
                  <button
                    key={id}
                    className={`chip links-only-chip${active?.id === id ? " active" : ""}`}
                    title={`This ${o.kind === "root" ? "root" : "word"} occurs nowhere else in the Book`}
                    aria-pressed={pinned?.id === id}
                    onMouseEnter={() => hoverFor(id, light)(true)}
                    onMouseLeave={() => hoverFor(id, light)(false)}
                    onClick={toggleFor(id, light)}
                  >
                    <span className="links-only-kind">{o.kind === "root" ? "root" : "word"}</span>
                    <span className="links-only-ar" dir="rtl">{shown(o.kind, o.text)}</span>
                  </button>
                );
              })}
            </div>
          )}

          {common.length > 0 && (
            <div className="links-common">
              <button className="links-link" aria-expanded={commonOpen} onClick={() => setCommonOpen((o) => !o)}>
                {commonOpen ? "Hide" : "Show"} {common.length} widespread link{common.length > 1 ? "s" : ""} not
                listed (each in more than 20 āyāt)
              </button>
              {commonOpen && (
                <div className="links-common-list">
                  {common.map((c) => {
                    const id = commonId(c);
                    const light = { positions: c.positions, length: c.length };
                    return (
                      <button
                        key={id}
                        className={`chip links-only-chip${active?.id === id ? " active" : ""}`}
                        title={`${LINK_KIND_LABEL[c.kind]}, in ${c.ayahs} āyāt`}
                        aria-pressed={pinned?.id === id}
                        onMouseEnter={() => hoverFor(id, light)(true)}
                        onMouseLeave={() => hoverFor(id, light)(false)}
                        onClick={toggleFor(id, light)}
                      >
                        <span className="links-only-ar" dir="rtl">{shown(c.kind, c.text)}</span>
                        <span className="links-only-kind">{c.ayahs}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {commonOpen && pinnedCommon && (
                <CommonDetail c={pinnedCommon} verseKey={verseKey} />
              )}
              {commonOpen && !pinnedCommon && (
                <p className="links-note">Choose one to light it in the āyah and see how to follow it.</p>
              )}
            </div>
          )}
        </>
      )}

      {canLens && (
        <div className="links-lens">
          {isLens ? (
            <>
              <p className="links-lens-text">
                This āyah is the lens: the banner at the top of the reader steps through the āyāt most like it.
              </p>
              <button className="ctl links-lens-btn" onClick={() => dispatch({ type: "setFocusAyah", verseKey: null })}>
                Stop using as lens
              </button>
            </>
          ) : (
            <>
              <p className="links-lens-text">
                Use this āyah as the lens: wherever you read, words from its roots are lit, and the banner
                at the top lets you step through the āyāt most like it, one by one.
              </p>
              <button className="ctl links-lens-btn" onClick={() => dispatch({ type: "setFocusAyah", verseKey })}>
                <span className="links-ic" aria-hidden>◎</span> Use as lens
              </button>
            </>
          )}
        </div>
      )}
        </>
      )}

      {tab === "speakers" && (
        <SpeakersSection verseKey={verseKey} words={words} light={lightProps} tags={tags} reload={() => setSpeechV((v) => v + 1)} />
      )}
      {tab === "characters" && (
        <CharactersSection
          mentions={mentions}
          characters={characters.data ?? []}
          words={words}
          light={lightProps}
          onChanged={reloadMentions}
        />
      )}
      {tab === "pronouns" && (
        <PronounsSection
          verseKey={verseKey}
          pronouns={pronouns}
          withVerbs={withVerbs}
          setWithVerbs={setWithVerbs}
          mentions={mentions.data ?? []}
          characters={characters.data ?? []}
          light={lightProps}
          onChanged={reloadMentions}
        />
      )}
    </div>
  );
}

/** In place of the found links when this plan doesn't include the lens tools. */
function LensLockNote() {
  const catalog = useFeatureCatalog();
  return (
    <p className="links-note">
      <PlanLock feature="lens" /> Finding what this āyah shares with the rest of the Book, rarest first:
      {" "}{lockReason("lens", catalog).replace(/^./, (c) => c.toLowerCase())}.
    </p>
  );
}
