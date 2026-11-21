// Spellings: every word the Book writes in more than one way (GET /corpus/spellings). One group
// is one word (with and without ٱل, a verb in every person); its spellings stand side by side
// with how often each is used, and open to every place. The kind names where two spellings part,
// by the letters only. Groups whose shapes differ only by a grammatical ending (ذُو / ذِى) are left
// out unless asked for. Where the bare word is written both ة and ت, its words that carry a
// pronoun are shown apart: the script writes ت there either way. Each spelling can be handed to
// Rule checks, which then lists exactly the places counted here. Why a word is spelled so is
// never said here: that is the reader's to investigate.

import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useAppDispatch } from "../state/store";
import { useFeature } from "../lib/features";
import { offerRuleScope } from "../lib/ruleHandoff";
import { useGate } from "../components/research/places";
import { PlanLock } from "../components/PlanLock";
import type { SpellingGroup, SpellingKind } from "../api/types";

const ENDING = "ending";

const PAGE = 40;
const spaced = (r: string) => r.split("").join(" "); // nbsp: root letters must not wrap (ه د ي)
const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function Spellings() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [kind, setKind] = useState<string>("");
  const [alpha, setAlpha] = useState(false);
  const [items, setItems] = useState<SpellingGroup[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [hidden, setHidden] = useState(0);
  const [kinds, setKinds] = useState<SpellingKind[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  // a new filter starts from the first page
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.spellings({ kind: kind || undefined, q: debounced || undefined, sort: alpha ? "alpha" : undefined, limit: PAGE, offset: 0 }).then(
      (r) => { if (!cancelled) { setItems(r.items); setTotal(r.total); setHidden(r.hidden); setKinds(r.kinds); setLoading(false); } },
      (e: Error) => { if (!cancelled) { setError(e.message); setLoading(false); } },
    );
    return () => { cancelled = true; };
  }, [kind, debounced, alpha]);

  const more = () => {
    if (loading) return;
    setLoading(true);
    api.spellings({ kind: kind || undefined, q: debounced || undefined, sort: alpha ? "alpha" : undefined, limit: PAGE, offset: items.length }).then(
      (r) => { setItems((s) => [...s, ...r.items]); setLoading(false); },
      (e: Error) => { setError(e.message); setLoading(false); },
    );
  };

  const label = (id: string) => kinds.find((k) => k.id === id)?.label ?? id;

  return (
    <div className="sheet sp">
      <header className="home-head">
        <h1>Spellings</h1>
        <p className="subtitle">
          Every word the Book writes in more than one way: the same word with a different written
          shape. Each spelling with how often it is used, and where.
        </p>
      </header>

      {error && <p className="sp-error" role="alert">Couldn't load the spellings: {error}</p>}

      <div className="sp-controls">
        <div className="sp-field">
          <label htmlFor="sp-q">Find a word</label>
          <input
            id="sp-q"
            className="sp-input"
            dir="rtl"
            placeholder="ابراهيم"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="sp-field">
          <span className="sp-label" id="sp-kinds">Where the spellings part</span>
          <div className="sp-kinds" role="group" aria-labelledby="sp-kinds">
            <button className={`sp-kind${kind === "" ? " active" : ""}`} aria-pressed={kind === ""} onClick={() => setKind("")}>
              Any
            </button>
            {kinds.map((k) => (
              <button
                key={k.id}
                className={`sp-kind${kind === k.id ? " active" : ""}`}
                aria-pressed={kind === k.id}
                disabled={k.count === 0 && kind !== k.id}
                onClick={() => setKind(kind === k.id ? "" : k.id)}
              >
                {k.label} <span className="sp-kind-n">{k.count}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="sp-field">
          <span className="sp-label" id="sp-order">Order</span>
          <div className="sp-kinds" role="group" aria-labelledby="sp-order">
            <button className={`sp-kind${alpha ? "" : " active"}`} aria-pressed={!alpha} onClick={() => setAlpha(false)}>
              Most places first
            </button>
            <button className={`sp-kind${alpha ? " active" : ""}`} aria-pressed={alpha} onClick={() => setAlpha(true)}>
              Alphabetical <span className="sp-kind-n" dir="rtl">أ ب ت</span>
            </button>
          </div>
        </div>
      </div>

      {total !== null && (
        <p className="search-count">
          {total === 0 ? "No word written more than one way matches." : `${n(total, "word", "words")} written more than one way`}
        </p>
      )}
      {kind === "" && hidden > 0 && (
        <p className="sp-hidden">
          {n(hidden, "word whose shapes differ", "words whose shapes differ")} only by a grammatical ending
          (ذُو / ذِى) {hidden === 1 ? "is" : "are"} not shown.{" "}
          <button className="sp-link" onClick={() => setKind(ENDING)}>Show them</button>
        </p>
      )}
      {kind === ENDING && (
        <p className="sp-hidden">
          Showing the words whose shapes differ by a grammatical ending: the case decides the letter, so they
          are not marked as spelling variants in the reader.{" "}
          <button className="sp-link" onClick={() => setKind("")}>Back to every spelling</button>
        </p>
      )}

      <ul className="sp-list">
        {items.map((g) => <Group key={g.key} group={g} label={label} />)}
      </ul>

      {loading && <p className="loading">Loading…</p>}
      {!loading && total !== null && items.length < total && (
        <div className="sp-more">
          <button className="ctl sp-secondary" onClick={more}>Show {Math.min(PAGE, total - items.length)} more</button>
        </div>
      )}
    </div>
  );
}

/** One word and its spellings, opening to every place. */
function Group({ group, label }: { group: SpellingGroup; label: (id: string) => string }) {
  const dispatch = useAppDispatch();
  const gate = useGate();
  const canRules = useFeature("rules");
  const [open, setOpen] = useState(false);
  // this spelling of this word: Rule checks lists exactly the places counted here
  const checkAsRule = (surface: string) => gate(canRules, "rules", () => {
    offerRuleScope({ kind: "spelling", key: `${group.key}|${surface}`, text: surface });
    dispatch({ type: "setTab", tab: "rules" });
  });
  const full = useAsync(async () => (open ? api.spellingGroup(group.key) : null), [open, group.key]);
  const shown = full.data ?? group;

  return (
    <li className="sp-group">
      <div className="sp-head">
        <span className="sp-lemma" dir="rtl">{group.lemma}</span>
        {group.root && <span className="sp-root" dir="rtl" title="Root">{spaced(group.root)}</span>}
        <span className="sp-total">{n(group.total, "word", "words")}</span>
        <span className="sp-tags">
          {group.kinds.map((k) => <span key={k} className="sp-tag">{label(k)}</span>)}
        </span>
      </div>
      <div className="sp-shapes" style={{ gridTemplateColumns: `repeat(${Math.min(group.spellings.length, 3)}, minmax(0, 1fr))` }}>
        {shown.spellings.map((s, i) => (
          <div key={i} className="sp-shape">
            <span className="sp-surface" dir="rtl">{s.surface}</span>
            <span className="sp-count">
              {n(s.count, "time", "times")} · {n(s.ayahs, "āyah", "āyāt")}
              {s.attached ? ` · ${s.attached} of them with a pronoun attached (written ت there)` : ""}
            </span>
            <button
              className={`sp-link sp-rule${canRules ? "" : " plan-locked"}`}
              dir="ltr"
              title="State a rule about this spelling and check it against these places"
              onClick={checkAsRule(s.surface)}
            >Check as a rule{!canRules && <> <PlanLock feature="rules" /></>}</button>
            {open && (
              <div className="sp-places">
                {full.loading && <span className="loading">…</span>}
                {!full.loading && s.places.map((p) => (
                  <button
                    key={`${p.verseKey}:${p.word}`}
                    className="chip sp-place"
                    title={`Read ${p.verseKey}, word ${p.word}`}
                    onClick={() => dispatch({ type: "jumpToEcho", verseKey: p.verseKey, start: p.word, length: 1 })}
                  >{p.verseKey}</button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {shown.withPronoun && (
        <div className="sp-aside">
          <p className="sp-aside-note">
            With a pronoun attached: {n(shown.withPronoun.count, "time", "times")} · {n(shown.withPronoun.ayahs, "āyah", "āyāt")}.
            The script writes ت there either way, so they are counted with neither spelling.
          </p>
          {open && !full.loading && (
            <div className="sp-places">
              {shown.withPronoun.places.map((p) => (
                <button
                  key={`${p.verseKey}:${p.word}`}
                  className="chip sp-place"
                  title={`Read ${p.verseKey}, word ${p.word}`}
                  onClick={() => dispatch({ type: "jumpToEcho", verseKey: p.verseKey, start: p.word, length: 1 })}
                >{p.verseKey}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {full.error && <p className="sp-error" role="alert">Couldn't load every place: {full.error.message}</p>}
      <div className="sp-group-actions">
        <button className="ctl sp-secondary" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide the places" : "Every place"}
        </button>
      </div>
    </li>
  );
}
