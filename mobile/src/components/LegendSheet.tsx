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
  { glyph: "⋯", color: colors.inkSoft, title: "Āyah actions", desc: "Copy or share the āyah, open related āyāt, pin it as a focus lens (⊙), ★ add/remove Focus, or ⇋ add to a comparison." },
];

// what the word sheet shows when you tap a word
const WORD_SHEET: Mark[] = [
  { glyph: "وزن", color: colors.gold, title: "Wazn — the form", desc: "The word's morphological pattern (فَعَلَ, مُفْعِل, مَفْعُول, اِسْتِفْعَال…), what that form tends to mean, and the root's three radicals. Verbs also show past/present/command and passive." },
  { glyph: "ج", color: colors.ink, title: "Root & meaning", desc: "The word's root — open its full lexicon page (dictionaries, forms, collocations, every occurrence)." },
  { glyph: "⚲", color: colors.inkSoft, title: "Follow this exact word", desc: "Walk every place this exact spelling appears — works for particles and proper names that have no root." },
  { glyph: "⚲", color: colors.inkSoft, title: "Follow the root", desc: "Walk every place the root appears, across all its derived forms." },
];

// study tools that live beyond a single āyah
const TOOLS: Mark[] = [
  { glyph: "★", color: colors.gold, title: "Focus", desc: "Star up to 5 āyāt and 5 roots to keep on your Home screen. Tap a focused āyah there to reopen it with its connections lens." },
  { glyph: "⇋", color: colors.lapis, title: "Compare", desc: "Add āyāt or roots to a named comparison from anywhere — the ⋯ menu, echo & related panels, a root's occurrences, or a trail. Shared roots are colour-linked down the page, and each āyah card carries its global note. Rename, save and switch comparisons in the Compare tab." },
  { glyph: "⚲", color: colors.inkSoft, title: "Trails", desc: "Follow a word or root through every occurrence, stop by stop. Save a trail to resume later; recent trails wait on Home." },
  { glyph: "⌕", color: colors.gold, title: "Expression search", desc: "Long-press a word to start, then tap any words in that āyah to build an expression (e.g. أصحاب النار). Find every āyah where they co-occur — Verbatim (exact wording) or By roots (any inflection)." },
  { glyph: "⇱", color: colors.lapis, title: "Share with… (AI)", desc: "From the āyah ⋯ menu or a root page, send a bundle — Arabic, translation, each root's meaning & derived forms, and your notes — to Gemini or any app. Choose a saved prompt, whether to include the translation, and exactly which dictionaries to attach." },
  { glyph: "▾", color: colors.inkSoft, title: "Sūra list", desc: "Tap the sūra name in the reader header to jump back to the list of sūras." },
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
            <Text style={styles.section}>Margin marks</Text>
            {MARKS.map((m, i) => (
              <View key={`mk${i}`} style={styles.row}>
                <Text style={[styles.glyph, { color: m.color }]}>{m.glyph}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{m.title}</Text>
                  <Text style={styles.rowDesc}>{m.desc}</Text>
                </View>
              </View>
            ))}

            <Text style={styles.section}>Tap a word</Text>
            {WORD_SHEET.map((m, i) => (
              <View key={`ws${i}`} style={styles.row}>
                <Text style={[styles.glyph, { color: m.color }]}>{m.glyph}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{m.title}</Text>
                  <Text style={styles.rowDesc}>{m.desc}</Text>
                </View>
              </View>
            ))}

            <Text style={styles.section}>Focus · Compare · Trails</Text>
            {TOOLS.map((m, i) => (
              <View key={`tl${i}`} style={styles.row}>
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
              <Text style={styles.rowDesc}>Gold word — shares a root with your focus āyah, or a repeated root lit by ↻. In Compare, each shared root has its own colour threaded down the page.</Text>
            </View>
            <View style={styles.row}>
              <Text style={[styles.glyph, { color: colors.lapis, fontSize: 20 }]}>كلمة</Text>
              <Text style={styles.rowDesc}>Blue word — carries a note.</Text>
            </View>

            <Text style={styles.section}>Tips</Text>
            <Text style={styles.tip}>• Tap any word for its wazn (وزن), root, spellings, gloss, and notes.</Text>
            <Text style={styles.tip}>• “⚲ Follow” walks every occurrence of an exact word or a root, stop by stop.</Text>
            <Text style={styles.tip}>• Long-press a word to start an expression, tap more words, then Find every āyah where they co-occur (verbatim or by roots).</Text>
            <Text style={styles.tip}>• Star ★ up to 5 āyāt and roots into Focus — they wait on your Home screen.</Text>
            <Text style={styles.tip}>• “✚ Add to Compare” from any āyah lines them up with roots colour-linked.</Text>
            <Text style={styles.tip}>• “⇱ Share with…” hands an āyah/root (with roots, forms & your notes) to Gemini or any app — pick a saved prompt, translation on/off, and which dictionaries.</Text>
            <Text style={styles.tip}>• Tap the sūra name in the header to open the sūra list.</Text>
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
