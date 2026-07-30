// Wazn (صرف pattern) of a word — the morphological "measure" its shape carries,
// derived from the corpus morphology tags (verb_form I–XII, derivation, aspect,
// voice) and mapped to the canonical Arabic template. We show the root's
// radicals beside the template rather than fabricate a surface form.
// Ported from the mobile app's data/wazn.ts.

import type { Db } from "./db.js";

export interface Wazn {
  kind: "verb" | "active-participle" | "passive-participle" | "verbal-noun";
  form: string;
  wazn: string | null;
  label: string;
  sense?: string;
  aspect?: string;
  voice?: string;
  radicals?: string[];
}

const VERB: Record<string, string> = {
  I: "فَعَلَ", II: "فَعَّلَ", III: "فَاعَلَ", IV: "أَفْعَلَ", V: "تَفَعَّلَ",
  VI: "تَفَاعَلَ", VII: "اِنْفَعَلَ", VIII: "اِفْتَعَلَ", IX: "اِفْعَلَّ",
  X: "اِسْتَفْعَلَ", XI: "اِفْعَالَّ", XII: "اِفْعَوْعَلَ",
};
const ACT: Record<string, string> = {
  I: "فَاعِل", II: "مُفَعِّل", III: "مُفَاعِل", IV: "مُفْعِل", V: "مُتَفَعِّل",
  VI: "مُتَفَاعِل", VII: "مُنْفَعِل", VIII: "مُفْتَعِل", IX: "مُفْعَلّ",
  X: "مُسْتَفْعِل", XI: "مُفْعَالّ", XII: "مُفْعَوْعِل",
};
const PASS: Record<string, string> = {
  I: "مَفْعُول", II: "مُفَعَّل", III: "مُفَاعَل", IV: "مُفْعَل", V: "مُتَفَعَّل",
  VI: "مُتَفَاعَل", VII: "مُنْفَعَل", VIII: "مُفْتَعَل", IX: "مُفْعَلّ",
  X: "مُسْتَفْعَل", XI: "مُفْعَالّ", XII: "مُفْعَوْعَل",
};
const MASDAR: Record<string, string> = {
  II: "تَفْعِيل", III: "مُفَاعَلَة", IV: "إِفْعَال", V: "تَفَعُّل", VI: "تَفَاعُل",
  VII: "اِنْفِعَال", VIII: "اِفْتِعَال", IX: "اِفْعِلَال", X: "اِسْتِفْعَال",
  XI: "اِفْعِيلَال", XII: "اِفْعِيعَال",
};
const SENSE: Record<string, string> = {
  I: "the base form",
  II: "intensive, or causative (to make something do)",
  III: "associative — doing something to or with another",
  IV: "causative — to bring about the action",
  V: "reflexive of Form II — the effect turning back on the doer",
  VI: "mutual, reciprocal action between parties",
  VII: "medio-passive — to become or undergo",
  VIII: "reflexive of Form I — doing the act for oneself",
  IX: "colours and bodily conditions",
  X: "to seek, ask for, or deem something to be",
  XI: "intensive of colours",
  XII: "intensive",
};

const romanOf = (verbForm: string | null | undefined) =>
  verbForm ? verbForm.replace(/[()]/g, "").trim() : "I";

const radicalsOf = (rootArabic: string | null | undefined) => {
  const letters = (rootArabic ?? "").replace(/[^ء-ي]/g, "");
  return [...letters].length === 3 ? [...letters] : undefined;
};

const aspectLabel = (a: string | null | undefined) =>
  a === "PERF" ? "past (perfect)" : a === "IMPF" ? "present (imperfect)" : a === "IMPV" ? "command (imperative)" : undefined;

export interface WordMorph {
  pos_english: string | null;
  pos: string | null;
  verb_form: string | null;
  derivation: string | null;
  verb_aspect: string | null;
  verb_voice: string | null;
  root_arabic: string | null;
}

export function describeWazn(m: WordMorph): Wazn | null {
  const form = romanOf(m.verb_form);
  const radicals = radicalsOf(m.root_arabic);
  const der = m.derivation;

  if (der === "ACT PCPL") {
    return {
      kind: "active-participle", form, wazn: ACT[form] ?? ACT.I!,
      label: `Active participle · اسم فاعل${form !== "I" ? ` (Form ${form})` : ""}`,
      sense: "the one who does the action", radicals,
    };
  }
  if (der === "PASS PCPL") {
    return {
      kind: "passive-participle", form, wazn: PASS[form] ?? PASS.I!,
      label: `Passive participle · اسم مفعول${form !== "I" ? ` (Form ${form})` : ""}`,
      sense: "the one/thing the action is done to", radicals,
    };
  }
  if (der === "VN") {
    return {
      kind: "verbal-noun", form, wazn: form === "I" ? null : (MASDAR[form] ?? null),
      label: `Verbal noun · مصدر${form !== "I" ? ` (Form ${form})` : ""}`,
      sense: form === "I" ? "the act itself (Form I — pattern is not fixed)" : "the act itself", radicals,
    };
  }
  const isVerb = m.pos === "V" || (m.pos_english ?? "").toLowerCase().includes("verb");
  if (isVerb) {
    return {
      kind: "verb", form, wazn: VERB[form] ?? VERB.I!,
      label: `Form ${form} verb`,
      sense: SENSE[form],
      aspect: aspectLabel(m.verb_aspect),
      voice: m.verb_voice === "PASS" ? "passive" : undefined,
      radicals,
    };
  }
  return null;
}

export function waznForWord(db: Db, verseKey: string, wordPosition: number): Wazn | null {
  const m = db.one<WordMorph>(
    `SELECT pos_english, pos, verb_form, derivation, verb_aspect, verb_voice, root_arabic
     FROM word_segments
     WHERE verse_key = ? AND word_position = ? AND segment_type = 'STEM'
     ORDER BY segment_number LIMIT 1`,
    [verseKey, wordPosition],
  );
  return m ? describeWazn(m) : null;
}
