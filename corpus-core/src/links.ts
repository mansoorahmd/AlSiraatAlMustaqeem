// Links: everything in an āyah that also occurs elsewhere in the Book, with how RARE it is.
//
// A link is a marker two or more āyāt share. Five kinds, from the longest to the broadest:
//
//   phrase  three or more words repeated verbatim (the echoes index, echoes.ts)
//   pair    two adjacent words repeated verbatim
//   form    one written word (vowels ignored, a leading و / ف set aside), so particles and
//           names with no root count too: تَٱللَّهِ, أَرَءَيْتَ
//   lemma   the dictionary form, whatever its inflection
//   root    any word from the root
//
// Rarity is the number of āyāt that carry the marker. The fewer, the stronger the link: a
// marker found in two āyāt ties exactly those two. Nothing here interprets; it only counts.
//
// One word is offered at the broadest level that says something new: its root, then its lemma
// only when the lemma is rarer than the root, then its written form only when that differs
// from the lemma. So a root with a single word is listed once, not three times.

import type { CorpusDb } from "./corpus-db.js";
import { once } from "./corpus-db.js";
import { buckToArabic, foldArabic } from "./text/normalize.js";
import { lettersKey } from "./wording.js";
import type { EchoIndex } from "./echoes.js";

export type MarkerKind = "phrase" | "pair" | "form" | "lemma" | "root";

/** Where a marker lands in another āyah: the 1-based word position it starts at. */
export interface LinkPlace { verseKey: string; start: number }

export interface LinkMarker {
  kind: MarkerKind;
  /** what is shared, as written (Arabic) */
  text: string;
  /** the index key: root, lemma, or the folded written form / phrase */
  key: string;
  /** every 1-based word position in THIS āyah where the marker starts */
  positions: number[];
  /** how many words the marker spans */
  length: number;
  /** āyāt in the Book that carry it, this one included */
  ayahs: number;
  /** the other āyāt, in mushaf order (capped; `ayahs` is the true total) */
  places: LinkPlace[];
}

export interface CommonMarker { kind: MarkerKind; text: string; positions: number[]; length: number; ayahs: number }
export interface OnlyHere { kind: "root" | "lemma"; text: string; position: number }

export interface AyahLinks {
  verseKey: string;
  /** markers carried by at most `max` āyāt, rarest first */
  links: LinkMarker[];
  /** markers too widespread to tie āyāt together: counted, places not listed */
  common: CommonMarker[];
  /** roots and words found in this āyah and nowhere else */
  onlyHere: OnlyHere[];
}

export type ExclusiveKind = "root" | "lemma" | "form" | "phrase";
export interface ExclusiveItem { kind: ExclusiveKind; text: string; key: string; length: number; places: LinkPlace[] }
export interface ExclusiveQuery {
  kind: ExclusiveKind;
  /** exactly this many āyāt carry the marker (2–5) */
  n?: number;
  /** only markers whose āyāt are not all in one sūrah */
  cross?: boolean;
  /** only markers with an āyah in this sūrah */
  chapter?: number;
  limit?: number;
  offset?: number;
}

interface W {
  pos: number;
  /** the whole written word, folded */
  whole: string;
  /** the written word without a leading connective, folded — the form key */
  form: string;
  /** the same two, as written */
  wholeText: string;
  formText: string;
  lemmas: string[];
  roots: string[];
}

// A leading و / ف that only joins the word to what came before: conjunction, resumption,
// result, circumstantial, supplemental, cause, comitative. Set aside so وَتَٱللَّهِ and تَٱللَّهِ
// are one written form. The oath wāw (tag P) is part of the word and stays.
const CONNECTIVE = new Set(["CONJ", "REM", "RSLT", "CIRC", "SUP", "CAUS", "COM"]);

const KIND_ORDER: Record<MarkerKind, number> = { phrase: 0, pair: 1, form: 2, lemma: 3, root: 4 };
const chapterOf = (k: string) => parseInt(k.split(":")[0] ?? "", 10) || 0;

