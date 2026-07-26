import React, { useMemo } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { QuranApi } from "../data/api";
import { colors } from "../theme/tokens";

/** Lists the word(s) in an āyah that are written more than one way in the
 *  mushaf, each with its spellings, counts, and a jump to an example. */
export function VariantPanel({
  visible,
  onClose,
  verseKey,
  q,
  onJump,
}: {
  visible: boolean;
  onClose: () => void;
  verseKey: string | null;
  q: QuranApi;
  onJump: (verseKey: string) => void;
}) {
  const items = useMemo(() => {
    if (!visible || !verseKey) return [];
    const words = q.verseWords(verseKey);
    return q.variantWords(verseKey).map((pos) => ({
      pos,
      arabic: words.find((w) => w.position === pos)?.arabic ?? "",
      gloss: words.find((w) => w.position === pos)?.gloss ?? "",
      variants: q.spellingVariants(verseKey, pos),
    })).filter((it) => it.variants.length > 1);
  }, [visible, verseKey, q]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>✍ Spelling in this āyah · {verseKey}</Text>
            <Pressable onPress={onClose} hitSlop={10}><Text style={styles.done}>Done</Text></Pressable>
          </View>
          <Text style={styles.sub}>Words written more than one way across the mushaf</Text>
          <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
            {items.length === 0 && <Text style={styles.empty}>No variant words here.</Text>}
            {items.map((it) => (
              <View key={it.pos} style={styles.word}>
                <Text style={styles.wordArabic}>{it.arabic}{it.gloss ? `  ·  ${it.gloss}` : ""}</Text>
                {it.variants.map((v, i) => (
                  <View key={i} style={styles.varRow}>
                    <Text style={styles.varArabic}>{v.surface}</Text>
                    <Text style={styles.varCount}>×{v.count}</Text>
                    <Pressable onPress={() => onJump(v.verses[0]!)} hitSlop={8}>
                      <Text style={styles.varJump}>{v.verses[0]} →</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24, maxHeight: "80%",
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 15, fontWeight: "700", color: colors.ink },
  done: { color: colors.lapis, fontWeight: "600", fontSize: 15 },
  sub: { color: colors.inkSoft, fontSize: 12, marginTop: 2, marginBottom: 6 },
  empty: { color: colors.inkSoft, textAlign: "center", paddingVertical: 18 },
  word: { borderTopWidth: 1, borderTopColor: colors.surfaceAlt, paddingVertical: 10 },
  wordArabic: { color: colors.gold, fontSize: 18, writingDirection: "rtl", textAlign: "right", marginBottom: 6 },
  varRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  varArabic: { color: colors.ink, fontSize: 26, writingDirection: "rtl", flex: 1 },
  varCount: { color: colors.inkSoft, fontSize: 13, marginHorizontal: 10 },
  varJump: { color: colors.lapis, fontSize: 13, fontWeight: "600" },
});
