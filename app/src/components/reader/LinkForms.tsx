// The small inline forms of the Links panel: save (or complete, or edit) a link between two
// places, and tag who speaks in a span of an āyah. Both follow the same plain pattern: labels
// above controls in one grid, Save / Cancel, Enter saves, Esc cancels.

import { useId, useState, type KeyboardEvent } from "react";
import { api } from "../../api/client";
import { archive, newId } from "../../persistence/db";
import { useAsync } from "../../hooks/useAsync";
import type { Word, LinkPlace } from "../../api/types";
import type { LinkEnd, SavedLink, SavedLinkKind, SpeakerTag } from "../../persistence/types";

/** What two linked places share, in plain words (the "defined" kind is read with its direction). */
export const SAVED_KIND_OPTIONS: { id: SavedLinkKind; label: string }[] = [
  { id: "", label: "Not said" },
  { id: "same-wording", label: "The same wording" },
  { id: "defined", label: "Explained in one, used in the other" },
  { id: "same-style", label: "The same way of speaking" },
  { id: "same-image", label: "The same image" },
  { id: "refers", label: "One refers to the other" },
  { id: "tension", label: "These seem to disagree (to me)" },
];

/** The kind as read from `verseKey`'s side of the link. */
export function savedKindLabel(l: SavedLink, verseKey: string): string {
  switch (l.kind) {
    case "same-wording": return "the same wording";
    case "defined": return l.a.verseKey === verseKey ? "explained here, used there" : "used here, explained there";
    case "same-style": return "the same way of speaking";
    case "same-image": return "the same image";
    case "refers": return "one refers to the other";
    case "tension": return l.resolved ? "seemed to disagree, settled" : "seem to disagree (to me)";
    default: return "linked";
  }
}

/** The Arabic words of a span of this āyah, from its word list (positions, never a split). */
export function spanText(words: Word[] | null, from: number, n: number | null): string {
  if (!words) return "";
  const last = from + (n ?? Infinity) - 1;
  return words.filter((w) => w.position >= from && w.position <= last).map((w) => w.arabic ?? "").join(" ");
}

/** Enter saves (Shift+Enter is a new line in a note), Esc cancels. */
function formKeys(save: () => void, cancel: () => void) {
  return (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") { e.preventDefault(); cancel(); return; }
    if (e.key === "Enter" && !e.shiftKey && !(e.nativeEvent as unknown as { isComposing?: boolean }).isComposing) {
      const t = e.target as HTMLElement;
      if (t.tagName === "BUTTON") return; // a focused button does its own thing
      e.preventDefault();
      save();
    }
  };
}

const TYPED = "__typed";
const KEY_RE = /^(\d{1,3}):(\d{1,3})$/;

/** Find where the shared marker sits in an āyah typed by hand; else the whole āyah. */
async function endIn(verseKey: string, marker: SavedLink["marker"]): Promise<LinkEnd> {
  // the word list ends with the āyah's end mark, which has no text and is not a word
  const words = (await api.verseWords(verseKey)).filter((w) => w.arabic);
  if (!words.length) throw new Error(`no āyah ${verseKey}`);
  const hit = marker
    ? words.find((w) => (marker.kind === "root" ? w.root === marker.key : marker.kind === "lemma" ? w.lemma === marker.key : false))
    : undefined;
  return hit ? { verseKey, word: hit.position, words: 1 } : { verseKey, word: 1, words: words.length };
}

/** How many other āyāt are ticked by default when a marker is shared by several. */
const TICK_ALL_UP_TO = 5;