export const DEFAULT_MAX_AYAHS = 20;
const DEFAULT_PLACES = 40;

export class LinkIndex {
  private verses = new Map<string, W[]>();
  private ord = new Map<string, number>();
  private roots = new Map<string, LinkPlace[]>();
  private lemmas = new Map<string, LinkPlace[]>();
  private forms = new Map<string, LinkPlace[]>();
  private pairs = new Map<string, LinkPlace[]>();
  private formText = new Map<string, string>();
  private formLemma = new Map<string, string>();
  private lemmaRoot = new Map<string, string>();
  private exclusiveCache = new Map<string, ExclusiveItem[]>();
  /** Built once, on first use; concurrent callers share the one build. */
  readonly build: () => Promise<void>;

  constructor(private db: CorpusDb, private echoes: EchoIndex) {
    this.build = once(() => this.load());
  }

  private async load(): Promise<void> {
    const rows = await this.db.query<{
      verse_key: string; word_position: number; segment_type: string | null; tag: string | null;
      form_arabic: string | null; lemma_arabic: string | null; root_arabic: string | null;
    }>(
      `SELECT ws.verse_key, ws.word_position, ws.segment_type, ws.tag, ws.form_arabic,
              ws.lemma_arabic, ws.root_arabic
       FROM word_segments ws JOIN verses v ON v.verse_key = ws.verse_key
       ORDER BY v.chapter_id, v.verse_number, ws.word_position, ws.segment_number`,
    );

    let cur: W | null = null;
    let curKey = "";
    let leading = true; // still inside the word's leading connectives
    const flush = () => {
      if (!cur) return;
      cur.whole = foldArabic(cur.wholeText);
      cur.form = foldArabic(cur.formText) || cur.whole;
      if (!cur.formText) cur.formText = cur.wholeText;
      let list = this.verses.get(curKey);
      if (!list) { list = []; this.verses.set(curKey, list); this.ord.set(curKey, this.ord.size); }
      list.push(cur);
    };
    for (const r of rows) {
      if (!cur || r.verse_key !== curKey || r.word_position !== cur.pos) {
        flush();
        curKey = r.verse_key;
        cur = { pos: r.word_position, whole: "", form: "", wholeText: "", formText: "", lemmas: [], roots: [] };
        leading = true;
      }
      const seg = r.form_arabic ?? "";
      cur.wholeText += seg;
      if (leading && r.segment_type === "PREFIX" && CONNECTIVE.has(r.tag ?? "")) continue;
      leading = false;
      cur.formText += seg;
      if (r.segment_type === "STEM") {
        if (r.lemma_arabic && !cur.lemmas.includes(r.lemma_arabic)) cur.lemmas.push(r.lemma_arabic);
        if (r.root_arabic && !cur.roots.includes(r.root_arabic)) cur.roots.push(r.root_arabic);
        if (r.lemma_arabic && r.root_arabic && !this.lemmaRoot.has(r.lemma_arabic)) {
          this.lemmaRoot.set(r.lemma_arabic, r.root_arabic);
        }
      }
    }
    flush();

    // each index keeps a marker's FIRST position per āyah, in mushaf order
    const add = (idx: Map<string, LinkPlace[]>, key: string, verseKey: string, start: number) => {
      const list = idx.get(key);
      if (!list) idx.set(key, [{ verseKey, start }]);
      else if (list[list.length - 1]!.verseKey !== verseKey) list.push({ verseKey, start });
    };
    for (const [verseKey, words] of this.verses) {
      for (let i = 0; i < words.length; i++) {
        const w = words[i]!;
        for (const root of w.roots) add(this.roots, root, verseKey, w.pos);
        for (const lemma of w.lemmas) add(this.lemmas, lemma, verseKey, w.pos);
        if (w.form) {
          add(this.forms, w.form, verseKey, w.pos);
          if (!this.formText.has(w.form)) this.formText.set(w.form, w.formText);
          if (!this.formLemma.has(w.form) && w.lemmas[0]) this.formLemma.set(w.form, w.lemmas[0]);
        }
        const next = words[i + 1];
        if (next && w.form && next.whole) add(this.pairs, `${w.form} ${next.whole}`, verseKey, w.pos);
      }
    }
  }

