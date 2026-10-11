import React, { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Db } from "../data/db";
import {
  addRootToMotif, createMotif, listMotifs, motifsForRoot, removeRootFromMotif, type Motif,
} from "../data/research";
import { colors, font } from "../theme/tokens";

/** Tag a root into one or more motifs (reader-defined themed groups). */
export function MotifPicker({
  visible,
  onClose,
  research,
  rootBw,
  rootAr,
}: {
  visible: boolean;
  onClose: () => void;
  research: Db;
  rootBw: string;
  rootAr: string | null;
}) {
  const [tick, setTick] = useState(0);
  const [newName, setNewName] = useState("");
  const motifs = useMemo<Motif[]>(() => (visible ? listMotifs(research) : []), [visible, research, tick]);
  const inSet = useMemo(() => new Set(visible ? motifsForRoot(research, rootBw) : []), [visible, research, rootBw, tick]);

  const toggle = (id: number) => {
    if (inSet.has(id)) removeRootFromMotif(research, id, rootBw);
    else addRootToMotif(research, id, rootBw, rootAr);
    setTick((t) => t + 1);
  };
  const create = () => {
    const n = newName.trim();
    if (!n) return;
    const id = createMotif(research, n);
    addRootToMotif(research, id, rootBw, rootAr);
    setNewName("");
    setTick((t) => t + 1);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>Add {rootAr ?? rootBw} to a motif</Text>
            <Pressable onPress={onClose} hitSlop={10}><Text style={styles.done}>Done</Text></Pressable>
          </View>

          <View style={styles.newRow}>
            <TextInput
              style={styles.input}
              value={newName}
              onChangeText={setNewName}
              placeholder="new motif name…"
              placeholderTextColor={colors.tabInactive}
              onSubmitEditing={create}
            />
            <Pressable style={styles.createBtn} onPress={create}><Text style={styles.createText}>Create</Text></Pressable>
          </View>

          <FlatList
            data={motifs}
            keyExtractor={(m) => String(m.id)}
            style={{ maxHeight: 360 }}
            ListEmptyComponent={<Text style={styles.empty}>No motifs yet — create one above.</Text>}
            renderItem={({ item }) => {
              const on = inSet.has(item.id);
              return (
                <Pressable style={styles.row} onPress={() => toggle(item.id)}>
                  <Text style={[styles.check, on && styles.checkOn]}>{on ? "☑" : "☐"}</Text>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.count}>{item.count ?? 0}</Text>
                </Pressable>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 26 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  title: { fontSize: 15, fontWeight: "700", color: colors.ink, flex: 1, writingDirection: "rtl", fontFamily: font.arabic, textAlign: "left" },
  done: { color: colors.lapis, fontWeight: "600", fontSize: 15 },
  newRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, color: colors.ink, backgroundColor: colors.bg },
  createBtn: { marginLeft: 8, backgroundColor: colors.ink, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  createText: { color: "#fff", fontWeight: "600" },
  empty: { color: colors.inkSoft, textAlign: "center", paddingVertical: 16 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 11, borderTopWidth: 1, borderTopColor: colors.surfaceAlt },
  check: { fontSize: 20, color: colors.inkSoft, marginRight: 12 },
  checkOn: { color: colors.gold },
  name: { flex: 1, color: colors.ink, fontSize: 15 },
  count: { color: colors.inkSoft, fontSize: 12 },
});
