// Shared verse renderer: correct word-position mapping (annotation marks
// don't count), optional gold highlight, optional word tapping.
// Used by the reader, evidence cards, and the case desk.

import { memo } from "react";
import type { HighlightRange } from "../persistence/types";
import { tokenizeVerse } from "./reader/format";

/** paint highlights as a translucent wash so the text stays fully legible */
function wash(hex: string, alpha = 0.45): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

interface Props {
  text: string;
  /** 1-based word position to ink in gold (the case subject) */
  highlightPosition?: number | null;
  /** if provided, words become tappable */
  onWordTap?: (position: number, token: string, rect: DOMRect) => void;
  /** the reader's own established meaning for this word, if any */
  glossFor?: (position: number) => string | null;
  /** research mark: case in progress, or a rare root worth investigating */
  markFor?: (position: number) => "open" | "rare" | null;
  /** painted segment highlights (board evidence markup) */
  highlightRanges?: HighlightRange[];
  /** focus lens: a word's relation to the pinned case */
  focusFor?: (position: number) => "shared" | "linked" | null;
  /** a word that carries a note or question → gets a small margin dot */
  hasNoteFor?: (position: number) => boolean;
  className?: string;
}

export const VerseText = memo(function VerseText({
  text,
  highlightPosition,
  onWordTap,
  glossFor,
  markFor,
  highlightRanges,
  focusFor,
  hasNoteFor,
  className,
}: Props) {
  const tokens = tokenizeVerse(text);

  return (
    <span className={className} dir="rtl">
      {tokens.map((tok, i) => {
        const isSubject =
          tok.position !== null && tok.position === highlightPosition;
        const gloss = tok.position !== null && glossFor ? glossFor(tok.position) : null;
        const mark = tok.position !== null && markFor ? markFor(tok.position) : null;
        const focus = tok.position !== null && focusFor ? focusFor(tok.position) : null;
        const noted = tok.position !== null && hasNoteFor ? hasNoteFor(tok.position) : false;
        const paint =
          tok.position !== null && highlightRanges
            ? highlightRanges.find(
                (h) => (tok.position as number) >= h.start && (tok.position as number) <= h.end,
              )
            : undefined;
        const cls = [
          tok.position === null ? "verse-mark" : onWordTap ? "word" : undefined,
          isSubject ? "ec-subject" : undefined,
          mark === "open" ? "case-open" : mark === "rare" ? "rare-root" : undefined,
          focus === "shared" ? "focus-shared" : focus === "linked" ? "focus-linked" : undefined,
          noted ? "has-note" : undefined,
          gloss ? "established" : undefined,
        ]
          .filter(Boolean)
          .join(" ") || undefined;

        const tappable = onWordTap && tok.position !== null;
        return (
          <span key={i}>
            <span
              className={cls}
              data-pos={tok.position ?? undefined}
              style={paint ? { backgroundColor: wash(paint.color) } : undefined}
              role={tappable ? "button" : undefined}
              tabIndex={tappable ? 0 : undefined}
              onClick={
                tappable
                  ? (e) =>
                      onWordTap(
                        tok.position as number,
                        tok.text,
                        (e.target as HTMLElement).getBoundingClientRect(),
                      )
                  : undefined
              }
              onKeyDown={
                tappable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onWordTap(
                          tok.position as number,
                          tok.text,
                          (e.target as HTMLElement).getBoundingClientRect(),
                        );
                      }
                    }
                  : undefined
              }
            >
              {gloss ? (
                <span className="word-stack">
                  <span>{tok.text}</span>
                  <span className="my-gloss">{gloss}</span>
                </span>
              ) : (
                tok.text
              )}
            </span>{" "}
          </span>
        );
      })}
    </span>
  );
});
