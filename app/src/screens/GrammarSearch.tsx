// Search by grammar: āyāt that share a CONSTRUCTION rather than a word — an opening وَإِذْ, the
// question أَرَءَيْتَ, سَ against سَوْفَ, ٱلَّذِى + verb. Ready-made queries as one-click cards, and
// a small builder: up to four words in a row, each matched by its written form, root, part of
// speech or a prefix it carries. It finds and counts; it doesn't interpret.
//
// The query runs on the research server (corpus-core/src/constructions.ts); each hit carries the
// 1-based word span, which is lit here and in the reader (jumpToEcho).

import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useAppDispatch } from "../state/store";
import { ArabicKeyboard } from "../components/ArabicKeyboard";
import { VerseText } from "../components/VerseText";
import { PlanLock } from "../components/PlanLock";
import { announcePlanLock } from "../api/client";
import { useFeature, useFeatureCatalog, lockReason } from "../lib/features";
import { offerRuleScope } from "../lib/ruleHandoff";
import type { ConstructionHit, ConstructionQuery, ConstructionSlot } from "../api/types";

const PAGE = 50;
const MAX_SLOTS = 4;
const MAX_GAP = 10;
const SPAN_WASH = "#fde68a";

/** One builder slot as edited: plain strings, "" = not used. */
interface Draft {
  form: string; root: string; pos: string; prefix: string; gap: number;
  derivation: string; verbForm: string; suffix: string; number: string; gender: string;
}
const emptyDraft = (): Draft => ({
  form: "", root: "", pos: "", prefix: "", gap: 0, derivation: "", verbForm: "", suffix: "", number: "", gender: "",
});

/** the finer grammar a slot can ask for, beyond word, root, part of speech and prefix */
const moreUsed = (d: Draft) => [d.derivation, d.verbForm, d.suffix, d.number, d.gender].filter(Boolean).length;

const NUMBERS: Record<string, string> = { S: "singular", D: "dual", P: "plural" };
const GENDERS: Record<string, string> = { M: "masculine", F: "feminine" };

function toQuery(drafts: Draft[], atStart: boolean): ConstructionQuery {
  return {
    atStart,
    slots: drafts.map((d, i) => {
      const s: ConstructionSlot = {};
      if (d.form.trim()) s.form = d.form.trim();
      if (d.root.trim()) s.root = d.root.trim();
      if (d.pos) s.pos = d.pos;
      if (d.prefix) s.prefix = d.prefix;
      if (d.derivation) s.derivation = d.derivation;
      if (d.verbForm) s.verbForm = d.verbForm;
      if (d.suffix) s.suffix = d.suffix;
      if (d.number || d.gender) {
        s.noun = {};
        if (d.number) s.noun.number = d.number as "S" | "D" | "P";
        if (d.gender) s.noun.gender = d.gender as "M" | "F";
      }
      if (i > 0 && d.gap > 0) s.gap = d.gap;
      return s;
    }),
  };
}

/** A short name for a built query, for a rule's scope: "إذ + a verb (opens the āyah)". */
function describe(drafts: Draft[], atStart: boolean, pos: Record<string, string>, prefixes: Record<string, string>): string {
  const words = drafts.map((d, i) => {
    const bits: string[] = [];
    if (d.form.trim()) bits.push(d.form.trim());
    if (d.root.trim()) bits.push(`root ${d.root.trim()}`);
    if (d.pos) bits.push(pos[d.pos] ?? d.pos);
    if (d.prefix) bits.push(`with ${prefixes[d.prefix] ?? d.prefix}`);
    if (moreUsed(d)) bits.push("finer grammar");
    const gap = i > 0 && d.gap > 0 ? `within ${d.gap} · ` : "";
    return gap + (bits.join(", ") || "any word");
  });
  return words.join(" + ") + (atStart ? " (opens the āyah)" : "");
}

const isEmpty = (d: Draft) => !d.form.trim() && !d.root.trim() && !d.pos && !d.prefix && moreUsed(d) === 0;

/** One āyah in the results, with every match in it. */
interface Row { verseKey: string; text: string; spans: { start: number; length: number }[] }

