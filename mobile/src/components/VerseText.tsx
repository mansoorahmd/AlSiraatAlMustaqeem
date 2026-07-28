import React from "react";
import { StyleSheet, Text } from "react-native";
import type { Word } from "../types";
import { colors, font } from "../theme/tokens";

const hasArabicLetter = (t: string) => /[ء-يٱ-ۓـ]/.test(t);

// Remove ONLY the characters that can't render: Private-Use-Area codepoints
// (font-specific IndoPak waqf glyphs that show as tofu without the original
// font) and zero-width / directional controls. Standard Unicode pause/sajda
// marks (U+0610–U+061A, U+06D6–U+06ED, …) are kept and render normally.
const clean = (t: string) => t.replace(/[\uE000-\uF8FF\u200B-\u200F\uFEFF]/g, "");

/**
 * Arabic verse text, right-to-left, generous line height.
 *
 * If `words` are supplied, the āyah's own script `text` is rendered as flowing,
 * script-accurate text where each word is individually tappable. Pause/sajda
 * marks are preserved (rendered inline, not tappable). Tokens are aligned 1:1 to
 * the word list so a tap always opens the right word; if the counts don't line
 * up (rare, some non-Uthmani scripts) it falls back to plain text so a tap can
 * never open the wrong word.
 */
export function VerseText({
  text,
  words,
  onWordPress,
  size = 28,
  notedPositions,
  highlightRoots,
  highlightPositions,
}: {
  text?: string;
  words?: Word[];
  onWordPress?: (w: Word) => void;
  size?: number;
  notedPositions?: Set<number>;
  highlightRoots?: Set<string>;
  highlightPositions?: Set<number>;
}) {
  const style = [
    styles.arabic,
    {
      fontSize: size,
      lineHeight: Math.round(size * 2.25),
      paddingTop: Math.round(size * 0.3),
      paddingBottom: Math.round(size * 0.55),
    },
  ];

  if (text && words && words.length && onWordPress) {
    const tokens = text.trim().split(/\s+/);
    const aligned = tokens.filter(hasArabicLetter).length === words.length;
    if (aligned) {
      let k = 0;
      return (
        <Text style={style} allowFontScaling>
          {tokens.map((tok, i) => {
            const disp = clean(tok);
            if (!disp) return null; // token was pure PUA/zero-width → nothing to show
            const sep = i < tokens.length - 1 ? " " : "";
            if (hasArabicLetter(tok)) {
              const w = words[k++];
              const lit = !!(w.root && highlightRoots?.has(w.root)) || !!highlightPositions?.has(w.position);
              const noted = notedPositions?.has(w.position);
              return (
                <Text
                  key={i}
                  onPress={() => onWordPress(w)}
                  suppressHighlighting
                  style={lit ? styles.lit : noted ? styles.noted : undefined}
                >
                  {disp + sep}
                </Text>
              );
            }
            // a standalone pause/sajda mark — keep it visible, not tappable
            return <Text key={i}>{disp + sep}</Text>;
          })}
        </Text>
      );
    }
  }

  return (
    <Text style={style} allowFontScaling>
      {clean(text ?? "")}
    </Text>
  );
}

const styles = StyleSheet.create({
  arabic: {
    color: colors.ink,
    writingDirection: "rtl",
    textAlign: "right",
    includeFontPadding: true, // Android: keep room for descenders (mīm tail) & low kasra
    fontFamily: font.arabic, // undefined → system Arabic; set in tokens to use a bundled Quran font
  },
  noted: { color: colors.lapis },
  lit: { color: colors.gold, fontWeight: "600" },
});
