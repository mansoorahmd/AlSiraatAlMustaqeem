import React, { useLayoutEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import type { RootSummary } from "../types";
import { useQuran } from "../state/DbContext";
import { Chip } from "../components/ui";
import { colors } from "../theme/tokens";

type Props = NativeStackScreenProps<RootStackParamList, "RootsExplorer">;

export default function RootsExplorer({ navigation }: Props) {
  const { q } = useQuran();
  const all = useMemo<RootSummary[]>(() => q.listRoots({ orderBy: "count", descending: false }), [q]);
  const [rarestFirst, setRarestFirst] = useState(true);
  const [filter, setFilter] = useState("");

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={() => navigation.navigate("Motifs")} hitSlop={10} style={{ paddingHorizontal: 6 }}>
          <Text style={{ color: colors.gold, fontSize: 15, fontWeight: "600" }}>❦ Motifs</Text>
        </Pressable>
      ),
    });
  }, [navigation]);

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    let list = all;
    if (f) {
      list = all.filter(
        (r) =>
          (r.meaning_en ?? "").toLowerCase().includes(f) ||
          (r.root_buckwalter ?? "").toLowerCase().includes(f) ||
          (r.root_arabic ?? "").includes(filter.trim()),
      );
    }
    const sorted = [...list].sort((a, b) => a.total_occurrences - b.total_occurrences);
    return rarestFirst ? sorted : sorted.reverse();
  }, [all, filter, rarestFirst]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.top}>
        <TextInput
          style={styles.input}
          value={filter}
          onChangeText={setFilter}
          placeholder="filter by meaning or root…"
          placeholderTextColor={colors.tabInactive}
        />
        <View style={styles.sortRow}>
          <Chip label="Rarest first" active={rarestFirst} onPress={() => setRarestFirst(true)} />
          <Chip label="Most common" active={!rarestFirst} onPress={() => setRarestFirst(false)} />
          <Text style={styles.count}>{rows.length} roots</Text>
        </View>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r, i) => `${r.root_buckwalter}-${i}`}
        contentContainerStyle={{ padding: 12 }}
        initialNumToRender={30}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => navigation.navigate("RootDetail", { root: item.root_buckwalter })}
          >
            <Text style={styles.arabic}>{item.root_arabic}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.meaning} numberOfLines={1}>
                {item.meaning_en ?? "—"}
              </Text>
              <Text style={styles.meta}>
                {item.total_occurrences} occ · {item.form_count} forms
              </Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  top: { padding: 12, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, color: colors.ink, backgroundColor: colors.bg,
  },
  sortRow: { flexDirection: "row", alignItems: "center", marginTop: 10 },
  count: { color: colors.inkSoft, fontSize: 12, marginLeft: "auto" },
  row: {
    flexDirection: "row", alignItems: "center", backgroundColor: colors.surface,
    borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8,
  },
  arabic: { fontSize: 26, color: colors.gold, writingDirection: "rtl", marginLeft: 14, minWidth: 70, textAlign: "right" },
  meaning: { color: colors.ink, fontSize: 15 },
  meta: { color: colors.inkSoft, fontSize: 12, marginTop: 2 },
});
