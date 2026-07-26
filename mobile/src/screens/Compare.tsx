import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/types";
import { useQuran } from "../state/DbContext";
import {
  clearCompare, getPref, listCompare, removeCompare, type CompareItem,
} from "../data/research";
import { colors } from "../theme/tokens";

type Props = NativeStackScreenProps<RootStackParamList, "Compare">;
const cnum = (k: string) => Number(k.split(":")[0]);
const parseEditions = (p: string | null) =>
  p == null ? new Set([20, 54]) : new Set(p ? p.split(",").map(Number).filter((n) => !Number.isNaN(n)) : []);

export default function Compare({ navigation }: Props) {
  const { q, research } = useQuran();
  const nav = navigation as any;
  const [items, setItems] = useState<CompareItem[]>([]);
  const [editionIds, setEditionIds] = useState<Set<number>>(new Set());

  useFocusEffect(useCallback(() => {
    setItems(listCompare(research));
    setEditionIds(parseEditions(getPref(research, "editions")));
  }, [research]));

  const drop = (id: number) => { removeCompare(research, id); setItems(listCompare(research)); };
  const clearAll = () => { clearCompare(research); setItems([]); };

  if (items.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Compare</Text>
        <Text style={styles.emptyText}>
          Pin āyāt (⋯ → Add to Compare) and roots (⇋ Compare on a root page) to line them up side by
          side — ideal for near-synonyms and parallel passages.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.bar}>
        <Text style={styles.barText}>{items.length} pinned</Text>
        <Pressable onPress={clearAll}><Text style={styles.clear}>Clear all</Text></Pressable>
      </View>
      <ScrollView horizontal contentContainerStyle={{ padding: 12 }} showsHorizontalScrollIndicator>
        {items.map((it) => (
          <View key={it.id} style={styles.col}>
            <View style={styles.colHead}>
              <Text style={styles.colKind}>{it.kind === "ayah" ? "ĀYAH" : "ROOT"}</Text>
              <Pressable onPress={() => drop(it.id)} hitSlop={8}><Text style={styles.x}>✕</Text></Pressable>
            </View>
            {it.kind === "ayah"
              ? <AyahColumn vk={it.ref} q={q} editionIds={editionIds} onOpen={() => nav.navigate("ReadTab", { screen: "Reader", params: { chapterId: cnum(it.ref), focusVerseKey: it.ref } })} />
              : <RootColumn bw={it.ref} q={q} onOpen={() => nav.navigate("RootsTab", { screen: "RootDetail", params: { root: it.ref } })} />}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function AyahColumn({ vk, q, editionIds, onOpen }: { vk: string; q: any; editionIds: Set<number>; onOpen: () => void }) {
  const v = q.verse(vk, { script: "uthmani" });
  const surah = q.chapter(cnum(vk))?.name_simple ?? "";
  const tr = editionIds.size ? q.verseTranslations(vk).filter((t: any) => editionIds.has(t.resource_id)) : [];
  return (
    <ScrollView style={{ flex: 1 }}>
      <Text style={styles.key}>{vk} · {surah}</Text>
      <Text style={styles.arabic}>{(v?.text as string) ?? ""}</Text>
      {tr.map((t: any) => <Text key={t.resource_id} style={styles.tr}>{t.text}</Text>)}
      <Pressable onPress={onOpen}><Text style={styles.open}>Read →</Text></Pressable>
    </ScrollView>
  );
}

function RootColumn({ bw, q, onOpen }: { bw: string; q: any; onOpen: () => void }) {
  const d = q.root(bw);
  const links = q.rootLinkages(bw, { limit: 6, sortBy: "count" });
  if (!d) return <Text style={styles.tr}>—</Text>;
  const meanings = (d.meanings ?? []).filter((m: any) => m.language === "en").slice(0, 3);
  return (
    <ScrollView style={{ flex: 1 }}>
      <Text style={styles.rootAr}>{d.root_arabic}</Text>
      <Text style={styles.rootMeta}>{d.total_occurrences} occ · {d.forms.length} forms</Text>
      {!!d.meaning_en && <Text style={styles.rootGloss}>{d.meaning_en}</Text>}
      {meanings.map((m: any, i: number) => (
        <View key={i} style={{ marginTop: 8 }}>
          <Text style={styles.src}>{m.source}</Text>
          <Text style={styles.tr}>{m.meaning}</Text>
        </View>
      ))}
      {links.length > 0 && (
        <>
          <Text style={styles.src}>keeps company with</Text>
          <Text style={styles.company}>{links.map((l: any) => `${l.root_arabic} (${l.cooccur})`).join("  ·  ")}</Text>
        </>
      )}
      <Pressable onPress={onOpen}><Text style={styles.open}>Open root →</Text></Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, padding: 28 },
  emptyTitle: { color: colors.ink, fontSize: 20, fontWeight: "700", marginBottom: 8 },
  emptyText: { color: colors.inkSoft, fontSize: 15, lineHeight: 22, textAlign: "center" },
  bar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  barText: { color: colors.inkSoft, fontSize: 13, fontWeight: "600" },
  clear: { color: colors.danger, fontSize: 13, fontWeight: "600" },
  col: { width: 300, marginRight: 12, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12 },
  colHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  colKind: { color: colors.inkSoft, fontSize: 10, fontWeight: "700", letterSpacing: 0.8 },
  x: { color: colors.inkSoft, fontSize: 16 },
  key: { color: colors.gold, fontSize: 12, fontWeight: "700", textAlign: "right" },
  arabic: { color: colors.ink, fontSize: 24, lineHeight: 46, writingDirection: "rtl", textAlign: "right", marginTop: 4 },
  tr: { color: colors.inkSoft, fontSize: 14, lineHeight: 21, marginTop: 8 },
  rootAr: { color: colors.gold, fontSize: 40, writingDirection: "rtl", textAlign: "center" },
  rootMeta: { color: colors.inkSoft, fontSize: 12, textAlign: "center", marginTop: 4 },
  rootGloss: { color: colors.ink, fontSize: 15, fontStyle: "italic", textAlign: "center", marginTop: 6 },
  src: { color: colors.inkSoft, fontSize: 11, fontWeight: "700", marginTop: 10 },
  company: { color: colors.gold, fontSize: 15, writingDirection: "rtl", textAlign: "right", marginTop: 4, lineHeight: 26 },
  open: { color: colors.lapis, fontSize: 14, fontWeight: "600", marginTop: 14 },
});
