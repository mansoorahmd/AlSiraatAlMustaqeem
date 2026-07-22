import React, { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/types";
import { useQuran } from "../state/DbContext";
import { allOpenQuestions, type Note } from "../data/research";
import { colors } from "../theme/tokens";

type Props = NativeStackScreenProps<RootStackParamList, "OpenQuestions">;

export default function OpenQuestions({ navigation }: Props) {
  const { research } = useQuran();
  const [questions, setQuestions] = useState<Note[]>([]);

  useFocusEffect(
    useCallback(() => {
      setQuestions(allOpenQuestions(research));
    }, [research]),
  );

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 12 }}
      data={questions}
      keyExtractor={(q) => String(q.id)}
      ListEmptyComponent={
        <Text style={styles.empty}>No open questions. Tap ✎ on an āyah or word to add one.</Text>
      }
      renderItem={({ item }) => (
        <Pressable
          style={styles.row}
          onPress={() =>
            navigation.navigate("Reader", {
              chapterId: Number(item.verse_key?.split(":")[0]),
              focusVerseKey: item.verse_key ?? undefined,
              focusWordPos: item.word_position ?? undefined,
            })
          }
        >
          <View style={styles.rowHead}>
            <Text style={styles.key}>{item.verse_key}{item.word_position != null ? ` · word ${item.word_position}` : ""}</Text>
            {!!item.root && <Text style={styles.root}>{item.root}</Text>}
          </View>
          <Text style={styles.text}>{item.text}</Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    padding: 12, marginBottom: 8,
  },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  key: { color: colors.gold, fontWeight: "700", fontSize: 12 },
  root: { color: colors.lapis, fontSize: 16, writingDirection: "rtl" },
  text: { color: colors.ink, fontSize: 15, lineHeight: 21 },
  empty: { color: colors.inkSoft, textAlign: "center", marginTop: 40, paddingHorizontal: 20, lineHeight: 20 },
});