function groupHits(hits: ConstructionHit[]): Row[] {
  const rows: Row[] = [];
  for (const h of hits) {
    const last = rows[rows.length - 1];
    if (last && last.verseKey === h.verse_key) last.spans.push({ start: h.start, length: h.length });
    else rows.push({ verseKey: h.verse_key, text: h.text, spans: [{ start: h.start, length: h.length }] });
  }
  return rows;
}

type Field = { slot: number; key: "form" | "root" };

export function GrammarSearch({ surahName }: { surahName: (key: string) => string }) {
  const dispatch = useAppDispatch();
  const catalog = useAsync(() => api.constructionPresets(), []);

  const [drafts, setDrafts] = useState<Draft[]>([emptyDraft()]);
  const [atStart, setAtStart] = useState(false);
  const [kbOpen, setKbOpen] = useState(false);
  const [field, setField] = useState<Field>({ slot: 0, key: "form" });

  // what is being shown: a preset (by name) or the builder's query, with a short label for it
  const [active, setActive] = useState<{ preset: string | null; query: ConstructionQuery; label: string } | null>(null);
  const canRules = useFeature("rules");
  const featureCatalog = useFeatureCatalog();
  // "Check as a rule": hand the query that produced these results to Rule checks
  const checkAsRule = () => {
    if (!active) return;
    if (!canRules) { announcePlanLock(lockReason("rules", featureCatalog)); return; }
    offerRuleScope({ kind: "construction", key: active.label, text: active.label, query: active.query });
    dispatch({ type: "setTab", tab: "rules" });
  };
  const [hits, setHits] = useState<ConstructionHit[]>([]);
  const [counts, setCounts] = useState<{ total: number; ayahs: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // a new query starts from the first page
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHits([]);
    setCounts(null);
    api.constructionSearch({ ...active.query, limit: PAGE, offset: 0 }).then(
      (r) => { if (!cancelled) { setHits(r.hits); setCounts({ total: r.total, ayahs: r.ayahs }); setLoading(false); } },
      (e: Error) => { if (!cancelled) { setError(e.message); setLoading(false); } },
    );
    return () => { cancelled = true; };
  }, [active]);

  const more = () => {
    if (!active || loading) return;
    setLoading(true);
    api.constructionSearch({ ...active.query, limit: PAGE, offset: hits.length }).then(
      (r) => { setHits((h) => [...h, ...r.hits]); setLoading(false); },
      (e: Error) => { setError(e.message); setLoading(false); },
    );
  };

  const rows = useMemo(() => groupHits(hits), [hits]);

  const setDraft = (i: number, patch: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const addSlot = () => setDrafts((ds) => (ds.length < MAX_SLOTS ? [...ds, emptyDraft()] : ds));
  const removeSlot = (i: number) => {
    setDrafts((ds) => ds.filter((_, j) => j !== i));
    setField((f) => (f.slot >= i ? { slot: Math.max(0, f.slot - 1), key: f.key } : f));
  };

  const runBuilder = () => {
    if (drafts.some(isEmpty)) {
      setError("Every word needs at least one thing to match: a written word, a root, a part of speech, a prefix or one of the finer grammar choices.");
      return;
    }
    setActive({ preset: null, query: toQuery(drafts, atStart), label: describe(drafts, atStart, pos, prefixes) });
  };

  // the on-screen keyboard types into the Arabic field last focused
  const typeInto = (fn: (s: string) => string) =>
    setDrafts((ds) => ds.map((d, j) => (j === field.slot ? { ...d, [field.key]: fn(d[field.key]) } : d)));

  const presets = catalog.data?.presets ?? [];
  const pos = catalog.data?.pos ?? {};
  const classes = catalog.data?.classes ?? [];
  const prefixes = catalog.data?.prefixes ?? {};
  const derivations = catalog.data?.derivations ?? {};
  const verbForms = catalog.data?.verbForms ?? [];
  const suffixes = catalog.data?.suffixes ?? {};

  return (
    <div className="gram">
      <section className="gram-section">
        <h2 className="gram-title">Ready-made</h2>
        {catalog.error && <p className="gram-error" role="alert">Couldn't load the ready-made searches: {catalog.error.message}</p>}
        <div className="gram-presets">
          {presets.map((p) => (
            <button
              key={p.name}
              className={`gram-preset${active?.preset === p.name ? " active" : ""}`}
              onClick={() => setActive({ preset: p.name, query: p.query, label: p.label })}
              title={`Find every āyah with ${p.label}`}
            >
              <span className="gram-preset-label">{p.label}</span>
              <span className="gram-preset-desc">{p.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="gram-section">
        <h2 className="gram-title">Build your own</h2>
        <p className="gram-hint">
          Up to four words in a row, read right to left as in the āyah. Fill in only what matters;
          vowels can be left off.
        </p>
        <div className="gram-slots">
          {drafts.map((d, i) => (
            <div key={i} className="gram-slot" role="group" aria-labelledby={`gram-slot-${i}`}>
              <div className="gram-slot-head">
                <span id={`gram-slot-${i}`}>Word {i + 1}</span>
                {drafts.length > 1 && (
                  <button
                    type="button"
                    className="ctl gram-remove"
                    onClick={() => removeSlot(i)}
                    title={`Remove word ${i + 1}`}
                    aria-label={`Remove word ${i + 1}`}
                  >Remove</button>
                )}
              </div>
              {i > 0 && (
                <div className="gram-field">
                  <label htmlFor={`gram-gap-${i}`}>After word {i}</label>
                  <select id={`gram-gap-${i}`} value={d.gap} onChange={(e) => setDraft(i, { gap: Number(e.target.value) })}>
                    <option value={0}>right after it</option>
                    {Array.from({ length: MAX_GAP }, (_, k) => k + 1).map((n) => (
                      <option key={n} value={n}>within {n} word{n === 1 ? "" : "s"}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="gram-field">
                <label htmlFor={`gram-form-${i}`}>Written word</label>
                <input
                  id={`gram-form-${i}`}
                  className="gram-arabic"
                  dir="rtl"
                  placeholder="إذ"
                  value={d.form}
                  onFocus={() => setField({ slot: i, key: "form" })}
                  onChange={(e) => setDraft(i, { form: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") runBuilder(); }}
                />
              </div>
              <div className="gram-field">
                <label htmlFor={`gram-root-${i}`}>Root</label>
                <input
                  id={`gram-root-${i}`}
                  className="gram-arabic"
                  dir="rtl"
                  placeholder="رأي"
                  value={d.root}
                  onFocus={() => setField({ slot: i, key: "root" })}
                  onChange={(e) => setDraft(i, { root: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") runBuilder(); }}
                />
              </div>
              <div className="gram-field">
                <label htmlFor={`gram-pos-${i}`}>Part of speech</label>
                <select id={`gram-pos-${i}`} value={d.pos} onChange={(e) => setDraft(i, { pos: e.target.value })}>
                  <option value="">any</option>
                  <optgroup label="Kinds">
                    {classes.map((c) => <option key={c} value={c}>{c}</option>)}
                  </optgroup>
                  <optgroup label="Exactly">
                    {Object.entries(pos).map(([tag, name]) => <option key={tag} value={tag}>{name}</option>)}
                  </optgroup>
                </select>
              </div>
              <div className="gram-field">
                <label htmlFor={`gram-prefix-${i}`}>Carries the prefix</label>
                <select id={`gram-prefix-${i}`} value={d.prefix} onChange={(e) => setDraft(i, { prefix: e.target.value })}>
                  <option value="">any or none</option>
                  {Object.entries(prefixes).map(([key, what]) => <option key={key} value={key}>{what}</option>)}
                </select>
              </div>
              <details className="gs-more">
                <summary>
                  More grammar{moreUsed(d) > 0 ? ` · ${moreUsed(d)} set` : ""}
                </summary>
                <div className="gs-more-grid">
                  <div className="gram-field">
                    <label htmlFor={`gram-deriv-${i}`}>Derived as</label>
                    <select id={`gram-deriv-${i}`} value={d.derivation} onChange={(e) => setDraft(i, { derivation: e.target.value })}>
                      <option value="">any or none</option>
                      {Object.entries(derivations).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
                    </select>
                  </div>
                  <div className="gram-field">
                    <label htmlFor={`gram-vform-${i}`}>Verb form</label>
                    <select id={`gram-vform-${i}`} value={d.verbForm} onChange={(e) => setDraft(i, { verbForm: e.target.value })}>
                      <option value="">any</option>
                      {verbForms.map((f) => <option key={f} value={f}>Form {f}</option>)}
                    </select>
                  </div>
                  <div className="gram-field">
                    <label htmlFor={`gram-suffix-${i}`}>Attached pronoun</label>
                    <select id={`gram-suffix-${i}`} value={d.suffix} onChange={(e) => setDraft(i, { suffix: e.target.value })}>
                      <option value="">any or none</option>
                      {Object.entries(suffixes).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
                    </select>
                  </div>
                  <div className="gram-field">
                    <label htmlFor={`gram-number-${i}`}>Noun number</label>
                    <select id={`gram-number-${i}`} value={d.number} onChange={(e) => setDraft(i, { number: e.target.value })}>
                      <option value="">any</option>
                      {Object.entries(NUMBERS).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
                    </select>
                  </div>
                  <div className="gram-field">
                    <label htmlFor={`gram-gender-${i}`}>Noun gender</label>
                    <select id={`gram-gender-${i}`} value={d.gender} onChange={(e) => setDraft(i, { gender: e.target.value })}>
                      <option value="">any</option>
                      {Object.entries(GENDERS).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
                    </select>
                  </div>
                </div>
                <p className="gram-hint">As the corpus marks each word. Verb form I is a verb, or a word derived from one, with no other form marked.</p>
              </details>
            </div>
          ))}
        </div>

        <div className="gram-options">
          <label className="gram-check">
            <input type="checkbox" checked={atStart} onChange={(e) => setAtStart(e.target.checked)} />
            Word 1 opens the āyah (a joining وَ / فَ allowed)
          </label>
        </div>

        <div className="gram-actions">
          <button className="ctl gram-secondary" onClick={addSlot} disabled={drafts.length >= MAX_SLOTS}>
            <span className="gram-ic" aria-hidden="true">+</span>Add a word
          </button>
          <button className="ctl gram-secondary" onClick={() => setKbOpen((o) => !o)} aria-pressed={kbOpen}>
            <span className="gram-ic" aria-hidden="true">⌨</span>Arabic keyboard
          </button>
          <button className="ctl primary" onClick={runBuilder}>Search</button>
        </div>

        {kbOpen && (
          <ArabicKeyboard
            onInsert={(ch) => typeInto((s) => s + ch)}
            onBackspace={() => typeInto((s) => s.slice(0, -1))}
            onClear={() => typeInto(() => "")}
          />
        )}
      </section>

      {error && <p className="gram-error" role="alert">{error}</p>}

      {active && (
        <section className="gram-section">
          {counts && (
            <div className="gram-result-head">
              <p className="search-count">
                {counts.total === 0
                  ? "No āyah has this construction."
                  : `${counts.total} match${counts.total === 1 ? "" : "es"} in ${counts.ayahs} ${counts.ayahs === 1 ? "āyah" : "āyāt"}`}
              </p>
              {counts.total > 0 && (
                <button
                  className={`ctl gram-secondary${canRules ? "" : " plan-locked"}`}
                  title={`State a rule about “${active.label}” and mark every place it occurs`}
                  onClick={checkAsRule}
                >
                  <span className="gram-ic" aria-hidden="true">☑</span>Check as a rule{!canRules && <> <PlanLock feature="rules" /></>}
                </button>
              )}
            </div>
          )}
          <ul className="search-list">
            {rows.map((r) => {
              const first = r.spans[0]!;
              const name = surahName(r.verseKey);
              return (
                <li key={r.verseKey}>
                  <button
                    className="search-row"
                    onClick={() => dispatch({ type: "jumpToEcho", verseKey: r.verseKey, start: first.start, length: first.length })}
                    title={`Read ${r.verseKey} with the match lit`}
                  >
                    <span className="search-ref">
                      {r.verseKey}{name ? ` · ${name}` : ""}
                      {r.spans.length > 1 ? ` · ${r.spans.length} matches` : ""}
                    </span>
                    <span className="search-verse quran" dir="rtl">
                      <VerseText
                        text={r.text}
                        highlightRanges={r.spans.map((s) => ({ start: s.start, end: s.start + s.length - 1, color: SPAN_WASH }))}
                      />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {loading && <p className="loading">Searching…</p>}
          {!loading && counts && hits.length < counts.total && (
            <div className="gram-more">
              <button className="ctl gram-secondary" onClick={more}>
                Show {Math.min(PAGE, counts.total - hits.length)} more
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
