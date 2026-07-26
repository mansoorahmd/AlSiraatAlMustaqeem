import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/types";
import { useQuran } from "../state/DbContext";
import {
  createTrail, getPref, getTrail, listTrails, updateTrailPos,
  type Trail as TrailRow, type TrailHop,
} from "../data/research";
import { VerseText } from "../components/VerseText";
import { TrailStrip } from "../components/TrailStrip";
import { colors } from "../theme/tokens";

type Props = NativeStackScreenProps<RootStackParamList, "Trail">;

const cnum = (k: string) => Number(k.split(":")[0]);
function parseEditions(pref: string | null): Set<number> {
  if (pref == null) return new Set([20, 54]);
  return new Set(pref ? pref.split(",").map(Number).filter((n) => !Number.isNaN(n)) : []);
}

export default function Trail({ route, navigation }: Props) {
  const { q, research } = useQuran();

  const [hops, setHops] = useState<TrailHop[]>([]);
  const [pos, setPos] = useState(0);
  const [label, setLabel] = useState<string | null>(null); // subject label (word or root, Arabic)
  const [subjectKey, setSubjectKey] = useState<string | null>(null); // root_bw or "lemma:xxx"
  const [trailId, setTrailId] = useState<number | null>(null);
  const [saved, setSaved] = useState<TrailRow[]>([]);
  const [editionIds, setEditionIds] = useState<Set<number>>(() => parseEditions(getPref(research, "editions")));

  useFocusEffect(
    useCallback(() => {
      setSaved(listTrails(research));
      setEditionIds(parseEditions(getPref(research, "editions")));
    }, [research]),
  );

  // load from params
  const paramRoot = route.params?.root;
  const paramLemma = route.params?.lemma;
  const paramLabel = route.params?.label;
  const paramTrailId = route.params?.trailId;
  useEffect(() => {
    if (paramTrailId != null) {
      const t = getTrail(research, paramTrailId);
      if (t) {
        setHops(JSON.parse(t.hops) as TrailHop[]);
        setPos(t.pos);
        setLabel(t.root_arabic);
        setSubjectKey(t.root_buckwalter);
        setTrailId(t.id);
      }
    } else if (paramRoot) {
      const detail = q.root(paramRoot);
      const occ = q.rootOccurrences(paramRoot, "uthmani", 3000);
      setHops(occ.map((o) => ({ verseKey: o.verse_key, wordPosition: o.word_position })));
      setLabel(detail?.root_arabic ?? paramRoot);
      setSubjectKey(paramRoot);
      setPos(0);
      setTrailId(null);
    } else if (paramLemma) {
      const occ = q.formOccurrences(paramLemma, "uthmani", 3000);
      setHops(occ.map((o) => ({ verseKey: o.verse_key, wordPosition: o.word_position })));
      setLabel(paramLabel ?? paramLemma);
      setSubjectKey(`lemma:${paramLemma}`);
      setPos(0);
      setTrailId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramRoot, paramLemma, paramTrailId]);

  useLayoutEffect(() => {
    navigation.setOptions({ title: label ? `Thread · ${label}` : "Trails" });
  }, [navigation, label]);

  const step = (next: number) => {
    const p = Math.max(0, Math.min(hops.length - 1, next));
    setPos(p);
    if (trailId != null) updateTrailPos(research, trailId, p);
  };

  const save = () => {
    if (trailId != null || !subjectKey) return;
    const id = createTrail(research, {
      name: `${label ?? subjectKey} · thread`,
      rootBuckwalter: subjectKey,
      rootArabic: label,
      hops,
      pos,
    });
    setTrailId(id);
    setSaved(listTrails(research));
  };

  const hop = hops[pos];
  const verse = useMemo(
    () => (hop ? q.verse(hop.verseKey, { script: "uthmani", withWords: true }) : undefined),
    [hop, q],
  );
  const words = (verse?.words ?? []).filter((w) => w.pos != null);
  const litPos = useMemo(() => (hop?.wordPosition != null ? new Set([hop.wordPosition]) : undefined), [hop]);
  const translations = useMemo(
    () => (hop && editionIds.size ? q.verseTranslations(hop.verseKey).filter((t) => editionIds.has(t.resource_id)) : []),
    [hop, editionIds, q],
  );

  if (!hop) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
        <Text style={styles.emptyTitle}>Trails</Text>
        <Text style={styles.emptyText}>
          Open a word and choose “Follow the thread” to walk every place that word — or its root — occurs.
        </Text>
        {saved.length > 0 && <Text style={styles.shelfTitle}>Saved trails</Text>}
        {saved.map((t) => (
          <Pressable key={t.id} style={styles.savedRow} onPress={() => navigation.push("Trail", { trailId: t.id })}>
            <Text style={styles.savedName}>{t.name ?? t.root_arabic}</Text>
            <Text style={styles.savedMeta}>{JSON.parse(t.hops).length} stops</Text>
          </Pressable>
        ))}
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.header}>
        <Text style={styles.count}>{pos + 1} / {hops.length}</Text>
        <View style={styles.headerBtns}>
          {trailId == null ? (
            <Pressable onPress={save} style={styles.hbtn}><Text style={styles.hbtnText}>Save trail</Text></Pressable>
          ) : (
            <Text style={styles.savedTag}>saved</Text>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={styles.vk}>{hop.verseKey} · {q.chapter(cnum(hop.verseKey))?.name_simple}</Text>
        <VerseText text={(verse?.text as string) ?? ""} words={words} highlightPositions={litPos} onWordPress={() => {}} size={26} />
        {translations.map((t) => (
          <View key={t.resource_id} style={styles.tr}>
            <Text style={styles.trText}>{t.text}</Text>
            <Text style={styles.trBy}>— {t.resource_name ?? t.language_name}</Text>
          </View>
        ))}
        <Pressable
          style={styles.openBtn}
          onPress={() => navigation.push("Reader", { chapterId: cnum(hop.verseKey), focusVerseKey: hop.verseKey })}
        >
          <Text style={styles.openBtnText}>Open in reader →</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <TrailStrip hops={hops} pos={pos} onJumpToHop={(i) => step(i)} />
        <View style={styles.nav}>
          <Pressable style={[styles.navBtn, pos === 0 && styles.navDisabled]} disabled={pos === 0} onPress={() => step(pos - 1)}>
            <Text style={styles.navText}>‹ Prev</Text>
          </Pressable>
          <Pressable
            style={[styles.navBtn, pos === hops.length - 1 && styles.navDisabled]}
            disabled={pos === hops.length - 1}
            onPress={() => step(pos + 1)}
          >
            <Text style={styles.navText}>Next ›</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  count: { color: colors.inkSoft, fontWeight: "700" },
  headerBtns: { flexDirection: "row", gap: 8 },
  hbtn: { backgroundColor: colors.ink, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  hbtnText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  savedTag: { color: colors.gold, fontWeight: "700", fontSize: 13 },
  vk: { color: colors.gold, fontWeight: "700", fontSize: 13, textAlign: "right", marginBottom: 8 },
  tr: { marginTop: 12, borderTopWidth: 1, borderTopColor: colors.surfaceAlt, paddingTop: 10 },
  trText: { color: colors.ink, fontSize: 15, lineHeight: 22 },
  trBy: { color: colors.inkSoft, fontSize: 11, marginTop: 3 },
  openBtn: { marginTop: 20, alignSelf: "flex-start" },
  openBtnText: { color: colors.lapis, fontWeight: "600", fontSize: 15 },
  footer: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  nav: { flexDirection: "row", justifyContent: "space-between", padding: 12 },
  navBtn: { backgroundColor: colors.surfaceAlt, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12 },
  navDisabled: { opacity: 0.4 },
  navText: { color: colors.ink, fontWeight: "600", fontSize: 15 },
  emptyTitle: { color: colors.ink, fontSize: 20, fontWeight: "700", marginBottom: 8 },
  emptyText: { color: colors.inkSoft, fontSize: 15, lineHeight: 22 },
  shelfTitle: { color: colors.inkSoft, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 22, marginBottom: 8 },
  savedRow: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    padding: 12, marginBottom: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  savedName: { color: colors.ink, fontSize: 16, writingDirection: "rtl" },
  savedMeta: { color: colors.inkSoft, fontSize: 12 },
});
