import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/types";
import type { Word } from "../types";
import { useQuran } from "../state/DbContext";
import {
  clearCompare, getPref, listCompare, removeCompare, type CompareItem,
} from "../data/research";
import { colors, font } from "../theme/tokens";

type Props = NativeStackScreenProps<RootStackParamList, "Compare">;
const cnum = (k: string) => Number(k.split(":")[0]);
const parseEditions = (p: string | null) =>
  p == null ? new Set([20, 54]) : new Set(p ? p.split(",").map(Number).filter((n) => !Number.isNaN(n)) : []);

// distinct, readable-on-light "lanes" — each shared root gets one, and the colour
// recurs wherever that root reappears down the page (the git-tree linkage).
const PALETTE = ["#B7791F", "#2563A6", "#9B2C6E", "#2C8A57", "#A6432E", "#6D4AA6", "#1F7A8C", "#8A6D1F"];

const hasArabicLetter = (t: string) => /[ء-يٱ-ۓـ]/.test(t);
const clean = (t: string) => t.replace(/[\uE000-\uF8FF\u200B-\u200F\uFEFF]/g, "");

export default function Compare({ navigation }: Props) {
  const { q, research } = useQuran();
  const nav = navigation as any;
  const [items, setItems] = useState<CompareItem[]>([]);
  const [editionIds, setEditionIds] = useState<Set<number>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  useFocusEffect(useCallback(() => {
    setItems(listCompare(research));
    setEditionIds(parseEditions(getPref(research, "editions")));
  }, [research]));

  const drop = (id: number) => { removeCompare(research, id); setItems(listCompare(research)); };
  const clearAll = () => { clearCompare(research); setItems([]); };
  const toggle = (id: number) =>
    setCollapsed((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // roots present in each pinned item → which recur across items (the shared "threads")
  const analysis = useMemo(() => {
    const rootsPerItem = items.map((it) => {
      const set = new Set<string>();
      if (it.kind === "ayah") {
        const v = q.verse(it.ref, { script: "uthmani", withWords: true });
        for (const w of (v?.words ?? []) as Word[]) if (w.root) set.add(w.root);
      } else {
        const d = q.root(it.ref);
        if (d?.root_arabic) set.add(d.root_arabic);
      }
      return set;
    });
    const count = new Map<string, number>();
    for (const s of rootsPerItem) for (const r of s) count.set(r, (count.get(r) ?? 0) + 1);
    const shared = [...count.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]);
    const colorOf = new Map<string, string>();
    shared.forEach(([r], i) => colorOf.set(r, PALETTE[i % PALETTE.length]!));
    return { rootsPerItem, shared, colorOf };
  }, [items, q]);

  if (items.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Compare</Text>
        <Text style={styles.emptyText}>
          Pin āyāt (⋯ → Add to Compare) and roots (⇋ Compare on a root page) to line them up as a
          thread — shared roots are colour-linked down the page so parallels leap out.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.bar}>
        <Text style={styles.barText}>{items.length} pinned · {analysis.shared.length} shared root{analysis.shared.length === 1 ? "" : "s"}</Text>
        <Pressable onPress={clearAll}><Text style={styles.clear}>Clear all</Text></Pressable>
      </View>

      {analysis.shared.length > 0 && (
        <View style={styles.legend}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, alignItems: "center" }}>
            <Text style={styles.legendLabel}>threads</Text>
            {analysis.shared.map(([r, c]) => (
              <View key={r} style={styles.chip}>
                <View style={[styles.swatch, { backgroundColor: analysis.colorOf.get(r) }]} />
                <Text style={[styles.chipRoot, { color: analysis.colorOf.get(r) }]}>{r}</Text>
                <Text style={styles.chipCount}>×{c}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      <ScrollView contentContainerStyle={{ paddingVertical: 8, paddingRight: 12 }}>
        {items.map((it, i) => {
          const isCollapsed = collapsed.has(it.id);
          const mine = analysis.rootsPerItem[i]!;
          const prev = i > 0 ? analysis.rootsPerItem[i - 1]! : null;
          const sharedWithPrev = prev
            ? [...mine].filter((r) => prev.has(r) && analysis.colorOf.has(r))
            : [];
          const nodeShared = [...mine].some((r) => analysis.colorOf.has(r));
          const first = i === 0;
          const last = i === items.length - 1;
          return (
            <View key={it.id} style={styles.row}>
              {/* spine */}
              <View style={styles.gutter}>
                <View style={[styles.line, first && styles.lineHalfTop, last && styles.lineHalfBottom]} />
                <View style={[styles.node, { borderColor: nodeShared ? colors.gold : colors.border }]} />
              </View>
              {/* card */}
              <View style={styles.card}>
                {sharedWithPrev.length > 0 && (
                  <View style={styles.mergeRow}>
                    <Text style={styles.mergeText}>shares with above</Text>
                    {sharedWithPrev.slice(0, 8).map((r) => (
                      <View key={r} style={[styles.dot, { backgroundColor: analysis.colorOf.get(r) }]} />
                    ))}
                  </View>
                )}
                <Pressable style={styles.cardHead} onPress={() => toggle(it.id)}>
                  <Text style={styles.caret}>{isCollapsed ? "▸" : "▾"}</Text>
                  <Text style={styles.kind}>{it.kind === "ayah" ? "ĀYAH" : "ROOT"}</Text>
                  <Text style={styles.cardKey} numberOfLines={1}>
                    {it.kind === "ayah" ? `${it.ref} · ${q.chapter(cnum(it.ref))?.name_simple ?? ""}` : (q.root(it.ref)?.root_arabic ?? it.ref)}
                  </Text>
                  <Pressable onPress={() => drop(it.id)} hitSlop={8}><Text style={styles.x}>✕</Text></Pressable>
                </Pressable>

                {isCollapsed ? (
                  <CollapsedPreview it={it} q={q} editionIds={editionIds} />
                ) : it.kind === "ayah" ? (
                  <AyahBody
                    vk={it.ref} q={q} editionIds={editionIds} colorOf={analysis.colorOf}
                    onOpen={() => nav.navigate("ReadTab", { screen: "Reader", params: { chapterId: cnum(it.ref), focusVerseKey: it.ref } })}
                  />
                ) : (
                  <RootBody
                    bw={it.ref} q={q} color={analysis.colorOf.get(q.root(it.ref)?.root_arabic ?? "")}
                    onOpen={() => nav.navigate("RootsTab", { screen: "RootDetail", params: { root: it.ref } })}
                  />
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Arabic verse where each word whose root is a shared thread is coloured with
 *  that thread's colour; other words stay in ink. Aligned 1:1 to word tokens. */
function ColoredVerse({ text, words, colorOf, size = 25 }: { text: string; words: Word[]; colorOf: Map<string, string>; size?: number }) {
  const style = [styles.arabic, { fontSize: size, lineHeight: size * 2.0 }];
  const tokens = text.trim().split(/\s+/);
  const aligned = tokens.filter(hasArabicLetter).length === words.length;
  if (!aligned) return <Text style={style}>{clean(text)}</Text>;
  let k = 0;
  return (
    <Text style={style}>
      {tokens.map((tok, i) => {
        const disp = clean(tok);
        if (!disp) return null;
        const sep = i < tokens.length - 1 ? " " : "";
        if (!hasArabicLetter(tok)) return <Text key={i}>{disp + sep}</Text>;
        const w = words[k++]!;
        const c = w.root ? colorOf.get(w.root) : undefined;
        return <Text key={i} style={c ? { color: c, fontWeight: "600" } : undefined}>{disp + sep}</Text>;
      })}
    </Text>
  );
}

function AyahBody({ vk, q, editionIds, colorOf, onOpen }: { vk: string; q: any; editionIds: Set<number>; colorOf: Map<string, string>; onOpen: () => void }) {
  const v = q.verse(vk, { script: "uthmani", withWords: true });
  const words = ((v?.words ?? []) as Word[]).filter((w) => w.pos != null);
  const tr = editionIds.size ? q.verseTranslations(vk).filter((t: any) => editionIds.has(t.resource_id)) : [];
  return (
    <View style={styles.body}>
      <ColoredVerse text={(v?.text as string) ?? ""} words={words} colorOf={colorOf} />
      {tr.map((t: any) => (
        <View key={t.resource_id} style={styles.trWrap}>
          <Text style={styles.tr}>{t.text}</Text>
          <Text style={styles.trBy}>— {t.resource_name ?? t.language_name}</Text>
        </View>
      ))}
      <Pressable onPress={onOpen}><Text style={styles.open}>Read →</Text></Pressable>
    </View>
  );
}

function RootBody({ bw, q, color, onOpen }: { bw: string; q: any; color?: string; onOpen: () => void }) {
  const d = q.root(bw);
  if (!d) return <Text style={styles.tr}>—</Text>;
  const links = q.rootLinkages(bw, { limit: 6, sortBy: "count" });
  const meanings = (d.meanings ?? []).filter((m: any) => m.language === "en").slice(0, 2);
  return (
    <View style={styles.body}>
      <Text style={[styles.rootAr, color ? { color } : undefined]}>{d.root_arabic}</Text>
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
    </View>
  );
}

function CollapsedPreview({ it, q, editionIds }: { it: CompareItem; q: any; editionIds: Set<number> }) {
  let preview = "";
  if (it.kind === "ayah") {
    const tr = editionIds.size ? q.verseTranslations(it.ref).filter((t: any) => editionIds.has(t.resource_id)) : [];
    preview = tr[0]?.text ?? clean((q.verse(it.ref, { script: "uthmani" })?.text as string) ?? "");
  } else {
    const d = q.root(it.ref);
    preview = d?.meaning_en ?? `${d?.total_occurrences ?? ""} occurrences`;
  }
  return <Text style={styles.preview} numberOfLines={1}>{preview}</Text>;
}

const GUTTER = 30;
const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, padding: 28 },
  emptyTitle: { color: colors.ink, fontSize: 20, fontWeight: "700", marginBottom: 8 },
  emptyText: { color: colors.inkSoft, fontSize: 15, lineHeight: 22, textAlign: "center" },
  bar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  barText: { color: colors.inkSoft, fontSize: 13, fontWeight: "600" },
  clear: { color: colors.danger, fontSize: 13, fontWeight: "600" },

  legend: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.surfaceAlt, backgroundColor: colors.surface },
  legendLabel: { color: colors.inkSoft, fontSize: 10, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginRight: 10 },
  chip: { flexDirection: "row", alignItems: "center", marginRight: 12 },
  swatch: { width: 9, height: 9, borderRadius: 2, marginRight: 5 },
  chipRoot: { fontSize: 16, writingDirection: "rtl", fontWeight: "600" },
  chipCount: { color: colors.inkSoft, fontSize: 11, marginLeft: 3 },

  row: { flexDirection: "row" },
  gutter: { width: GUTTER, alignItems: "center" },
  line: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: colors.border, left: GUTTER / 2 - 1 },
  lineHalfTop: { top: 22 },
  lineHalfBottom: { bottom: undefined, height: 22 },
  node: { width: 12, height: 12, borderRadius: 6, borderWidth: 2.5, backgroundColor: colors.bg, marginTop: 16 },

  card: { flex: 1, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginVertical: 6, marginLeft: 2, padding: 12 },
  mergeRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  mergeText: { color: colors.inkSoft, fontSize: 10, letterSpacing: 0.4, marginRight: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 4 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  caret: { color: colors.inkSoft, fontSize: 13, width: 14 },
  kind: { color: colors.inkSoft, fontSize: 9, fontWeight: "700", letterSpacing: 0.8 },
  cardKey: { flex: 1, color: colors.gold, fontSize: 13, fontWeight: "700" },
  x: { color: colors.inkSoft, fontSize: 15 },
  preview: { color: colors.inkSoft, fontSize: 13, marginTop: 6 },

  body: { marginTop: 8 },
  arabic: { color: colors.ink, writingDirection: "rtl", textAlign: "right", fontFamily: font.arabic },
  trWrap: { marginTop: 10, borderTopWidth: 1, borderTopColor: colors.surfaceAlt, paddingTop: 8 },
  tr: { color: colors.inkSoft, fontSize: 14, lineHeight: 21 },
  trBy: { color: colors.inkSoft, fontSize: 11, marginTop: 2, opacity: 0.7 },
  rootAr: { color: colors.gold, fontSize: 38, writingDirection: "rtl", textAlign: "center" },
  rootMeta: { color: colors.inkSoft, fontSize: 12, textAlign: "center", marginTop: 4 },
  rootGloss: { color: colors.ink, fontSize: 15, fontStyle: "italic", textAlign: "center", marginTop: 6 },
  src: { color: colors.inkSoft, fontSize: 11, fontWeight: "700", marginTop: 10 },
  company: { color: colors.gold, fontSize: 15, writingDirection: "rtl", textAlign: "right", marginTop: 4, lineHeight: 26 },
  open: { color: colors.lapis, fontSize: 14, fontWeight: "600", marginTop: 14 },
});
