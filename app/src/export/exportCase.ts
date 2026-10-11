// Case export: a pixel-clean standalone HTML report (print → PDF) and a
// Markdown file. Both are built entirely from the case document — evidence
// with highlights and the subject word in gold, threads, notes, cited
// references, established meanings, and the verdict. Every ayah links to
// quran.com so the report is shareable and navigable outside the app.

import type { CaseRecord, EvidenceCardRecord, NoteRecord } from "../persistence/types";
import type { RootOccurrence } from "../api/types";
import { tokenizeVerse } from "../components/reader/format";

export interface ExportData {
  occById: Map<string, RootOccurrence>;
  extraTexts: Map<string, string>;
  /** root core meaning (reference) for root cases */
  rootCoreEn?: string | null;
  /** The reader's notes and questions on the āyāt of this case. These live outside the
   *  case document (the `notes` table, keyed by verse + word), so the report used to
   *  omit them entirely — losing reasoning recorded while reading. */
  notes?: NoteRecord[];
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const quranUrl = (verseKey: string) => `https://quran.com/${verseKey.replace(":", "/")}`;

const wash = (hex: string, alpha = 0.45): string => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
};

function verseTextOf(card: EvidenceCardRecord, d: ExportData): string | null {
  return d.occById.get(card.id)?.verse_text ?? d.extraTexts.get(card.verseKey) ?? null;
}

function sortedCards(c: CaseRecord): EvidenceCardRecord[] {
  const key = (k: string, p: number | null) => {
    const [ch, v] = k.split(":").map((n) => parseInt(n, 10) || 0);
    return ch * 1_000_000 + v * 1_000 + (p ?? 0);
  };
  return c.cards.slice().sort((a, b) => key(a.verseKey, a.wordPosition) - key(b.verseKey, b.wordPosition));
}

/** token text at a word position (for thread anchor names) */
function tokenAt(card: EvidenceCardRecord, pos: number | null | undefined, d: ExportData): string | null {
  if (pos == null) return null;
  const text = verseTextOf(card, d);
  if (!text) return null;
  return tokenizeVerse(text).find((t) => t.position === pos)?.text ?? null;
}

function endpointName(id: string, word: number | null | undefined, c: CaseRecord, d: ExportData): string {
  const card = c.cards.find((k) => k.id === id);
  if (card) {
    const tok = tokenAt(card, word, d);
    return tok ? `${card.verseKey} · ${tok}` : card.verseKey;
  }
  const slip = c.slips.find((s) => s.id === id);
  if (slip) {
    const t = slip.text.length > 30 ? slip.text.slice(0, 30) + "…" : slip.text;
    return slip.kind === "comment" ? `note “${t}”` : `ref “${slip.source ?? t}”`;
  }
  return id;
}


/** Slip prose is often mixed Arabic + English + verse refs. Escape it, then wrap each
 *  Arabic run so it renders in the Quran face and is bidi-isolated from the English —
 *  without isolation the refs and punctuation jump to the wrong end of the line. */
function mixedText(s: string): string {
  return esc(s).replace(
    /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF][\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF\s\u064B-\u0652]*/g,
    (run) => `<span class="ar" dir="rtl">${run}</span>`,
  );
}

// ---- HTML report --------------------------------------------------------------

function renderVerseHtml(card: EvidenceCardRecord, d: ExportData): string {
  const text = verseTextOf(card, d);
  if (!text) return "";
  return tokenizeVerse(text)
    .map((tok) => {
      const isSubject = tok.position !== null && tok.position === card.wordPosition;
      const hl = tok.position !== null
        ? (card.highlights ?? []).find((h) => tok.position! >= h.start && tok.position! <= h.end)
        : undefined;
      const style = hl ? ` style="background:${wash(hl.color)};border-radius:4px;padding:0 2px"` : "";
      const cls = isSubject ? ` class="subj"` : "";
      return `<span${cls}${style}>${esc(tok.text)}</span>`;
    })
    .join(" ");
}

