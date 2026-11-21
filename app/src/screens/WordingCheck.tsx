// Check wording: any Arabic text set against the Book, word by word (POST /corpus/wording-check).
// Each word is found as written, with the same letters and other vowels, only once a leading
// prefix is set aside, or not at all. It checks wording only, never whether a reading is right.

import { useState } from "react";
import { api } from "../api/client";
import { useAppDispatch } from "../state/store";
import { ArabicKeyboard } from "../components/ArabicKeyboard";
import type { WordingCheck as Result, WordingWord } from "../api/types";

const MAX_WORDS = 200;
const spaced = (r: string) => r.split("").join(" "); // nbsp: root letters must not wrap (ه د ي)
const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const STATUS: Record<WordingWord["status"], string> = {
  written: "As written",
  letters: "Same letters",
  stem: "With a prefix set aside",
  none: "Not found",
};

function detail(w: WordingWord): string {
  switch (w.status) {
    case "written": return `${n(w.written.count, "time", "times")} in ${n(w.written.ayahs, "āyah", "āyāt")}`;
    case "letters": {
      // a word typed with no vowel marks was never going to match "as written": just count it
      const vowelled = /[ً-ْٰ]/.test(w.text);
      return `${vowelled ? "not with these vowels; " : ""}these letters ${n(w.letters.count, "time", "times")} in ${n(w.letters.ayahs, "āyah", "āyāt")}`;
    }
    case "stem": return w.stem ? `${w.stem.prefix} set aside: ${n(w.stem.count, "time", "times")} in ${n(w.stem.ayahs, "āyah", "āyāt")}` : "";
    case "none": return "not in the Book as a word, nor once a leading و ف ب ل ك س or ال is set aside";
  }
}

export function WordingCheck() {
  const dispatch = useAppDispatch();
  const [text, setText] = useState("");
  const [kbOpen, setKbOpen] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  const check = () => {
    if (!text.trim() || loading) return;
    setLoading(true);
    setError(null);
    api.wordingCheck(text).then(
      (r) => { setResult(r); setLoading(false); },
      (e: Error) => { setError(e.message); setLoading(false); },
    );
  };

  const open = (verseKey: string) => dispatch({ type: "jumpToVerse", verseKey });

  return (
    <div className="wc">
      {error && <p className="wc-error" role="alert">Couldn't check this wording: {error}</p>}
      <div className="wc-field">
        <label htmlFor="wc-text">Arabic text</label>
        <textarea
          id="wc-text"
          className="wc-input"
          dir="rtl"
          rows={3}
          placeholder="الصق نصا عربيا أو اكتبه…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) check(); }}
        />
        <span className="wc-hint">
          Up to {MAX_WORDS} words. Each is set against every word in the Book, vowels and all, then
          by its letters alone.{words > MAX_WORDS ? ` This text has ${words}.` : ""}
        </span>
      </div>
      <div className="wc-actions">
        <button className="ctl wc-secondary" onClick={() => setKbOpen((o) => !o)} aria-pressed={kbOpen}>
          <span className="wc-ic" aria-hidden="true">⌨</span>Arabic keyboard
        </button>
        <button className="ctl primary" onClick={check} disabled={!text.trim() || loading || words > MAX_WORDS}>
          {loading ? "Checking…" : "Check"}
        </button>
      </div>
      {kbOpen && (
        <ArabicKeyboard
          onInsert={(ch) => setText((s) => s + ch)}
          onBackspace={() => setText((s) => s.slice(0, -1))}
          onClear={() => setText("")}
        />
      )}

      {result && (
        <section className="wc-result" aria-live="polite">
          <p className="search-count">
            {n(result.summary.total, "word", "words")}: {result.summary.written} as written,{" "}
            {result.summary.letters} with the same letters, {result.summary.stem} with a prefix set aside,{" "}
            {result.summary.none} not found
          </p>
          <ol className="wc-words">
            {result.words.map((w, i) => (
              <li key={i} className={`wc-word wc-${w.status}`}>
                <div className="wc-word-head">
                  <span className="wc-text" dir="rtl">{w.text}</span>
                  <span className="wc-status">{STATUS[w.status]}</span>
                </div>
                <p className="wc-detail">{detail(w)}</p>
                {w.status === "letters" && w.letters.forms.length > 0 && (
                  <p className="wc-forms">
                    <span className="wc-label">The Book writes</span>
                    {w.letters.forms.map((f) => <span key={f} className="wc-form" dir="rtl">{f}</span>)}
                  </p>
                )}
                {w.status === "stem" && w.stem && (
                  <p className="wc-forms">
                    <span className="wc-label">Found as</span>
                    <span className="wc-form" dir="rtl">{w.stem.text}</span>
                  </p>
                )}
                {(() => {
                  const roots = w.status === "stem" ? w.stem?.roots ?? [] : w.letters.roots;
                  return roots.length > 0 && w.status !== "none" ? (
                    <p className="wc-forms">
                      <span className="wc-label">Root{roots.length > 1 ? "s" : ""}</span>
                      {roots.map((r) => <span key={r} className="wc-root" dir="rtl">{spaced(r)}</span>)}
                    </p>
                  ) : null;
                })()}
                {w.sample && (
                  <button className="ctl wc-open" onClick={() => open(w.sample!)} title={`Read ${w.sample}`}>
                    Open {w.sample}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
