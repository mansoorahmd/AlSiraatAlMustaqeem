// The research home — a workbench that ties together everything the reader is
// in the middle of: where they were reading, open cases, unanswered questions,
// recent trails, and how much meaning they've established. Read-only over the
// existing stores; every item is a one-click jump back in.

import { useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { archive, fetchFormStatus, backupResearch, fetchIdentity, type BackupResult } from "../persistence/db";
import {
  normalizeCase, createSubjectCase, openOrCreateRootCase, openOrCreateAyahCase,
} from "../cases/ops";
import type { SubjectType } from "../persistence/types";
import { useAppState, useAppDispatch } from "../state/store";
import { Preferences } from "../components/Preferences";

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
  // "＋ new" — a case on a phrase or a theme, not anchored to a root or an āyah
  const [newCaseOpen, setNewCaseOpen] = useState(false);
  const [newType, setNewType] = useState<SubjectType>("phrase");
  const [newSubject, setNewSubject] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [casesRev, setCasesRev] = useState(0); // bump to re-read after creating

  // backup of research.db — the reader's one irreplaceable file
  const [backupState, setBackupState] = useState<"idle" | "working">("idle");
  const [lastBackup, setLastBackup] = useState<BackupResult | null>(null);
  const [backupErr, setBackupErr] = useState<string | null>(null);
  const runBackup = async () => {
    setBackupState("working");
    setBackupErr(null);
    try {
      const res = await backupResearch();
      if (!("canceled" in res)) setLastBackup(res);
    } catch (e) {
      setBackupErr((e as Error).message);
    } finally {
      setBackupState("idle");
    }
  };
  const shortPath = (p: string) => p.replace(/^.*[/\\]/, "");
  const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

  const cases = useAsync(() => archive.cases.all(), [casesRev]);
  const trails = useAsync(() => archive.trails.all(), []);
  const notes = useAsync(() => archive.notes.all(), []);
  const forms = useAsync(() => fetchFormStatus(), []);
  const identity = useAsync(() => fetchIdentity(), []);
  // archive (local API) status — moved out of the top bar, kept quietly with Preferences
  const health = useAsync(() => api.health(), []);
  const archiveDot = health.loading ? "" : health.error ? "error" : "ok";
  const archiveText = health.loading
    ? "reaching the archive…"
    : health.error
      ? "archive unreachable"
      : `archive open · v${health.data?.version ?? "?"}`;

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
        <h1 className="home-title">MQ Research Gate</h1>
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

        <section className="home-card">
          <h2 className="home-card-title">Your data</h2>
          <p className="home-empty">
            All your research lives in one file. Back it up somewhere safe — a copy is
            complete and can be taken any time, even while you work.
          </p>
          <button className="ctl" onClick={runBackup} disabled={backupState === "working"}>
            {backupState === "working" ? "Backing up…" : "⤓ Back up research"}
          </button>
          {lastBackup && (
            <p className="home-lex" title={lastBackup.path}>
              Saved <strong>{shortPath(lastBackup.path)}</strong> · {kb(lastBackup.bytes)}
            </p>
          )}
          {backupErr && <p className="home-empty">Couldn’t back up: {backupErr}</p>}
          {identity.data && (
            <p className="home-empty" title={identity.data.localId}>
              Local identity: <code>{identity.data.localId.slice(0, 8)}…</code>
            </p>
          )}
        </section>

      </div>

      {/* Reading preferences live here rather than in the top bar: they're set once in a while,
          not per-action, so the chrome stays free for navigation. */}
      <section className="home-card home-prefs">
        <h2 className="home-card-title">Preferences</h2>
        <Preferences />
        <p className="home-status" title="local API status">
          <span className={`dot ${archiveDot}`} /> {archiveText}
        </p>
      </section>
    </div>
  );
}