export function buildCaseHtml(c: CaseRecord, d: ExportData): string {
  const isAyah = c.subject.type === "ayah";
  const isPhrase = c.subject.type === "phrase";
  const subjectDisplay = isAyah ? c.subject.value : c.subject.value.split("").join(" ");
  const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const cards = sortedCards(c);
  const comments = c.slips.filter((s) => s.kind === "comment" && s.text.trim());
  const refs = c.slips.filter((s) => s.kind === "reference" && (s.text.trim() || s.source));
  // A card↔slip thread with no label is just an attachment — the slip is already
  // printed under its āyah, so listing it again as a "connection" is noise.
  const isAttachment = (t: { fromCardId: string; toCardId: string; label: string }) =>
    !t.label.trim() && [t.fromCardId, t.toCardId].some((id) => c.slips.some((s) => s.id === id));
  const threads = c.threads.filter((t) => t.accepted && !isAttachment(t));

  // unanswered questions on this case's āyāt: real unfinished business, worth naming
  const caseVerses = new Set(cards.map((k) => k.verseKey));
  const openQs = (d.notes ?? []).filter(
    (n) => n.kind === "question" && !n.resolved && !n.answer && caseVerses.has(n.verseKey),
  );

  // findings vs unfinished business — a report should also say what is NOT settled
  const meanings = Object.entries(c.formResearch).filter(([, fr]) => fr.status === "established");
  const openForms = Object.entries(c.formResearch).filter(([, fr]) => fr.status !== "established");

  const meaningRows = meanings
    .map(([lemma, fr]) => `
      <div class="meaning">
        <div class="meaning-form quran">${esc(lemma)}</div>
        <div class="meaning-body">
          <span class="pill ${fr.status}">${fr.status === "established" ? "established" : "under investigation"}</span>
          ${fr.meaning ? `<p class="meaning-text mixed">“${mixedText(fr.meaning)}”</p>` : ""}
        </div>
      </div>`)
    .join("");

  const evidenceCard = (card: EvidenceCardRecord): string => {
    const lemma = d.occById.get(card.id)?.lemma_arabic;
    // the slips the reader tied to this āyah, so the reasoning sits with its evidence
    const attached = c.slips.filter(
      (s) => c.threads.some((t) =>
        (t.fromCardId === card.id && t.toCardId === s.id) ||
        (t.toCardId === card.id && t.fromCardId === s.id)),
    );
    // notes the reader wrote on this āyah while reading — answered questions included,
    // unanswered ones are also collected below into "Questions still open"
    const myNotes = (d.notes ?? []).filter((n) => n.verseKey === card.verseKey);
    return `
      <div class="evidence">
        <div class="ev-head">
          <a class="vkey" href="${quranUrl(card.verseKey)}" target="_blank" rel="noopener">${card.verseKey}</a>
          ${lemma ? `<span class="lemma quran">${esc(lemma)}</span>` : ""}
          ${card.source === "ai" ? `<span class="pill ai">AI-added</span>` : ""}
        </div>
        <p class="ev-text quran" dir="rtl">${renderVerseHtml(card, d)}</p>
        ${attached.length || myNotes.length ? `<ul class="ev-notes">${[
          ...attached.map((s) => `<li class="mixed">${mixedText(s.text)}${s.kind === "reference" && s.source ? ` <em>(${esc(s.source)}${s.locator ? `, ${esc(s.locator)}` : ""})</em>` : ""}</li>`),
          ...myNotes.map((n) => `<li class="mixed note-${n.kind}">${
            n.kind === "question" ? `<span class="qmark">?</span> ` : ""
          }${mixedText(n.text)}${
            n.wordPosition ? ` <span class="at-word">(word ${n.wordPosition})</span>` : ""
          }${n.answer ? `<div class="note-answer mixed">→ ${mixedText(n.answer)}</div>` : ""}${
            n.source === "ai" ? ` <span class="pill ai">AI</span>` : ""
          }</li>`),
        ].join("")}</ul>` : ""}
      </div>`;
  };

  // Evidence is presented under the reader's OWN clusters — the grouping *is* the
  // analysis, so it should organise the section rather than trail it as a name list.
  const clustered = new Set(c.clusters.flatMap((g) => g.cardIds));
  const groupedEvidence = c.clusters
    .map((g) => {
      const inGroup = cards.filter((k) => g.cardIds.includes(k.id));
      const slipsIn = c.slips.filter((s) => g.cardIds.includes(s.id) && s.text.trim());
      if (!inGroup.length && !slipsIn.length) return "";
      return `
      <div class="cluster-block">
        <h3 class="cluster-name mixed">${mixedText(g.name)} <span class="cluster-count">${inGroup.length} ${inGroup.length === 1 ? "āyah" : "āyāt"}</span></h3>
        ${slipsIn.length ? `<ul class="cluster-notes">${slipsIn
          .map((s) => `<li class="mixed">${mixedText(s.text)}${s.kind === "reference" && s.source ? ` <em>(${esc(s.source)})</em>` : ""}</li>`)
          .join("")}</ul>` : ""}
        ${inGroup.map(evidenceCard).join("")}
      </div>`;
    })
    .join("");
  const ungrouped = cards.filter((k) => !clustered.has(k.id));
  const evidenceRows = groupedEvidence
    + (ungrouped.length
      ? (c.clusters.length ? `<h3 class="cluster-name">Not yet grouped <span class="cluster-count">${ungrouped.length} ${ungrouped.length === 1 ? "āyah" : "āyāt"}</span></h3>` : "")
        + ungrouped.map(evidenceCard).join("")
      : "");

  const threadRows = threads
    .map((t) => `
      <li>
        <span class="th-ends">${esc(endpointName(t.fromCardId, t.fromWord, c, d))} ↔ ${esc(endpointName(t.toCardId, t.toWord, c, d))}</span>
        ${t.label ? `<span class="th-label">— ${esc(t.label)}</span>` : ""}
      </li>`)
    .join("");

  // A slip already printed beside its evidence (attached by a thread, or inside a
  // cluster) must not be repeated here; what is left is general reasoning, grouped by
  // the form it concerns so the argument for each form reads together.
  const shownWithEvidence = new Set<string>([
    ...c.clusters.flatMap((g) => g.cardIds),
    ...c.threads.flatMap((t) => [t.fromCardId, t.toCardId])
      .filter((id) => c.slips.some((s) => s.id === id)),
  ]);
  const loose = comments.filter((s) => !shownWithEvidence.has(s.id));
  const byForm = new Map<string, typeof loose>();
  for (const s of loose) {
    const k = s.form ?? "";
    byForm.set(k, [...(byForm.get(k) ?? []), s]);
  }
  const noteRows = [...byForm.entries()]
    .sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : a[0].localeCompare(b[0])))
    .map(([form, slips]) => `
      ${form ? `<h3 class="note-form quran">${esc(form)}</h3>` : c.clusters.length || byForm.size > 1 ? `<h3 class="note-form">On the root as a whole</h3>` : ""}
      <ul>${slips.map((s) => `<li class="mixed">${mixedText(s.text)}${s.author === "ai" ? ` <span class="pill ai">AI</span>` : ""}</li>`).join("")}</ul>`)
    .join("");

  const refRows = refs
    .map((s, i) => `
      <li id="ref${i + 1}">
        <strong>${esc(s.source || "—")}</strong>${s.locator ? `, ${esc(s.locator)}` : ""}${s.text ? ` — ${mixedText(s.text)}` : ""}
      </li>`)
    .join("");

  // (clusters are no longer listed separately — they organise the evidence section)

  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(c.title)} — research report</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Amiri+Quran&family=Scheherazade+New:wght@400;700&display=swap" rel="stylesheet" />
