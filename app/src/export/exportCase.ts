// Case export: a pixel-clean standalone HTML report (print → PDF) and a
// Markdown file. Both are built entirely from the case document — evidence
// with highlights and the subject word in gold, threads, notes, cited
// references, established meanings, and the verdict. Every ayah links to
// quran.com so the report is shareable and navigable outside the app.

import type { CaseRecord, EvidenceCardRecord } from "../persistence/types";
import type { RootOccurrence } from "../api/types";
import { tokenizeVerse } from "../components/reader/format";

export interface ExportData {
  occById: Map<string, RootOccurrence>;
  extraTexts: Map<string, string>;
  /** root core meaning (reference) for root cases */
  rootCoreEn?: string | null;
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
  const subjectDisplay = isAyah ? c.subject.value : c.subject.value.split("").join(" ");
  const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const cards = sortedCards(c);
  const comments = c.slips.filter((s) => s.kind === "comment" && s.text.trim());
  const refs = c.slips.filter((s) => s.kind === "reference" && (s.text.trim() || s.source));
  const threads = c.threads.filter((t) => t.accepted && t.source === "user" || (t.accepted && t.label));

  const meanings = Object.entries(c.formResearch);

  const meaningRows = meanings
    .map(([lemma, fr]) => `
      <div class="meaning">
        <div class="meaning-form quran">${esc(lemma)}</div>
        <div class="meaning-body">
          <span class="pill ${fr.status}">${fr.status === "established" ? "established" : "under investigation"}</span>
          ${fr.meaning ? `<p class="meaning-text">“${esc(fr.meaning)}”</p>` : ""}
        </div>
      </div>`)
    .join("");

  const evidenceRows = cards
    .map((card) => {
      const lemma = d.occById.get(card.id)?.lemma_arabic;
      return `
      <div class="evidence">
        <div class="ev-head">
          <a class="vkey" href="${quranUrl(card.verseKey)}" target="_blank" rel="noopener">${card.verseKey}</a>
          ${lemma ? `<span class="lemma quran">${esc(lemma)}</span>` : ""}
        </div>
        <p class="ev-text quran" dir="rtl">${renderVerseHtml(card, d)}</p>
      </div>`;
    })
    .join("");

  const threadRows = threads
    .map((t) => `
      <li>
        <span class="th-ends">${esc(endpointName(t.fromCardId, t.fromWord, c, d))} ↔ ${esc(endpointName(t.toCardId, t.toWord, c, d))}</span>
        ${t.label ? `<span class="th-label">— ${esc(t.label)}</span>` : ""}
      </li>`)
    .join("");

  const noteRows = comments.map((s) => `<li>${esc(s.text)}${s.form ? ` <span class="tag quran">${esc(s.form)}</span>` : ""}</li>`).join("");

  const refRows = refs
    .map((s, i) => `
      <li id="ref${i + 1}">
        <strong>${esc(s.source || "—")}</strong>${s.locator ? `, ${esc(s.locator)}` : ""}${s.text ? ` — ${esc(s.text)}` : ""}
      </li>`)
    .join("");

