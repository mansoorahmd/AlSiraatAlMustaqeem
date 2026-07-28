import React, { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/types";
import type { Word } from "../types";
import type { Db } from "../data/db";
import { useQuran } from "../state/DbContext";
import {
  clearCompare, createCompareSet, deleteCompareSet, getPref, listCompare, listCompareSets,
  notesForVerse, removeCompare, renameCompareSet, setActiveCompareSet,
  type CompareItem, type CompareSet,
} from "../data/research";
import { NotesPanel, type NoteScope } from "../components/NotesPanel";
import { TappableVerse } from "../components/TappableVerse";
import { colors, font } from "../theme/tokens";

type Props = NativeStackScreenProps<RootStackParamList, "Compare">;
const cnum = (k: string) => Number(k.split(":")[0]);
const parseEditions = (p: string | null) =>
  p == null ? new Set([20, 54]) : new Set(p ? p.split(",").map(Number).filter((n) => !Number.isNaN(n)) : []);
const clean = (t: string) => t.replace(/[\uE000-\uF8FF\u200B-\u200F\uFEFF]/g, "");
const titleOf = (s: CompareSet | undefined | null) => (s?.title?.trim() || "Untitled comparison");

export default function Compare({ navigation }: Props) {
  const { q, research } = useQuran();
  const [sets, setSets] = useState<CompareSet[]>([]);
  const [activeId, setActiveIdState] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const refreshSets = useCallback(() => {
    setSets(listCompareSets(research));
    const a = Number(getPref(research, "activeCompareSet"));
    setActiveIdState(a || null);
  }, [research]);

  useFocusEffect(useCallback(() => { refreshSets(); }, [refreshSets]));

  if (openId != null) {
    return (
      <CompareBoard
        setId={openId}
        q={q}
        research={research}
        isActive={activeId === openId}
        onBack={() => { setOpenId(null); refreshSets(); }}
        onChanged={refreshSets}
        onSetActive={() => { setActiveCompareSet(research, openId); setActiveIdState(openId); }}
        navigation={navigation}
      />
    );
  }

  const newComparison = () => {
    const id = createCompareSet(research, null);
    setActiveCompareSet(research, id);
    setActiveIdState(id);
    refreshSets();
    setOpenId(id);
  };

  const confirmDelete = (s: CompareSet) =>
    Alert.alert("Delete comparison?", `“${titleOf(s)}” and its ${s.count} pinned item${s.count === 1 ? "" : "s"} will be removed.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => { deleteCompareSet(research, s.id); refreshSets(); } },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.bar}>
        <Text style={styles.barTitle}>Comparisons</Text>
        <Pressable onPress={newComparison}><Text style={styles.newBtn}>＋ New</Text></Pressable>
      </View>

      {sets.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No comparisons yet</Text>
          <Text style={styles.emptyText}>
            Tap “✚ Add to Compare” on any āyah — in the reader, echo panel, related āyāt, a root’s
            occurrences, or while following a thread — and it lands in your active comparison.
            Shared roots are pinned atop each card, linked to the āyah above.
          </Text>
          <Pressable style={styles.emptyBtn} onPress={newComparison}>
            <Text style={styles.emptyBtnText}>＋ New comparison</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12 }}>
          {sets.map((s) => (
            <Pressable key={s.id} style={styles.setRow} onPress={() => setOpenId(s.id)}>
              <View style={{ flex: 1 }}>
                <View style={styles.setTitleRow}>
                  <Text style={styles.setTitle} numberOfLines={1}>{titleOf(s)}</Text>
                  {activeId === s.id && <Text style={styles.activeTag}>active</Text>}
                </View>
                <Text style={styles.setMeta}>{s.count} item{s.count === 1 ? "" : "s"} · updated {s.updated_at.slice(0, 10)}</Text>
              </View>
              <Pressable onPress={() => confirmDelete(s)} hitSlop={10} style={{ paddingLeft: 12 }}>
                <Text style={styles.del}>✕</Text>
              </Pressable>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function CompareBoard({
  setId, q, research, isActive, onBack, onChanged, onSetActive, navigation,
}: {
  setId: number; q: any; research: Db; isActive: boolean;
  onBack: () => void; onChanged: () => void; onSetActive: () => void; navigation: any;
}) {
  const nav = navigation as any;
  const [items, setItems] = useState<CompareItem[]>([]);
  const [set, setSet] = useState<CompareSet | undefined>();
  const [editionIds, setEditionIds] = useState<Set<number>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [noteScope, setNoteScope] = useState<NoteScope | null>(null);
  const [notesTick, setNotesTick] = useState(0);

  const reload = useCallback(() => {
    setItems(listCompare(research, setId));
    setEditionIds(parseEditions(getPref(research, "editions")));
    setSet(listCompareSets(research).find((r) => r.id === setId));
  }, [research, setId]);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const drop = (id: number) => { removeCompare(research, id); reload(); onChanged(); };
  const clearAll = () =>
    Alert.alert("Clear all items?", "This empties the comparison but keeps it saved.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: () => { clearCompare(research, setId); reload(); onChanged(); } },
    ]);
  const toggle = (id: number) =>
    setCollapsed((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const saveTitle = () => { renameCompareSet(research, setId, titleDraft.trim()); setEditingTitle(false); reload(); onChanged(); };

  const analysis = useMemo(() => {
    const rootsPerItem = items.map((it) => {
      const s = new Set<string>();
      if (it.kind === "ayah") {
        const v = q.verse(it.ref, { script: "uthmani", withWords: true });
        for (const w of (v?.words ?? []) as Word[]) if (w.root) s.add(w.root);
      } else {
        const d = q.root(it.ref);
        if (d?.root_arabic) s.add(d.root_arabic);
      }
      return s;
    });
    const count = new Map<string, number>();
    for (const s of rootsPerItem) for (const r of s) count.set(r, (count.get(r) ?? 0) + 1);
    const sharedAll = new Set<string>([...count.entries()].filter(([, c]) => c >= 2).map(([r]) => r));
    return { rootsPerItem, sharedAll };
  }, [items, q]);

  const noteCount = (vk: string) => notesForVerse(research, vk).filter((n) => n.word_position == null).length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.boardBar}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ All</Text></Pressable>
        {editingTitle ? (
          <TextInput
            style={styles.titleInput}
            value={titleDraft}
            onChangeText={setTitleDraft}
            placeholder="name this comparison"
            placeholderTextColor={colors.tabInactive}
            autoFocus
            onSubmitEditing={saveTitle}
            onBlur={saveTitle}
            returnKeyType="done"
          />
        ) : (
          <Pressable style={{ flex: 1 }} onPress={() => { setTitleDraft(set?.title ?? ""); setEditingTitle(true); }}>
            <Text style={styles.boardTitle} numberOfLines={1}>{titleOf(set)} ✎</Text>
          </Pressable>
        )}
        {isActive
          ? <Text style={styles.activeTagSm}>active</Text>
          : <Pressable onPress={onSetActive} hitSlop={8}><Text style={styles.setActive}>Set active</Text></Pressable>}
      </View>

      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Empty. Add āyāt or roots with “✚ Add to Compare” from anywhere.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingVertical: 8, paddingRight: 12 }}>
          {items.map((it, i) => {
            const isCollapsed = collapsed.has(it.id);
            const mine = analysis.rootsPerItem[i]!;
            const prev = i > 0 ? analysis.rootsPerItem[i - 1]! : null;
            const sharedWithPrev = prev ? [...mine].filter((r) => prev.has(r)) : [];
            const nodeShared = [...mine].some((r) => analysis.sharedAll.has(r));
            const first = i === 0;
            const last = i === items.length - 1;
            const notes = it.kind === "ayah" ? noteCount(it.ref) : 0;
            return (
              <View key={`${it.id}-${notesTick}`} style={styles.row}>
                <View style={styles.gutter}>
                  <View style={[styles.line, first && styles.lineHalfTop, last && styles.lineHalfBottom]} />
                  <View style={[styles.node, { borderColor: nodeShared ? colors.gold : colors.border }]} />
                </View>
                <View style={styles.card}>
                  {sharedWithPrev.length > 0 && (
                    <View style={styles.mergeRow}>
                      <Text style={styles.mergeText}>shares with above ↑</Text>
                      <View style={styles.mergeChips}>
                        {sharedWithPrev.map((r) => (
                          <Text key={r} style={styles.mergeChip}>{r}</Text>
                        ))}
                      </View>
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
                      vk={it.ref} q={q} research={research} editionIds={editionIds} notes={notes} nav={nav}
                      onNote={() => setNoteScope({ verseKey: it.ref })}
                      onOpen={() => nav.navigate("ReadTab", { screen: "Reader", params: { chapterId: cnum(it.ref), focusVerseKey: it.ref } })}
                    />
                  ) : (
                    <RootBody
                      bw={it.ref} q={q}
                      onOpen={() => nav.navigate("RootsTab", { screen: "RootDetail", params: { root: it.ref } })}
                    />
                  )}
                </View>
              </View>
            );
          })}
          <Pressable onPress={clearAll} style={{ alignSelf: "center", marginTop: 12 }}>
            <Text style={styles.clear}>Clear all items</Text>
          </Pressable>
        </ScrollView>
      )}

      <NotesPanel
        visible={!!noteScope}
        scope={noteScope}
        research={research}
        onClose={() => setNoteScope(null)}
        onChanged={() => setNotesTick((t) => t + 1)}
        onJump={(vk) => { setNoteScope(null); nav.navigate("ReadTab", { screen: "Reader", params: { chapterId: cnum(vk), focusVerseKey: vk } }); }}
      />
    </View>
  );
}

function AyahBody({ vk, q, research, editionIds, notes, nav, onNote, onOpen }: { vk: string; q: any; research: Db; editionIds: Set<number>; notes: number; nav: any; onNote: () => void; onOpen: () => void }) {
  const v = q.verse(vk, { script: "uthmani", withWords: true });
  const words = ((v?.words ?? []) as Word[]).filter((w) => w.pos != null);
  const tr = editionIds.size ? q.verseTranslations(vk).filter((t: any) => editionIds.has(t.resource_id)) : [];
  return (
    <View style={styles.body}>
      <TappableVerse
        q={q}
        research={research}
        verseKey={vk}
        text={(v?.text as string) ?? ""}
        words={words}
        size={25}
        onOpenRoot={(bw) => nav.navigate("RootsTab", { screen: "RootDetail", params: { root: bw } })}
        onFollowWord={(surface, lbl) => nav.navigate("ReadTab", { screen: "Trail", params: { word: surface, label: lbl } })}
        onFollowRoot={(bw) => nav.navigate("ReadTab", { screen: "Trail", params: { root: bw } })}
        onJumpVerse={(k) => nav.navigate("ReadTab", { screen: "Reader", params: { chapterId: cnum(k), focusVerseKey: k } })}
      />
      {tr.map((t: any) => (
        <View key={t.resource_id} style={styles.trWrap}>
          <Text style={styles.tr}>{t.text}</Text>
          <Text style={styles.trBy}>— {t.resource_name ?? t.language_name}</Text>
        </View>
      ))}
      <View style={styles.cardActions}>
        <Pressable onPress={onNote}><Text style={styles.action}>✎ Note{notes > 0 ? ` · ${notes}` : ""}</Text></Pressable>
        <Pressable onPress={onOpen}><Text style={styles.action}>Read →</Text></Pressable>
      </View>
    </View>
  );
}

function RootBody({ bw, q, onOpen }: { bw: string; q: any; onOpen: () => void }) {
  const d = q.root(bw);
  if (!d) return <Text style={styles.tr}>—</Text>;
  const links = q.rootLinkages(bw, { limit: 6, sortBy: "count" });
  const meanings = (d.meanings ?? []).filter((m: any) => m.language === "en").slice(0, 2);
  return (
    <View style={styles.body}>
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
      <Pressable onPress={onOpen}><Text style={styles.action}>Open root →</Text></Pressable>
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
  bar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  barTitle: { color: colors.ink, fontSize: 17, fontWeight: "700" },
  newBtn: { color: colors.lapis, fontSize: 15, fontWeight: "600" },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  emptyTitle: { color: colors.ink, fontSize: 18, fontWeight: "700", marginBottom: 8 },
  emptyText: { color: colors.inkSoft, fontSize: 15, lineHeight: 22, textAlign: "center" },
  emptyBtn: { marginTop: 18, borderWidth: 1, borderColor: colors.border, borderRadius: 18, paddingHorizontal: 18, paddingVertical: 9 },
  emptyBtnText: { color: colors.lapis, fontSize: 15, fontWeight: "600" },

  setRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10 },
  setTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  setTitle: { color: colors.ink, fontSize: 16, fontWeight: "600", flexShrink: 1 },
  activeTag: { color: colors.gold, fontSize: 10, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  setMeta: { color: colors.inkSoft, fontSize: 12, marginTop: 3 },
  del: { color: colors.inkSoft, fontSize: 16 },

  boardBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  back: { color: colors.lapis, fontSize: 15, fontWeight: "600" },
  boardTitle: { color: colors.ink, fontSize: 16, fontWeight: "700" },
  titleInput: { flex: 1, color: colors.ink, fontSize: 16, fontWeight: "700", borderBottomWidth: 1, borderBottomColor: colors.gold, paddingVertical: 2 },
  activeTagSm: { color: colors.gold, fontSize: 10, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  setActive: { color: colors.lapis, fontSize: 13, fontWeight: "600" },
  clear: { color: colors.danger, fontSize: 13, fontWeight: "600" },

  row: { flexDirection: "row" },
  gutter: { width: GUTTER, alignItems: "center" },
  line: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: colors.border, left: GUTTER / 2 - 1 },
  lineHalfTop: { top: 22 },
  lineHalfBottom: { bottom: undefined, height: 22 },
  node: { width: 12, height: 12, borderRadius: 6, borderWidth: 2.5, backgroundColor: colors.bg, marginTop: 16 },

  card: { flex: 1, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginVertical: 6, marginLeft: 2, padding: 12 },
  mergeRow: {
    flexDirection: "row", alignItems: "center", flexWrap: "wrap",
    marginBottom: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.surfaceAlt,
  },
  mergeText: { color: colors.inkSoft, fontSize: 10, letterSpacing: 0.4, marginRight: 8, textTransform: "uppercase", fontWeight: "700" },
  mergeChips: { flexDirection: "row", flexWrap: "wrap", flex: 1 },
  mergeChip: {
    color: colors.gold, fontSize: 16, lineHeight: 22, includeFontPadding: false, textAlignVertical: "center",
    writingDirection: "rtl", fontFamily: font.arabic,
    backgroundColor: colors.surfaceAlt, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
    marginRight: 6, marginBottom: 4,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  caret: { color: colors.inkSoft, fontSize: 13, width: 14 },
  kind: { color: colors.inkSoft, fontSize: 9, fontWeight: "700", letterSpacing: 0.8 },
  cardKey: { flex: 1, color: colors.gold, fontSize: 13, fontWeight: "700" },
  x: { color: colors.inkSoft, fontSize: 15 },
  preview: { color: colors.inkSoft, fontSize: 13, marginTop: 6 },

  body: { marginTop: 8 },
  trWrap: { marginTop: 10, borderTopWidth: 1, borderTopColor: colors.surfaceAlt, paddingTop: 8 },
  tr: { color: colors.inkSoft, fontSize: 14, lineHeight: 21 },
  trBy: { color: colors.inkSoft, fontSize: 11, marginTop: 2, opacity: 0.7 },
  rootAr: { color: colors.gold, fontSize: 34, paddingBottom: 8, includeFontPadding: true, writingDirection: "rtl", textAlign: "center", fontFamily: font.arabic },
  rootMeta: { color: colors.inkSoft, fontSize: 12, textAlign: "center", marginTop: 4 },
  rootGloss: { color: colors.ink, fontSize: 15, fontStyle: "italic", textAlign: "center", marginTop: 6 },
  src: { color: colors.inkSoft, fontSize: 11, fontWeight: "700", marginTop: 10 },
  company: { color: colors.gold, fontSize: 15, writingDirection: "rtl", textAlign: "right", marginTop: 4, lineHeight: 26 },
  cardActions: { flexDirection: "row", justifyContent: "space-between", marginTop: 14 },
  action: { color: colors.lapis, fontSize: 14, fontWeight: "600" },
});
