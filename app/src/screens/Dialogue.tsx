// Dialogue: one sūrah read as a script. Every speech span the reader tagged, in order: who speaks,
// to whom, who else hears, whether the text says who speaks or it is the reader's inference, and
// the words of the span. Between them, the places where the corpus finds speech introduced
// (قال، قالوا، قل، نادى …, GET /corpus/chapters/:n/speech-openers) that no tag starts at yet:
// "speech not yet tagged", one tap from the āyah's Links panel to tag it.
//
// It lists and counts; who is speaking is the reader's to say.

import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { chapterTexts } from "../hooks/useVerseTexts";
import { useAppDispatch, useAppState } from "../state/store";
import { useFeature } from "../lib/features";
import { archive } from "../persistence/db";
import { PlanLock } from "../components/PlanLock";
import { tokenizeVerse } from "../components/reader/format";
import { basisLabel, SpeechForm } from "../components/reader/LinkForms";
import { PlaceText, useGate, byPlace, verseNo, plural } from "../components/research/places";
import type { SpeechOpener } from "../api/types";
import type { SpeakerTag } from "../persistence/types";

const PAGE = 60;

type Item =
  | { type: "tag"; verseKey: string; word: number; t: SpeakerTag }
  | { type: "opener"; verseKey: string; word: number; o: SpeechOpener };

/** The words of a span, read off the āyah's text by word position (marks are not words). */
function spanWords(text: string | undefined, word: number, words: number | null): string {
  if (!text) return "";
  const last = words == null ? Infinity : word + words - 1;
  return tokenizeVerse(text)
    .filter((t) => t.position !== null && t.position >= word && t.position <= last)
    .map((t) => t.text)
    .join(" ");
}

