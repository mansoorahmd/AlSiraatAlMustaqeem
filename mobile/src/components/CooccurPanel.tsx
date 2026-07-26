import React, { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { QuranApi } from "../data/api";
import { VerseText } from "./VerseText";
import { colors } from "../theme/tokens";

const cnum = (k: string) => Number(k.split(":")[0]);
const CAP = 60;

/** Āyāt where two roots co-occur — both roots lit; reveal translations or jump. */
export function CooccurPanel({
  visible,
  onClose,
  a,
  b,
  q,
  editionIds,
  onJump,
  onOpenRoot,
}: {
  visible: boolean;
  onClose: () => void;
  a: { arabic: string; bw: string } | null; // current root
  b: { arabic: string; bw: string } | null; // co-occurring root
  q: QuranApi;
  editionIds: Set<number>;
  onJump: (verseKey: string) => void;
  onOpenRoot: (bw: string) => void;
}) {
  const shared = useMemo<string[]>(() => {
    if (!visible || !a || !b) return [];
    const setA = new Set(q.rootOccurrences(a.bw, "uthmani", 5000).map((o) => o.verse_key));
    const out: string[] = [];
    const seen = new Set<string>();
    for (const o of q.rootOccurrences(b.bw, "uthmani", 5000)) {
      if (setA.has(o.verse_key) && !seen.has(o.verse_key)) { seen.add(o.verse_key); out.push(o.verse_key); }
    }
    return out;
  }, [visible, a, b, q]);

  const surah = (vk: string) => q.chapter(cnum(vk))?.name_simple ?? "";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>
              {a?.arabic} <Text style={styles.plus}>+</Text> {b?.arabic}
            </Text>
            <Pressable onPress={onClose} hitSlop={10}><Text style={styles.done}>Done</Text></Pressable>
          </View>
          <View style={styles.subRow}>
            <Text style={styles.sub}>{shared.length} āyāt where both roots occur</Text>
            {b && (
              <Pressable onPress={() => onOpenRoot(b.bw)}><Text style={styles.openRoot}>open {b.arabic} →</Text></Pressable>
            )}
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
            {shared.length === 0 && <Text style={styles.empty}>No shared āyāt.</Text>}
            {shared.slice(0, CAP).map((vk) => (
              <CoRow key={vk} verseKey={vk} aAr={a!.arabic} bAr={b!.arabic} q={q} editionIds={editionIds} surah={surah(vk)} onJump={onJump} />
            ))}
            {shared.length > CAP && <Text style={styles.more}>…and {shared.length - CAP} more</Text>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function CoRow({
  verseKey, aAr, bAr, q, editionIds, surah, onJump,
}: {
  verseKey: string; aAr: string; bAr: string; q: QuranApi; editionIds: Set<number>;
  surah: string; onJump: (vk: string) => void;
}) {
  const [reveal, setReveal] = useState(false);
  const verse = useMemo(() => q.verse(verseKey, { script: "uthmani", withWords: true }), [verseKey, q]);
  const words = (verse?.words ?? []).filter((w) => w.pos != null);
  const roots = useMemo(() => new Set([aAr, bAr]), [aAr, bAr]);
  const tr = reveal && editionIds.size ? q.verseTranslations(verseKey).filter((t) => editionIds.has(t.resource_id)) : [];

  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={styles.key}>{verseKey} · {surah}</Text>
        <Pressable onPress={() => onJump(verseKey)} hitSlop={8}><Text style={styles.readLink}>read →</Text></Pressable>
      </View>
      <VerseText text={(verse?.text as string) ?? ""} words={words} highlightRoots={roots} onWordPress={() => {}} size={24} />
      <Pressable onPress={() => setReveal((r) => !r)} hitSlop={6}>
        <Text style={styles.reveal}>{reveal ? "hide translation" : "reveal translation"}</Text>
      </Pressable>
      {tr.map((t) => <Text key={t.resource_id} style={styles.tr}>{t.text}</Text>)}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24, maxHeight: "88%",
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 22, color: colors.gold, writingDirection: "rtl" },
  plus: { color: colors.inkSoft, fontSize: 16 },
  done: { color: colors.lapis, fontWeight: "600", fontSize: 15 },
  subRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 2, marginBottom: 6 },
  sub: { color: colors.inkSoft, fontSize: 12 },
  openRoot: { color: colors.lapis, fontSize: 13, fontWeight: "600" },
  empty: { color: colors.inkSoft, textAlign: "center", paddingVertical: 18 },
  row: { borderTopWidth: 1, borderTopColor: colors.surfaceAlt, paddingVertical: 10 },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  key: { color: colors.gold, fontWeight: "700", fontSize: 12 },
  readLink: { color: colors.lapis, fontSize: 13, fontWeight: "600" },
  reveal: { color: colors.lapis, fontSize: 13, marginTop: 4 },
  tr: { color: colors.inkSoft, fontSize: 13, lineHeight: 19, marginTop: 5 },
  more: { color: colors.inkSoft, fontSize: 12, fontStyle: "italic", marginTop: 8 },
});