  /** Every link an āyah has, rarest first. `max` is the most āyāt a marker may be in to be listed
   *  with its places; anything more widespread is returned under `common`, counted only. */
  async linksForVerse(verseKey: string, opts: { max?: number; places?: number } = {}): Promise<AyahLinks | null> {
    await this.build();
    const words = this.verses.get(verseKey);
    if (!words) return null;
    const max = opts.max ?? DEFAULT_MAX_AYAHS;
    const cap = opts.places ?? DEFAULT_PLACES;

    interface Found { kind: MarkerKind; text: string; key: string; positions: number[]; length: number; all: LinkPlace[] }
    const found = new Map<string, Found>();
    const note = (kind: MarkerKind, key: string, text: string, pos: number, length: number, all: LinkPlace[]) => {
      const id = `${kind} ${key}`;
      const f = found.get(id);
      if (f) { if (!f.positions.includes(pos)) f.positions.push(pos); }
      else found.set(id, { kind, key, text, positions: [pos], length, all });
    };

    // phrases of three or more words: the echoes index already finds the longest ones
    const byPos = new Map(words.map((w) => [w.pos, w]));
    const spanText = (start: number, length: number) => {
      const out: string[] = [];
      for (let p = start; p < start + length; p++) {
        const w = byPos.get(p);
        if (w) out.push(w.wholeText);
      }
      return out.join(" ");
    };
    const covered: [number, number][] = [];
    for (const e of await this.echoes.echoesForVerse(verseKey)) {
      // only the echoes index knows these places, and it counts a repeat inside this āyah too
      const elsewhere = e.occurrences.filter((o) => o.verseKey !== verseKey);
      if (elsewhere.length === 0) continue;
      covered.push([e.start, e.start + e.length - 1]);
      // a phrase whose key is also a Rare link's is counted as the Rare link counts it (its first
      // word with or without a leading و / ف), so one key always names one set of places
      const run = this.exclusiveRuns().get(e.phrase);
      note("phrase", e.phrase, spanText(e.start, e.length) || e.phrase, e.start, e.length,
        run ? run.places : [{ verseKey, start: e.start }, ...elsewhere]);
    }
    const inPhrase = (a: number, b: number) => covered.some(([s, t]) => s <= a && t >= b);

    const onlyHere: OnlyHere[] = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!;
      const next = words[i + 1];
      if (next && next.pos === w.pos + 1 && !inPhrase(w.pos, next.pos)) {
        const key = `${w.form} ${next.whole}`;
        const all = this.pairs.get(key);
        if (all && all.length > 1) note("pair", key, `${w.formText} ${next.wholeText}`, w.pos, 2, all);
      }

      let rootCount = Infinity;
      for (const root of w.roots) {
        const all = this.roots.get(root)!;
        rootCount = Math.min(rootCount, all.length);
        if (all.length > 1) note("root", root, root, w.pos, 1, all);
        else onlyHere.push({ kind: "root", text: root, position: w.pos });
      }
      let lemmaCount = Infinity;
      for (const lemma of w.lemmas) {
        const all = this.lemmas.get(lemma)!;
        lemmaCount = Math.min(lemmaCount, all.length);
        const root = this.lemmaRoot.get(lemma);
        const same = root !== undefined && this.roots.get(root)!.length === all.length;
        if (same) continue; // the root already says it
        if (all.length > 1) note("lemma", lemma, lemma, w.pos, 1, all);
        else onlyHere.push({ kind: "lemma", text: lemma, position: w.pos });
      }
      const forms = this.forms.get(w.form);
      if (forms && forms.length > 1 && forms.length !== lemmaCount && forms.length !== rootCount) {
        note("form", w.form, w.formText, w.pos, 1, forms);
      }
    }