function TagRow({ t, text, canEdit, onChanged }: {
  t: SpeakerTag; text: string | undefined; canEdit: boolean; onChanged: () => void;
}) {
  const dispatch = useAppDispatch();
  const gate = useGate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ai = t.source === "ai";
  const basis = basisLabel(t.basis);
  const act = (fn: () => Promise<void>) => async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await fn(); onChanged(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const words = spanWords(text, t.word, t.words);
  const length = t.words ?? Math.max(1, (text ? tokenizeVerse(text).filter((x) => x.position !== null).length : t.word) - t.word + 1);
  return (
    <li className={`dlg-row dlg-tag${ai ? " suggested" : ""}`}>
      <div className="dlg-who">
        <span className="dlg-ref">{t.verseKey}{t.word > 1 ? ` · from word ${t.word}` : ""}</span>
        <span className="dlg-pair">
          <span className="links-speaker">{t.speaker || "not said"}</span>
          <span className="links-saved-kind" aria-label="speaks to">→</span>
          <span className="links-speaker">{t.addressee || "not said"}</span>
        </span>
        {t.listeners && <span className="dlg-also">also heard by {t.listeners}</span>}
        <span className="dlg-chips">
          {ai && <span className="rc-sugg-chip">suggestion</span>}
          {basis && <span className={`lp-basis ${t.basis}`}>{basis}</span>}
        </span>
      </div>
      <div className="dlg-body">
        <button
          className="dlg-words quran"
          dir="rtl"
          title={`Read ${t.verseKey} with this speech lit`}
          onClick={() => dispatch({ type: "jumpToEcho", verseKey: t.verseKey, start: t.word, length })}
        >{text === undefined ? "…" : words || "…"}</button>
        {t.note && <p className="ml-note">{t.note}</p>}
        {error && <p className="ml-error" role="alert">{error}</p>}
        {ai && (
          <div className="ml-item-actions">
            <button className={`ctl ml-secondary${canEdit ? "" : " plan-locked"}`} disabled={busy}
              onClick={gate(canEdit, "speakers", act(() => archive.proposed.accept("speech", t.id)))}>
              Accept{!canEdit && <> <PlanLock feature="speakers" /></>}
            </button>
            <button className={`ctl ml-secondary${canEdit ? "" : " plan-locked"}`} disabled={busy}
              onClick={gate(canEdit, "speakers", act(() => archive.speech.remove(t.id)))}>Dismiss</button>
          </div>
        )}
      </div>
    </li>
  );
}

const spaced = (r: string) => r.split("").join(" "); // nbsp: root letters must not wrap (ه د ي)
const FIXED_ROOTS = ["قول", "ندو"];
const ROOTS_KEY = "dialogue.openerRoots";
/** letters of a root as the reader typed them, or null when it is not three or four Arabic letters */
function parseRoot(input: string): string | null {
  const s = input.replace(/\s+/g, "");
  return /^[ء-غف-ي]{3,4}$/.test(s) ? s : null;
}

/** The speaker form, in the row. The speech an opener introduces starts at the word after it,
 *  or with the next āyah when the opener is the last word of its own. */
function TagHere({ o, onDone, onCancel }: { o: SpeechOpener; onDone: () => void; onCancel: () => void }) {
  const [chapterNo, ayahNo] = o.verseKey.split(":").map(Number);
  const nextKey = `${chapterNo}:${(ayahNo ?? 0) + 1}`;
  const here = useAsync(() => api.verseWords(o.verseKey), [o.verseKey]);
  const lastWord = (here.data ?? []).reduce((m, w) => (w.position != null && w.arabic ? Math.max(m, w.position) : m), 0);
  const atEnd = here.data != null && o.word >= lastWord;
  const next = useAsync(async () => (atEnd ? api.verseWords(nextKey).catch(() => null) : null), [atEnd, nextKey]);
  const names = useAsync(async () => (await archive.speech.speakers()).map((s) => s.name), []);
  if (here.error) return <p className="ml-error" role="alert">Couldn't load the āyah: {here.error.message}</p>;
  if (!here.data || (atEnd && next.loading)) return <p className="loading">Loading the āyah…</p>;
  const onward = atEnd && next.data && next.data.length > 0;
  return (
    <div className="dlg-tag-here">
      {onward && <p className="ml-hint">This word ends {o.verseKey}, so the speech is tagged from {nextKey}.</p>}
      <SpeechForm
        verseKey={onward ? nextKey : o.verseKey}
        words={onward ? next.data! : here.data}
        startAt={onward ? undefined : o.word + 1}
        names={names.data ?? []}
        onDone={onDone}
        onCancel={onCancel}
      />
    </div>
  );
}

function OpenerRow({ o, text, skipped, canEdit, onChanged }: {
  o: SpeechOpener; text: string | undefined; skipped: boolean; canEdit: boolean; onChanged: () => void;
}) {
  const dispatch = useAppDispatch();
  const gate = useGate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tagging, setTagging] = useState(false);
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (skipped) await archive.speech.unskip(o.verseKey, o.word); else await archive.speech.skip(o.verseKey, o.word);
      onChanged();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <li className={`dlg-row dlg-untagged${skipped ? " dlg-skipped" : ""}`}>
      <div className="dlg-who">
        <span className="dlg-ref">{o.verseKey} · word {o.word}</span>
        <span className="dlg-untagged-chip">
          {skipped ? "set aside: no speech here" : o.sure ? "speech not yet tagged" : "a call: speech may follow"}
        </span>
        <span className="rx-ar" dir="rtl">{o.text}</span>
        {o.added && <span className="dlg-root-note">from your root <span className="rx-ar" dir="rtl">{spaced(o.root)}</span></span>}
      </div>
      <div className="dlg-body">
        <PlaceText text={text} word={o.word} words={1} />
        {error && <p className="ml-error" role="alert">{error}</p>}
        <div className="ml-item-actions">
          {!skipped && (
            <button
              className={`ctl ml-secondary${tagging ? " active" : ""}${canEdit ? "" : " plan-locked"}`}
              aria-expanded={tagging}
              title="Say who speaks here, without leaving this page"
              onClick={gate(canEdit, "speakers", () => setTagging((x) => !x))}
            >
              <span className="ml-ic" aria-hidden="true">✎</span>Tag it here{!canEdit && <> <PlanLock feature="speakers" /></>}
            </button>
          )}
          {!skipped && (
            <button
              className="ctl ml-secondary"
              title={`Read ${o.verseKey} in the reader, with its Speakers panel open. The reader shows the way back here.`}
              onClick={() => dispatch({ type: "jumpToVerse", verseKey: o.verseKey, wordPosition: o.word, openLinks: "speakers" })}
            >
              <span className="ml-ic" aria-hidden="true">↗</span>Open in the reader
            </button>
          )}
          <button className={`ctl ml-secondary${canEdit ? "" : " plan-locked"}`} disabled={busy}
            onClick={gate(canEdit, "speakers", () => void toggle())}>
            {skipped ? "Put back" : "No speech here"}{!canEdit && <> <PlanLock feature="speakers" /></>}
          </button>
        </div>
        {tagging && !skipped && (
          <TagHere o={o} onDone={() => { setTagging(false); onChanged(); }} onCancel={() => setTagging(false)} />
        )}
      </div>
    </li>
  );
}

