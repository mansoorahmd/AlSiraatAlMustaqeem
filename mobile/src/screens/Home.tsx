import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/types";
import { useQuran } from "../state/DbContext";
import {
  getPref, setPref, openQuestionCount, listTrails, userRootMeaningCount,
  listFocus, removeFocusById, type Trail, type FocusItem,
} from "../data/research";
import { Card, SectionTitle } from "../components/ui";
import { VerseJump } from "../components/VerseJump";
import { LegendSheet } from "../components/LegendSheet";
import { backupResearch } from "../lib/backup";
import { colors, font } from "../theme/tokens";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;
const cnum = (k: string) => Number(k.split(":")[0]);

export default function Home({ navigation }: Props) {
  const { q, research } = useQuran();
  const nav = navigation as any; // cross-tab navigation

  const [last, setLast] = useState<string | null>(null);
  const [openQ, setOpenQ] = useState(0);
  const [trails, setTrails] = useState<Trail[]>([]);
  const [meanings, setMeanings] = useState(0);
  const [focusAyat, setFocusAyat] = useState<FocusItem[]>([]);
  const [focusRoots, setFocusRoots] = useState<FocusItem[]>([]);
  const [backupMsg, setBackupMsg] = useState("");
  const [legend, setLegend] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setLast(getPref(research, "lastVerseKey"));
      setOpenQ(openQuestionCount(research));
      setTrails(listTrails(research).slice(0, 3));
      setMeanings(userRootMeaningCount(research));
      setFocusAyat(listFocus(research, "ayah"));
      setFocusRoots(listFocus(research, "root"));
      // first launch: show the marks guide once
      if (getPref(research, "seenGuide") !== "1") {
        setLegend(true);
        setPref(research, "seenGuide", "1");
      }
    }, [research]),
  );

  const lastChapter = last ? q.chapter(cnum(last)) : undefined;
  const dropFocus = (id: number) => {
    removeFocusById(research, id);
    setFocusAyat(listFocus(research, "ayah"));
    setFocusRoots(listFocus(research, "root"));
  };

  return (
    <>
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 14 }}>
      <Text style={styles.greeting}>رَّبِّ زِدْنِي عِلْمًا</Text>
      <Text style={styles.tagline}>“My Lord, increase me in knowledge.” (20:114)</Text>

      <VerseJump
        q={q}
        onGo={(c, vk) => nav.navigate("ReadTab", { screen: "Reader", params: { chapterId: c, focusVerseKey: vk } })}
      />

      {last && lastChapter && (
        <Pressable
          style={styles.resume}
          onPress={() => nav.navigate("ReadTab", { screen: "Reader", params: { chapterId: lastChapter.id, focusVerseKey: last } })}
        >
          <Text style={styles.resumeLabel}>CONTINUE READING</Text>
          <Text style={styles.resumeWhere}>{lastChapter.name_simple} · {last}</Text>
        </Pressable>
      )}

      {(focusAyat.length > 0 || focusRoots.length > 0) && (
        <>
          <SectionTitle>In focus</SectionTitle>
          {focusAyat.map((f) => {
            const ch = q.chapter(cnum(f.ref));
            const txt = (q.verse(f.ref, { script: "uthmani" })?.text as string) ?? "";
            return (
              <View key={f.id} style={styles.focusRow}>
                <Pressable
                  style={{ flex: 1 }}
                  onPress={() => nav.navigate("ReadTab", { screen: "Reader", params: { chapterId: cnum(f.ref), focusVerseKey: f.ref, openLens: true } })}
                >
                  <Text style={styles.focusKey}>{f.ref} · {ch?.name_simple}</Text>
                  <Text style={styles.focusArabic} numberOfLines={1}>{txt}</Text>
                  <Text style={styles.focusHint}>tap → open with connections lens ⊙</Text>
                </Pressable>
                <Pressable onPress={() => dropFocus(f.id)} hitSlop={10}><Text style={styles.focusX}>✕</Text></Pressable>
              </View>
            );
          })}
          {focusRoots.length > 0 && (
            <View style={styles.focusChips}>
              {focusRoots.map((f) => (
                <View key={f.id} style={styles.focusChip}>
                  <Pressable onPress={() => nav.navigate("RootsTab", { screen: "RootDetail", params: { root: f.ref } })}>
                    <Text style={styles.focusChipText}>{f.label ?? f.ref}</Text>
                  </Pressable>
                  <Pressable onPress={() => dropFocus(f.id)} hitSlop={8}><Text style={styles.focusChipX}>  ✕</Text></Pressable>
                </View>
              ))}
            </View>
          )}
        </>
      )}

      <View style={styles.grid}>
        <Pressable style={styles.stat} onPress={() => nav.navigate("ReadTab", { screen: "OpenQuestions" })}>
          <Text style={styles.statNum}>{openQ}</Text>
          <Text style={styles.statLabel}>open questions</Text>
        </Pressable>
        <Pressable style={styles.stat} onPress={() => nav.navigate("RootsTab", { screen: "MyMeanings" })}>
          <Text style={styles.statNum}>{meanings}</Text>
          <Text style={styles.statLabel}>my meanings</Text>
        </Pressable>
      </View>

      <SectionTitle>Recent trails</SectionTitle>
      {trails.length === 0 ? (
        <Text style={styles.empty}>No trails yet — tap ⚲ “Follow the thread” on any word.</Text>
      ) : (
        trails.map((t) => (
          <Pressable
            key={t.id}
            onPress={() => nav.navigate("ReadTab", { screen: "Trail", params: { trailId: t.id } })}
          >
            <Card style={styles.trailCard}>
              <Text style={styles.trailName}>{t.name ?? t.root_arabic ?? "trail"}</Text>
              <Text style={styles.trailMeta}>{JSON.parse(t.hops).length} stops · resume at {t.pos + 1}</Text>
            </Card>
          </Pressable>
        ))
      )}

      <SectionTitle>Explore</SectionTitle>
      <Pressable style={styles.link} onPress={() => nav.navigate("RootsTab")}>
        <Text style={styles.linkText}>Explore the roots  →</Text>
      </Pressable>
      <Pressable style={styles.link} onPress={() => nav.navigate("RootsTab", { screen: "Motifs" })}>
        <Text style={styles.linkText}>Motifs — your themed root groups  →</Text>
      </Pressable>
      <Pressable style={styles.link} onPress={() => nav.navigate("SearchTab")}>
        <Text style={styles.linkText}>Search the Book  →</Text>
      </Pressable>
      <Pressable style={styles.link} onPress={() => setLegend(true)}>
        <Text style={styles.linkText}>Reading guide — what the marks mean  →</Text>
      </Pressable>

      <SectionTitle>Your work</SectionTitle>
      <Pressable
        style={styles.link}
        onPress={async () => {
          try { await backupResearch(); }
          catch (e) { setBackupMsg(e instanceof Error ? e.message : String(e)); }
        }}
      >
        <Text style={styles.linkText}>Back up my research  ⇪</Text>
      </Pressable>
      {!!backupMsg && <Text style={styles.backupMsg}>{backupMsg}</Text>}
      <Text style={styles.hint}>
        Exports notes, questions, meanings and trails as a single file you can save or send.
      </Text>
    </ScrollView>
    <LegendSheet visible={legend} onClose={() => setLegend(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  greeting: { color: colors.gold, fontSize: 26, textAlign: "right", writingDirection: "rtl", fontFamily: font.arabic, marginTop: 4 },
  tagline: { color: colors.inkSoft, fontSize: 14, marginTop: 4, marginBottom: 16 },
  resume: { backgroundColor: colors.ink, borderRadius: 14, padding: 16, marginBottom: 14 },
  resumeLabel: { color: colors.amberStrong, fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  resumeWhere: { color: "#fff", fontSize: 18, fontWeight: "600", marginTop: 5 },
  grid: { flexDirection: "row", gap: 12, marginBottom: 6 },
  stat: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    padding: 16, alignItems: "center",
  },
  statNum: { color: colors.gold, fontSize: 30, fontWeight: "800" },
  statLabel: { color: colors.inkSoft, fontSize: 12, marginTop: 4 },
  empty: { color: colors.inkSoft, fontSize: 14, marginBottom: 8 },
  focusRow: {
    flexDirection: "row", alignItems: "center", backgroundColor: colors.surface,
    borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8,
  },
  focusKey: { color: colors.gold, fontSize: 12, fontWeight: "700" },
  focusArabic: { color: colors.ink, fontSize: 18, writingDirection: "rtl", fontFamily: font.arabic, textAlign: "right", marginTop: 3 },
  focusHint: { color: colors.inkSoft, fontSize: 11, marginTop: 4 },
  focusX: { color: colors.inkSoft, fontSize: 15, paddingLeft: 12 },
  focusChips: { flexDirection: "row", flexWrap: "wrap", marginBottom: 8 },
  focusChip: {
    flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.gold,
    borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8, marginBottom: 8,
  },
  focusChipText: { color: colors.gold, fontSize: 18, writingDirection: "rtl", fontFamily: font.arabic, fontWeight: "600" },
  focusChipX: { color: colors.inkSoft, fontSize: 13 },
  trailCard: { paddingVertical: 12 },
  trailName: { color: colors.ink, fontSize: 16, writingDirection: "rtl", fontFamily: font.arabic },
  trailMeta: { color: colors.inkSoft, fontSize: 12, marginTop: 3 },
  link: {
    backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    padding: 14, marginBottom: 8,
  },
  linkText: { color: colors.lapis, fontSize: 15, fontWeight: "600" },
  backupMsg: { color: colors.danger, fontSize: 12, marginBottom: 6 },
  hint: { color: colors.inkSoft, fontSize: 12, lineHeight: 17, marginTop: 2 },
});
