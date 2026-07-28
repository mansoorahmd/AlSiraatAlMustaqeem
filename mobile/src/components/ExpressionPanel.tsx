import React, { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { QuranApi } from "../data/api";
import type { Db } from "../data/db";
import type { Word } from "../types";
import type { ExprTerm, ExprMode } from "../data/expressions";
import { VerseText } from "./VerseText";
import { useWordSheet } from "./WordSheet";
import { colors, font } from "../theme/tokens";

const cnum = (k: string) => Number(k.split(":")[0]);
type WordActions = {
  research: Db;
  onOpenRoot: (bw: string) => void;
  onFollowWord: (surface: string, label: string) => void;
  onFollowRoot: (bw: string) => void;
};

/** Results for a user-picked expression: every āyah where the chosen words
 *  co-occur, with a Verbatim / By-roots toggle. */
export function ExpressionPanel({
  visible,
  terms,
  q,
  editionIds,
  onClose,
  onJump,
  onAddCompare,
  actions,
}: {
  visible: boolean;
  terms: ExprTerm[];
  q: QuranApi;
  editionIds: Set<number>;
  onClose: () => void;
  onJump: (verseKey: string) => void;
  onAddCompare?: (verseKey: string) => void;
  actions: WordActions;
}) {
  const [mode, setMode] = useState<ExprMode>("verbatim");
  const anyRoots = terms.some((t) => t.rootBuckwalter);

  const hits = useMemo(
    () => (visible && terms.length ? q.expressionSearch(terms, mode, 300) : []),
    [visible, terms, mode, q],
  );
  const surah = (vk: string) => q.chapter(cnum(vk))?.name_simple ?? "";
  const trFor = (vk: string) =>
    editionIds.size ? q.verseTranslations(vk).filter((t) => editionIds.has(t.resource_id)) : [];
  const wordsFor = (vk: string) => ((q.verse(vk, { script: "uthmani", withWords: true })?.words ?? []) as Word[]).filter((w) => w.pos != null);
  const ws = useWordSheet({ q, research: actions.research, onOpenRoot: actions.onOpenRoot, onFollowWord: actions.onFollowWord, onFollowRoot: actions.onFollowRoot, onJumpVerse: onJump });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>Expression</Text>
            <Pressable onPress={onClose} hitSlop={10}><Text style={styles.done}>Done</Text></Pressable>
          </View>

          <View style={styles.termsRow}>
            {terms.map((t, i) => <Text key={i} style={styles.term}>{t.surface}</Text>)}
          </View>

          <View style={styles.toggle}>
            <Pressable style={[styles.tog, mode === "verbatim" && styles.togOn]} onPress={() => setMode("verbatim")}>
              <Text style={[styles.togText, mode === "verbatim" && styles.togTextOn]}>Verbatim</Text>
            </Pressable>
            <Pressable
              style={[styles.tog, mode === "roots" && styles.togOn, !anyRoots && styles.togDisabled]}
              disabled={!anyRoots}
              onPress={() => setMode("roots")}
            >
              <Text style={[styles.togText, mode === "roots" && styles.togTextOn]}>By roots</Text>
            </Pressable>
          </View>

          <Text style={styles.sub}>
            {hits.length} āyah{hits.length === 1 ? "" : "s"} where {mode === "roots" ? "these roots" : "these words"} co-occur
          </Text>

          <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
            {hits.map((h) => (
              <View key={h.verse_key} style={styles.row}>
                <Pressable onPress={() => onJump(h.verse_key)}>
                  <Text style={styles.key}>{h.verse_key} · {surah(h.verse_key)}  →</Text>
                </Pressable>
                <VerseText text={h.text} words={wordsFor(h.verse_key)} size={20} onWordPress={(w) => ws.open(h.verse_key, w)} />
                {trFor(h.verse_key).map((t) => <Text key={t.resource_id} style={styles.tr}>{t.text}</Text>)}
                {!!onAddCompare && (
                  <Pressable onPress={() => onAddCompare(h.verse_key)} hitSlop={8}>
                    <Text style={styles.addCompare}>✚ Add to Compare</Text>
                  </Pressable>
                )}
              </View>
            ))}
            {hits.length === 0 && <Text style={styles.empty}>No āyah contains all of these together.</Text>}
          </ScrollView>
        </View>
      </View>
      {ws.sheet}
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
  title: { fontSize: 15, fontWeight: "700", color: colors.ink },
  done: { color: colors.lapis, fontWeight: "600", fontSize: 15 },
  termsRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 8, gap: 8 },
  term: { color: colors.gold, fontSize: 20, fontFamily: font.arabic, writingDirection: "rtl" },
  toggle: { flexDirection: "row", marginTop: 12, backgroundColor: colors.surfaceAlt, borderRadius: 10, padding: 3 },
  tog: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  togOn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  togDisabled: { opacity: 0.4 },
  togText: { color: colors.inkSoft, fontSize: 14, fontWeight: "600" },
  togTextOn: { color: colors.ink },
  sub: { color: colors.inkSoft, fontSize: 12, marginTop: 10, marginBottom: 4 },
  row: { borderTopWidth: 1, borderTopColor: colors.surfaceAlt, paddingVertical: 10 },
  key: { color: colors.gold, fontWeight: "700", fontSize: 12 },
  tr: { color: colors.inkSoft, fontSize: 13, lineHeight: 19, marginTop: 5 },
  addCompare: { color: colors.lapis, fontSize: 13, fontWeight: "600", marginTop: 8 },
  empty: { color: colors.inkSoft, textAlign: "center", paddingVertical: 20 },
});