/** The roots whose verbs count as openers: ق و ل and ن د و, and any the reader adds. */
function OpenerRoots({ roots, canEdit, onChange }: { roots: string[]; canEdit: boolean; onChange: (r: string[]) => void }) {
  const gate = useGate();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const r = parseRoot(text);
    if (!r) { setError("A root is three or four Arabic letters, for example ظن."); return; }
    if (FIXED_ROOTS.includes(r) || roots.includes(r)) { setError("That root is already in the list."); return; }
    setError(null);
    setText("");
    onChange([...roots, r]);
  };
  return (
    <div className="dlg-roots" role="group" aria-label="Opener roots">
      <span className="dlg-roots-label">Opener roots</span>
      <ul className="dlg-roots-list">
        {FIXED_ROOTS.map((r) => <li key={r} className="dlg-root fixed rx-ar" dir="rtl">{spaced(r)}</li>)}
        {roots.map((r) => (
          <li key={r} className="dlg-root">
            <span className="rx-ar" dir="rtl">{spaced(r)}</span>
            <button className="dlg-root-x" title={`Remove ${r}`} aria-label={`Remove root ${r}`}
              onClick={gate(canEdit, "speakers", () => onChange(roots.filter((x) => x !== r)))}>×</button>
          </li>
        ))}
      </ul>
      <span className="dlg-roots-add">
        <input className="links-input" dir="rtl" lang="ar" aria-label="Add an opener root" placeholder="ظ ن" value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); gate(canEdit, "speakers", add)(); } }} />
        <button className={`ctl ml-secondary${canEdit ? "" : " plan-locked"}`} onClick={gate(canEdit, "speakers", add)}>
          Add root{!canEdit && <> <PlanLock feature="speakers" /></>}
        </button>
      </span>
      {error && <p className="ml-error dlg-roots-error" role="alert">{error}</p>}
    </div>
  );
}

