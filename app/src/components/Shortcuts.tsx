// Global keyboard shortcuts. Ignored while typing in a field.
//   /            → jump to Search
//   g then h/r/s/i/v/o → Home / Read / Search / Investigate / Vault / rOots
//   j / k        → next / previous ayah in the reader

import { useEffect, useRef } from "react";
import { useAppDispatch, type Tab } from "../state/store";

const GOTO: Record<string, Tab> = {
  h: "home", r: "read", s: "search", i: "investigate", v: "vault", o: "roots",
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
      if (e.key === "/") { e.preventDefault(); dispatch({ type: "setTab", tab: "search" }); return; }
      if (e.key === "g") { awaitingGoto.current = true; window.setTimeout(() => { awaitingGoto.current = false; }, 900); return; }
      if (e.key === "j") { moveAyah(1); return; }
      if (e.key === "k") { moveAyah(-1); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);

  return null;
}
