// The research home — a workbench that ties together everything the reader is
// in the middle of: where they were reading, open cases, unanswered questions,
// recent trails, and how much meaning they've established. Read-only over the
// existing stores; every item is a one-click jump back in.

import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { archive, fetchFormStatus } from "../persistence/db";
import { normalizeCase } from "../cases/ops";
import { useAppState, useAppDispatch } from "../state/store";

const spaced = (r: string) => r.split("").join(" ");
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
  const cases = useAsync(() => archive.cases.all(), []);
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
  const openForms = new Set(
    (forms.data ?? []).filter((f) => f.status !== "established").map((f) => f.lemma),
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
      <header className="home-head">
        <h1 className="home-title quran">الصراط المستقيم</h1>
        <p className="subtitle">Your workbench — pick up where you left off.</p>
      </header>

      <div className="home-stats">
        <button
          className="stat"
          onClick={() => dispatch({ type: "jumpToVerse", verseKey: contKey })}
        >
          <span className="stat-n">{contKey}</span>
          <span className="stat-l">continue reading{chapter.data ? ` · ${chapter.data.name_simple}` : ""}</span>
        </button>
        <button className="stat" onClick={() => dispatch({ type: "setTab", tab: "investigate" })}>
          <span className="stat-n">{openCases.length}</span>
          <span className="stat-l">open case{openCases.length === 1 ? "" : "s"}</span>
        </button>
        <button className="stat" onClick={() => dispatch({ type: "setTab", tab: "read" })}>
          <span className="stat-n">{openQuestions.length}</span>
          <span className="stat-l">open question{openQuestions.length === 1 ? "" : "s"}</span>
        </button>
        <button className="stat" onClick={() => dispatch({ type: "setTab", tab: "vault" })}>
          <span className="stat-n">{established}</span>
          <span className="stat-l">established meaning{established === 1 ? "" : "s"}</span>
        </button>
      </div>

      <div className="home-grid">
        <section className="home-card">
          <h2 className="home-card-title">Open cases</h2>
          {openCases.length === 0 ? (
            <p className="home-empty">No open investigations. Tap a word while reading to start one.</p>
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
                <li key={n.id}>
                  <button
                    className="home-row"
                    onClick={() => dispatch({ type: "jumpToVerse", verseKey: n.verseKey, wordPosition: n.wordPosition })}
                  >
                    <span className="home-q">❓</span>
                    <span className="home-row-main home-q-text">{n.text}</span>
                    <span className="home-row-meta">{n.verseKey}</span>
                  </button>
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

        <section className="home-card">
          <h2 className="home-card-title">Your lexicon</h2>
          <p className="home-lex">
            <button className="home-lex-n" onClick={() => dispatch({ type: "setTab", tab: "vault" })}>
              {established}
            </button>{" "}
            form{established === 1 ? "" : "s"} established
            {openForms > 0 ? `, ${openForms} still open` : ""}.
          </p>
          <p className="home-empty">Meanings you settle in cases build your own lexicon in the Vault.</p>
        </section>

        <section className="home-card">
          <h2 className="home-card-title">Explore the roots</h2>
          <p className="home-empty">
            Every root in the Book, from the rarest to the most common — a place to wander and discover.
          </p>
          <button className="ctl" onClick={() => dispatch({ type: "setTab", tab: "roots" })}>
            ⌘ Open the Roots
          </button>
        </section>
      </div>
    </div>
  );
}