    const links: LinkMarker[] = [];
    const common: CommonMarker[] = [];
    for (const f of found.values()) {
      const ayahs = f.all.length;
      if (ayahs > max) {
        common.push({ kind: f.kind, text: f.text, positions: f.positions, length: f.length, ayahs });
        continue;
      }
      const places = f.all.filter((p) => p.verseKey !== verseKey).slice(0, cap);
      links.push({ kind: f.kind, text: f.text, key: f.key, positions: f.positions, length: f.length, ayahs, places });
    }
    const order = (a: CommonMarker, b: CommonMarker) =>
      a.ayahs - b.ayahs || b.length - a.length || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.positions[0]! - b.positions[0]!;
    links.sort(order);
    common.sort(order);
    return { verseKey, links, common, onlyHere };
  }

  /** EVERY place a marker occurs, in Book order: each word (or run of words) that carries it,
   *  several in one āyah when it recurs there.
   *
   *  The key is tried as given first, so a LinkMarker's key finds exactly the places its count
   *  says; then, for a key a reader typed, more loosely:
   *
   *    phrase  word for word as the Links panel counts it (each word as the morphology or the
   *            displayed text writes it, folded); if nothing, its first word also without a leading
   *            و / ف (how a Rare-links phrase key is built); if still nothing, the key folded
   *    pair    its first word with or without a leading و / ف (as the index keys pairs); then folded
   *    form    the folded written form (the index key); then folded as typed (marks stripped, ٱ أ إ آ
   *            read as ا); then by its letters (the small alif typed as ا or left out, ء dropped)
   *    lemma   the lemma exactly; then every lemma equal to it with its marks stripped and folded
   *    root    the root's letters, spaced or not; hamza read as the corpus writes it (ا); Buckwalter
   *            (qwl) converted to Arabic
   */
  async occurrencesOf(kind: MarkerKind, key: string): Promise<{ verseKey: string; word: number; words: number; text: string }[]> {
    await this.build();
    if (kind === "phrase" || kind === "pair") {
      const raw = key.trim().split(/\s+/).filter(Boolean);
      if (raw.length === 0) return [];
      // A marker's own key answers from the marker's own āyāt, so the two can't disagree: a pair
      // (the Links panel's, or a two-word Rare link) from the pair index, a longer Rare link from
      // the run exclusive() built. Only the places inside those āyāt are looked for.
      const joined = raw.join(" ");
      const pair = raw.length === 2 ? this.pairs.get(joined) : undefined;
      if (pair) return this.runPlaces(raw, pair, null);
      const run = this.exclusiveRuns().get(joined);
      if (run) return this.runPlaces(raw, run.places, run.firstWhole);
      const folded = raw.map((w) => foldArabic(w));
      const tries: [string[], boolean][] = kind === "phrase"
        ? [[raw, false], [raw, true], [folded, true]]
        : [[raw, true], [folded, true]];
      for (const [want, formFirst] of tries) {
        const found = await this.phrasePlaces(want, formFirst);
        if (found.length) return found;
      }
      return [];
    }
    const k = key.trim();
    const tests: ((w: W) => boolean)[] = [];
    if (kind === "root") {
      const r = k.replace(/\s+/g, "");
      const ar = /[؀-ۿ]/.test(r) ? r : buckToArabic(r);
      const fr = foldArabic(ar).replace(/[ءأإآؤئ]/g, "ا");
      tests.push((w) => w.roots.includes(ar));
      tests.push((w) => w.roots.some((x) => foldArabic(x).replace(/[ءأإآؤئ]/g, "ا") === fr));
    } else if (kind === "lemma") {
      tests.push((w) => w.lemmas.includes(k));
      const fk = foldArabic(k);
      tests.push((w) => w.lemmas.some((l) => foldArabic(l) === fk));
    } else {
      tests.push((w) => w.form === k);
      const fk = foldArabic(k);
      tests.push((w) => w.form === fk);
      const lk = lettersKey(k);
      tests.push((w) => !!lk && (lettersKey(w.formText) === lk || lettersKey(w.formText, "") === lk));
    }
    for (const hit of tests) {
      const out: { verseKey: string; word: number; words: number; text: string }[] = [];
      for (const [verseKey, words] of this.verses) {
        for (const w of words) if (hit(w)) out.push({ verseKey, word: w.pos, words: 1, text: w.wholeText });
      }
      if (out.length) return out;
    }
    return [];
  }

  /** The places of a marker inside its own āyāt (`within`, Book order): every run whose first word
   *  is `key[0]` without its leading connective (or, for a Rare link, written whole as the first
   *  word of its first place is: `firstWhole`) and whose other words are written whole as `key`. */
  private runPlaces(key: string[], within: LinkPlace[], firstWhole: string | null) {
    const out: { verseKey: string; word: number; words: number; text: string }[] = [];
    for (const { verseKey } of within) {
      const words = this.verses.get(verseKey)!;
      for (let i = 0; i + key.length <= words.length; i++) {
        const first = words[i]!;
        if (first.form !== key[0] && first.whole !== firstWhole) continue;
        let ok = true;
        for (let k = 1; k < key.length && ok; k++) {
          const w = words[i + k]!;
          ok = w.whole === key[k] && w.pos === first.pos + k;
        }
        if (ok) out.push({ verseKey, word: first.pos, words: key.length, text: words.slice(i, i + key.length).map((w) => w.wholeText).join(" ") });
      }
    }
    return out;
  }

  /** Every Rare-links phrase (n = 2 to 5) by its key. */
  private runsByKey: Map<string, { places: LinkPlace[]; firstWhole: string }> | null = null;
  private exclusiveRuns() {
    if (!this.runsByKey) {
      const m = new Map<string, { places: LinkPlace[]; firstWhole: string }>();
      for (let n = 2; n <= 5; n++) {
        for (const it of this.exclusiveAll("phrase", n)) {
          const p = it.places[0]!;
          const first = this.verses.get(p.verseKey)!.find((w) => w.pos === p.start)!;
          if (!m.has(it.key)) m.set(it.key, { places: it.places, firstWhole: first.whole });
        }
      }
      this.runsByKey = m;
    }
    return this.runsByKey;
  }

  private exclusiveAll(kind: ExclusiveKind, n: number): ExclusiveItem[] {
    const cacheKey = `${kind} ${n}`;
    let all = this.exclusiveCache.get(cacheKey);
    if (!all) {
      all = kind === "phrase" ? this.exclusivePhrases(n) : this.exclusiveWords(kind, n);
      this.exclusiveCache.set(cacheKey, all);
    }
    return all;
  }

  /** Every run of words matching `want`, each word as the morphology or the displayed text writes
   *  it (folded); `formFirst` lets the first word also match without a leading و / ف. */
  private async phrasePlaces(want: string[], formFirst: boolean) {
    const out: { verseKey: string; word: number; words: number; text: string }[] = [];
    for (const [verseKey, words] of this.verses) {
      const echo = await this.echoes.foldedWords(verseKey);
      for (let i = 0; i + want.length <= words.length; i++) {
        let ok = true;
        for (let k = 0; k < want.length && ok; k++) {
          const w = words[i + k]!;
          const t = echo[w.pos - 1];
          ok = want[k] === w.whole || want[k] === t || (formFirst && k === 0 && want[k] === w.form);
          if (ok && k > 0) ok = w.pos === words[i]!.pos + k; // contiguous
        }
        if (ok) {
          out.push({
            verseKey, word: words[i]!.pos, words: want.length,
            text: words.slice(i, i + want.length).map((w) => w.wholeText).join(" "),
          });
        }
      }
    }
    return out;
  }

  /** Every marker carried by exactly `n` āyāt. Each level lists only what the level above does
   *  not already say: a word is under "lemma" only when its root is used more widely, and a
   *  written form only when its lemma is. Phrases are the longest runs of two or more words. */
  async exclusive(q: ExclusiveQuery): Promise<{ total: number; items: ExclusiveItem[] }> {
    await this.build();
    const n = Math.min(5, Math.max(2, Math.trunc(q.n ?? 2)));
    let items = this.exclusiveAll(q.kind, n);
    if (q.cross) items = items.filter((it) => new Set(it.places.map((p) => chapterOf(p.verseKey))).size > 1);
    if (q.chapter) items = items.filter((it) => it.places.some((p) => chapterOf(p.verseKey) === q.chapter));
    const offset = Math.max(0, Math.trunc(q.offset ?? 0));
    const limit = Math.min(500, Math.max(1, Math.trunc(q.limit ?? 100)));
    return { total: items.length, items: items.slice(offset, offset + limit) };
  }

  private exclusiveWords(kind: "root" | "lemma" | "form", n: number): ExclusiveItem[] {
    const out: ExclusiveItem[] = [];
    const idx = kind === "root" ? this.roots : kind === "lemma" ? this.lemmas : this.forms;
    for (const [key, places] of idx) {
      if (places.length !== n) continue;
      let text = key;
      if (kind === "lemma") {
        const root = this.lemmaRoot.get(key);
        if (root !== undefined && this.roots.get(root)!.length === n) continue;
      } else if (kind === "form") {
        const lemma = this.formLemma.get(key);
        if (lemma !== undefined && this.lemmas.get(lemma)!.length === n) continue;
        text = this.formText.get(key) ?? key;
      }
      out.push({ kind, text, key, length: 1, places });
    }
    return out.sort((a, b) => this.ord.get(a.places[0]!.verseKey)! - this.ord.get(b.places[0]!.verseKey)! ||
      a.places[0]!.start - b.places[0]!.start);
  }

  private exclusivePhrases(n: number): ExclusiveItem[] {
    const at = (p: LinkPlace, offset: number): W | undefined => {
      const words = this.verses.get(p.verseKey)!;
      // positions are 1-based and contiguous, but look the word up rather than assume it
      const i = p.start - 1 + offset;
      const w = words[i];
      return w && w.pos === p.start + offset ? w : words.find((x) => x.pos === p.start + offset);
    };
    // Grow each exclusive pair as far as it goes in ALL its places, to the left and to the right.
    // The run holds a pair only these āyāt carry, so the run too is carried by exactly them.
    // Every exclusive pair inside one run grows into that same run, so it is kept once. (A pair
    // inside the run may also occur elsewhere, e.g. عَلَىٰ سَفَرٍ, and must not split the run.)
    const seen = new Set<string>();
    const out: ExclusiveItem[] = [];
    for (const [, seed] of this.pairs) {
      if (seed.length !== n) continue;
      // leftwards: the word that was first becomes an inner word, so it must now match whole
      // (connective included); the new first word matches without its leading connective
      let back = 0;
      for (;;) {
        const first = seed.map((p) => at(p, -back));
        const before = seed.map((p) => at(p, -back - 1));
        if (!first.every((w) => w && w.whole === first[0]!.whole)) break;
        // (or whole: the corpus tags the same وَ as an oath in one āyah and a conjunction in
        // another, e.g. وَرَبِّنَا in 6:30 and 46:34, so the stripped forms can differ)
        if (!before.every((w) => w && (w.form === before[0]!.form || w.whole === before[0]!.whole))) break;
        back++;
      }
      let length = back + 2;
      for (;;) {
        const next = seed.map((p) => at(p, length - back));
        if (!next.every((w) => w && w.whole === next[0]!.whole)) break;
        length++;
      }
      const places = back ? seed.map((p) => ({ verseKey: p.verseKey, start: p.start - back })) : seed;
      const id = `${places[0]!.verseKey}@${places[0]!.start}+${length}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const text: string[] = [];
      const key: string[] = [];
      for (let k = 0; k < length; k++) {
        const w = at(places[0]!, k)!;
        text.push(k === 0 ? w.formText : w.wholeText);
        key.push(k === 0 ? w.form : w.whole);
      }
      out.push({ kind: "phrase", text: text.join(" "), key: key.join(" "), length, places });
    }
    return out.sort((a, b) => b.length - a.length ||
      this.ord.get(a.places[0]!.verseKey)! - this.ord.get(b.places[0]!.verseKey)! ||
      a.places[0]!.start - b.places[0]!.start);
  }
}
