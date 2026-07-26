import React, { useMemo } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { QuranApi } from "../data/api";
import type { SpellingVariant } from "../data/spellings";
import { colors } from "../theme/tokens";

const cnum = (k: string) => Number(k.split(":")[0]);

/** For a form (lemma): its spelling-variant groups (if any) and the āyāt where
 *  it occurs, each tappable to open in the reader. */
export function FormSpellingPanel({
  visible,
  onClose,
  title,
  lemmaBuckwalter,
  groups,
  q,
  onJump,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  lemmaBuckwalter: string | null;
  groups: SpellingVariant[][];
  q: QuranApi;
  onJump: (verseKey: string) => void;
}) {
  const occs = useMemo(
    () => (visible && lemmaBuckwalter ? q.formOccurrences(lemmaBuckwalter) : []),
    [visible, lemmaBuckwalter, q],
  );
  const surah = (vk: string) => q.chapter(cnum(vk))?.name_simple ?? "";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>Form · {title}</Text>
            <Pressable onPress={onClose} hitSlop={10}><Text style={styles.done}>Done</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
            {groups.length > 0 && (
              <>
                <Text style={styles.section}>✍ written more than one way</Text>
                {groups.map((g, gi) => (
                  <View key={gi} style={styles.group}>
                    {g.map((v, i) => (
                      <View key={i} style={styles.varRow}>
                        <Text style={styles.varArabic}>{v.surface}</Text>
                        <Text style={styles.count}>×{v.count}</Text>
                        <Pressable onPress={() => onJump(v.verses[0]!)} hitSlop={8}>
                          <Text style={styles.jump}>{v.verses[0]} →</Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                ))}
              </>
            )}

            <Text style={styles.section}>Occurrences ({occs.length})</Text>
            {occs.map((o) => (
              <Pressable key={o.verse_key} style={styles.occ} onPress={() => onJump(o.verse_key)}>
                <Text style={styles.occKey}>{o.verse_key} · {surah(o.verse_key)}</Text>
                <Text style={styles.occText} numberOfLines={2}>{o.verse_text ?? ""}</Text>
              </Pressable>
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
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24, maxHeight: "85%",
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 18, color: colors.gold, writingDirection: "rtl" },
  done: { color: colors.lapis, fontWeight: "600", fontSize: 15 },
  section: { color: colors.inkSoft, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 14, marginBottom: 6 },
  group: { borderTopWidth: 1, borderTopColor: colors.surfaceAlt, paddingVertical: 8 },
  varRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  varArabic: { color: colors.ink, fontSize: 26, writingDirection: "rtl", flex: 1 },
  count: { color: colors.inkSoft, fontSize: 13, marginHorizontal: 10 },
  jump: { color: colors.lapis, fontSize: 13, fontWeight: "600" },
  occ: { borderTopWidth: 1, borderTopColor: colors.surfaceAlt, paddingVertical: 9 },
  occKey: { color: colors.gold, fontSize: 11, fontWeight: "700", textAlign: "right" },
  occText: { color: colors.ink, fontSize: 19, lineHeight: 34, writingDirection: "rtl", textAlign: "right", marginTop: 2 },
});
