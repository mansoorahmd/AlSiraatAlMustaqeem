// Plan features — what each plan may USE. Every feature belongs to one of three groups, and each
// has its own rule (resource_access kind 'feature', key = the feature), so a maintainer decides in
// Admin → Access what is Public, Free or on a tier (or with `npm run access -- feature <key> …`).
//
//   read      read-assist tools: the text, search, roots, trails, echoes …  (default: free)
//   interact  the reader's own study: notes, indications, meanings, motifs  (default: pro)
//   research  cases, publishing, the community, the AI assistant            (default: pro)
//
// How a rule is enforced depends on the feature:
//   • read-assist tools are corpus READS: a /corpus request answers 401/402 by its feature's rule
//     (featureForCorpus). Meanings and translations ride inside other answers too, so a locked one
//     is also filtered out of those (corpus/serve.ts).
//   • interaction and research features are the reader's own records: a locked feature is
//     READ-ONLY — what they made stays visible, but nothing new is written (featureForResearch
//     looks only at writes).
//
// Plans say what you may use; ROLES still say what you may do (publish needs both).
// A new feature needs a line here (and its routes in the maps below) — nothing in the database.

export const FEATURE_GROUPS = [
  { key: "read", label: "Read-assist tools" },
  { key: "interact", label: "Interaction features" },
  { key: "research", label: "Research & publication" },
] as const;
export type FeatureGroup = (typeof FEATURE_GROUPS)[number]["key"];

export const FEATURES = [
  // read-assist tools
  { key: "text", group: "read", label: "Qur'an text", description: "every surah, its scripts and word-by-word grammar" },
  { key: "translations", group: "read", label: "Translations", description: "translations under each āyah" },
  { key: "search", group: "read", label: "Search", description: "searching by word, phrase or expression" },
  { key: "roots", group: "read", label: "Roots", description: "a word's root and all its forms" },
  { key: "meanings", group: "read", label: "Dictionary meanings", description: "the classical lexicons' entries for a root" },
  { key: "follow-root", group: "read", label: "Follow root", description: "a thread through every occurrence of a root" },
  { key: "follow-word", group: "read", label: "Follow word", description: "a thread through every occurrence of one spelling" },
  { key: "echoes", group: "read", label: "Echoes", description: "phrases repeated elsewhere in the Book" },
  { key: "similar", group: "read", label: "Similar āyāt", description: "āyāt that resemble this one" },
  { key: "spelling", group: "read", label: "Spelling variants", description: "words written more than one way" },
  { key: "wazn", group: "read", label: "Word pattern", description: "each word's pattern (wazn)" },
  { key: "linkages", group: "read", label: "Where roots meet", description: "roots that keep company, and where two occur together" },
  { key: "lens", group: "read", label: "Āyah lens", description: "the focus map around an āyah" },
  { key: "compare", group: "read", label: "Compare", description: "forms, roots and āyāt side by side" },
  // interaction
  { key: "notes", group: "interact", label: "Notes & questions", description: "notes and open questions on āyāt and words" },
  { key: "indications", group: "interact", label: "Indications", description: "your indications, refinements, and the Vault of established roots" },
  { key: "my-meanings", group: "interact", label: "My meanings", description: "your own meaning for a root" },
  { key: "motifs", group: "interact", label: "Motifs", description: "your root groupings (بيوت)" },
  // research & publication
  { key: "cases", group: "research", label: "Cases", description: "investigations, the evidence board, dossiers and export" },
  { key: "publish", group: "research", label: "Publish", description: "sending your work to the community for review" },
  { key: "community", group: "research", label: "Community readings", description: "the group's established readings" },
  { key: "divergences", group: "research", label: "Where I stand apart", description: "where your reading and the group's differ" },
  { key: "ai", group: "research", label: "AI assistant", description: "tokens for Claude and other AI assistants (MCP)" },
] as const satisfies readonly { key: string; group: FeatureGroup; label: string; description: string }[];

export type PlanFeature = (typeof FEATURES)[number]["key"];
export const FEATURE_KEYS: readonly string[] = FEATURES.map((f) => f.key);
export const isPlanFeature = (v: unknown): v is PlanFeature => typeof v === "string" && FEATURE_KEYS.includes(v);
export const featureLabel = (k: PlanFeature) => FEATURES.find((f) => f.key === k)!.label;

/** The default each feature gets when first seeded (migration 0013). */
export const DEFAULT_MIN: Record<FeatureGroup, string> = { read: "free", interact: "pro", research: "pro" };

/** Which feature a /corpus request uses. `path` is relative to /corpus. Unmatched → "text". */
export function featureForCorpus(method: string, path: string): PlanFeature {
  const p = path.replace(/\/+$/, "") || "/";
  if (/^\/roots\/[^/]+\/(with\/[^/]+|linkages)$/.test(p)) return "linkages";
  if (/^\/roots\/[^/]+\/occurrences$/.test(p)) return "follow-root";
  if (p === "/words/occurrences") return "follow-word";
  if (/^\/roots(\/|$)/.test(p)) return "roots";
  if (p === "/phrase-search" || (method === "POST" && (p === "/search" || p === "/expression-search"))) return "search";
  if (/^\/(chapters|verses)\/[^/]+\/echoes$/.test(p)) return "echoes";
  if (/^\/verses\/[^/]+\/similar$/.test(p)) return "similar";
  if (/^\/chapters\/[^/]+\/variants$/.test(p) || /^\/verses\/[^/]+\/spelling$/.test(p)) return "spelling";
  if (/^\/verses\/[^/]+\/wazn$/.test(p)) return "wazn";
  if (/^\/verses\/[^/]+\/translations$/.test(p) || p === "/translation-resources") return "translations";
  return "text";
}

/**
 * Which feature a WRITE to the reader's research uses (null = none: reads are always allowed, so a
 * locked feature stays readable). `path` is the full path, e.g. /research/notes/n1.
 */
export function featureForResearch(method: string, path: string): PlanFeature | PlanFeature[] | null {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  const seg = path.replace(/^\/research\//, "").split("/");
  switch (seg[0]) {
    case "notes": return "notes";
    case "indications": case "refinements": return "indications";
    case "root-meanings": return "my-meanings";
    case "motifs": return "motifs";
    case "cases": return "cases";
    case "compare-sets": return "compare";
    // a trail is saved by either kind of follow
    case "trails": return ["follow-root", "follow-word"];
    case "proposed": return seg[1] === "indication" ? "indications" : "notes";
    case "proposals": case "submission-log": return "publish";
    default: return null;   // settings: the reader's own preferences
  }
}
