import React, { useRef } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { QuranApi } from "../data/api";
import type { Db } from "../data/db";
import type { CompositeMatch, Word } from "../types";
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

/**
 * Closest-first list of āyāt related to a base āyah (composite similarity).
 * Used for the "Related āyāt" action and the focus lens "connections" map.
 */
export function RelatedPanel({
  visible,
  onClose,
  title,
  matches,
  q,
  editionIds,
  baseKey,
  onJump,
  onAddCompare,
  actions,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  matches: CompositeMatch[];
  q: QuranApi;
  editionIds: Set<number>;
  baseKey?: string;
  onJump: (verseKey: string) => void;
  onAddCompare?: (verseKey: string) => void;
  actions: WordActions;
}) {
  const ws = useWordSheet({ q, research: actions.research, onOpenRoot: actions.onOpenRoot, onFollowWord: actions.onFollowWord, onFollowRoot: actions.onFollowRoot, onJumpVerse: onJump });
  const surah = (vk: string) => q.chapter(cnum(vk))?.name_simple ?? "";
  const trFor = (vk: string) =>
    editionIds.size ? q.verseTranslations(vk).filter((t) => editionIds.has(t.resource_id)) : [];
  const wordCache = useRef(new Map<string, Word[]>());
  const wordsFor = (vk: string) => {
    const hit = wordCache.current.get(vk);
    if (hit) return hit;
    const ws = ((q.verse(vk, { script: "uthmani", withWords: true })?.words ?? []) as Word[]).filter((w) => w.pos != null);
    wordCache.current.set(vk, ws);
    return ws;
  };
  const base = visible && baseKey ? q.verse(baseKey, { script: "uthmani", withWords: true }) : undefined;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10}><Text style={styles.done}>Done</Text></Pressable>
          </View>
          <Text style={styles.sub}>{matches.length} related āyāt · closest first</Text>
          <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
            {!!base && baseKey && (
              <View style={styles.baseCard}>
                <Text style={styles.baseKey}>base · {baseKey} · {surah(baseKey)}</Text>
                <VerseText text={(base.text as string) ?? ""} words={((base.words ?? []) as Word[]).filter((w) => w.pos != null)} size={22} onWordPress={(w) => ws.open(baseKey, w)} />
                {trFor(baseKey).map((t) => <Text key={t.resource_id} style={styles.tr}>{t.text}</Text>)}
                {!!onAddCompare && (
                  <Pressable onPress={() => onAddCompare(baseKey)} hitSlop={8}>
                    <Text style={styles.addCompare}>✚ Add to Compare</Text>
                  </Pressable>
                )}
              </View>
            )}
            {matches.map((m) => (
              <View key={m.verse_key} style={styles.row}>
                <Pressable onPress={() => onJump(m.verse_key)}>
                  <View style={styles.rowHead}>
                    <Text style={styles.key}>{m.verse_key} · {surah(m.verse_key)}  →</Text>
                    <Text style={styles.score}>{m.score.toFixed(3)}</Text>
                  </View>
                </Pressable>
                <VerseText text={m.text ?? ""} words={wordsFor(m.verse_key)} size={19} onWordPress={(w) => ws.open(m.verse_key, w)} />
                {trFor(m.verse_key).map((t) => <Text key={t.resource_id} style={styles.tr}>{t.text}</Text>)}
                {m.phrase_run && m.phrase_run.length > 0 && (
                  <Text style={styles.phrase}>phrase: {m.phrase_run.join(" ")}</Text>
                )}
                {m.shared.length > 0 && (
                  <Text style={styles.shared}>shared roots: {m.shared.join("  ")}</Text>
                )}
                {!!onAddCompare && (
                  <Pressable onPress={() => onAddCompare(m.verse_key)} hitSlop={8}>
                    <Text style={styles.addCompare}>✚ Add to Compare</Text>
                  </Pressable>
                )}
              </View>
            ))}
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
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24, maxHeight: "85%",
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 15, fontWeight: "700", color: colors.ink },
  done: { color: colors.lapis, fontWeight: "600", fontSize: 15 },
  sub: { color: colors.inkSoft, fontSize: 12, marginTop: 2, marginBottom: 6 },
  row: { borderTopWidth: 1, borderTopColor: colors.surfaceAlt, paddingVertical: 10 },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  key: { color: colors.gold, fontWeight: "700", fontSize: 12 },
  score: { color: colors.inkSoft, fontSize: 11 },
  text: { color: colors.ink, fontSize: 20, lineHeight: 36, writingDirection: "rtl", textAlign: "right", marginTop: 3 },
  tr: { color: colors.inkSoft, fontSize: 13, lineHeight: 19, marginTop: 5 },
  baseCard: { backgroundColor: colors.amber, borderRadius: 10, padding: 12, marginVertical: 8 },
  baseKey: { color: colors.ink, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  baseText: { color: colors.ink, fontSize: 22, lineHeight: 42, writingDirection: "rtl", textAlign: "right" },
  phrase: { color: colors.gold, fontSize: 16, lineHeight: 30, writingDirection: "rtl", textAlign: "right", marginTop: 4, fontFamily: font.arabic },
  shared: { color: colors.lapis, fontSize: 15, lineHeight: 28, writingDirection: "rtl", textAlign: "right", marginTop: 3, fontFamily: font.arabic },
  addCompare: { color: colors.lapis, fontSize: 13, fontWeight: "600", marginTop: 8 },
});