<style>
  :root { --ink:#27272a; --soft:#52525b; --faint:#a1a1aa; --edge:#e4e4e7; --gold:#b45309; --blue:#2563eb; }
  * { box-sizing: border-box; }
  body { margin:0; background:#f4f4f5; color:var(--ink);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; line-height:1.55; }
  .page { max-width: 46rem; margin: 2rem auto; background:#fff; border:1px solid var(--edge);
    border-radius:14px; padding: 2.5rem 3rem; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  .quran { font-family: "Amiri Quran","Scheherazade New",serif; }
  h1 { font-size:1.5rem; margin:0 0 .2rem; }
  h2 { font-size:.78rem; letter-spacing:.14em; text-transform:uppercase; color:var(--faint);
    margin: 2rem 0 .7rem; border-bottom:1px solid var(--edge); padding-bottom:.3rem; }
  /* Arabic needs headroom: harakat rise above the line and descenders drop below,
     so a tight line-height makes the subject collide with the meta line under it. */
  .subject { font-size:1.75rem; color:var(--gold); line-height:1.9; unicode-bidi:plaintext;
    text-align:left; margin:.1rem 0 .35rem; }
  .meta { color:var(--soft); font-size:.85rem; clear:both; }
  .desc { font-style:italic; color:var(--soft); margin:.4rem 0 0; }
  .pill { display:inline-block; font-size:.68rem; font-weight:600; letter-spacing:.05em; text-transform:uppercase;
    border-radius:999px; padding:.1rem .6rem; border:1px solid var(--edge); color:var(--soft); }
  .pill.established { color:#166534; border-color:#bbf7d0; background:#f0fdf4; }
  .rpt-head { margin:0 0 .3rem; }
  .rpt-head-top { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; }
  .rpt-head-top h1 { flex:1 1 auto; }
  .status { flex:0 0 auto; margin-top:.35rem; }
  .meta .dot { color:var(--edge); margin:0 .1rem; }
  .verdict { font-size:1.05rem; font-style:italic; color:var(--blue);
    border-left:3px solid var(--blue); padding:.4rem 0 .4rem 1rem; margin:.5rem 0; }
  .meaning { display:flex; gap:1.2rem; align-items:baseline; padding:.5rem 0; border-bottom:1px dotted var(--edge); }
  .meaning-form { font-size:1.25rem; min-width:7rem; line-height:1.9;
    unicode-bidi:plaintext; text-align:left; }
  .meaning-text { margin:.25rem 0 0; font-style:italic; }
  .rootcore { color:var(--soft); font-size:.85rem; margin:.3rem 0 0; }
  .evidence { border:1px solid var(--edge); border-radius:10px; padding:.7rem 1rem; margin:.6rem 0;
    page-break-inside: avoid; }
  .ev-head { display:flex; gap:.7rem; align-items:baseline; margin-bottom:.3rem; }
  .vkey { font-size:.78rem; font-weight:600; color:var(--blue); text-decoration:none;
    border:1px solid #dbeafe; background:#eff6ff; border-radius:6px; padding:.05rem .5rem; }
  .lemma { color:var(--soft); font-size:1.05rem; }
  .ev-text { margin:0; font-size:1.35rem; line-height:2.15; }
  .subj { color:var(--gold); font-weight:700; }
  ul { margin:.3rem 0; padding-left:1.3rem; }
  li { margin:.3rem 0; }
  .th-label { color:var(--soft); font-style:italic; }
  /* Slip text is often mixed Arabic + English + verse numbers. Without plaintext
     bidi the refs and punctuation jump to the wrong end of the line. */
  .mixed { unicode-bidi:plaintext; }
  .ev-notes .note-question { color:var(--ink); }
  .qmark { display:inline-block; width:1rem; height:1rem; line-height:1rem; text-align:center;
    border-radius:50%; background:var(--gold); color:#fff; font-size:.7rem; font-weight:700; }
  .note-answer { margin:.15rem 0 0 .2rem; color:var(--soft); font-style:italic; }
  .at-word { color:var(--faint); font-size:.8rem; }
  .mixed .quran, .ar { font-family:"Amiri Quran","Scheherazade New",serif; }
  h3 { font-size:.95rem; margin:1.2rem 0 .4rem; }
  .cluster-block { margin: 0 0 1.2rem; }
  .cluster-name { color:var(--ink); border-left:3px solid var(--gold); padding-left:.6rem; }
  .cluster-count { font-weight:400; font-size:.75rem; color:var(--faint); }
  .cluster-notes { margin:.2rem 0 .6rem; color:var(--soft); font-style:italic; }
  .ev-notes { margin:.4rem 0 0; padding-left:1.1rem; font-size:.9rem; color:var(--soft);
    border-top:1px dotted var(--edge); padding-top:.4rem; }
  .note-form { unicode-bidi:plaintext; text-align:left; font-size:1.15rem;
    line-height:1.9; color:var(--gold); }
  .pill.ai { color:var(--gold); border-color:#fcd34d; background:#fffbeb; }
  .open-note { color:var(--soft); font-style:italic; }
  .tag { font-size:.9rem; color:var(--gold); }
  .footer { margin-top:2.5rem; padding-top:.8rem; border-top:1px solid var(--edge);
    color:var(--faint); font-size:.75rem; display:flex; justify-content:space-between; }
  .brand-ar { font-family:"Scheherazade New",serif; font-size:1rem; }
  .printbtn { position:fixed; top:1rem; right:1rem; font:inherit; font-weight:600; color:#fff;
    background:var(--blue); border:none; border-radius:10px; padding:.55rem 1.1rem; cursor:pointer;
    box-shadow:0 2px 8px rgba(37,99,235,.35); }
  @media print {
    body { background:#fff; }
    .page { margin:0; border:none; box-shadow:none; border-radius:0; max-width:none; padding:0 .2in; }
    .printbtn { display:none; }
    a { color:inherit; }
  }
  @page { size: A4; margin: 18mm 16mm; }
</style>
</head>
<body>
<button class="printbtn" onclick="window.print()">Print / Save as PDF</button>
<div class="page">
  <header class="rpt-head">
    <div class="rpt-head-top">
      <h1 class="mixed">${mixedText(c.title)}</h1>
      <span class="pill status">${esc(c.status)}</span>
    </div>
    ${isPhrase ? "" : `<div class="subject quran">${esc(subjectDisplay)}</div>`}
    <div class="meta">
      ${isAyah
        ? `Āyah <a class="vkey" href="${quranUrl(c.subject.value)}" target="_blank" rel="noopener">${esc(c.subject.value)}</a>`
        : isPhrase ? `Phrase / theme <span class="ar" dir="rtl">${esc(c.subject.value)}</span>` : "Root family"}
      <span class="dot">·</span> ${cards.length} ${cards.length === 1 ? "āyah" : "āyāt"}
      ${c.clusters.length ? `<span class="dot">·</span> ${c.clusters.length} group${c.clusters.length === 1 ? "" : "s"}` : ""}
      ${threads.length ? `<span class="dot">·</span> ${threads.length} connection${threads.length === 1 ? "" : "s"}` : ""}
      ${refs.length ? `<span class="dot">·</span> ${refs.length} source${refs.length === 1 ? "" : "s"}` : ""}
      ${meanings.length ? `<span class="dot">·</span> ${meanings.length} established` : ""}
      <span class="dot">·</span> exported ${esc(date)}
    </div>
  </header>
  ${c.description ? `<h2>The question</h2><p class="desc mixed">${mixedText(c.description)}</p>` : ""}
  ${d.rootCoreEn ? `<p class="rootcore"><strong>Root core (lexical reference, not authority):</strong> ${esc(d.rootCoreEn)}</p>` : ""}

  ${cards.length ? `<h2>The evidence</h2>${evidenceRows}` : ""}

  ${noteRows ? `<h2>What the evidence shows</h2>${noteRows}` : ""}

  ${threadRows ? `<h2>Connections drawn</h2><ul>${threadRows}</ul>` : ""}

  ${refRows ? `<h2>Sources consulted</h2><ol>${refRows}</ol>` : ""}

  ${openQs.length ? `<h2>Questions still open</h2><ul>${openQs
      .map((n) => `<li class="mixed"><a class="vkey" href="${quranUrl(n.verseKey)}" target="_blank" rel="noopener">${esc(n.verseKey)}</a> ${mixedText(n.text)}</li>`)
      .join("")}</ul>` : ""}

  ${meanings.length ? `<h2>${isAyah ? "Established understanding" : "Findings by form"}</h2>${meaningRows}` : ""}

  ${c.verdict
    ? `<h2>Conclusion</h2><p class="verdict mixed">“${mixedText(c.verdict)}”</p>`
    : `<h2>Conclusion</h2><p class="open-note">This case is still ${esc(c.status)} — no verdict has been recorded yet.</p>`}

  ${openForms.length ? `<h2>Still open</h2><ul>${openForms
      .map(([lemma]) => `<li class="quran">${esc(lemma)}</li>`).join("")}</ul>` : ""}

  <div class="footer">
    <span>Original research — established from the Book's own usage.</span>
    <span class="brand-ar">MQ Research Gate</span>
  </div>
</div>
</body>
</html>`;
}

// ---- Markdown ----------------------------------------------------------------

export function buildCaseMarkdown(c: CaseRecord, d: ExportData): string {
  const isAyah = c.subject.type === "ayah";
  const lines: string[] = [];
  const date = new Date().toISOString().slice(0, 10);

  lines.push(`# ${c.title}`);
  lines.push("");
  lines.push(`**Subject:** ${isAyah ? `ayah [${c.subject.value}](${quranUrl(c.subject.value)})` : `root ${c.subject.value}`} · **Status:** ${c.status} · **Exported:** ${date}`);
  if (c.description) lines.push(`\n## The question\n\n${c.description}`);
  if (d.rootCoreEn) lines.push(`\n**Root core (lexical reference, not authority):** ${d.rootCoreEn}`);

  // Same order as the HTML report: the question, then the evidence, then what it
  // shows, then the conclusion. Leading with the verdict reads as assertion, not
  // research — the reader should be able to follow how the meaning was reached.
  const cards = sortedCards(c);
  const ayahMd = (card: EvidenceCardRecord): string => {
    const text = verseTextOf(card, d) ?? "";
    return tokenizeVerse(text)
      .map((tok) => {
        const subj = tok.position !== null && tok.position === card.wordPosition;
        const hl = tok.position !== null
          ? (card.highlights ?? []).some((h) => tok.position! >= h.start && tok.position! <= h.end)
          : false;
        if (subj) return `**${tok.text}**`;
        if (hl) return `==${tok.text}==`;
        return tok.text;
      })
      .join(" ");
  };
  const attachedTo = (cardId: string) => c.slips.filter(
    (s) => c.threads.some((t) =>
      (t.fromCardId === cardId && t.toCardId === s.id) ||
      (t.toCardId === cardId && t.fromCardId === s.id)),
  );
  const emitAyah = (card: EvidenceCardRecord) => {
    lines.push(`\n**[${card.verseKey}](${quranUrl(card.verseKey)})**${card.source === "ai" ? " *(AI-added)*" : ""}`);
    lines.push(`\n${ayahMd(card)}`);
    for (const s of attachedTo(card.id)) {
      lines.push(`\n  - ${s.text}${s.kind === "reference" && s.source ? ` *(${s.source}${s.locator ? `, ${s.locator}` : ""})*` : ""}`);
    }
    // the reader's own notes/questions on this āyah, recorded while reading
    for (const n of (d.notes ?? []).filter((x) => x.verseKey === card.verseKey)) {
      lines.push(`\n  - ${n.kind === "question" ? "**Q:** " : ""}${n.text}${n.wordPosition ? ` (word ${n.wordPosition})` : ""}${n.source === "ai" ? " *(AI)*" : ""}`);
      if (n.answer) lines.push(`\n    → ${n.answer}`);
    }
  };

  if (cards.length) {
    lines.push(`\n## The evidence`);
    const clustered = new Set(c.clusters.flatMap((g) => g.cardIds));
    for (const g of c.clusters) {
      const inGroup = cards.filter((k) => g.cardIds.includes(k.id));
      const slipsIn = c.slips.filter((s) => g.cardIds.includes(s.id) && s.text.trim());
      if (!inGroup.length && !slipsIn.length) continue;
      lines.push(`\n### ${g.name} — ${inGroup.length} ${inGroup.length === 1 ? "āyah" : "āyāt"}`);
      for (const s of slipsIn) lines.push(`\n*${s.text}*`);
      inGroup.forEach(emitAyah);
    }
    const rest = cards.filter((k) => !clustered.has(k.id));
    if (rest.length) {
      if (c.clusters.length) lines.push(`\n### Not yet grouped — ${rest.length} ${rest.length === 1 ? "āyah" : "āyāt"}`);
      rest.forEach(emitAyah);
    }
  }

  const shownWithEvidence = new Set<string>([
    ...c.clusters.flatMap((g) => g.cardIds),
    ...c.threads.flatMap((t) => [t.fromCardId, t.toCardId]).filter((id) => c.slips.some((s) => s.id === id)),
  ]);
  const comments = c.slips.filter(
    (s) => s.kind === "comment" && s.text.trim() && !shownWithEvidence.has(s.id),
  );
  if (comments.length) {
    lines.push(`\n## What the evidence shows`);
    const byForm = new Map<string, typeof comments>();
    for (const s of comments) byForm.set(s.form ?? "", [...(byForm.get(s.form ?? "") ?? []), s]);
    for (const [form, slips] of [...byForm.entries()].sort(
      (a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : a[0].localeCompare(b[0])),
    )) {
      lines.push(`\n### ${form || "On the root as a whole"}`);
      for (const s of slips) lines.push(`- ${s.text}${s.author === "ai" ? " *(AI)*" : ""}`);
    }
  }

  const threads = c.threads.filter(
    (t) => t.accepted && !(!t.label.trim() && [t.fromCardId, t.toCardId].some((id) => c.slips.some((s) => s.id === id))),
  );
  if (threads.length) {
    lines.push(`\n## Connections drawn`);
    for (const t of threads) {
      lines.push(`- ${endpointName(t.fromCardId, t.fromWord, c, d)} ↔ ${endpointName(t.toCardId, t.toWord, c, d)}${t.label ? ` — *${t.label}*` : ""}`);
    }
  }

  const refs = c.slips.filter((s) => s.kind === "reference" && (s.text.trim() || s.source));
  if (refs.length) {
    lines.push(`\n## Sources consulted`);
    refs.forEach((s, i) => {
      lines.push(`${i + 1}. **${s.source || "—"}**${s.locator ? `, ${s.locator}` : ""}${s.text ? ` — ${s.text}` : ""}`);
    });
  }

  const caseVerses = new Set(cards.map((k) => k.verseKey));
  const openQs = (d.notes ?? []).filter(
    (n) => n.kind === "question" && !n.resolved && !n.answer && caseVerses.has(n.verseKey),
  );
  if (openQs.length) {
    lines.push(`\n## Questions still open`);
    for (const n of openQs) lines.push(`- [${n.verseKey}](${quranUrl(n.verseKey)}) ${n.text}`);
  }

  const all = Object.entries(c.formResearch);
  const meanings = all.filter(([, fr]) => fr.status === "established");
  const openForms = all.filter(([, fr]) => fr.status !== "established");
  if (meanings.length) {
    lines.push(`\n## ${isAyah ? "Established understanding" : "Findings by form"}`);
    for (const [lemma, fr] of meanings) {
      lines.push(`- **${lemma}**: ${fr.meaning ? `“${fr.meaning}”` : "—"}`);
    }
  }

  lines.push(`\n## Conclusion`);
  lines.push(c.verdict
    ? `\n> ${c.verdict}`
    : `\nThis case is still ${c.status} — no verdict has been recorded yet.`);

  if (openForms.length) {
    lines.push(`\n## Still open`);
    for (const [lemma] of openForms) lines.push(`- ${lemma}`);
  }

  lines.push(`\n---\n*Original research — established from the Book's own usage. MQ Research Gate*`);
  return lines.join("\n");
}

// ---- delivery ------------------------------------------------------------------

function slug(c: CaseRecord): string {
  const base = c.subject.type === "ayah" ? `ayah-${c.subject.value.replace(":", "-")}` : `root-${c.subject.value}`;
  return `case-${base}-${new Date().toISOString().slice(0, 10)}`;
}

/** Open the report in a new tab — one click there prints / saves as PDF. */
export function openCaseReport(c: CaseRecord, d: ExportData): void {
  const blob = new Blob([buildCaseHtml(c, d)], { type: "text/html" });
  window.open(URL.createObjectURL(blob), "_blank");
}

/** Download the report as a shareable .html file. */
export function downloadCaseHtml(c: CaseRecord, d: ExportData): void {
  triggerDownload(new Blob([buildCaseHtml(c, d)], { type: "text/html" }), `${slug(c)}.html`);
}

/** Download the case as Markdown. */
export function downloadCaseMarkdown(c: CaseRecord, d: ExportData): void {
  triggerDownload(
    new Blob([buildCaseMarkdown(c, d)], { type: "text/markdown;charset=utf-8" }),
    `${slug(c)}.md`,
  );
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
