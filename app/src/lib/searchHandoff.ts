// A screen that sends the reader to Search for one of its modes (Supplications → "Check wording")
// names the mode here, then opens the Search tab, which takes it once.

export type SearchMode = "phrase" | "related" | "grammar" | "wording";

let pending: SearchMode | null = null;

/** Ask the Search screen to open in this mode (call, then switch to the "search" tab). */
export function offerSearchMode(mode: SearchMode): void {
  pending = mode;
}

/** Look at the asked-for mode without taking it (safe in a state initialiser). */
export function peekSearchMode(): SearchMode | null {
  return pending;
}

/** Take the asked-for mode, if any; it is handed over only once. */
export function takeSearchMode(): SearchMode | null {
  const m = pending;
  pending = null;
  return m;
}
