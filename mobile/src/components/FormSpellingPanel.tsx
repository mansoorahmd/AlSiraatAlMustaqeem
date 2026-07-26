import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { SpellingVariant } from "../data/spellings";
import { colors } from "../theme/tokens";

/** Shows a form's (lemma's) spelling-variant groups — each group is one
 *  word/inflection written more than one way, with counts and jumps. */
export function FormSpellingPanel({
  visible,
  onClose,
  title,
  groups,
  onJump,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  groups: SpellingVariant[][];
  onJump: (verseKey: string) => void;
}) {
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
            {groups.length === 0 ? (
              <Text style={styles.empty}>This form is written the same way throughout the mushaf.</Text>
            ) : (
              <>
                <Text style={styles.sub}>✍ written more than one way in the mushaf</Text>
                {groups.map((g, gi) => (
                  <View key={gi} style={styles.group}>
                    {g.map((v, i) => (
                      <View key={i} style={styles.row}>
                        <Text style={styles.arabic}>{v.surface}</Text>
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
  title: { fontSize: 18, color: colors.gold, writingDirection: "rtl" },
  done: { color: colors.lapis, fontWeight: "600", fontSize: 15 },
  sub: { color: colors.inkSoft, fontSize: 12, marginTop: 2, marginBottom: 6 },
  empty: { color: colors.inkSoft, textAlign: "center", paddingVertical: 20, lineHeight: 20 },
  group: { borderTopWidth: 1, borderTopColor: colors.surfaceAlt, paddingVertical: 8 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  arabic: { color: colors.ink, fontSize: 26, writingDirection: "rtl", flex: 1 },
  count: { color: colors.inkSoft, fontSize: 13, marginHorizontal: 10 },
  jump: { color: colors.lapis, fontSize: 13, fontWeight: "600" },
});