  const clusterRows = c.clusters
    .map((g) => {
      const members = g.cardIds
        .map((id) => c.cards.find((k) => k.id === id)?.verseKey ?? c.slips.find((s) => s.id === id)?.kind)
        .filter(Boolean)
        .join(" · ");
      return `<li><strong>${esc(g.name)}</strong>: ${esc(members)}</li>`;
    })
    .join("");

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
  .subject { font-size:2.2rem; color:var(--gold); line-height:1.5; direction:rtl; text-align:left; }
  .meta { color:var(--soft); font-size:.85rem; }
  .desc { font-style:italic; color:var(--soft); margin:.4rem 0 0; }
  .pill { display:inline-block; font-size:.68rem; font-weight:600; letter-spacing:.05em; text-transform:uppercase;
    border-radius:999px; padding:.1rem .6rem; border:1px solid var(--edge); color:var(--soft); }
  .pill.established { color:#166534; border-color:#bbf7d0; background:#f0fdf4; }
  .status { float:right; margin-top:.3rem; }
  .verdict { font-size:1.05rem; font-style:italic; color:var(--blue);
    border-left:3px solid var(--blue); padding:.4rem 0 .4rem 1rem; margin:.5rem 0; }
  .meaning { display:flex; gap:1.2rem; align-items:baseline; padding:.5rem 0; border-bottom:1px dotted var(--edge); }
  .meaning-form { font-size:1.5rem; min-width:7rem; direction:rtl; text-align:left; }
  .meaning-text { margin:.25rem 0 0; font-style:italic; }
  .rootcore { color:var(--soft); font-size:.85rem; margin:.3rem 0 0; }
  .evidence { border:1px solid var(--edge); border-radius:10px; padding:.7rem 1rem; margin:.6rem 0;
    page-break-inside: avoid; }
  .ev-head { display:flex; gap:.7rem; align-items:baseline; margin-bottom:.3rem; }
  .vkey { font-size:.78rem; font-weight:600; color:var(--blue); text-decoration:none;
    border:1px solid #dbeafe; background:#eff6ff; border-radius:6px; padding:.05rem .5rem; }
  .lemma { color:var(--soft); font-size:1.05rem; }
  .ev-text { margin:0; font-size:1.6rem; line-height:2.3; }
  .subj { color:var(--gold); font-weight:700; }
  ul { margin:.3rem 0; padding-left:1.3rem; }
  li { margin:.3rem 0; }
  .th-label { color:var(--soft); font-style:italic; }
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
  <span class="pill status">${esc(c.status)}</span>
  <h1>${esc(c.title)}</h1>
  <div class="subject quran">${esc(subjectDisplay)}</div>
  <div class="meta">${isAyah ? `Ayah <a class="vkey" href="${quranUrl(c.subject.value)}" target="_blank" rel="noopener">${esc(c.subject.value)}</a>` : "Root family"} · ${cards.length} evidence · exported ${esc(date)}</div>
  ${c.description ? `<p class="desc">${esc(c.description)}</p>` : ""}
  ${d.rootCoreEn ? `<p class="rootcore"><strong>Root core (reference):</strong> ${esc(d.rootCoreEn)}</p>` : ""}

  ${meanings.length ? `<h2>${isAyah ? "Established understanding" : "Established meanings"}</h2>${meaningRows}` : ""}

  ${c.verdict ? `<h2>Verdict</h2><p class="verdict">“${esc(c.verdict)}”</p>` : ""}

  ${cards.length ? `<h2>Evidence from the Book</h2>${evidenceRows}` : ""}

  ${threadRows ? `<h2>Connections</h2><ul>${threadRows}</ul>` : ""}

  ${noteRows ? `<h2>Research notes</h2><ul>${noteRows}</ul>` : ""}

  ${refRows ? `<h2>References</h2><ol>${refRows}</ol>` : ""}

  ${clusterRows ? `<h2>Clusters</h2><ul>${clusterRows}</ul>` : ""}

  <div class="footer">
    <span>Original research — established from the Book's own usage.</span>
    <span class="brand-ar">الصراط المستقيم</span>
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
  if (c.description) lines.push(`\n> ${c.description}`);
  if (d.rootCoreEn) lines.push(`\n**Root core (reference):** ${d.rootCoreEn}`);

  const meanings = Object.entries(c.formResearch);
  if (meanings.length) {
    lines.push(`\n## ${isAyah ? "Established understanding" : "Established meanings"}`);
    for (const [lemma, fr] of meanings) {
      lines.push(`- **${lemma}** (${fr.status}): ${fr.meaning ? `“${fr.meaning}”` : "—"}`);
    }
  }

  if (c.verdict) lines.push(`\n## Verdict\n\n> ${c.verdict}`);

  const cards = sortedCards(c);
  if (cards.length) {
    lines.push(`\n## Evidence from the Book`);
    for (const card of cards) {
      const text = verseTextOf(card, d) ?? "";
      const md = tokenizeVerse(text)
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
      lines.push(`\n**[${card.verseKey}](${quranUrl(card.verseKey)})**`);
      lines.push(`\n${md}`);
    }
  }

  const threads = c.threads.filter((t) => t.accepted);
  if (threads.length) {
    lines.push(`\n## Connections`);
    for (const t of threads) {
      lines.push(`- ${endpointName(t.fromCardId, t.fromWord, c, d)} ↔ ${endpointName(t.toCardId, t.toWord, c, d)}${t.label ? ` — *${t.label}*` : ""}`);
    }
  }

  const comments = c.slips.filter((s) => s.kind === "comment" && s.text.trim());
  if (comments.length) {
    lines.push(`\n## Research notes`);
    for (const s of comments) lines.push(`- ${s.text}${s.form ? ` (${s.form})` : ""}`);
  }

  const refs = c.slips.filter((s) => s.kind === "reference" && (s.text.trim() || s.source));
  if (refs.length) {
    lines.push(`\n## References`);
    refs.forEach((s, i) => {
      lines.push(`${i + 1}. **${s.source || "—"}**${s.locator ? `, ${s.locator}` : ""}${s.text ? ` — ${s.text}` : ""}`);
    });
  }

  if (c.clusters.length) {
    lines.push(`\n## Clusters`);
    for (const g of c.clusters) {
      const members = g.cardIds
        .map((id) => c.cards.find((k) => k.id === id)?.verseKey)
        .filter(Boolean)
        .join(", ");
      lines.push(`- **${g.name}**: ${members}`);
    }
  }

  lines.push(`\n---\n*Original research — established from the Book's own usage. الصراط المستقيم*`);
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
