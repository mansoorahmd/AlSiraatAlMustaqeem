// Rule checks: a rule the reader states, set against EVERY place it applies.
//
//   list    each rule with its tally: fits / exceptions / not sure / not yet checked / AI suggestions
//   a rule  its statement, what would prove it wrong, what it covers, then every place from
//           POST /corpus/occurrences in Book order, each marked by the reader: Fits, Exception,
//           Not sure, with a note
//
// The app finds and counts the places; whether each one fits is the reader's call. An assistant's
// marks arrive as suggestions (source 'ai') and count for nothing until the reader accepts them.
// A rule can be started from anywhere that holds a list of places: lib/ruleHandoff.ts.

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useVerseTexts } from "../hooks/useVerseTexts";
import { useAppDispatch, useAppState } from "../state/store";
import { useFeature } from "../lib/features";
import { archive, newId } from "../persistence/db";
import { PlanLock } from "../components/PlanLock";
import { DeleteButton } from "../components/reader/LinkForms";
import { peekRuleScope, takeRuleScope } from "../lib/ruleHandoff";
import {
  SCOPE_KIND_LABEL, scopeShown, typedScope, MatchInput, PlaceText, ConfirmButton, useGate,
  byPlace, chapterOf, plural, placeKey, type MatchKind,
} from "../components/research/places";
import type { Occurrence, OccurrenceScope } from "../api/types";
import type { RuleCheck, RuleMark, RuleMarkValue } from "../persistence/types";

const PAGE = 50;
/** the most places one rule is checked against (the server marks at most 6000 at a time) */
const MAX_PLACES = 6000;

const MARK_LABEL: Record<RuleMarkValue, string> = { fits: "Fits", exception: "Exception", unsure: "Not sure" };
const MARK_WORD: Record<RuleMarkValue, string> = { fits: "fits", exception: "exception", unsure: "not sure" };
const MARK_IC: Record<RuleMarkValue, string> = { fits: "✓", exception: "✕", unsure: "?" };

type Filter = "all" | "unchecked" | "exception" | "unsure" | "suggested";

function useSurahName() {
  const chapters = useAsync(() => api.chapters(), []);
  return (key: string) => chapters.data?.find((c) => c.id === chapterOf(key))?.name_simple ?? "";
}

// ------------------------------------------------------------ new rule ----

