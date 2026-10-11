import React from "react";
import type { QuranApi } from "../data/api";
import type { Db } from "../data/db";
import type { Word } from "../types";
import { VerseText } from "./VerseText";
import { useWordSheet } from "./WordSheet";

/**
 * A verse rendered with individually tappable words — the same word sheet
 * (root, wazn, spellings, follow-thread) and notes as the reader, usable
 * anywhere a single āyah is shown (trail, compare card). Navigation actions are
 * delegated to the host so each screen routes correctly for its tab.
 */
export function TappableVerse({
  q,
  research,
  verseKey,
  text,
  words,
  size = 26,
  highlightRoots,
  highlightPositions,
  onOpenRoot,
  onFollowWord,
  onFollowRoot,
  onJumpVerse,
}: {
  q: QuranApi;
  research: Db;
  verseKey: string;
  text: string;
  words: Word[];
  size?: number;
  highlightRoots?: Set<string>;
  highlightPositions?: Set<number>;
  onOpenRoot: (rootBuckwalter: string) => void;
  onFollowWord: (surface: string, label: string) => void;
  onFollowRoot: (rootBuckwalter: string) => void;
  onJumpVerse?: (verseKey: string) => void;
}) {
  const { open, sheet } = useWordSheet({ q, research, onOpenRoot, onFollowWord, onFollowRoot, onJumpVerse });
  return (
    <>
      <VerseText
        text={text}
        words={words}
        size={size}
        highlightRoots={highlightRoots}
        highlightPositions={highlightPositions}
        onWordPress={(w) => open(verseKey, w)}
      />
      {sheet}
    </>
  );
}
