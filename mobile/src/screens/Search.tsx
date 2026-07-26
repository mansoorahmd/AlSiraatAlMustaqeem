import React, { useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import type { CompositeMatch, Verse } from "../types";
import { useQuran } from "../state/DbContext";
import { getRecentSearches, pushRecentSearch } from "../data/research";
import { ArabicKeyboard } from "../components/ArabicKeyboard";
import { VerseJump } from "../components/VerseJump";
import { Chip } from "../components/ui";
import { colors } from "../theme/tokens";

type Props = NativeStackScreenProps<RootStackParamList, "Search">;
type Mode = "phrase" | "related";

const chapterOf = (verseKey: string) => Number(verseKey.split(":")[0]);

export default function Search({ navigation }: Props) {
  const { q, research } = useQuran();
  const [mode, setMode] = useState<Mode>("phrase");
  const [text, setText] = useState("");
  const [kb, setKb] = useState(true);
  const [busy, setBusy] = useState(false);
  const [phraseHits, setPhraseHits] = useState<Verse[] | null>(null);
  const [related, setRelated] = useState<{ resolved: string[]; matches: CompositeMatch[] } | null>(null);
  const [recent, setRecent] = useState<string[]>(() => getRecentSearches(research));

  const run = (queryArg?: string) => {
    const query = (queryArg ?? text).trim();
    if (!query) return;
    if (queryArg) setText(queryArg);
    pushRecentSearch(research, query);
    setRecent(getRecentSearches(research));
    setBusy(true);
    // let the spinner paint before the (sync) query on the JS thread
    setTimeout(() => {
      try {
        if (mode === "phrase") {
          setRelated(null);
          setPhraseHits(q.phraseSearch(query, "uthmani", 80));
        } else {
          setPhraseHits(null);
          const r = q.search(query, { topK: 30 });
          setRelated({
            resolved: r.resolved.map((x) => x.root).filter(Boolean) as string[],
            matches: r.matches,
          });
        }
      } finally {
        setBusy(false);
      }
    }, 10);
  };

  const openVerse = (verseKey: string) =>
    navigation.navigate("Reader", { chapterId: chapterOf(verseKey), focusVerseKey: verseKey });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.top}>
        <VerseJump q={q} onGo={(c, vk) => navigation.navigate("Reader", { chapterId: c, focusVerseKey: vk })} />
        <View style={styles.modes}>
          <Chip label="Phrase (verbatim)" active={mode === "phrase"} onPress={() => setMode("phrase")} />
          <Chip label="Related (by roots)" active={mode === "related"} onPress={() => setMode("related")} />
        </View>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder={mode === "phrase" ? "type an exact phrase…" : "type a few words…"}
            placeholderTextColor={colors.tabInactive}
            textAlign="right"
            onSubmitEditing={() => run()}
          />
          <Pressable style={styles.go} onPress={() => run()}>
            <Text style={styles.goText}>Search</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => setKb((v) => !v)}>
          <Text style={styles.kbToggle}>{kb ? "Hide" : "Show"} Arabic keyboard</Text>
        </Pressable>
        {recent.length > 0 && (
          <View style={styles.recentRow}>
            {recent.map((r) => (
              <Pressable key={r} style={styles.recentChip} onPress={() => run(r)}>
                <Text style={styles.recentText} numberOfLines={1}>{r}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {busy && <ActivityIndicator color={colors.gold} style={{ marginTop: 20 }} />}

      {mode === "related" && related && (
        <View style={styles.resolvedRow}>
          <Text style={styles.resolvedLabel}>roots: </Text>
          <Text style={styles.resolvedRoots}>{related.resolved.join("  ·  ") || "—"}</Text>
        </View>
      )}

      {!busy && phraseHits && (
        <FlatList
          data={phraseHits}
          keyExtractor={(v) => v.verse_key}
          contentContainerStyle={{ padding: 12 }}
          ListEmptyComponent={<Text style={styles.empty}>No verbatim matches.</Text>}
          renderItem={({ item }) => (
            <Pressable style={styles.hit} onPress={() => openVerse(item.verse_key)}>
              <Text style={styles.hitKey}>{item.verse_key}</Text>
              <Text style={styles.hitArabic}>{item.text as string}</Text>
            </Pressable>
          )}
        />
      )}

      {!busy && related && (
        <FlatList
          data={related.matches}
          keyExtractor={(m) => m.verse_key}
          contentContainerStyle={{ padding: 12 }}
          ListEmptyComponent={<Text style={styles.empty}>No related āyāt found.</Text>}
          renderItem={({ item }) => (
            <Pressable style={styles.hit} onPress={() => openVerse(item.verse_key)}>
              <View style={styles.hitHead}>
                <Text style={styles.hitKey}>{item.verse_key}</Text>
                <Text style={styles.score}>score {item.score.toFixed(3)}</Text>
              </View>
              <Text style={styles.hitArabic}>{item.text ?? ""}</Text>
              {!!item.shared.length && (
                <Text style={styles.shared}>shared roots: {item.shared.join("  ")}</Text>
              )}
            </Pressable>
          )}
        />
      )}

      {kb && (
        <ArabicKeyboard
          onKey={(ch) => setText((t) => t + ch)}
          onBackspace={() => setText((t) => [...t].slice(0, -1).join(""))}
          onClear={() => setText("")}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { padding: 12, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  modes: { flexDirection: "row", flexWrap: "wrap" },
  inputRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  input: {
    flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 20, color: colors.ink,
    writingDirection: "rtl", backgroundColor: colors.bg,
  },
  go: { marginLeft: 8, backgroundColor: colors.ink, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  goText: { color: "#fff", fontWeight: "600" },
  kbToggle: { color: colors.lapis, marginTop: 8, fontSize: 13 },
  recentRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 8 },
  recentChip: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.bg, paddingHorizontal: 10, paddingVertical: 5, marginRight: 8, marginBottom: 6, maxWidth: 200 },
  recentText: { color: colors.inkSoft, fontSize: 13, writingDirection: "rtl" },
  resolvedRow: { flexDirection: "row", paddingHorizontal: 14, paddingTop: 10, alignItems: "baseline" },
  resolvedLabel: { color: colors.inkSoft, fontSize: 12 },
  resolvedRoots: { color: colors.gold, fontSize: 16, writingDirection: "rtl", flex: 1 },
  hit: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8 },
  hitHead: { flexDirection: "row", justifyContent: "space-between" },
  hitKey: { color: colors.gold, fontWeight: "700", fontSize: 12, textAlign: "right" },
  score: { color: colors.inkSoft, fontSize: 11 },
  hitArabic: { color: colors.ink, fontSize: 22, lineHeight: 40, writingDirection: "rtl", textAlign: "right", marginTop: 4 },
  shared: { color: colors.lapis, fontSize: 14, marginTop: 6, writingDirection: "rtl", textAlign: "right" },
  empty: { color: colors.inkSoft, textAlign: "center", marginTop: 30 },
});
