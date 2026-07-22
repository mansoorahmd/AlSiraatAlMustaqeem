import React, { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { QuranApi } from "../data/api";
import type { Echo } from "../types";
import { colors } from "../theme/tokens";

const cnum = (k: string) => Number(k.split(":")[0]);
const COMPARE_CAP = 25; // don't render hundreds of āyāt at once

export function EchoPanel({
  visible,
  onClose,
  verseKey,
  q,
  editionIds,
  onJump,
}: {
  visible: boolean;
  onClose: () => void;
  verseKey: string | null;
  q: QuranApi;
  editionIds: Set<number>;
  onJump: (verseKey: string) => void;
}) {
  const echoes = useMemo<Echo[]>(
    () => (visible && verseKey ? q.verseEchoes(verseKey) : []),
    [visible, verseKey, q],
  );
  const surahName = (vk: string) => q.chapter(cnum(vk))?.name_simple ?? "";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>Repeated phrases · {verseKey}</Text>
            <Pressable onPress={onClose} hitSlop={10}><Text style={styles.done}>Done</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator>
            {echoes.length === 0 && <Text style={styles.empty}>No verbatim repeats in this āyah.</Text>}
            {echoes.map((e, i) => (
              <EchoRow key={i} echo={e} q={q} surahName={surahName} editionIds={editionIds} onJump={onJump} />
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function EchoRow({
  echo,
  q,
  surahName,
  editionIds,
  onJump,
}: {
  echo: Echo;
  q: QuranApi;
  surahName: (vk: string) => string;
  editionIds: Set<number>;
  onJump: (verseKey: string) => void;
}) {
  const [compare, setCompare] = useState(false);

  // fetch the comparison āyāt once, only when expanded (capped) — include the
  // reader's selected translation editions if any are enabled
  const compareRows = useMemo(() => {
    if (!compare) return [];
    return echo.occurrences.slice(0, COMPARE_CAP).map((o) => ({
      verseKey: o.verseKey,
      surah: surahName(o.verseKey),
      text: (q.verse(o.verseKey, { script: "uthmani" })?.text as string) ?? "",
      translations: editionIds.size
        ? q.verseTranslations(o.verseKey).filter((t) => editionIds.has(t.resource_id))
        : [],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compare, echo, editionIds]);
  const extra = echo.occurrences.length - COMPARE_CAP;

  return (
    <View style={styles.echo}>
      <Text style={styles.phrase}>{echo.phrase}</Text>
      <Text style={styles.meta}>
        appears in {echo.occurrences.length} other āyah{echo.occurrences.length === 1 ? "" : "s"}
      </Text>
      <View style={styles.chips}>
        {echo.occurrences.map((o) => (
          <Pressable key={o.verseKey} style={styles.chip} onPress={() => onJump(o.verseKey)}>
            <Text style={styles.chipText}>{o.verseKey} · {surahName(o.verseKey)}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable onPress={() => setCompare((c) => !c)} hitSlop={8}>
        <Text style={styles.compareToggle}>{compare ? "Hide comparison" : "Compare here"}</Text>
      </Pressable>
      {compareRows.map((r) => (
        <View key={r.verseKey} style={styles.compareRow}>
          <Text style={styles.compareKey}>{r.verseKey} · {r.surah}</Text>
          <Text style={styles.compareText}>{r.text}</Text>
          {r.translations.map((t) => (
            <Text key={t.resource_id} style={styles.compareTr}>{t.text}</Text>
          ))}
        </View>
      ))}
      {compare && extra > 0 && <Text style={styles.more}>…and {extra} more</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24, maxHeight: "85%",
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  title: { fontSize: 15, fontWeight: "700", color: colors.ink },
  done: { color: colors.lapis, fontWeight: "600", fontSize: 15 },
  empty: { color: colors.inkSoft, textAlign: "center", paddingVertical: 18 },
  echo: { borderTopWidth: 1, borderTopColor: colors.surfaceAlt, paddingVertical: 12 },
  phrase: { color: colors.ink, fontSize: 24, lineHeight: 42, writingDirection: "rtl", textAlign: "right" },
  meta: { color: colors.inkSoft, fontSize: 12, marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", marginTop: 8 },
  chip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.bg,
    paddingHorizontal: 10, paddingVertical: 5, marginRight: 8, marginBottom: 8,
  },
  chipText: { color: colors.gold, fontSize: 12, fontWeight: "600" },
  compareToggle: { color: colors.lapis, fontSize: 13, marginTop: 2 },
  compareRow: { marginTop: 10, backgroundColor: colors.bg, borderRadius: 8, padding: 10 },
  compareKey: { color: colors.gold, fontSize: 11, fontWeight: "700", textAlign: "right" },
  compareText: { color: colors.ink, fontSize: 20, lineHeight: 36, writingDirection: "rtl", textAlign: "right", marginTop: 2 },
  compareTr: { color: colors.inkSoft, fontSize: 14, lineHeight: 20, marginTop: 6 },
  more: { color: colors.inkSoft, fontSize: 12, marginTop: 8, fontStyle: "italic" },
});
