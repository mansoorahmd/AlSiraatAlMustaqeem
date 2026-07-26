import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/tokens";

interface Mark { glyph: string; color: string; title: string; desc: string; }

const MARKS: Mark[] = [
  { glyph: "≡", color: colors.gold, title: "Verbatim echo", desc: "This exact phrase recurs word-for-word elsewhere in the Book. Tap to see every place and compare them inline." },
  { glyph: "✍", color: colors.amberStrong, title: "Spelling variant", desc: "A word here is written more than one way across the mushaf (e.g. إبراهيم with a full vs small yāʾ). Tap to see the spellings." },
  { glyph: "⚲", color: colors.inkSoft, title: "Rare root", desc: "Contains a root that occurs 25 times or fewer in the whole Qur'an — the most distinctive vocabulary." },
  { glyph: "↻", color: colors.gold, title: "Root echo", desc: "The same root repeats within this one āyah — often for emphasis or as a cognate accusative (مفعول مطلق) like نَصْرًا نَصَرَ. A bright gold ↻ marks a tight, adjacent repeat; a faint one marks a root echoed elsewhere in the āyah. Tap to light up every repeated root in place." },
  { glyph: "⊙", color: colors.gold, title: "In focus", desc: "Matches the āyah you've pinned as a focus lens; its shared roots light up gold. Tap for why it matches." },
  { glyph: "✎", color: colors.lapis, title: "Notes & questions", desc: "You've attached a note or question here (the number is the count). Tap to read, answer, or add." },
  { glyph: "⋯", color: colors.inkSoft, title: "Āyah actions", desc: "Copy or share the āyah, open related āyāt, or pin it as a focus lens." },
];

export function LegendSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>Reading the marks</Text>
            <Pressable onPress={onClose} hitSlop={10}><Text style={styles.done}>Done</Text></Pressable>
          </View>
          <Text style={styles.intro}>
            The Book rewards an observant eye. These faint marks flag things worth a closer look —
            none are required reading; follow the ones that catch your attention.
          </Text>
          <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
            {MARKS.map((m) => (
              <View key={m.glyph} style={styles.row}>
                <Text style={[styles.glyph, { color: m.color }]}>{m.glyph}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{m.title}</Text>
                  <Text style={styles.rowDesc}>{m.desc}</Text>
                </View>
              </View>
            ))}

            <Text style={styles.section}>Word colours</Text>
            <View style={styles.row}>
              <Text style={[styles.glyph, { color: colors.gold, fontSize: 20 }]}>كلمة</Text>
              <Text style={styles.rowDesc}>Gold word — shares a root with your focus āyah.</Text>
            </View>
            <View style={styles.row}>
              <Text style={[styles.glyph, { color: colors.lapis, fontSize: 20 }]}>كلمة</Text>
              <Text style={styles.rowDesc}>Blue word — carries a note.</Text>
            </View>

            <Text style={styles.section}>Tips</Text>
            <Text style={styles.tip}>• Tap any word for its root, spellings, gloss, and notes.</Text>
            <Text style={styles.tip}>• “⚲ Follow the thread” walks every occurrence of a root.</Text>
            <Text style={styles.tip}>• The ⚙ menu holds script, size, word-by-word, and translations.</Text>
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
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24, maxHeight: "88%",
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 16, fontWeight: "700", color: colors.ink },
  done: { color: colors.lapis, fontWeight: "600", fontSize: 15 },
  intro: { color: colors.inkSoft, fontSize: 13, lineHeight: 19, marginTop: 6, marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.surfaceAlt },
  glyph: { fontSize: 22, width: 40, textAlign: "center" },
  rowTitle: { color: colors.ink, fontSize: 15, fontWeight: "600" },
  rowDesc: { color: colors.inkSoft, fontSize: 13, lineHeight: 19, flex: 1 },
  section: { color: colors.inkSoft, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 16, marginBottom: 4 },
  tip: { color: colors.ink, fontSize: 14, lineHeight: 22 },
});