export function Dialogue() {
  const { reading } = useAppState();
  const canEdit = useFeature("speakers");
  const [chapter, setChapter] = useState(reading.surahId || 1);
  const [version, setVersion] = useState(0);
  const chapters = useAsync(() => api.chapters(), []);
  const tags = useAsync(() => archive.speech.forChapter(chapter), [chapter, version]);
  // the roots the reader added (kept in the account); null until they are read
  const [roots, setRoots] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    void archive.prefs.get<string[]>(ROOTS_KEY).then((r) => { if (live) setRoots(Array.isArray(r) ? r.filter((x) => typeof x === "string") : []); });
    return () => { live = false; };
  }, []);
  const changeRoots = (r: string[]) => { setRoots(r); void archive.prefs.set(ROOTS_KEY, r); };
  const openers = useAsync(async () => (roots === null ? null : api.speechOpeners(chapter, roots)), [chapter, roots?.join(",") ?? null]);
  const skips = useAsync(() => archive.speech.skips(chapter), [chapter, version]);
  const texts = useAsync(() => chapterTexts(chapter), [chapter]);
  const [speaker, setSpeaker] = useState("");
  const [show, setShow] = useState<"all" | "tagged" | "untagged" | "aside">("all");
  const [shown, setShown] = useState(PAGE);
  useEffect(() => { setSpeaker(""); setShown(PAGE); }, [chapter]);
  useEffect(() => setShown(PAGE), [speaker, show]);

  const allTags = useMemo(
    () => [...(tags.data ?? [])].sort((a, b) => byPlace(a.verseKey, b.verseKey) || a.word - b.word),
    [tags.data],
  );
  const ownTags = allTags.filter((t) => t.source !== "ai");
  const total = chapters.data?.find((c) => c.id === chapter)?.verses_count ?? 0;

  // Each of the reader's tags answers ONE opener: the nearest one at or before where the tag
  // starts, in the same āyah; or, for a tag that starts an āyah with no opener before it, the
  // last opener of the āyah before (the speech it introduces begins in the next āyah). So one
  // tag never counts two openers as tagged.
  const allOpeners = openers.data?.openers ?? [];
  const answered = new Set<SpeechOpener>();
  for (const t of ownTags) {
    const here = allOpeners.filter((o) => o.verseKey === t.verseKey && o.word <= t.word);
    const prev = `${chapter}:${verseNo(t.verseKey) - 1}`;
    const o = here.length ? here[here.length - 1]
      : t.word === 1 ? allOpeners.filter((x) => x.verseKey === prev).pop() : undefined;
    if (o) answered.add(o);
  }
  const skipKeys = new Set((skips.data ?? []).map((s) => `${s.verseKey}|${s.word}`));
  const isSkipped = (o: SpeechOpener) => skipKeys.has(`${o.verseKey}|${o.word}`);
  const untagged = allOpeners.filter((o) => !answered.has(o) && !isSkipped(o));
  const setAside = allOpeners.filter((o) => !answered.has(o) && isSkipped(o));
  const speakers = useMemo(() => [...new Set(allTags.flatMap((t) => [t.speaker, t.addressee]).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [allTags]);

  const items: Item[] = [];
  if (show === "all" || show === "tagged") {
    for (const t of allTags) {
      if (speaker && t.speaker !== speaker && t.addressee !== speaker) continue;
      items.push({ type: "tag", verseKey: t.verseKey, word: t.word, t });
    }
  }
  if ((show === "all" || show === "untagged") && !speaker) {
    for (const o of untagged) items.push({ type: "opener", verseKey: o.verseKey, word: o.word, o });
  }
  if (show === "aside" && !speaker) {
    for (const o of setAside) items.push({ type: "opener", verseKey: o.verseKey, word: o.word, o });
  }
  items.sort((a, b) => byPlace(a.verseKey, b.verseKey) || a.word - b.word || (a.type === "opener" ? -1 : 1));
  const page = items.slice(0, shown);
  const error = tags.error ?? openers.error ?? texts.error ?? skips.error;

  return (
    <div className="sheet ml-screen dlg-screen">
      <header className="home-head">
        <h1>Dialogue</h1>
        <p className="subtitle">
          A sūrah as a script: every speech you tagged, in order, and the places where speech is introduced
          that you have not tagged yet.
        </p>
      </header>

      <div className="ml-filters dlg-controls">
        <div className="ml-field">
          <label htmlFor="dlg-surah">Sūrah</label>
          <select id="dlg-surah" value={chapter} onChange={(e) => setChapter(Number(e.target.value))}>
            {(chapters.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.id}. {c.name_simple}</option>)}
            {!chapters.data && <option value={chapter}>{chapter}</option>}
          </select>
        </div>
        <div className="ml-field">
          <label htmlFor="dlg-speaker">Speaker</label>
          <select id="dlg-speaker" value={speaker} onChange={(e) => setSpeaker(e.target.value)}>
            <option value="">everyone</option>
            {speakers.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="ml-field">
          <label htmlFor="dlg-show">Show</label>
          <select id="dlg-show" value={show} onChange={(e) => setShow(e.target.value as typeof show)}>
            <option value="all">tagged speech and speech not yet tagged</option>
            <option value="tagged">tagged speech only</option>
            <option value="untagged">speech not yet tagged only</option>
            <option value="aside">set aside only</option>
          </select>
        </div>
      </div>

      {roots && <OpenerRoots roots={roots} canEdit={canEdit} onChange={changeRoots} />}

      {error && <p className="ml-error" role="alert">Couldn't load this sūrah's dialogue: {error.message}</p>}

      {openers.data && tags.data && skips.data && (
        <p className="rc-tally-head dlg-tally">
          {plural(allOpeners.length, "speech opener", "speech openers")} · {allOpeners.length - untagged.length - setAside.length} tagged ·{" "}
          <span className={untagged.length > 0 ? "dlg-untagged-n" : undefined}>{untagged.length} not yet tagged</span>
          {setAside.length > 0 && <> · {setAside.length} set aside</>}
          <span className="dlg-tally-sub"> · {plural(ownTags.length, "speech span", "speech spans")} tagged{total ? ` · ${plural(total, "āyah", "āyāt")} in the sūrah` : ""}</span>
        </p>
      )}
      {speaker && <p className="ml-hint">Showing the speech where {speaker} speaks or is spoken to. Speech not yet tagged is hidden while a speaker is chosen.</p>}

      {roots === null || (tags.loading && !tags.data) || (openers.loading && !openers.data) ?<p className="loading">Reading the sūrah…</p> : items.length === 0 ? (
        <p className="home-empty">
          {allTags.length === 0 && allOpeners.length === 0
            ? "Nothing to show: no speech is tagged in this sūrah, and the corpus finds no speech opener in it."
            : "Nothing matches these choices."}
        </p>
      ) : (
        <ol className="dlg-script">
          {page.map((it) => it.type === "tag"
            ? <TagRow key={`t ${it.t.id}`} t={it.t} text={texts.data?.get(it.verseKey)} canEdit={canEdit} onChanged={() => setVersion((v) => v + 1)} />
            : <OpenerRow key={`o ${it.verseKey} ${it.word}`} o={it.o} text={texts.data?.get(it.verseKey)}
                skipped={show === "aside"} canEdit={canEdit} onChanged={() => setVersion((v) => v + 1)} />)}
        </ol>
      )}
      {items.length > shown && (
        <div className="ml-more">
          <button className="ctl ml-secondary" onClick={() => setShown((s) => s + PAGE)}>Show {Math.min(PAGE, items.length - shown)} more</button>
        </div>
      )}
    </div>
  );
}