function NewRuleForm({ initialScope, onSaved, onCancel }: {
  initialScope: OccurrenceScope | null;
  onSaved: (r: RuleCheck) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [statement, setStatement] = useState("");
  const [falsifier, setFalsifier] = useState("");
  // what it covers: handed over from elsewhere, or typed here
  const [given, setGiven] = useState<OccurrenceScope | null>(initialScope);
  const [kind, setKind] = useState<MatchKind>("lemma");
  const [text, setText] = useState("");
  const scope = given ?? typedScope(kind, text);
  const sig = scope ? JSON.stringify([scope.kind, scope.key, scope.query ?? null]) : "";
  const [previewFor, setPreviewFor] = useState<string | null>(given ? sig : null);
  const preview = useAsync(
    async () => (previewFor && scope && previewFor === sig ? api.occurrences(scope, { limit: 1 }) : null),
    [previewFor, sig],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (busy) return;
    if (!title.trim() && !statement.trim()) { setError("Give the rule a title or state it."); return; }
    if (!scope) { setError("Say what the rule covers: type the Arabic to look for."); return; }
    setBusy(true);
    setError(null);
    try {
      const saved = await archive.rules.save({
        id: newId("rule"), title: title.trim(), statement: statement.trim(), falsifier: falsifier.trim(), scope,
      });
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onCancel(); }
  };

  return (
    <section className="ml-card rc-new" aria-label="New rule" onKeyDown={keys}>
      <h2 className="ml-title">New rule</h2>
      {error && <p className="ml-error" role="alert">{error}</p>}
      <div className="ml-field">
        <label htmlFor="rc-title">Title</label>
        <input id="rc-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="a short name for the rule" />
      </div>
      <div className="ml-field">
        <label htmlFor="rc-statement">The rule, in your words</label>
        <textarea id="rc-statement" rows={2} value={statement} onChange={(e) => setStatement(e.target.value)} />
      </div>
      <div className="ml-field">
        <label htmlFor="rc-falsifier">What would prove this wrong?</label>
        <textarea id="rc-falsifier" rows={2} value={falsifier} onChange={(e) => setFalsifier(e.target.value)}
          placeholder="the kind of place that, if you found it, would break the rule" />
      </div>
      <div className="ml-field">
        <span className="rx-label">What it covers</span>
        {given ? (
          <div className="rc-given">
            <span className="rc-kind">{SCOPE_KIND_LABEL[given.kind]}</span>
            <span className="rx-ar" dir="rtl">{scopeShown(given)}</span>
            <button className="links-link" onClick={() => { setGiven(null); setPreviewFor(null); }}>Type something else</button>
          </div>
        ) : (
          <MatchInput kind={kind} text={text} onKind={(k) => setKind(k)} onText={setText} onEnter={() => scope && setPreviewFor(sig)} />
        )}
      </div>
      <div className="rc-preview">
        {!given && (
          <button className="ctl ml-secondary" disabled={!scope} onClick={() => setPreviewFor(sig)}>
            <span className="ml-ic" aria-hidden="true">⌕</span>Count the places
          </button>
        )}
        {previewFor === sig && preview.loading && <span className="ml-hint">Counting…</span>}
        {previewFor === sig && preview.error && <span className="ml-error" role="alert">{preview.error.message}</span>}
        {previewFor === sig && preview.data && (
          <span className="ml-hint">
            {preview.data.total === 0
              ? "Found nowhere in the Book. Check the spelling, or match it another way."
              : `${plural(preview.data.total, "place", "places")} in ${plural(preview.data.ayahs, "āyah", "āyāt")}: each one will be listed for you to check.`}
          </span>
        )}
      </div>
      <div className="ml-actions">
        <button className="ctl ml-secondary" onClick={onCancel}>Cancel</button>
        <button className="ctl primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save the rule"}</button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------ the list ----

function RuleRow({ r, onOpen }: { r: RuleCheck; onOpen: () => void }) {
  // the true number of places: one row fetched, `total` is the whole count
  const total = useAsync(() => api.occurrences(r.scope, { limit: 1 }), [r.scope.kind, r.scope.key, JSON.stringify(r.scope.query ?? null)]);
  const c = r.counts ?? { fits: 0, exception: 0, unsure: 0, suggested: 0 };
  const marked = c.fits + c.exception + c.unsure;
  const unchecked = total.data ? Math.max(0, total.data.total - marked) : null;
  return (
    <li>
      <button className="ml-group rc-rule" onClick={onOpen}>
        <span className="ml-group-name">{r.title || r.statement || "Untitled rule"}</span>
        <span className="rc-covers">
          <span className="rc-kind">{SCOPE_KIND_LABEL[r.scope.kind]}</span>
          <span className="rx-ar" dir="rtl">{scopeShown(r.scope)}</span>
        </span>
        <span className="rc-tally-line">
          <span>{c.fits} fit</span>
          <span className={c.exception > 0 ? "rc-exc-strong" : undefined}>{plural(c.exception, "exception", "exceptions")}</span>
          <span>{c.unsure} not sure</span>
          <span>{unchecked === null ? "…" : unchecked} not yet checked</span>
          {c.suggested > 0 && <span className="rc-sugg-count">{plural(c.suggested, "AI suggestion", "AI suggestions")} waiting</span>}
        </span>
      </button>
    </li>
  );
}

// ------------------------------------------------------------ one rule ----

function MarkRow({ o, mark, text, surahName, canEdit, onMark, onUnmark, onNote, onAccept }: {
  o: Occurrence;
  mark: RuleMark | undefined;
  text: string | undefined;
  surahName: (k: string) => string;
  canEdit: boolean;
  onMark: (v: RuleMarkValue, note: string) => Promise<void>;
  onUnmark: () => Promise<void>;
  onNote: (note: string) => Promise<void>;
  onAccept: () => Promise<void>;
}) {
  const dispatch = useAppDispatch();
  const gate = useGate();
  const own = mark && mark.source !== "ai" ? mark : undefined;
  const sugg = mark && mark.source === "ai" ? mark : undefined;
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<void>) => async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const press = (v: RuleMarkValue) => run(() => (own?.mark === v ? onUnmark() : onMark(v, own?.note ?? "")));
  const saveNote = run(async () => { await onNote(note.trim()); setEditing(false); });
  const name = surahName(o.verseKey);

  return (
    <li className={`rc-row${own ? ` m-${own.mark}` : ""}${sugg ? " suggested" : ""}`}>
      <div className="rc-row-main">
        <button
          className="rc-place"
          title={`Read ${o.verseKey} with these words lit`}
          onClick={() => dispatch({ type: "jumpToEcho", verseKey: o.verseKey, start: o.word, length: o.words })}
        >
          <span className="search-ref">{o.verseKey}{name ? ` · ${name}` : ""}</span>
          <PlaceText text={text} word={o.word} words={o.words} />
        </button>
        <div className="rc-marks" role="group" aria-label={`Mark ${o.verseKey}`}>
          {(["fits", "exception", "unsure"] as RuleMarkValue[]).map((v) => (
            <button
              key={v}
              className={`ctl rc-mark rc-mark-${v}${own?.mark === v ? " active" : ""}${canEdit ? "" : " plan-locked"}`}
              aria-pressed={own?.mark === v}
              title={own?.mark === v ? `Marked ${MARK_WORD[v]}: press again to clear` : `Mark this place: ${MARK_WORD[v]}`}
              disabled={busy}
              onClick={gate(canEdit, "rules", press(v))}
            >
              <span className="rc-mark-ic" aria-hidden="true">{MARK_IC[v]}</span>{MARK_LABEL[v]}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="ml-error" role="alert">{error}</p>}
      {sugg && (
        <div className="rc-sugg">
          <span className="rc-sugg-chip">suggestion</span>
          <span>Your assistant suggests: <strong>{MARK_WORD[sugg.mark]}</strong>{sugg.note ? `. ${sugg.note}` : ""}</span>
          <span className="rc-sugg-acts">
            <button className={`ctl ml-secondary${canEdit ? "" : " plan-locked"}`} disabled={busy}
              onClick={gate(canEdit, "rules", run(onAccept))}>Accept</button>
            <button className={`ctl ml-secondary${canEdit ? "" : " plan-locked"}`} disabled={busy}
              onClick={gate(canEdit, "rules", run(onUnmark))}>Dismiss</button>
          </span>
        </div>
      )}
      {own && (editing ? (
        <div className="rc-note-edit" onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
          else if (e.key === "Enter") { e.preventDefault(); void saveNote(); }
        }}>
          <div className="ml-field">
            <label htmlFor={`rc-note-${placeKey(o)}`}>Note on {o.verseKey}</label>
            <input id={`rc-note-${placeKey(o)}`} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
          </div>
          <div className="ml-actions">
            <button className="ctl ml-secondary" onClick={() => setEditing(false)}>Cancel</button>
            <button className="ctl primary" onClick={saveNote} disabled={busy}>Save</button>
          </div>
        </div>
      ) : (
        <div className="rc-note">
          {own.note ? <span className="ml-note">{own.note}</span> : null}
          <button className={`links-link${canEdit ? "" : " plan-locked"}`}
            onClick={gate(canEdit, "rules", () => { setNote(own.note); setEditing(true); })}>
            {own.note ? "Edit note" : "Add a note"}
          </button>
        </div>
      ))}
    </li>
  );
}

function RuleView({ id, onBack }: { id: string; onBack: () => void }) {
  const canEdit = useFeature("rules");
  const gate = useGate();
  const surahName = useSurahName();
  const rule = useAsync(() => archive.rules.get(id), [id]);
  const [doc, setDoc] = useState<RuleCheck | null>(null);
  const [marks, setMarks] = useState<Map<string, RuleMark>>(new Map());
  useEffect(() => {
    if (!rule.data) return;
    setDoc(rule.data);
    setMarks(new Map((rule.data.marks ?? []).map((m) => [placeKey(m), m])));
  }, [rule.data]);
  const scope = doc?.scope ?? null;
  const occ = useAsync(
    async () => (scope ? api.occurrences(scope, { limit: MAX_PLACES }) : null),
    [scope ? JSON.stringify([scope.kind, scope.key, scope.query ?? null]) : ""],
  );
  const places = useMemo(
    () => [...(occ.data?.places ?? [])].sort((a, b) => byPlace(a.verseKey, b.verseKey) || a.word - b.word),
    [occ.data],
  );

  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [filter]);
  const [error, setError] = useState<string | null>(null);

  // the tally counts only the places in the list, and only the reader's own marks
  const tally = useMemo(() => {
    const t = { fits: 0, exception: 0, unsure: 0, suggested: 0, unchecked: 0 };
    for (const p of places) {
      const m = marks.get(placeKey(p));
      if (!m || m.source === "ai") t.unchecked++;
      if (!m) continue;
      if (m.source === "ai") t.suggested++;
      else t[m.mark]++;
    }
    return t;
  }, [places, marks]);
  const checked = places.length - tally.unchecked;
  const exceptions = places.filter((p) => { const m = marks.get(placeKey(p)); return m && m.source !== "ai" && m.mark === "exception"; });
  const bare = places.filter((p) => !marks.has(placeKey(p)));

  const list = places.filter((p) => {
    const m = marks.get(placeKey(p));
    switch (filter) {
      case "all": return true;
      case "unchecked": return !m || m.source === "ai";
      case "suggested": return m?.source === "ai";
      default: return !!m && m.source !== "ai" && m.mark === filter;
    }
  });
  const page = list.slice(0, shown);
  const texts = useVerseTexts(useMemo(() => [...new Set(page.map((p) => p.verseKey))], [page]));

  // ---- writes: the server first, then the marks held here ----
  const setOne = (p: { verseKey: string; word: number }, m: RuleMark | null) =>
    setMarks((cur) => { const next = new Map(cur); if (m) next.set(placeKey(p), m); else next.delete(placeKey(p)); return next; });
  const mark = async (p: Occurrence, v: RuleMarkValue, note: string) => {
    await archive.rules.mark(id, [{ verseKey: p.verseKey, word: p.word, mark: v, note }]);
    setOne(p, { verseKey: p.verseKey, word: p.word, mark: v, note, source: "me", updatedAt: Date.now() });
  };
  const unmark = async (p: Occurrence) => {
    await archive.rules.unmark(id, [{ verseKey: p.verseKey, word: p.word }]);
    setOne(p, null);
  };
  const accept = async (places?: { verseKey: string; word: number }[]) => {
    await archive.rules.accept(id, places);
    setMarks((cur) => {
      const next = new Map(cur);
      for (const [k, m] of next) {
        if (m.source === "ai" && (!places || places.some((p) => placeKey(p) === k))) next.set(k, { ...m, source: "me" });
      }
      return next;
    });
  };
  const allFit = async () => {
    setError(null);
    try {
      await archive.rules.mark(id, bare.map((p) => ({ verseKey: p.verseKey, word: p.word, mark: "fits" as const, note: "" })));
      setMarks((cur) => {
        const next = new Map(cur);
        for (const p of bare) next.set(placeKey(p), { verseKey: p.verseKey, word: p.word, mark: "fits", note: "", source: "me" });
        return next;
      });
    } catch (e) { setError((e as Error).message); }
  };
  const acceptAll = async () => {
    setError(null);
    try { await accept(); } catch (e) { setError((e as Error).message); }
  };

  // ---- the rule's own words: shown as values, edited on request ----
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", statement: "", falsifier: "" });
  const [busy, setBusy] = useState(false);
  const saveRule = async () => {
    if (!doc || busy) return;
    if (!draft.title.trim() && !draft.statement.trim()) { setError("Give the rule a title or state it."); return; }
    setBusy(true);
    setError(null);
    try {
      const { marks: _m, counts: _c, ...rest } = doc;
      const saved = await archive.rules.save({ ...rest, title: draft.title.trim(), statement: draft.statement.trim(), falsifier: draft.falsifier.trim() });
      setDoc({ ...doc, ...saved, marks: doc.marks });
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (rule.error) {
    return (
      <div className="sheet ml-screen">
        <button className="ctl ml-secondary rc-back" onClick={onBack}>← All rules</button>
        <p className="ml-error" role="alert">Couldn't load the rule: {rule.error.message}</p>
      </div>
    );
  }
  if (!doc) return <div className="sheet ml-screen"><p className="loading">Loading the rule…</p></div>;

  const FILTERS: { id: Filter; label: string; n: number }[] = [
    { id: "all", label: "All", n: places.length },
    { id: "unchecked", label: "Not yet checked", n: tally.unchecked },
    { id: "exception", label: "Exceptions", n: tally.exception },
    { id: "unsure", label: "Not sure", n: tally.unsure },
    { id: "suggested", label: "AI suggestions", n: tally.suggested },
  ];

  return (
    <div className="sheet ml-screen rc-screen">
      <div className="rc-top">
        <button className="ctl ml-secondary rc-back" onClick={onBack}>← All rules</button>
      </div>
      {error && <p className="ml-error" role="alert">{error}</p>}

      <section className="ml-card rc-head" aria-label="The rule">
        {editing ? (
          <div className="ml-edit" onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
            else if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); void saveRule(); }
          }}>
            <div className="ml-field">
              <label htmlFor="rc-e-title">Title</label>
              <input id="rc-e-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} autoFocus />
            </div>
            <div className="ml-field">
              <label htmlFor="rc-e-statement">The rule, in your words</label>
              <textarea id="rc-e-statement" rows={2} value={draft.statement} onChange={(e) => setDraft({ ...draft, statement: e.target.value })} />
            </div>
            <div className="ml-field">
              <label htmlFor="rc-e-falsifier">What would prove this wrong?</label>
              <textarea id="rc-e-falsifier" rows={2} value={draft.falsifier} onChange={(e) => setDraft({ ...draft, falsifier: e.target.value })} />
            </div>
            <div className="ml-actions">
              <button className="ctl ml-secondary" onClick={() => setEditing(false)}>Cancel</button>
              <button className="ctl primary" onClick={saveRule} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        ) : (
          <>
            <h1 className="rc-title">{doc.title || "Untitled rule"}</h1>
            <dl className="ml-values">
              <div className="ml-wide"><dt>The rule</dt><dd>{doc.statement || <span className="ml-none">not stated</span>}</dd></div>
              <div className="ml-wide"><dt>What would prove this wrong</dt><dd>{doc.falsifier || <span className="ml-none">not said yet</span>}</dd></div>
              <div className="ml-wide">
                <dt>What it covers</dt>
                <dd className="rc-covers">
                  <span className="rc-kind">{SCOPE_KIND_LABEL[doc.scope.kind]}</span>
                  <span className="rx-ar" dir="rtl">{scopeShown(doc.scope)}</span>
                </dd>
              </div>
            </dl>
            <div className="ml-item-actions">
              <button
                className={`ctl ml-secondary${canEdit ? "" : " plan-locked"}`}
                onClick={gate(canEdit, "rules", () => {
                  setDraft({ title: doc.title ?? "", statement: doc.statement ?? "", falsifier: doc.falsifier ?? "" });
                  setEditing(true);
                })}
              >
                <span className="ml-ic" aria-hidden="true">✎</span>Edit{!canEdit && <> <PlanLock feature="rules" /></>}
              </button>
              {canEdit && <DeleteButton what="rule and all its marks" onDelete={async () => { await archive.rules.remove(id); onBack(); }} />}
            </div>
          </>
        )}
      </section>

      {occ.error && <p className="ml-error" role="alert">Couldn't list the places: {occ.error.message}</p>}
      {occ.loading && !occ.data && <p className="loading">Finding every place…</p>}

      {occ.data && (
        <>
          <section className={`rc-tally${tally.exception > 0 ? " has-exceptions" : ""}`} aria-label="Tally">
            <p className="rc-tally-head">
              {checked.toLocaleString()} of {plural(places.length, "place", "places")} checked ·{" "}
              <span className={tally.exception > 0 ? "rc-exc-strong" : undefined}>{plural(tally.exception, "exception", "exceptions")}</span>
            </p>
            <div className="rc-stats">
              <span className="rc-stat"><span className="rc-stat-n">{tally.fits}</span>fit</span>
              <span className={`rc-stat${tally.exception > 0 ? " alarm" : ""}`}><span className="rc-stat-n">{tally.exception}</span>exceptions</span>
              <span className="rc-stat"><span className="rc-stat-n">{tally.unsure}</span>not sure</span>
              <span className="rc-stat"><span className="rc-stat-n">{tally.unchecked}</span>not yet checked</span>
              <span className={`rc-stat${tally.suggested > 0 ? " sugg" : ""}`}><span className="rc-stat-n">{tally.suggested}</span>AI suggestions</span>
            </div>
            {exceptions.length > 0 && (
              <p className="rc-exc-list" role="note">
                <strong>{exceptions.length === 1 ? "One place does not fit:" : `${exceptions.length} places do not fit:`}</strong>{" "}
                {exceptions.slice(0, 12).map((p) => p.verseKey).join(", ")}{exceptions.length > 12 ? ", …" : ""}
                {filter !== "exception" && <> <button className="links-link" onClick={() => setFilter("exception")}>Show them</button></>}
              </p>
            )}
            {occ.data.truncated && (
              <p className="ml-hint">
                The Book has {plural(occ.data.total, "place", "places")} for this; the first {places.length.toLocaleString()} are listed.
                Narrow what the rule covers to check them all.
              </p>
            )}
            <div className="rc-bulk">
              {bare.length > 0 && (
                canEdit ? (
                  <ConfirmButton
                    question={`Mark all ${plural(bare.length, "unchecked place", "unchecked places")} as fits?${tally.suggested ? " Places with an AI suggestion are left for you." : ""}`}
                    confirm={`Mark ${bare.length.toLocaleString()} as fits`}
                    onConfirm={allFit}
                  >
                    <span className="ml-ic" aria-hidden="true">✓</span>Mark all the unchecked as fits
                  </ConfirmButton>
                ) : (
                  <button className="ctl ml-secondary plan-locked" onClick={gate(false, "rules", () => {})}>
                    Mark all the unchecked as fits <PlanLock feature="rules" />
                  </button>
                )
              )}
              {tally.suggested > 0 && canEdit && (
                <ConfirmButton
                  question={`Take all ${plural(tally.suggested, "AI suggestion", "AI suggestions")} as your own marks?`}
                  confirm={`Accept ${tally.suggested.toLocaleString()}`}
                  onConfirm={acceptAll}
                >
                  Accept all suggestions
                </ConfirmButton>
              )}
            </div>
          </section>

          <div className="rx-seg rx-seg-5 rc-filters" role="group" aria-label="Show">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                className={`ctl${filter === f.id ? " active" : ""}${f.id === "exception" && f.n > 0 ? " rc-filter-alarm" : ""}`}
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label}<span className="ml-view-count">{f.n}</span>
              </button>
            ))}
          </div>

          {list.length === 0 ? (
            <p className="home-empty">
              {places.length === 0 ? "The corpus finds no place for this in the Book." : "No place matches this filter."}
            </p>
          ) : (
            <ul className="rc-list">
              {page.map((p) => (
                <MarkRow
                  key={placeKey(p)}
                  o={p}
                  mark={marks.get(placeKey(p))}
                  text={texts.get(p.verseKey)}
                  surahName={surahName}
                  canEdit={canEdit}
                  onMark={(v, note) => mark(p, v, note)}
                  onUnmark={() => unmark(p)}
                  onNote={async (note) => {
                    const m = marks.get(placeKey(p));
                    if (m) await mark(p, m.mark, note);
                  }}
                  onAccept={() => accept([{ verseKey: p.verseKey, word: p.word }])}
                />
              ))}
            </ul>
          )}
          {list.length > shown && (
            <div className="ml-more">
              <button className="ctl ml-secondary" onClick={() => setShown((s) => s + PAGE)}>
                Show {Math.min(PAGE, list.length - shown)} more
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------- screen ----

export function RuleChecks() {
  const canEdit = useFeature("rules");
  const gate = useGate();
  const openId = useAppState().openItemId;
  const dispatch = useAppDispatch();
  const setOpenId = (id: string | null) => dispatch({ type: "openItem", tab: "rules", id });
  // a scope handed over from elsewhere (the Links panel's "Check as a rule") opens the form
  const [creating, setCreating] = useState<{ scope: OccurrenceScope | null } | null>(() => {
    const s = peekRuleScope();
    return s ? { scope: s } : null;
  });
  useEffect(() => { takeRuleScope(); }, []);
  const [version, setVersion] = useState(0);
  const rules = useAsync(() => archive.rules.all(), [version, openId]);

  const notFound = !!openId && !rules.loading && !!rules.data &&!rules.data.some((r) => r.id === openId);
  if (openId && !notFound) return <RuleView id={openId} onBack={() => { setOpenId(null); setVersion((v) => v + 1); }} />;

  const list = rules.data ?? [];
  return (
    <div className="sheet ml-screen rc-screen">
      <header className="home-head">
        <h1>Rule checks</h1>
        <p className="subtitle">
          State a rule, then check it against every place it applies to, one by one: it fits, it is an
          exception, or you are not sure yet. One exception is enough to rethink a rule.
        </p>
      </header>

      {rules.error && <p className="ml-error" role="alert">Couldn't load your rules: {rules.error.message}</p>}
      {notFound && <p className="ml-hint">That rule was not found.</p>}

      {creating ? (
        <NewRuleForm
          initialScope={creating.scope}
          onCancel={() => setCreating(null)}
          onSaved={(r) => { setCreating(null); setOpenId(r.id); }}
        />
      ) : (
        <div className="rc-top">
          <button
            className={`ctl primary${canEdit ? "" : " plan-locked"}`}
            onClick={gate(canEdit, "rules", () => setCreating({ scope: null }))}
          >
            <span className="ml-ic" aria-hidden="true">＋</span>New rule{!canEdit && <> <PlanLock feature="rules" /></>}
          </button>
        </div>
      )}

      {rules.loading && !rules.data ? <p className="loading">Loading your rules…</p> : list.length === 0 ? (
        <p className="home-empty">
          No rules yet. State one with New rule, or start from a word in the reader: open an āyah's Links
          panel and choose “Check as a rule” on any row.
        </p>
      ) : (
        <ul className="rc-rules">
          {list.map((r) => <RuleRow key={r.id} r={r} onOpen={() => setOpenId(r.id)} />)}
        </ul>
      )}
    </div>
  );
}
