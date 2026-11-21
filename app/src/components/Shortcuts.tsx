// Global keyboard shortcuts. Ignored while typing in a field.
//   g then a letter → a screen (GOTO below; the command palette lists them all by name)
//   j / k           → next / previous āyah in the reader

import { useEffect, useRef } from "react";
import { useAppDispatch, type Tab } from "../state/store";

/** g + key → screen. One letter per screen, the first free letter of its name. */
export const GOTO: Record<string, Tab> = {
  h: "home",         // Home
  r: "read",         // Read
  s: "search",       // Search
  i: "investigate",  // Investigate
  o: "roots",        // rOots
  x: "links",        // Rare links (eXclusive markers)
  l: "mylinks",      // My Links
  m: "motifs",       // Motifs
  c: "compare",      // Compare
  v: "vault",        // Vault
  d: "diverge",      // Where I stand apart (Divergences)
  "?": "guide",      // Guide
};

function moveAyah(dir: 1 | -1) {
  const els = Array.from(document.querySelectorAll<HTMLElement>(".reader-sheet .ayah[data-key]"));
  if (!els.length) return;
  const H = 96; // header offset
  if (dir > 0) {
    const next = els.find((el) => el.getBoundingClientRect().top > H + 5);
    next?.scrollIntoView({ block: "start" });
  } else {
    const prevs = els.filter((el) => el.getBoundingClientRect().top < H - 5);
    prevs[prevs.length - 1]?.scrollIntoView({ block: "start" });
  }
}

export function Shortcuts() {
  const dispatch = useAppDispatch();
  const awaitingGoto = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (awaitingGoto.current) {
        awaitingGoto.current = false;
        const tab = GOTO[e.key];
        if (tab) { e.preventDefault(); dispatch({ type: "setTab", tab }); }
        return;
      }
      // "/" and ⌘K open the command palette — handled in CommandPalette, not here
      if (e.key === "g") { awaitingGoto.current = true; window.setTimeout(() => { awaitingGoto.current = false; }, 900); return; }
      if (e.key === "j") { moveAyah(1); return; }
      if (e.key === "k") { moveAyah(-1); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);

  return null;
}
