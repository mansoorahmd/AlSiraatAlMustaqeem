// Case operations: create, find, and mutate cases in the local archive.
// All mutations are pure (return a new CaseRecord); CaseDesk persists them.

import { archive, newId } from "../persistence/db";
import type {
  CaseRecord, EvidenceCardRecord, ThreadRecord, ClusterRecord,
  SlipRecord, SlipKind, HighlightRange, SubjectType, SourceKind,
} from "../persistence/types";
import type { RootOccurrence } from "../api/types";

function spacedRoot(root: string): string {
  return root.split("").join("\u00A0"); // nbsp: root letters must not wrap
}

/** Find an existing case for a root subject, or create and persist a new one. */
export async function openOrCreateRootCase(
  root: string,
  spark?: { verseKey: string; wordPosition: number },
): Promise<CaseRecord> {
  const all = await archive.cases.all();
  const existing = all.find(
    (c) => c.subject.type === "root" && c.subject.value === root,
  );
  if (existing) return normalizeCase(existing);

  const now = Date.now();
  const rec: CaseRecord = {
    id: newId("case"),
    subject: {
      type: "root",
      value: root,
      sparkVerseKey: spark?.verseKey,
      sparkWordPosition: spark?.wordPosition,
    },
    title: `The root ${spacedRoot(root)}`,
    cards: [],
    slips: [],
    threads: [],
    clusters: [],
    formResearch: {},
    verdict: "",
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
  await archive.cases.save(rec);
  return rec;
}

/** Open a case on a phrase or a free-form theme — an investigation that isn't anchored
 *  to one root or one āyah. Unlike the root/āyah helpers this always creates: two
 *  enquiries can share a phrase and still be different questions. */
export async function createSubjectCase(
  subjectType: SubjectType,
  value: string,
  title: string,
  description = "",
): Promise<CaseRecord> {
  const now = Date.now();
  const subject = value.trim();
  const rec: CaseRecord = {
    id: newId("case"),
    subject: { type: subjectType, value: subject },
    title: title.trim() || subject || "Untitled case",
    description,
    cards: [],
    slips: [],
    threads: [],
    clusters: [],
    formResearch: {},
    verdict: "",
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
  await archive.cases.save(rec);
  return rec;
}

/** Stable id for the card belonging to one occurrence. */
export function cardIdFor(occ: RootOccurrence): string {
  return `ev_${occ.verse_key}_${occ.word_position}`;
}

/** Default placement for the n-th card: a loose grid scatter. */
export function defaultPosition(n: number): { x: number; y: number } {
  return { x: 30 + (n % 3) * 300, y: 30 + Math.floor(n / 3) * 200 };
}

/** Pull an occurrence onto the board (or return the case unchanged if present). */
export function withCardAdded(c: CaseRecord, occ: RootOccurrence): CaseRecord {
  const id = cardIdFor(occ);
  if (c.cards.some((k) => k.id === id)) return c;
  const { x, y } = defaultPosition(c.cards.length);
  const card: EvidenceCardRecord = {
    id,
    verseKey: occ.verse_key,
    wordPosition: occ.word_position,
    x,
    y,
    rotation: (Math.random() - 0.5) * 2.4, // paper never sits perfectly straight
  };
  return { ...c, cards: [...c.cards, card] };
}

/** Add ANY ayah of the Quran as evidence (not only root occurrences). */
export function withAyahCardAdded(
  c: CaseRecord,
  verseKey: string,
  wordPosition: number | null = null,
): CaseRecord {
  const id = `ev_${verseKey}_${wordPosition ?? 0}`;
  if (c.cards.some((k) => k.id === id)) return c;
  const { x, y } = defaultPosition(c.cards.length + c.slips.length);
  const card: EvidenceCardRecord = {
    id,
    verseKey,
    wordPosition,
    x,
    y,
    rotation: (Math.random() - 0.5) * 2.4,
  };
  return { ...c, cards: [...c.cards, card] };
}

export function withCardRemoved(c: CaseRecord, cardId: string): CaseRecord {
  return {
    ...c,
    cards: c.cards.filter((k) => k.id !== cardId),
    threads: c.threads.filter((t) => t.fromCardId !== cardId && t.toCardId !== cardId),
    clusters: c.clusters.map((g) => ({
      ...g,
      cardIds: g.cardIds.filter((id) => id !== cardId),
    })),
  };
}

/** Set a card for the reading (the default: the field is dropped) or against it. */
export function withCardStance(c: CaseRecord, cardId: string, stance: "for" | "against"): CaseRecord {
  return {
    ...c,
    cards: c.cards.map((k) => {
      if (k.id !== cardId) return k;
      const { stance: _old, ...rest } = k;
      return stance === "against" ? { ...rest, stance: "against" } : rest;
    }),
  };
}

export function withCardMoved(c: CaseRecord, cardId: string, x: number, y: number): CaseRecord {
  return {
    ...c,
    cards: c.cards.map((k) => (k.id === cardId ? { ...k, x, y } : k)),
  };
}

// ---- threads ---------------------------------------------------------------

export function withThreadAdded(
  c: CaseRecord,
  fromCardId: string,
  toCardId: string,
  label: string,
  source: "user" | "suggested" = "user",
  accepted = true,
  id?: string,
  fromWord: number | null = null,
  toWord: number | null = null,
): CaseRecord {
  // idempotent: a thread with a known id (accepted/dismissed suggestion)
  // must never be added twice — double-clicks used to draw twin threads
  if (id && c.threads.some((t) => t.id === id)) return c;
  const t: ThreadRecord = {
    id: id ?? newId("th"),
    fromCardId,
    toCardId,
    fromWord,
    toWord,
    label,
    source,
    accepted,
  };
  return { ...c, threads: [...c.threads, t] };
}

export function withThreadUpdated(c: CaseRecord, id: string, label: string): CaseRecord {
  return {
    ...c,
    threads: c.threads.map((t) => (t.id === id ? { ...t, label } : t)),
  };
}

export function withThreadRemoved(c: CaseRecord, id: string): CaseRecord {
  return { ...c, threads: c.threads.filter((t) => t.id !== id) };
}

// ---- clusters --------------------------------------------------------------

// Distinct, saturated cluster colours (used for member-card borders and the chip).
// Chosen to read clearly as borders and to be well separated from each other.
export const CLUSTER_COLORS = [
  "#2563eb", // blue
  "#d97706", // amber
  "#16a34a", // green
  "#db2777", // pink
  "#7c3aed", // violet
  "#0d9488", // teal
  "#dc2626", // red
  "#4f46e5", // indigo
];

/** the next colour not already used by a cluster, else cycle by count */
function nextClusterColor(c: CaseRecord): string {
  const used = new Set(c.clusters.map((g) => g.color).filter(Boolean));
  const free = CLUSTER_COLORS.find((col) => !used.has(col));
  return free ?? CLUSTER_COLORS[c.clusters.length % CLUSTER_COLORS.length]!;
}

export function withClusterAdded(c: CaseRecord, name: string, cardIds: string[]): CaseRecord {
  const g: ClusterRecord = { id: newId("cl"), name, cardIds, color: nextClusterColor(c) };
  return { ...c, clusters: [...c.clusters, g] };
}

export function withClusterRemoved(c: CaseRecord, id: string): CaseRecord {
  return { ...c, clusters: c.clusters.filter((g) => g.id !== id) };
}

// ---- pencil suggestions ----------------------------------------------------

export interface ThreadSuggestion {
  id: string; // deterministic, so dismissals persist as threads with accepted=false
  fromCardId: string;
  toCardId: string;
  reason: string;
}

/**
 * Machine-computed connections between cards on the board, drawn in pencil
 * until the reader inks (accepts) or dismisses them. Computed from data the
 * board already has: shared word form, and same-surah proximity.
 */
export function suggestThreads(
  c: CaseRecord,
  occById: Map<string, RootOccurrence>,
  maxTotal = 12,
): ThreadSuggestion[] {
  const known = new Set(c.threads.map((t) => t.id));
  const pairKnown = new Set(
    c.threads.map((t) => [t.fromCardId, t.toCardId].sort().join("|")),
  );
  const perCard = new Map<string, number>();
  const out: ThreadSuggestion[] = [];

  const cards = c.cards;
  for (let i = 0; i < cards.length && out.length < maxTotal; i++) {
    for (let j = i + 1; j < cards.length && out.length < maxTotal; j++) {
      const a = cards[i], b = cards[j];
      const oa = occById.get(a.id), ob = occById.get(b.id);
      if (!oa || !ob) continue;
      const pair = [a.id, b.id].sort().join("|");
      if (pairKnown.has(pair)) continue;

      let reason: string | null = null;
      let kind = "";
      if (oa.lemma_arabic && oa.lemma_arabic === ob.lemma_arabic) {
        reason = `same form: ${oa.lemma_arabic}`;
        kind = "form";
      } else if (oa.chapter_id === ob.chapter_id) {
        reason = "same surah";
        kind = "surah";
      }
      if (!reason) continue;

      const id = `sug_${kind}_${pair}`;
      if (known.has(id)) continue; // already accepted or dismissed
      if ((perCard.get(a.id) ?? 0) >= 2 || (perCard.get(b.id) ?? 0) >= 2) continue;

      out.push({ id, fromCardId: a.id, toCardId: b.id, reason });
      perCard.set(a.id, (perCard.get(a.id) ?? 0) + 1);
      perCard.set(b.id, (perCard.get(b.id) ?? 0) + 1);
    }
  }
  return out;
}


// ---- V4: normalization (older documents may predate slips/formResearch) -----

export function normalizeCase(c: CaseRecord): CaseRecord {
  // heal duplicate threads created before thread-adding became idempotent
  const seenThreadIds = new Set<string>();
  const threads = (c.threads ?? []).filter((t) => {
    if (seenThreadIds.has(t.id)) return false;
    seenThreadIds.add(t.id);
    return true;
  });
  return {
    ...c,
    description: c.description ?? "",
    cards: c.cards ?? [],
    slips: c.slips ?? [],
    threads,
    clusters: c.clusters ?? [],
    formResearch: c.formResearch ?? {},
    verdict: c.verdict ?? "",
    status: c.status ?? "open",
  };
}

// ---- V4: slips ---------------------------------------------------------------

export function withSlipAdded(
  c: CaseRecord,
  kind: SlipKind,
  form: string | null,
): CaseRecord {
  const n = c.cards.length + c.slips.length;
  const { x, y } = defaultPosition(n);
  const slip: SlipRecord = {
    id: newId("slip"),
    kind,
    form,
    text: "",
    source: kind === "reference" ? "" : undefined,
    locator: kind === "reference" ? "" : undefined,
    x: x + 40,
    y: y + 40,
    rotation: (Math.random() - 0.5) * 3,
  };
  return { ...c, slips: [...c.slips, slip] };
}

export function withSlipUpdated(
  c: CaseRecord,
  id: string,
  patch: Partial<SlipRecord>,
): CaseRecord {
  return {
    ...c,
    slips: c.slips.map((s) => (s.id === id ? { ...s, ...patch, id: s.id } : s)),
  };
}

/** Say what kind of source a reference slip cites; null = not said (the field is dropped). */
export function withSlipSourceKind(c: CaseRecord, id: string, kind: SourceKind | null): CaseRecord {
  return {
    ...c,
    slips: c.slips.map((s) => {
      if (s.id !== id) return s;
      const { sourceKind: _old, ...rest } = s;
      return kind ? { ...rest, sourceKind: kind } : rest;
    }),
  };
}

export function withSlipRemoved(c: CaseRecord, id: string): CaseRecord {
  return {
    ...c,
    slips: c.slips.filter((s) => s.id !== id),
    threads: c.threads.filter((t) => t.fromCardId !== id && t.toCardId !== id),
    clusters: c.clusters.map((g) => ({
      ...g,
      cardIds: g.cardIds.filter((k) => k !== id),
    })),
  };
}

export function withSlipMoved(c: CaseRecord, id: string, x: number, y: number): CaseRecord {
  return {
    ...c,
    slips: c.slips.map((s) => (s.id === id ? { ...s, x, y } : s)),
  };
}

// ---- V4: form research ---------------------------------------------------------

export function withFormMeaning(c: CaseRecord, lemma: string, meaning: string): CaseRecord {
  const prev = c.formResearch[lemma];
  return {
    ...c,
    formResearch: {
      ...c.formResearch,
      [lemma]: { ...prev, status: prev?.status ?? "open", meaning },
    },
  };
}

export function withFormEstablished(c: CaseRecord, lemma: string, meaning: string): CaseRecord {
  return {
    ...c,
    formResearch: {
      ...c.formResearch,
      [lemma]: { status: "established", meaning, establishedAt: Date.now() },
    },
  };
}

/** Reopen an established form. The server keeps the old meaning as a dated
 *  revision automatically when the next different meaning is established. */
export function withFormReopened(c: CaseRecord, lemma: string): CaseRecord {
  const prev = c.formResearch[lemma];
  if (!prev) return c;
  return {
    ...c,
    status: c.status === "closed" || c.status === "partial" ? "open" : c.status,
    formResearch: {
      ...c.formResearch,
      [lemma]: { ...prev, status: "open" },
    },
  };
}

// ---- V4: completion --------------------------------------------------------------

export interface CaseCompletion {
  /** lemmas that have evidence (a card or slip) on the board */
  evidenced: string[];
  /** evidenced lemmas not yet established */
  pending: string[];
  /** can the verdict be written / case be closed? */
  verdictUnlocked: boolean;
}

export function caseCompletion(
  c: CaseRecord,
  lemmaOfCard: (cardId: string) => string | null,
): CaseCompletion {
  const evidenced = new Set<string>();
  for (const card of c.cards) {
    const l = lemmaOfCard(card.id);
    if (l) evidenced.add(l);
  }
  for (const s of c.slips) if (s.form) evidenced.add(s.form);
  const list = [...evidenced];
  const pending = list.filter((l) => c.formResearch[l]?.status !== "established");
  return {
    evidenced: list,
    pending,
    verdictUnlocked: list.length > 0 && pending.length === 0,
  };
}

/** Close the case: 'closed' if every family form is established, else 'partial'. */
export function withCaseClosed(
  c: CaseRecord,
  verdict: string,
  allFamilyLemmas: string[],
): CaseRecord {
  const allDone =
    allFamilyLemmas.length > 0 &&
    allFamilyLemmas.every((l) => c.formResearch[l]?.status === "established");
  return { ...c, verdict, status: allDone ? "closed" : "partial" };
}

export function withCaseReopened(c: CaseRecord): CaseRecord {
  return { ...c, status: "open" };
}


// ---- V6: ayah cases ----------------------------------------------------------

/** Find an existing case for a whole ayah, or create one (the ayah itself
 *  is pinned as the first evidence card). */
export async function openOrCreateAyahCase(verseKey: string): Promise<CaseRecord> {
  const all = await archive.cases.all();
  const existing = all.find(
    (c) => c.subject.type === "ayah" && c.subject.value === verseKey,
  );
  if (existing) return normalizeCase(existing);

  const now = Date.now();
  const rec: CaseRecord = {
    id: newId("case"),
    subject: { type: "ayah", value: verseKey, sparkVerseKey: verseKey },
    title: `The ayah ${verseKey}`,
    cards: [
      {
        id: `ev_${verseKey}_0`,
        verseKey,
        wordPosition: null,
        x: 30,
        y: 30,
        rotation: 0,
      },
    ],
    slips: [],
    threads: [],
    clusters: [],
    formResearch: {},
    verdict: "",
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
  await archive.cases.save(rec);
  return rec;
}

// ---- V6: segment highlights ----------------------------------------------------

/** Paint (or erase, when color is null) a word-range highlight on a card.
 *  Overlapping older ranges are trimmed away. */
export function withCardHighlighted(
  c: CaseRecord,
  cardId: string,
  start: number,
  end: number,
  color: string | null,
): CaseRecord {
  const [a, b] = start <= end ? [start, end] : [end, start];
  return {
    ...c,
    cards: c.cards.map((card) => {
      if (card.id !== cardId) return card;
      const kept: HighlightRange[] = [];
      for (const h of card.highlights ?? []) {
        if (h.end < a || h.start > b) { kept.push(h); continue; }
        // trim the non-overlapping remainders of the old range
        if (h.start < a) kept.push({ ...h, end: a - 1 });
        if (h.end > b) kept.push({ ...h, start: b + 1 });
      }
      if (color) kept.push({ start: a, end: b, color });
      return { ...card, highlights: kept };
    }),
  };
}

// ---- V6: auto-arrange -----------------------------------------------------------

const ARR_X0 = 30, ARR_Y0 = 30, ARR_COL_W = 360, ARR_FALLBACK_H = 200, ARR_COLS = 4,
  ARR_ROW_GAP = 64, ARR_GROUP_GAP = 96;

function verseSort(key: string, wordPosition: number | null): number {
  const [ch, v] = key.split(":").map((n) => parseInt(n, 10) || 0);
  return ch * 1_000_000 + v * 1_000 + (wordPosition ?? 0);
}

/** Tidy the board: cards grouped by word form (mushaf order inside each
 *  group), slips placed after the group they are tagged/threaded to. */
export function arrangeBoard(
  c: CaseRecord,
  occById: Map<string, RootOccurrence>,
  heightOf?: (id: string) => number | undefined,
): CaseRecord {
  // group cards by lemma; non-occurrence ayah evidence goes to its own group
  const groups = new Map<string, EvidenceCardRecord[]>();
  for (const card of c.cards) {
    const lemma = occById.get(card.id)?.lemma_arabic ?? "\u0000other";
    const list = groups.get(lemma) ?? [];
    list.push(card);
    groups.set(lemma, list);
  }
  const ordered = [...groups.entries()]
    .map(([lemma, cards]) => ({
      lemma,
      cards: cards.slice().sort(
        (x, y) => verseSort(x.verseKey, x.wordPosition) - verseSort(y.verseKey, y.wordPosition),
      ),
    }))
    .sort(
      (g1, g2) =>
        verseSort(g1.cards[0].verseKey, g1.cards[0].wordPosition) -
        verseSort(g2.cards[0].verseKey, g2.cards[0].wordPosition),
    );

  // slips: tagged to a form → that group; threaded to a card → that card's group
  const groupOfCard = new Map<string, string>();
  for (const g of ordered) for (const card of g.cards) groupOfCard.set(card.id, g.lemma);
  const slipGroup = new Map<string, string>();
  for (const slip of c.slips) {
    if (slip.form && groups.has(slip.form)) { slipGroup.set(slip.id, slip.form); continue; }
    const th = c.threads.find(
      (t) =>
        (t.fromCardId === slip.id && groupOfCard.has(t.toCardId)) ||
        (t.toCardId === slip.id && groupOfCard.has(t.fromCardId)),
    );
    if (th) {
      const other = th.fromCardId === slip.id ? th.toCardId : th.fromCardId;
      slipGroup.set(slip.id, groupOfCard.get(other)!);
    }
  }

  // A cluster is the reader's OWN grouping, so it outranks the by-form default: if any
  // clusters exist, their members are laid out together and in cluster order, and only
  // what is left over falls back to form grouping. Otherwise the board would scatter
  // the very grouping the reader just made.
  const clusterOf = new Map<string, string>();
  for (const g of c.clusters) {
    for (const id of g.cardIds) if (!clusterOf.has(id)) clusterOf.set(id, g.id);
  }
  const clusterBlocks: string[][] = c.clusters
    .map((g) => {
      const memberCards = c.cards
        .filter((k) => clusterOf.get(k.id) === g.id)
        .sort((x, y2) => verseSort(x.verseKey, x.wordPosition) - verseSort(y2.verseKey, y2.wordPosition))
        .map((k) => k.id);
      const memberSlips = c.slips.filter((sl) => clusterOf.get(sl.id) === g.id).map((sl) => sl.id);
      return [...memberCards, ...memberSlips];
    })
    .filter((ids) => ids.length > 0);

  const pos = new Map<string, { x: number; y: number }>();
  let y = ARR_Y0;
  const layoutRow = (ids: string[]) => {
    // rows of ARR_COLS; each row is as tall as its tallest MEASURED card,
    // so long ayahs never spill into the row beneath
    for (let r = 0; r < ids.length; r += ARR_COLS) {
      const row = ids.slice(r, r + ARR_COLS);
      row.forEach((id, i) => {
        pos.set(id, { x: ARR_X0 + i * ARR_COL_W, y });
      });
      const rowH = Math.max(
        ...row.map((id) => heightOf?.(id) ?? ARR_FALLBACK_H),
        80,
      );
      y += rowH + ARR_ROW_GAP;
    }
  };
  // clusters first, in the reader's order
  for (const ids of clusterBlocks) {
    layoutRow(ids);
    y += ARR_GROUP_GAP;
  }
  // then whatever is not in a cluster, still grouped by form
  for (const g of ordered) {
    const cardIds = g.cards.map((card) => card.id).filter((id) => !clusterOf.has(id));
    const slipIds = c.slips
      .filter((sl) => slipGroup.get(sl.id) === g.lemma && !clusterOf.has(sl.id))
      .map((sl) => sl.id);
    if (!cardIds.length && !slipIds.length) continue;
    layoutRow([...cardIds, ...slipIds]);
    y += ARR_GROUP_GAP;
  }
  const loose = c.slips
    .filter((sl) => !slipGroup.has(sl.id) && !clusterOf.has(sl.id))
    .map((sl) => sl.id);
  if (loose.length) layoutRow(loose);

  return {
    ...c,
    cards: c.cards.map((card) => ({ ...card, ...pos.get(card.id)!, rotation: 0 })),
    slips: c.slips.map((sl) => ({ ...sl, ...(pos.get(sl.id) ?? { x: sl.x, y: sl.y }), rotation: 0 })),
  };
}

// ---- how many separate āyāt a reading rests on --------------------------------------

export interface AyahsBehind {
  /** lemma → separate āyāt pinned for that form */
  byForm: Map<string, number>;
  /** separate āyāt pinned anywhere in the case */
  all: number;
  /** separate āyāt other than the case's own subject āyah (an āyah case) */
  others: number;
  /** the same three counts for the cards the reader set AGAINST the reading */
  againstByForm: Map<string, number>;
  againstAll: number;
  againstOthers: number;
}

/** Count the separate āyāt behind each form and behind the case. Two cards on one āyah are
 *  one āyah: what matters is how many independent places the reading stands on. Cards set
 *  against the reading are counted apart: they are not what it rests on. */
export function ayahsBehind(c: CaseRecord, lemmaOfCard: (cardId: string) => string | null): AyahsBehind {
  const count = (cards: CaseRecord["cards"]) => {
    const perForm = new Map<string, Set<string>>();
    const all = new Set<string>();
    for (const card of cards) {
      all.add(card.verseKey);
      const lemma = lemmaOfCard(card.id);
      if (!lemma) continue;
      const set = perForm.get(lemma);
      if (set) set.add(card.verseKey);
      else perForm.set(lemma, new Set([card.verseKey]));
    }
    const byForm = new Map<string, number>();
    for (const [lemma, set] of perForm) byForm.set(lemma, set.size);
    const own = c.subject.type === "ayah" && all.has(c.subject.value) ? 1 : 0;
    return { byForm, all: all.size, others: all.size - own };
  };
  const pro = count(c.cards.filter((k) => k.stance !== "against"));
  const con = count(c.cards.filter((k) => k.stance === "against"));
  return { ...pro, againstByForm: con.byForm, againstAll: con.all, againstOthers: con.others };
}

// ---- what a reading rests on: āyāt, the reader's own observations, and cited sources ---------

/** How the reader may describe a cited source. "unsaid" = the reader has not said what kind. */
export type SourceKindOrUnsaid = SourceKind | "unsaid";

/** What each kind of source is called, for a picker and for an export. */
export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  lexicon: "dictionary",
  tafsir: "tafsīr",
  narration: "narration",
  story: "story from outside the Book",
  other: "other source",
};
export const SOURCE_KINDS: SourceKind[] = ["lexicon", "tafsir", "narration", "story", "other"];

export interface RestsOn {
  /** separate āyāt pinned for it (for an āyah case's understanding: other than the āyah itself) */
  ayahs: number;
  /** separate āyāt the reader set against it */
  against: number;
  /** the reader's own comment slips */
  observations: number;
  /** comment slips an AI put on the board (not the reader's own) */
  aiComments: number;
  /** reference slips, by the kind of source the reader said they are */
  references: Record<SourceKindOrUnsaid, number>;
}

/** Which part of a case to count: the whole case, the other āyāt behind an āyah case's own āyah,
 *  or one form (lemma) with the slips tagged to it. */
export type RestsOnScope = "case" | "others" | { form: string };

/** Count what a case, or one form of it, rests on. It only counts: nothing here weighs a kind of
 *  source against another. Empty slips (nothing written yet) are not counted. */
export function restsOn(
  c: CaseRecord,
  lemmaOfCard: (cardId: string) => string | null,
  scope: RestsOnScope,
): RestsOn {
  const behind = ayahsBehind(c, lemmaOfCard);
  const form = typeof scope === "object" ? scope.form : null;
  const ayahs = form !== null ? behind.byForm.get(form) ?? 0 : scope === "others" ? behind.others : behind.all;
  const against = form !== null ? behind.againstByForm.get(form) ?? 0 : scope === "others" ? behind.againstOthers : behind.againstAll;
  const references: Record<SourceKindOrUnsaid, number> = { lexicon: 0, tafsir: 0, narration: 0, story: 0, other: 0, unsaid: 0 };
  let observations = 0;
  let aiComments = 0;
  for (const s of c.slips) {
    if (form !== null && s.form !== form) continue;
    if (s.kind === "comment") {
      if (!s.text.trim()) continue;
      if (s.author === "ai") aiComments++;
      else observations++;
    } else {
      if (!s.text.trim() && !s.source?.trim()) continue;
      references[s.sourceKind ?? "unsaid"]++;
    }
  }
  return { ayahs, against, observations, aiComments, references };
}

const REF_WORDS: Record<SourceKindOrUnsaid, [string, string]> = {
  lexicon: ["dictionary entry", "dictionary entries"],
  tafsir: ["tafsīr", "tafsīrs"],
  narration: ["narration", "narrations"],
  story: ["story from outside the Book", "stories from outside the Book"],
  other: ["other source", "other sources"],
  unsaid: ["reference of a kind not said", "references of a kind not said"],
};

/** The parts of the line, zero counts left out: "12 āyāt", "1 against", "3 of your observations"… */
export function restsOnParts(r: RestsOn, scope: RestsOnScope = "case"): string[] {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const parts: string[] = [];
  if (r.ayahs) parts.push(scope === "others" ? n(r.ayahs, "other āyah", "other āyāt") : n(r.ayahs, "āyah", "āyāt"));
  if (r.against) parts.push(`${r.against} against`);
  if (r.observations) parts.push(r.observations === 1 ? "1 of your observations" : `${r.observations} of your observations`);
  if (r.aiComments) parts.push(n(r.aiComments, "AI comment", "AI comments"));
  for (const k of [...SOURCE_KINDS, "unsaid"] as SourceKindOrUnsaid[]) {
    if (r.references[k]) parts.push(n(r.references[k], REF_WORDS[k][0], REF_WORDS[k][1]));
  }
  return parts;
}

/** "Rests on 12 āyāt · 1 against · 3 of your observations · 2 dictionary entries · 1 tafsīr".
 *  Empty when nothing is pinned or written yet. */
export function restsOnLine(r: RestsOn, scope: RestsOnScope = "case"): string {
  const parts = restsOnParts(r, scope);
  return parts.length ? `Rests on ${parts.join(" · ")}` : "";
}
