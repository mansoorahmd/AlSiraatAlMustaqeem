// The research home — a workbench, and ONLY a workbench: where you were reading, and the three
// things you have in flight (cases, questions, trails). Every item is a one-click jump back in.
//
// Configuration deliberately doesn't live here. Reading preferences, the research database and
// backups moved to Settings (the gear in the top bar) — mixing "what am I working on" with
// "how is the app set up" is what made this page feel like a dumping ground.

import { useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { archive, fetchFormStatus } from "../persistence/db";
import {
  normalizeCase, createSubjectCase, openOrCreateRootCase, openOrCreateAyahCase,
} from "../cases/ops";
import type { SubjectType } from "../persistence/types";
import { useAppState, useAppDispatch } from "../state/store";
import { ShareButton } from "../components/ShareButton";

const spaced = (r: string) => r.split("").join("\u00A0"); // nbsp: root letters must not wrap (ه د ي)
const vsort = (k: string) => {
  const [c, v] = k.split(":").map((n) => parseInt(n, 10) || 0);
  return (c ?? 0) * 1000 + (v ?? 0);
};

export function Home() {
  const { reading } = useAppState();
  const dispatch = useAppDispatch();

  // where to continue: the last ayah read, else the top of the current surah
  const contKey = reading.lastVerseKey ?? `${reading.surahId}:1`;
  const contSurah = parseInt(contKey.split(":")[0] ?? "1", 10);
  const chapter = useAsync(() => api.chapter(contSurah), [contSurah]);
  // "＋ new" — a case on a phrase or a theme, not anchored to a root or an āyah
  const [newCaseOpen, setNewCaseOpen] = useState(false);
  const [newType, setNewType] = useState<SubjectType>("phrase");
  const [newSubject, setNewSubject] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [casesRev, setCasesRev] = useState(0); // bump to re-read after creating

  const cases = useAsync(() => archive.cases.all(), [casesRev]);
  const trails = useAsync(() => archive.trails.all(), []);
  const notes = useAsync(() => archive.notes.all(), []);
  const forms = useAsync(() => fetchFormStatus(), []);
  const openCases = (cases.data ?? [])
    .map(normalizeCase)
    .filter((c) => c.status !== "closed")
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const openQuestions = (notes.data ?? [])
    .filter((n) => n.kind === "question" && !n.resolved)
    .sort((a, b) => vsort(a.verseKey) - vsort(b.verseKey));

  const recentTrails = [...(trails.data ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);

  const established = new Set(
    (forms.data ?? []).filter((f) => f.status === "established").map((f) => f.lemma),
  ).size;

  const openCase = (id: string) => {
    dispatch({ type: "setActiveCase", caseId: id });
    dispatch({ type: "setTab", tab: "investigate" });
  };
  const openTrail = (id: string) => {
    dispatch({ type: "setActiveTrail", trailId: id });
    dispatch({ type: "setTab", tab: "read" });
  };

  return (
    <div className="sheet home">
      {/* A calm resume bar, then the counts as quiet text — the shape people know from a feed
          header. A big saturated block shouted at the reader and pushed the actual work down. */}
      <header className="home-hero">
        <button
          className="resume"
          onClick={() => dispatch({ type: "jumpToVerse", verseKey: contKey })}
        >
          <span className="resume-body">
            <span className="resume-label">Continue reading</span>
            <span className="resume-ref">
              {chapter.data?.name_simple ?? "Sūrah"} <span className="resume-ayah">{contKey}</span>
            </span>
          </span>
          <span className="resume-go" aria-hidden>→</span>
        </button>

        <div className="home-counts">
          <button className="count" onClick={() => dispatch({ type: "setTab", tab: "investigate" })}>
            <strong>{openCases.length}</strong> open case{openCases.length === 1 ? "" : "s"}
          </button>
          <span className="count-sep" aria-hidden>·</span>
          <button className="count" onClick={() => dispatch({ type: "setTab", tab: "read" })}>
            <strong>{openQuestions.length}</strong> open question{openQuestions.length === 1 ? "" : "s"}
          </button>
          <span className="count-sep" aria-hidden>·</span>
          <button className="count" onClick={() => dispatch({ type: "setTab", tab: "vault" })}>
            <strong>{established}</strong> established
          </button>
        </div>
      </header>

      <div className="home-grid">
        <section className="home-card">
          <h2 className="home-card-title">
            Open cases
            <button
              className="ctl home-card-act"
              title="Open a case on a phrase or a theme — not tied to one root or āyah"
              onClick={() => setNewCaseOpen((o) => !o)}
            >＋ new</button>
          </h2>

          {/* a case that isn't anchored to a root or an āyah: a phrase, or a theme */}
          {newCaseOpen && (
            <form
              className="home-newcase"
              onSubmit={async (e) => {
                e.preventDefault();
                const value = newSubject.trim();
                if (!value) return;
                // root/āyah cases are looked up by subject elsewhere (the word menu
                // assumes one per root), so reuse an existing one rather than making
                // a duplicate. A phrase/theme case is always new.
                const c = newType === "root" ? await openOrCreateRootCase(value)
                  : newType === "ayah" ? await openOrCreateAyahCase(value)
                  : await createSubjectCase(newType, value, newTitle, newDesc);
                setNewCaseOpen(false);
                setNewSubject(""); setNewTitle(""); setNewDesc("");
                setCasesRev((r) => r + 1);
                openCase(c.id);
              }}
            >
              <div className="home-newcase-row">
                <select
                  className="board-input"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as SubjectType)}
                  title="What the investigation is about"
                >
                  <option value="phrase">phrase / theme</option>
                  <option value="root">root</option>
                  <option value="ayah">āyah</option>
                </select>
                <input
                  className="board-input"
                  autoFocus
                  placeholder={
                    newType === "root" ? "the root, e.g. رحم"
                      : newType === "ayah" ? "verse key, e.g. 2:255"
                      : "the phrase, or what this is about"
                  }
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                />
              </div>
              <input
                className="board-input"
                placeholder="title (optional — defaults to the subject)"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
              <textarea
                className="board-input"
                rows={2}
                placeholder="the question this case is asking (optional)"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
              <div className="home-newcase-acts">
                <button className="ctl" type="submit" disabled={!newSubject.trim()}>open case</button>
                <button className="ctl" type="button" onClick={() => setNewCaseOpen(false)}>cancel</button>
              </div>
            </form>
          )}

          {openCases.length === 0 ? (
            <p className="home-empty">
              No open investigations. Tap a word while reading to start one, or ＋ new for a phrase or theme.
            </p>
          ) : (
            <ul className="home-list">
              {openCases.slice(0, 6).map((c) => (
                <li key={c.id}>
                  <button className="home-row" onClick={() => openCase(c.id)}>
                    <span className="stamp">{c.status}</span>
                    <span className="home-row-main quran">
                      {c.subject.type === "root" ? spaced(c.subject.value) : c.subject.value}
                    </span>
                    <span className="home-row-meta">{c.cards.length} on desk</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="home-card">
          <h2 className="home-card-title">Open questions</h2>
          {openQuestions.length === 0 ? (
            <p className="home-empty">Nothing unanswered. Leave a question with the ✎ mark while reading.</p>
          ) : (
            <ul className="home-list">
              {openQuestions.slice(0, 6).map((n) => (
                <li key={n.id} className="home-row-wrap">
                  <button
                    className="home-row"
                    onClick={() => dispatch({ type: "jumpToVerse", verseKey: n.verseKey, wordPosition: n.wordPosition })}
                  >
                    <span className="home-q">❓</span>
                    <span className="home-row-main home-q-text">{n.text}</span>
                    <span className="home-row-meta">{n.verseKey}</span>
                  </button>
                  <ShareButton
                    localRef={n.id}
                    kind="question"
                    subjectKind="ayah"
                    subjectValue={n.verseKey}
                    payload={{ id: n.id, verseKey: n.verseKey, wordPosition: n.wordPosition, text: n.text }}
                    label="Ask the community this question"
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="home-card">
          <h2 className="home-card-title">Recent trails</h2>
          {recentTrails.length === 0 ? (
            <p className="home-empty">No trails yet. Follow a word's thread to start one.</p>
          ) : (
            <ul className="home-list">
              {recentTrails.slice(0, 6).map((t) => (
                <li key={t.id}>
                  <button className="home-row" onClick={() => openTrail(t.id)}>
                    <span className="home-trail">➶</span>
                    <span className="home-row-main quran">{t.name || t.subject || "trail"}</span>
                    <span className="home-row-meta">{t.hops.length} hops</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

      </div>
    </div>
  );
}