export function LinkForm({ verseKey, here, marker, choices, length, initial, labels, already, surahName, onDone, onCancel }: {
  /** the āyah the panel is on */
  verseKey: string;
  /** this āyah's end of a new link (ignored when `initial` already has one here) */
  here: LinkEnd;
  marker: SavedLink["marker"];
  /** other āyāt that share the marker, to pick from */
  choices: LinkPlace[];
  /** words the marker spans in each choice */
  length: number;
  /** editing a link or completing a lead */
  initial?: SavedLink | null;
  labels: string[];
  /** āyāt this āyah is already linked to on this marker: shown ticked, not saved again */
  already?: string[];
  surahName?: (verseKey: string) => string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const uid = useId();
  // A marker shared by several āyāt: tick the ones to link. One link is saved from this āyah to
  // each ticked āyah, all with the same kind, group and note.
  const multi = !initial && choices.length > 1;
  const done = new Set(already ?? []);
  const open = choices.filter((p) => !done.has(p.verseKey));
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set((open.length <= TICK_ALL_UP_TO ? open : open.slice(0, 1)).map((p) => p.verseKey)),
  );
  const tick = (key: string) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  // a kept link keeps its two ends; only what is said about them changes
  const fixedOther: LinkEnd | null =
    initial?.b ? (initial.a.verseKey === verseKey ? initial.b : initial.a) : null;
  const hereEnd: LinkEnd =
    initial ? (initial.b && initial.b.verseKey === verseKey && initial.a.verseKey !== verseKey ? initial.b : initial.a) : here;

  const [other, setOther] = useState<string>(choices[0]?.verseKey ?? TYPED);
  const [typed, setTyped] = useState("");
  const [kind, setKind] = useState<SavedLinkKind>(initial?.kind ?? "");
  const [definer, setDefiner] = useState<"here" | "there">(
    initial?.kind === "defined" && initial.a.verseKey !== verseKey ? "there" : "here",
  );
  const [label, setLabel] = useState(initial?.label ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const saveSeveral = async () => {
    const targets = open.filter((p) => picked.has(p.verseKey));
    let extra: LinkEnd | null = null;
    if (typed.trim()) {
      const m = KEY_RE.exec(typed.trim());
      if (!m) { setErr("Write the āyah as sūrah:āyah, for example 2:255."); return; }
      const key = `${Number(m[1])}:${Number(m[2])}`;
      if (key === verseKey) { setErr("That is this āyah. Choose another."); return; }
      if (!choices.some((p) => p.verseKey === key)) {
        try { extra = await endIn(key, marker); }
        catch { setErr(`There is no āyah ${key}.`); return; }
      }
    }
    const ends: LinkEnd[] = targets.map((p) => ({ verseKey: p.verseKey, word: p.start, words: length }));
    if (extra) ends.push(extra);
    if (ends.length === 0) { setErr("Tick at least one āyah to link to, or use Keep as a lead."); return; }
    setBusy(true);
    try {
      for (const otherEnd of ends) {
        const [a, b] = kind === "defined" && definer === "there" ? [otherEnd, hereEnd] : [hereEnd, otherEnd];
        await archive.links.save({
          id: newId("link"), a, b, kind, marker, label: label.trim(), note: note.trim(), status: "kept", source: "me",
        });
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save the links.");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (busy) return;
    setErr(null);
    if (multi) return saveSeveral();
    let otherEnd: LinkEnd | null = fixedOther;
    if (!otherEnd) {
      if (other !== TYPED) {
        const c = choices.find((p) => p.verseKey === other);
        if (c) otherEnd = { verseKey: c.verseKey, word: c.start, words: length };
      } else if (typed.trim()) {
        const m = KEY_RE.exec(typed.trim());
        if (!m) { setErr("Write the āyah as sūrah:āyah, for example 2:255."); return; }
        const key = `${Number(m[1])}:${Number(m[2])}`;
        if (key === verseKey) { setErr("That is this āyah. Choose the other end."); return; }
        try { otherEnd = await endIn(key, marker); }
        catch { setErr(`There is no āyah ${key}.`); return; }
      }
    }
    let a: LinkEnd = hereEnd;
    let b: LinkEnd | null = otherEnd;
    if (otherEnd && kind === "defined") {
      [a, b] = definer === "here" ? [hereEnd, otherEnd] : [otherEnd, hereEnd];
    } else if (initial?.b && otherEnd) {
      a = initial.a; b = initial.b; // keep the saved orientation
    }
    const rec: SavedLink = {
      id: initial?.id ?? newId("link"),
      a, b,
      kind,
      marker: initial?.marker ?? marker,
      label: label.trim(),
      note: note.trim(),
      status: b ? "kept" : "lead",
      // a tension keeps whether (and how) it was settled while its details are edited
      ...(kind === "tension" && initial?.kind === "tension" ? { resolved: initial.resolved, resolution: initial.resolution } : {}),
      source: initial?.source ?? "me",
      createdAt: initial?.createdAt,
    };
    setBusy(true);
    try {
      await archive.links.save(rec);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save the link.");
    } finally {
      setBusy(false);
    }
  };

  const count = open.filter((p) => picked.has(p.verseKey)).length + (multi && typed.trim() ? 1 : 0);
  const otherText = fixedOther ? fixedOther.verseKey
    : multi ? (count === 1 ? [...picked][0] ?? typed.trim() : "the other āyāt")
    : other === TYPED ? typed.trim() : other;
  return (
    <div className="links-form" onKeyDown={formKeys(save, onCancel)}>
      {err && <p className="acct-error links-form-wide" role="alert">{err}</p>}
      {multi && (
        <fieldset className="links-field links-form-wide links-pick">
          <legend className="links-field-label">Link this āyah to</legend>
          <div className="links-pick-list">
            {choices.map((p) => {
              const saved = done.has(p.verseKey);
              const name = surahName?.(p.verseKey) ?? "";
              return (
                <label key={p.verseKey} className={`links-pick-item${saved ? " saved" : ""}`}>
                  <input
                    type="checkbox"
                    checked={saved || picked.has(p.verseKey)}
                    disabled={saved}
                    onChange={() => tick(p.verseKey)}
                  />
                  <span>{p.verseKey}{name ? ` · ${name}` : ""}</span>
                  {saved && <span className="links-pick-note">already linked</span>}
                </label>
              );
            })}
          </div>
          <div className="links-pick-tools">
            <button type="button" className="links-link" onClick={() => setPicked(new Set(open.map((p) => p.verseKey)))}>
              Tick all {open.length}
            </button>
            <button type="button" className="links-link" onClick={() => setPicked(new Set())}>Tick none</button>
            <input
              className="links-input links-pick-typed"
              placeholder="or another āyah, e.g. 2:255"
              aria-label="Another āyah to link to"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
          <p className="links-pick-hint">
            One link is saved from {verseKey} to each ticked āyah, with the same details below.
          </p>
        </fieldset>
      )}
      {!multi && (
      <label className="links-field">
        <span className="links-field-label">The other āyah</span>
        {fixedOther ? (
          <span className="links-field-value">{fixedOther.verseKey}</span>
        ) : (
          <>
            <select className="links-input" value={other} onChange={(e) => setOther(e.target.value)} autoFocus>
              {choices.map((p) => <option key={p.verseKey} value={p.verseKey}>{p.verseKey}</option>)}
              <option value={TYPED}>{choices.length ? "Another āyah…" : "Type it below"}</option>
            </select>
            {other === TYPED && (
              <input
                className="links-input"
                placeholder="e.g. 2:255 (empty keeps it as a lead)"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoFocus={choices.length > 0}
              />
            )}
          </>
        )}
      </label>
      )}
      <label className={`links-field${multi ? " links-form-wide" : ""}`}>
        <span className="links-field-label">What they share</span>
        <select className="links-input" value={kind} onChange={(e) => setKind(e.target.value as SavedLinkKind)}>
          {SAVED_KIND_OPTIONS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      </label>
      {kind === "defined" && (
        <label className="links-field links-form-wide">
          <span className="links-field-label">Where is it explained?</span>
          <select className="links-input" value={definer} onChange={(e) => setDefiner(e.target.value as "here" | "there")}>
            <option value="here">Here, in {verseKey}; used in {otherText || "the other āyah"}</option>
            <option value="there">In {otherText || "the other āyah"}; used here, in {verseKey}</option>
          </select>
        </label>
      )}
      <label className="links-field">
        <span className="links-field-label">Group (optional)</span>
        <input
          className="links-input"
          list={`${uid}-labels`}
          placeholder="one image, one theme…"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <datalist id={`${uid}-labels`}>
          {labels.map((l) => <option key={l} value={l} />)}
        </datalist>
      </label>
      <label className="links-field">
        <span className="links-field-label">Note (optional)</span>
        <textarea className="links-input" rows={1} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="links-form-actions links-form-wide">
        <button className="ctl links-btn" onClick={onCancel}>Cancel</button>
        <button className="ctl primary" onClick={save} disabled={busy || (multi && count === 0)}>
          {busy ? "Saving…" : multi ? `Save ${count} link${count === 1 ? "" : "s"}` : "Save"}
        </button>
      </div>
    </div>
  );
}

/** Whether the text itself names the speaker, or the reader infers it. */
export const BASIS_OPTIONS: { id: NonNullable<SpeakerTag["basis"]>; label: string }[] = [
  { id: "", label: "Not said" },
  { id: "stated", label: "Stated in the text" },
  { id: "inferred", label: "My inference" },
];
export const basisLabel = (b: SpeakerTag["basis"]): string | null =>
  b === "stated" ? "stated in the text" : b === "inferred" ? "my inference" : null;

export function SpeechForm({ verseKey, words, initial, startAt, names, onDone, onCancel }: {
  verseKey: string;
  words: Word[] | null;
  initial?: SpeakerTag | null;
  /** a new tag: the word the speech starts at, when the caller knows (the word after an opener) */
  startAt?: number;
  /** speaker and addressee names already in use */
  names: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const uid = useId();
  // only real words: the list ends with the āyah's end mark, which has no text
  const list = (words ?? []).filter((w) => w.position != null && w.arabic);
  const first = list[0]?.position ?? 1;
  const last = list[list.length - 1]?.position ?? 1;
  const [from, setFrom] = useState(initial?.word ?? (startAt != null ? Math.min(Math.max(startAt, first), last) : first));
  const [to, setTo] = useState(initial ? (initial.words == null ? last : initial.word + initial.words - 1) : last);
  const [speaker, setSpeaker] = useState(initial?.speaker ?? "");
  const [addressee, setAddressee] = useState(initial?.addressee ?? "");
  const [listeners, setListeners] = useState(initial?.listeners ?? "");
  const [basis, setBasis] = useState<NonNullable<SpeakerTag["basis"]>>(initial?.basis ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // the reader's characters are offered as names too, beside the names already used in tags
  const characters = useAsync(async () => {
    try { return (await archive.characters.all()).map((c) => c.name); } catch { return []; }
  }, []);
  const suggestions = [...new Set([...names, ...(characters.data ?? [])].map((n) => n.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  const save = async () => {
    if (busy) return;
    if (!speaker.trim()) { setErr("Say who speaks."); return; }
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const rec: SpeakerTag = {
      id: initial?.id ?? newId("speech"),
      verseKey,
      word: lo,
      words: hi >= last ? null : hi - lo + 1,
      speaker: speaker.trim(),
      addressee: addressee.trim(),
      listeners: listeners.trim(),
      basis,
      note: note.trim(),
      source: initial?.source ?? "me",
      createdAt: initial?.createdAt,
    };
    setBusy(true);
    setErr(null);
    try {
      await archive.speech.save(rec);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const wordOption = (w: Word) => (
    <option key={w.position} value={w.position}>{w.position} · {w.arabic ?? ""}</option>
  );
  return (
    <div className="links-form" onKeyDown={formKeys(save, onCancel)}>
      {err && <p className="acct-error links-form-wide" role="alert">{err}</p>}
      <label className="links-field">
        <span className="links-field-label">From word</span>
        <select className="links-input links-input-ar" value={from} onChange={(e) => setFrom(Number(e.target.value))} autoFocus>
          {list.map(wordOption)}
        </select>
      </label>
      <label className="links-field">
        <span className="links-field-label">To word</span>
        <select className="links-input links-input-ar" value={to} onChange={(e) => setTo(Number(e.target.value))}>
          {list.map(wordOption)}
        </select>
      </label>
      <label className="links-field">
        <span className="links-field-label">Who speaks</span>
        <input className="links-input" list={`${uid}-names`} value={speaker} onChange={(e) => setSpeaker(e.target.value)} />
      </label>
      <label className="links-field">
        <span className="links-field-label">To whom</span>
        <input className="links-input" list={`${uid}-names`} value={addressee} onChange={(e) => setAddressee(e.target.value)} />
      </label>
      <datalist id={`${uid}-names`}>
        {suggestions.map((n) => <option key={n} value={n} />)}
      </datalist>
      <label className="links-field">
        <span className="links-field-label">Who else hears (optional)</span>
        <input className="links-input" list={`${uid}-names`} value={listeners} onChange={(e) => setListeners(e.target.value)} />
      </label>
      <label className="links-field">
        <span className="links-field-label">Is the speaker stated in the text?</span>
        <select className="links-input" value={basis} onChange={(e) => setBasis(e.target.value as NonNullable<SpeakerTag["basis"]>)}>
          {BASIS_OPTIONS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
      </label>
      <label className="links-field links-form-wide">
        <span className="links-field-label">Note (optional)</span>
        <textarea className="links-input" rows={1} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="links-form-actions links-form-wide">
        <button className="ctl links-btn" onClick={onCancel}>Cancel</button>
        <button className="ctl primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

/** Delete with an inline "are you sure", never a browser confirm. */
export function DeleteButton({ what, verb = "Delete", onDelete }: {
  what: string;
  /** "Delete", or "Dismiss" for an assistant's proposal */
  verb?: string;
  onDelete: () => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking) {
    return (
      <button className="links-link links-danger" title={`${verb} this ${what}`} onClick={() => setAsking(true)}>
        {verb}
      </button>
    );
  }
  return (
    <span className="links-confirm" role="group" aria-label={`${verb} this ${what}?`}>
      <span>{verb} this {what}?</span>
      <button
        className="ctl danger"
        disabled={busy}
        autoFocus
        onClick={async () => { setBusy(true); try { await onDelete(); } finally { setBusy(false); setAsking(false); } }}
      >{verb}</button>
      <button className="ctl links-btn" onClick={() => setAsking(false)}>Keep</button>
    </span>
  );
}
