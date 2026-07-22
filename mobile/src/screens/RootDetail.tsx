import React, { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import type { Linkage, RootDetail as RootDetailT, RootOccurrence } from "../types";
import { useQuran } from "../state/DbContext";
import { setUserRootMeaning, userRootMeaning } from "../data/research";
import { Card, Chip, SectionTitle } from "../components/ui";
import { colors } from "../theme/tokens";

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
  const linkages = useMemo<Linkage[]>(() => q.rootLinkages(root, { limit: 18, sortBy: "score" }), [q, root]);

  const [mine, setMine] = useState<string>("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setMine(userRootMeaning(research, root) ?? "");
  }, [research, root]);

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

  const Header = (
    <View>
      <View style={styles.hero}>
        <Text style={styles.heroArabic}>{detail.root_arabic}</Text>
        <Text style={styles.heroMeta}>
          {detail.letters_arabic ?? ""} · {detail.total_occurrences} occurrences · {detail.forms.length} forms
        </Text>
        {!!detail.meaning_en && <Text style={styles.heroGloss}>{detail.meaning_en}</Text>}
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
            {linkages.map((l, i) => (
              <Chip
                key={`${l.root_buckwalter}-${i}`}
                label={`${l.root_arabic} · ${l.cooccur}`}
                onPress={() => navigation.push("RootDetail", { root: l.root_buckwalter })}
              />
            ))}
          </View>
        </Card>
      )}

      <Card>
        <SectionTitle>Forms</SectionTitle>
        {detail.forms.map((f, i) => (
          <View key={`${f.lemma_buckwalter}-${f.pos ?? ""}-${i}`} style={styles.formRow}>
            <Text style={styles.formArabic}>{f.lemma_arabic ?? f.lemma_buckwalter}</Text>
            <Text style={styles.formPos}>{f.pos_english ?? f.pos ?? ""}</Text>
            <Text style={styles.formCount}>{f.occurrence_count}</Text>
          </View>
        ))}
      </Card>

      <Card>
        <SectionTitle>Dictionaries</SectionTitle>
        {Object.entries(byLang).map(([lang, entries]) => (
          <View key={lang} style={{ marginBottom: 10 }}>
            <Text style={styles.lang}>{lang}</Text>
            {entries.map((m, i) => (
              <View key={`${m.source}-${i}`} style={styles.dictRow}>
                <Text style={styles.dictSource}>{m.source}</Text>
                <Text style={[styles.dictMeaning, lang !== "en" && styles.rtl]}>{m.meaning}</Text>
              </View>
            ))}
          </View>
        ))}
      </Card>

      <SectionTitle>Occurrences ({occurrences.length}{occurrences.length >= 500 ? "+" : ""})</SectionTitle>
    </View>
  );

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
      data={occurrences}
      keyExtractor={(o, i) => `${o.verse_key}-${o.word_position}-${i}`}
      ListHeaderComponent={Header}
      renderItem={({ item }) => (
        <Pressable
          style={styles.occ}
          onPress={() =>
            navigation.navigate("Reader", {
              chapterId: chapterOf(item.verse_key),
              focusVerseKey: item.verse_key,
              focusWordPos: item.word_position,
            })
          }
        >
          <Text style={styles.occKey}>{item.verse_key}</Text>
          <Text style={styles.occText} numberOfLines={2}>{item.verse_text ?? ""}</Text>
        </Pressable>
      )}
    />
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
  heroArabic: { fontSize: 52, color: colors.gold, writingDirection: "rtl" },
  heroMeta: { color: colors.inkSoft, fontSize: 13, marginTop: 6 },
  heroGloss: { color: colors.ink, fontSize: 16, marginTop: 6, fontStyle: "italic" },
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
  formArabic: { fontSize: 20, color: colors.ink, writingDirection: "rtl", minWidth: 90 },
  formPos: { flex: 1, color: colors.inkSoft, fontSize: 12, marginLeft: 10 },
  formCount: { color: colors.gold, fontWeight: "700" },
  lang: { color: colors.lapis, fontSize: 12, fontWeight: "700", textTransform: "uppercase", marginBottom: 4 },
  dictRow: { marginBottom: 8 },
  dictSource: { color: colors.inkSoft, fontSize: 11, fontWeight: "600" },
  dictMeaning: { color: colors.ink, fontSize: 14, lineHeight: 20 },
  rtl: { writingDirection: "rtl", textAlign: "right" },
  occ: { backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 10, marginBottom: 8 },
  occKey: { color: colors.gold, fontWeight: "700", fontSize: 11, textAlign: "right" },
  occText: { color: colors.ink, fontSize: 18, lineHeight: 32, writingDirection: "rtl", textAlign: "right", marginTop: 2 },
});
