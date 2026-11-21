// Pieces shared by the research tools that work over lists of places in the Book (Rule checks,
// Characters, Dialogue, the Links panel's Characters and Pronouns): what a scope covers in plain
// words, one place's line of text with its words lit, an in-page "are you sure", and the small
// "Arabic + how to match it" input. They only find, count and show; nothing here interprets.

import { useId, useState, type ReactNode } from "react";
import { announcePlanLock } from "../../api/client";
import { useFeatureCatalog, lockReason, type PlanFeature } from "../../lib/features";
import { VerseText } from "../VerseText";
import type { OccurrenceKind, OccurrenceScope } from "../../api/types";

/** What a scope looks for, in plain words. */
export const SCOPE_KIND_LABEL: Record<OccurrenceKind, string> = {
  phrase: "phrase",
  pair: "two words",
  form: "word as written",
  lemma: "word (all its forms)",
  root: "root",
  spelling: "exact spelling",
  construction: "grammar pattern",
};

/** Root letters must not wrap (ه د ي): joined with a non-breaking space. */
export const spacedRoot = (r: string) => r.replace(/\s+/g, "").split("").join(" ");

/** A scope's text as it is shown: a root letter-spaced, anything else as written. */
export const scopeShown = (s: Pick<OccurrenceScope, "kind" | "text" | "key">) =>
  s.kind === "root" ? spacedRoot(s.text || s.key) : (s.text || s.key);

/** The three ways a reader can match Arabic they type. */
export type MatchKind = "form" | "lemma" | "root";
export const MATCH_KINDS: { id: MatchKind; label: string; hint: string }[] = [
  { id: "form", label: "As written", hint: "this word as it is written, with or without a leading و or ف" },
  { id: "lemma", label: "Word", hint: "the word in all its forms (its lemma)" },
  { id: "root", label: "Root", hint: "every word from this root" },
];

/** A scope from typed Arabic; null when nothing usable was typed. */
export function typedScope(kind: MatchKind, raw: string): OccurrenceScope | null {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return null;
  const key = kind === "root" ? text.replace(/\s+/g, "") : text;
  return { kind, key, text: kind === "root" ? key : text };
}

export const chapterOf = (k: string) => parseInt(k.split(":")[0] ?? "", 10) || 0;
export const verseNo = (k: string) => parseInt(k.split(":")[1] ?? "", 10) || 0;
/** Book order of two āyah keys. */
export const byPlace = (x: string, y: string) => chapterOf(x) - chapterOf(y) || verseNo(x) - verseNo(y);
export const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
/** One key per place: an āyah and the word a span starts at. */
export const placeKey = (p: { verseKey: string; word: number }) => `${p.verseKey}|${p.word}`;

export const SPAN_WASH = "#fde68a";

/** One place's line of text with its words lit; "…" until the text has arrived. */
export function PlaceText({ text, word, words }: { text: string | undefined; word: number; words: number }) {
  return (
    <span className="rx-line quran" dir="rtl">
      {text === undefined
        ? "…"
        : <VerseText text={text} highlightRanges={[{ start: word, end: word + Math.max(1, words) - 1, color: SPAN_WASH }]} />}
    </span>
  );
}

/** A change control's click: the action when the plan allows it, else a toast saying why. */
export function useGate() {
  const catalog = useFeatureCatalog();
  return (ok: boolean, f: PlanFeature, fn: () => void) => (ok ? fn : () => announcePlanLock(lockReason(f, catalog)));
}

/** A button whose action is asked about in the page first (never a browser confirm). */
export function ConfirmButton({ children, question, confirm, onConfirm, className = "ctl ml-secondary", disabled }: {
  children: ReactNode;
  /** the question, saying how many it touches */
  question: string;
  /** the label of the button that does it */
  confirm: string;
  onConfirm: () => Promise<void>;
  className?: string;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking) {
    return <button className={className} disabled={disabled} onClick={() => setAsking(true)}>{children}</button>;
  }
  return (
    <span className="rx-confirm" role="group" aria-label={question}>
      <span className="rx-confirm-q">{question}</span>
      <button
        className="ctl primary"
        disabled={busy}
        autoFocus
        onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); setAsking(false); } }}
      >{busy ? "Working…" : confirm}</button>
      <button className="ctl ml-secondary" onClick={() => setAsking(false)}>Cancel</button>
    </span>
  );
}

/** Arabic to look for and how to match it, labels above controls, one left edge. */
export function MatchInput({ kind, text, onKind, onText, label = "Arabic to look for", onEnter }: {
  kind: MatchKind;
  text: string;
  onKind: (k: MatchKind) => void;
  onText: (t: string) => void;
  label?: string;
  onEnter?: () => void;
}) {
  const id = useId();
  const hint = MATCH_KINDS.find((m) => m.id === kind)?.hint ?? "";
  return (
    <div className="rx-match">
      <div className="ml-field">
        <label htmlFor={`${id}-ar`}>{label}</label>
        <input
          id={`${id}-ar`}
          className="rx-ar-input"
          dir="rtl"
          lang="ar"
          value={text}
          placeholder={kind === "root" ? "ه د ي" : "ٱلرَّحْمَٰن"}
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && onEnter) { e.preventDefault(); onEnter(); } }}
        />
      </div>
      <div className="ml-field">
        <span className="rx-label" id={`${id}-how`}>Match it</span>
        <div className="rx-seg rx-seg-3" role="group" aria-labelledby={`${id}-how`}>
          {MATCH_KINDS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`ctl${kind === m.id ? " active" : ""}`}
              aria-pressed={kind === m.id}
              title={m.hint}
              onClick={() => onKind(m.id)}
            >{m.label}</button>
          ))}
        </div>
        <span className="rx-hint">{hint}</span>
      </div>
    </div>
  );
}
