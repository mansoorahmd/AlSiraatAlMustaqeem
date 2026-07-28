import React, { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, Share, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import type { Linkage, RootDetail as RootDetailT, RootOccurrence } from "../types";
import * as Clipboard from "expo-clipboard";
import { useQuran } from "../state/DbContext";
import { addToActiveCompare, addFocus, removeFocus, isFocused, FOCUS_CAP, getPref, setUserRootMeaning, userRootMeaning } from "../data/research";
import { toast } from "../ui/toast";
import { Card, Chip, SectionTitle } from "../components/ui";
import { CooccurPanel } from "../components/CooccurPanel";
import { FormSpellingPanel } from "../components/FormSpellingPanel";
import { MotifPicker } from "../components/MotifPicker";
import { composeRootShare } from "../lib/aishare";
import type { SpellingVariant } from "../data/spellings";
import { colors, font } from "../theme/tokens";

type Props = NativeStackScreenProps<RootStackParamList, "RootDetail">;

const chapterOf = (verseKey: string) => Number(verseKey.split(":")[0]);

export default function RootDetail({ route, navigation }: Props) {
  const { root } = route.params;
  const { q, research } = useQuran();

  const detail = useMemo<RootDetailT | null>(() => q.root(root), [q, root]);
  const occurrences = useMemo<RootOccurrence[]>(
    () => q.rootOccurrences(root, "uthmani", 500),
    [q, root],
  );
  const linkages = useMemo<Linkage[]>(() => q.rootLinkages(root, { limit: 300, sortBy: "count" }), [q, root]);
  const [showAllColl, setShowAllColl] = useState(false);
  const COLL_PREVIEW = 20;

  const [mine, setMine] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [coll, setColl] = useState<Linkage | null>(null);
  const formSpellings = useMemo(() => q.rootSpellingsByForm(root), [q, root]);
  const [formPick, setFormPick] = useState<{ arabic: string; lemmaBw: string; groups: SpellingVariant[][] } | null>(null);
  const [groupByForm, setGroupByForm] = useState(true);
  const [motifOpen, setMotifOpen] = useState(false);
  const [compareMsg, setCompareMsg] = useState(false);
  const [focused, setFocused] = useState(false);

  type OccItem =
    | { kind: "header"; label: string; pos: string; count: number }
    | { kind: "occ"; occ: RootOccurrence };
  const items = useMemo<OccItem[]>(() => {
    if (!groupByForm) return occurrences.map((o) => ({ kind: "occ", occ: o }));
    const by = new Map<string, RootOccurrence[]>();
    for (const o of occurrences) {
      const k = o.lemma_arabic ?? "—";
      let a = by.get(k);
      if (!a) { a = []; by.set(k, a); }
      a.push(o);
    }
    const out: OccItem[] = [];
    for (const [label, occs] of by) {
      out.push({ kind: "header", label, pos: occs[0]?.pos_english ?? "", count: occs.length });
      for (const o of occs) out.push({ kind: "occ", occ: o });
    }
    return out;
  }, [occurrences, groupByForm]);
  const editionIds = useMemo<Set<number>>(() => {
    const e = getPref(research, "editions");
    if (e == null) return new Set([20, 54]);
    return new Set(e ? e.split(",").map(Number).filter((n) => !Number.isNaN(n)) : []);
  }, [research]);

  useEffect(() => {
    setMine(userRootMeaning(research, root) ?? "");
    setFocused(isFocused(research, "root", root));
  }, [research, root]);

  const toggleFocus = () => {
    if (!detail) return;
    if (focused) { removeFocus(research, "root", detail.root_buckwalter); setFocused(false); toast("Removed from Focus"); return; }
    const r = addFocus(research, "root", detail.root_buckwalter, detail.root_arabic);
    if (r.ok) { setFocused(true); toast("Added to Focus"); }
    else toast(r.reason === "full" ? `Focus is full (max ${FOCUS_CAP} roots)` : "Already in Focus");
  };

  useEffect(() => {
    navigation.setOptions({ title: detail ? detail.root_arabic : "Root" });
  }, [navigation, detail]);

  if (!detail) {
    return (
      <View style={styles.center}>
        <Text style={styles.meta}>Root not found: {root}</Text>
      </View>
    );
  }

  const byLang = groupBy(detail.meanings, (m) => m.language);

  const saveMine = () => {
    setUserRootMeaning(research, root, mine.trim());
    setEditing(false);
  };

  const addAyah = (vk: string) => {
    const r = addToActiveCompare(research, "ayah", vk, null);
    toast(r.added ? `Added ${vk} to “${r.title}”` : `${vk} is already in “${r.title}”`);
  };

  const Header = (
    <View>
      <View style={styles.hero}>
        <Text style={styles.heroArabic}>{detail.root_arabic}</Text>
        <Text style={styles.heroMeta}>
          {detail.letters_arabic ?? ""} · {detail.total_occurrences} occurrences · {detail.forms.length} forms
        </Text>
        {!!detail.meaning_en && <Text style={styles.heroGloss}>{detail.meaning_en}</Text>}
        <View style={styles.heroBtns}>
          <Pressable style={styles.motifBtn} onPress={() => setMotifOpen(true)}>
            <Text style={styles.motifBtnText}>❦ Add to motif</Text>
          </Pressable>
          <Pressable style={styles.motifBtn} onPress={() => {
            const r = addToActiveCompare(research, "root", detail.root_buckwalter, detail.root_arabic);
            setCompareMsg(true);
            toast(r.added ? `Added to “${r.title}”` : `Already in “${r.title}”`);
          }}>
            <Text style={styles.motifBtnText}>{compareMsg ? "✓ in Compare" : "⇋ Compare"}</Text>
          </Pressable>
          <Pressable style={styles.motifBtn} onPress={toggleFocus}>
            <Text style={styles.motifBtnText}>{focused ? "★ In Focus" : "☆ Focus"}</Text>
          </Pressable>
          <Pressable style={styles.motifBtn} onPress={() => Share.share({ message: composeRootShare(q, research, detail.root_buckwalter) })}>
            <Text style={styles.motifBtnText}>⇱ Share with…</Text>
          </Pressable>
        </View>
      </View>

      <Card>
        <SectionTitle>My meaning</SectionTitle>
        {editing ? (
          <>
            <TextInput
              style={styles.mineInput}
              value={mine}
              onChangeText={setMine}
              placeholder="what does this root mean, in your own words?"
              placeholderTextColor={colors.tabInactive}
              multiline
            />
            <View style={styles.mineBtns}>
              <Pressable style={styles.save} onPress={saveMine}>
                <Text style={styles.saveText}>Save</Text>
              </Pressable>
              <Pressable onPress={() => setEditing(false)}>
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <Pressable onPress={() => setEditing(true)}>
            <Text style={mine ? styles.mineText : styles.minePlaceholder}>
              {mine || "＋ Add your own definition"}
            </Text>
          </Pressable>
        )}
      </Card>

      {!!linkages.length && (
        <Card>
          <SectionTitle>The company it keeps</SectionTitle>
          <View style={styles.chipsWrap}>
            {(showAllColl ? linkages : linkages.slice(0, COLL_PREVIEW)).map((l, i) => (
              <Chip
                key={`${l.root_buckwalter}-${i}`}
                label={`${l.root_arabic} · ${l.cooccur}`}
                onPress={() => setColl(l)}
              />
            ))}
          </View>
          {linkages.length > COLL_PREVIEW && (
            <Pressable onPress={() => setShowAllColl((v) => !v)}>
              <Text style={styles.showAll}>
                {showAllColl ? "Show fewer" : `Show all ${linkages.length} →`}
              </Text>
            </Pressable>
          )}
        </Card>
      )}

      <Card>
        <SectionTitle>Forms</SectionTitle>
        {detail.forms.map((f, i) => {
          const groups = formSpellings.get(f.lemma_buckwalter);
          return (
            <Pressable
              key={`${f.lemma_buckwalter}-${f.pos ?? ""}-${i}`}
              style={styles.formRow}
              onPress={() => setFormPick({ arabic: f.lemma_arabic ?? f.lemma_buckwalter, lemmaBw: f.lemma_buckwalter, groups: groups ?? [] })}
            >
              <Text style={styles.formArabic}>{f.lemma_arabic ?? f.lemma_buckwalter}</Text>
              {!!groups && <Text style={styles.formVariant}>✍</Text>}
              <Text style={styles.formPos}>{f.pos_english ?? f.pos ?? ""}</Text>
              <Text style={styles.formCount}>{f.occurrence_count}</Text>
            </Pressable>
          );
        })}
      </Card>

      <Card>
        <SectionTitle>Dictionaries</SectionTitle>
        {Object.entries(byLang).map(([lang, entries]) => (
          <View key={lang} style={{ marginBottom: 10 }}>
            <Text style={styles.lang}>{lang}</Text>
            {entries.map((m, i) => (
              <View key={`${m.source}-${i}`} style={styles.dictRow}>
                <View style={styles.dictHead}>
                  <Text style={styles.dictSource}>{m.source}</Text>
                  <Pressable
                    hitSlop={8}
                    onPress={() => Clipboard.setStringAsync(`${detail.root_arabic} — ${m.source}\n${m.meaning}`)}
                  >
                    <Text style={styles.copy}>⧉ copy</Text>
                  </Pressable>
                </View>
                <Text style={[styles.dictMeaning, lang !== "en" && styles.rtl]}>{m.meaning}</Text>
              </View>
            ))}
          </View>
        ))}
      </Card>

      <View style={styles.occHead}>
        <SectionTitle>Occurrences ({occurrences.length}{occurrences.length >= 500 ? "+" : ""})</SectionTitle>
        <Pressable onPress={() => setGroupByForm((v) => !v)} hitSlop={8}>
          <Text style={styles.toggle}>{groupByForm ? "in mushaf order" : "group by form"}</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <>
      <FlatList
        style={{ backgroundColor: colors.bg }}
        contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
        data={items}
        keyExtractor={(it, i) => (it.kind === "header" ? `h${i}` : `o${i}`)}
        ListHeaderComponent={Header}
        renderItem={({ item }) =>
          item.kind === "header" ? (
            <View style={styles.formHeader}>
              <Text style={styles.formHeaderAr}>{item.label}</Text>
              <Text style={styles.formHeaderMeta}>{item.pos}{item.pos ? " · " : ""}{item.count}</Text>
            </View>
          ) : (
            <View style={styles.occ}>
              <Pressable
                onPress={() =>
                  navigation.navigate("Reader", {
                    chapterId: chapterOf(item.occ.verse_key),
                    focusVerseKey: item.occ.verse_key,
                    focusWordPos: item.occ.word_position,
                  })
                }
              >
                <Text style={styles.occKey}>{item.occ.verse_key}</Text>
                <Text style={styles.occText} numberOfLines={2}>{item.occ.verse_text ?? ""}</Text>
              </Pressable>
              <Pressable onPress={() => addAyah(item.occ.verse_key)} hitSlop={6} style={styles.occAdd}>
                <Text style={styles.occAddText}>✚ Compare</Text>
              </Pressable>
            </View>
          )
        }
      />

      <CooccurPanel
        visible={!!coll}
        a={detail ? { arabic: detail.root_arabic, bw: detail.root_buckwalter } : null}
        b={coll ? { arabic: coll.root_arabic, bw: coll.root_buckwalter } : null}
        q={q}
        editionIds={editionIds}
        onClose={() => setColl(null)}
        onJump={(vk) => { setColl(null); navigation.navigate("Reader", { chapterId: chapterOf(vk), focusVerseKey: vk }); }}
        onOpenRoot={(bw) => { setColl(null); navigation.push("RootDetail", { root: bw }); }}
      />

      <FormSpellingPanel
        visible={!!formPick}
        title={formPick?.arabic ?? ""}
        lemmaBuckwalter={formPick?.lemmaBw ?? null}
        groups={formPick?.groups ?? []}
        q={q}
        onClose={() => setFormPick(null)}
        onJump={(vk) => { setFormPick(null); navigation.navigate("Reader", { chapterId: chapterOf(vk), focusVerseKey: vk }); }}
      />

      {detail && (
        <MotifPicker
          visible={motifOpen}
          onClose={() => setMotifOpen(false)}
          research={research}
          rootBw={detail.root_buckwalter}
          rootAr={detail.root_arabic}
        />
      )}
    </>
  );
}

function groupBy<T>(arr: T[], key: (t: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const x of arr) (out[key(x)] ??= []).push(x);
  return out;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  meta: { color: colors.inkSoft },
  hero: { alignItems: "center", paddingVertical: 12 },
  heroArabic: { fontSize: 46, paddingBottom: 10, includeFontPadding: true, color: colors.gold, writingDirection: "rtl", fontFamily: font.arabic },
  heroMeta: { color: colors.inkSoft, fontSize: 13, marginTop: 6 },
  heroGloss: { color: colors.ink, fontSize: 16, marginTop: 6, fontStyle: "italic" },
  heroBtns: { flexDirection: "row", gap: 10, marginTop: 12 },
  motifBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7 },
  motifBtnText: { color: colors.lapis, fontSize: 13, fontWeight: "600" },
  mineInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10,
    minHeight: 70, textAlignVertical: "top", color: colors.ink, backgroundColor: colors.bg,
  },
  mineBtns: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  save: { backgroundColor: colors.ink, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  saveText: { color: "#fff", fontWeight: "600" },
  cancel: { color: colors.inkSoft, marginLeft: 14 },
  mineText: { color: colors.ink, fontSize: 15, lineHeight: 22 },
  minePlaceholder: { color: colors.lapis, fontSize: 15 },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap" },
  formRow: { flexDirection: "row", alignItems: "center", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.surfaceAlt },
  formArabic: { fontSize: 20, color: colors.ink, writingDirection: "rtl", fontFamily: font.arabic, minWidth: 90 },
  formVariant: { color: colors.amberStrong, fontSize: 15, marginLeft: 8 },
  formPos: { flex: 1, color: colors.inkSoft, fontSize: 12, marginLeft: 10 },
  formCount: { color: colors.gold, fontWeight: "700" },
  lang: { color: colors.lapis, fontSize: 12, fontWeight: "700", textTransform: "uppercase", marginBottom: 4 },
  dictRow: { marginBottom: 8 },
  dictHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  dictSource: { color: colors.inkSoft, fontSize: 11, fontWeight: "600" },
  copy: { color: colors.lapis, fontSize: 12, fontWeight: "600" },
  showAll: { color: colors.lapis, fontSize: 13, fontWeight: "600", marginTop: 4 },
  occHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  toggle: { color: colors.lapis, fontSize: 13, fontWeight: "600" },
  formHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: colors.surfaceAlt, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 6, marginTop: 4,
  },
  formHeaderAr: { color: colors.ink, fontSize: 20, writingDirection: "rtl", fontFamily: font.arabic },
  formHeaderMeta: { color: colors.inkSoft, fontSize: 12 },
  dictMeaning: { color: colors.ink, fontSize: 14, lineHeight: 20 },
  rtl: { writingDirection: "rtl", fontFamily: font.arabic, textAlign: "right" },
  occ: { backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 10, marginBottom: 8 },
  occKey: { color: colors.gold, fontWeight: "700", fontSize: 11, textAlign: "right" },
  occText: { color: colors.ink, fontSize: 18, lineHeight: 32, writingDirection: "rtl", fontFamily: font.arabic, textAlign: "right", marginTop: 2 },
  occAdd: { alignSelf: "flex-start", marginTop: 6 },
  occAddText: { color: colors.lapis, fontSize: 12, fontWeight: "600" },
});
