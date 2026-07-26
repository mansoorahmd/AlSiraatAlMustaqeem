import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Word } from "../types";
import { colors, font } from "../theme/tokens";

/**
 * Word-by-word layout: each word shows its Arabic form over its gloss, laid out
 * right-to-left. Tapping a word raises it (for the root sheet).
 */
export function WordGrid({
  words,
  onWordPress,
  showGloss = true,
  arabicSize = 26,
  notedPositions,
  highlightRoots,
}: {
  words: Word[];
  onWordPress?: (w: Word) => void;
  showGloss?: boolean;
  arabicSize?: number;
  notedPositions?: Set<number>;
  highlightRoots?: Set<string>;
}) {
  return (
    <View style={styles.row}>
      {words.map((w) => {
        const noted = notedPositions?.has(w.position);
        const lit = !!(w.root && highlightRoots?.has(w.root));
        return (
        <Pressable
          key={w.position}
          onPress={() => onWordPress?.(w)}
          style={({ pressed }) => [styles.word, pressed && styles.pressed]}
        >
          <Text style={[styles.arabic, { fontSize: arabicSize }, noted && styles.noted, lit && styles.lit]}>{w.arabic ?? "—"}</Text>
          {showGloss && !!w.gloss && <Text style={styles.gloss}>{w.gloss}</Text>}
          {showGloss && !!w.root && <Text style={styles.root}>{w.root}</Text>}
        </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    alignItems: "flex-start",
  },
  word: {
    alignItems: "center",
    marginHorizontal: 6,
    marginVertical: 6,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 8,
  },
  pressed: { backgroundColor: colors.amber },
  arabic: { color: colors.ink, writingDirection: "rtl", fontFamily: font.arabic },
  noted: { color: colors.lapis },
  lit: { color: colors.gold, fontWeight: "600" },
  gloss: { color: colors.inkSoft, fontSize: 11, marginTop: 2, maxWidth: 90, textAlign: "center" },
  root: { color: colors.gold, fontSize: 12, marginTop: 1, writingDirection: "rtl" },
});
