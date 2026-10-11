// A right-hand side-sheet that slides in over the canvas. The board stays visible and
// interactive beside it. Closes on the ×, on Escape, or on a backdrop click.

import { useEffect, type ReactNode } from "react";

interface Props {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  /** wider sheet for list-heavy panels (evidence, dossier) */
  wide?: boolean;
  children: ReactNode;
}

export function SideSheet({ open, title, onClose, wide, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="sheet-backdrop" onMouseDown={onClose}>
      <aside
        className={`side-sheet${wide ? " wide" : ""}`}
        role="dialog"
        aria-modal="false"
        aria-label={typeof title === "string" ? title : undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="side-sheet-head">
          <span className="side-sheet-title">{title}</span>
          <button className="ctl side-sheet-close" title="Close (Esc)" aria-label="Close" onClick={onClose}>✕</button>
        </header>
        <div className="side-sheet-body">{children}</div>
      </aside>
    </div>
  );
}
