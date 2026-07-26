import React, { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/types";
import { useQuran } from "../state/DbContext";
import {
  createMotif, deleteMotif, listMotifs, motifMembers, removeRootFromMotif, renameMotif, type Motif,
} from "../data/research";
import { colors } from "../theme/tokens";

type Props = NativeStackScreenProps<RootStackParamList, "Motifs">;

export default function Motifs({ navigation }: Props) {
  const { research } = useQuran();
  const [motifs, setMotifs] = useState<Motif[]>([]);
  const [tick, setTick] = useState(0);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  useFocusEffect(useCallback(() => { setMotifs(listMotifs(research)); }, [research, tick]));
  const refresh = () => setTick((t) => t + 1);

  const create = () => {
    const n = newName.trim();
    if (!n) return;
    createMotif(research, n);
    setNewName("");
    refresh();
  };

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 12 }}
      data={motifs}
      keyExtractor={(m) => String(m.id)}
      ListHeaderComponent={
        <View style={styles.newRow}>
          <TextInput
            style={styles.input}
            value={newName}
            onChangeText={setNewName}
            placeholder="new motif — e.g. بيوت (houses)…"
            placeholderTextColor={colors.tabInactive}
            onSubmitEditing={create}
          />
          <Pressable style={styles.createBtn} onPress={create}><Text style={styles.createText}>Create</Text></Pressable>
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.empty}>
          No motifs yet. A motif is your own grouping of roots that share a theme — create one above,
          or tap “Add to motif” on any root page.
        </Text>
      }
      renderItem={({ item }) => {
        const members = motifMembers(research, item.id);
        return (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              {editing === item.id ? (
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={editName}
                  onChangeText={setEditName}
                  autoFocus
                  onSubmitEditing={() => { renameMotif(research, item.id, editName.trim() || item.name); setEditing(null); refresh(); }}
                />
              ) : (
                <Text style={styles.name}>{item.name}</Text>
              )}
              <View style={styles.actions}>
                {editing === item.id ? (
                  <Pressable onPress={() => { renameMotif(research, item.id, editName.trim() || item.name); setEditing(null); refresh(); }}>
                    <Text style={styles.action}>save</Text>
                  </Pressable>
                ) : (
                  <Pressable onPress={() => { setEditing(item.id); setEditName(item.name); }}>
                    <Text style={styles.action}>rename</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() =>
                    Alert.alert("Delete motif?", `“${item.name}” and its members.`, [
                      { text: "Cancel", style: "cancel" },
                      { text: "Delete", style: "destructive", onPress: () => { deleteMotif(research, item.id); refresh(); } },
                    ])
                  }
                >
                  <Text style={[styles.action, { color: colors.danger }]}>delete</Text>
                </Pressable>
              </View>
            </View>

            {members.length === 0 ? (
              <Text style={styles.hint}>No roots yet.</Text>
            ) : (
              <View style={styles.chips}>
                {members.map((r) => (
                  <Pressable
                    key={r.root_buckwalter}
                    style={styles.chip}
                    onPress={() => navigation.navigate("RootDetail", { root: r.root_buckwalter })}
                    onLongPress={() =>
                      Alert.alert("Remove root?", `${r.root_arabic ?? r.root_buckwalter} from “${item.name}”.`, [
                        { text: "Cancel", style: "cancel" },
                        { text: "Remove", style: "destructive", onPress: () => { removeRootFromMotif(research, item.id, r.root_buckwalter); refresh(); } },
                      ])
                    }
                  >
                    <Text style={styles.chipText}>{r.root_arabic ?? r.root_buckwalter}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <Text style={styles.tip}>tap a root to open · long-press to remove</Text>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  newRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, color: colors.ink, backgroundColor: colors.surface },
  createBtn: { marginLeft: 8, backgroundColor: colors.ink, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  createText: { color: "#fff", fontWeight: "600" },
  empty: { color: colors.inkSoft, textAlign: "center", marginTop: 30, paddingHorizontal: 16, lineHeight: 20 },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 10 },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name: { color: colors.ink, fontSize: 17, fontWeight: "600", flex: 1 },
  actions: { flexDirection: "row", gap: 14, marginLeft: 8 },
  action: { color: colors.inkSoft, fontSize: 13 },
  chips: { flexDirection: "row", flexWrap: "wrap", marginTop: 10 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.bg, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8, marginBottom: 8 },
  chipText: { color: colors.gold, fontSize: 18, writingDirection: "rtl" },
  hint: { color: colors.inkSoft, fontSize: 13, marginTop: 8 },
  tip: { color: colors.tabInactive, fontSize: 11, marginTop: 6 },
});
