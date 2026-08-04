// Comparison operations — a comparison is a named, saved board of pinned āyāt
// and roots studied side by side. Pins always land in the *active* comparison,
// chosen from anywhere an āyah or root is shown ("✚ Add to Compare"). The active
// comparison's id is a device-local pref; the sets & items live in research.db.

import { archive, newId } from "../persistence/db";
import type { CompareSet } from "../api/types";

const ACTIVE_KEY = "activeCompareSet";

export const compareTitle = (s: CompareSet | undefined | null): string =>
  s?.title?.trim() || "Untitled comparison";

export async function setActiveCompare(id: string): Promise<void> {
  await archive.prefs.set(ACTIVE_KEY, id);
}

/** Create a new comparison and make it active. Returns its id. */
export async function createCompare(title = ""): Promise<string> {
  const id = newId("cmp");
  await archive.compare.saveSet({ id, title });
  await setActiveCompare(id);
  return id;
}

/** The active comparison's id — reusing a stored one if it still exists,
 *  else the most-recently-touched, else a fresh "Untitled" one. */
export async function ensureActiveCompare(): Promise<string> {
  const sets = await archive.compare.sets();
  const stored = await archive.prefs.get<string>(ACTIVE_KEY);
  if (stored && sets.some((s) => s.id === stored)) return stored;
  const latest = sets[0]; // sets come most-recently-touched first
  if (latest) {
    await setActiveCompare(latest.id);
    return latest.id;
  }
  return createCompare();
}

/** Add an āyah or root to the active comparison. Returns the comparison's title
 *  and whether the item was newly added (false = it was already pinned). */
export async function addToActiveCompare(
  kind: "ayah" | "root",
  ref: string,
  label: string | null = null,
): Promise<{ title: string; added: boolean; setId: string }> {
  const setId = await ensureActiveCompare();
  const before = await archive.compare.items(setId);
  const already = before.some((i) => i.kind === kind && i.ref === ref);
  if (!already) await archive.compare.addItem(setId, { id: newId("cmpi"), kind, ref, label });
  const set = (await archive.compare.sets()).find((s) => s.id === setId);
  return { title: compareTitle(set), added: !already, setId };
}
