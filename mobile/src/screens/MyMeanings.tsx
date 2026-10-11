import React, { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/types";
import { useQuran } from "../state/DbContext";
import { listUserRootMeanings, type UserRootMeaning } from "../data/research";
import { buckToArabic } from "../text/normalize";
import { colors, font } from "../theme/tokens";

type Props = NativeStackScreenProps<RootStackParamList, "MyMeanings">;

export default function MyMeanings({ navigation }: Props) {
  const { research } = useQuran();
  const [rows, setRows] = useState<UserRootMeaning[]>([]);

  useFocusEffect(
    useCallback(() => {
      setRows(listUserRootMeanings(research));
    }, [research]),
  );

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 12 }}
      data={rows}
      keyExtractor={(r) => r.root_buckwalter}
      ListEmptyComponent={
        <Text style={styles.empty}>
          No meanings yet. Open a root and add “My meaning” to build your own lexicon.
        </Text>
      }
      renderItem={({ item }) => (
        <Pressable
          style={styles.row}
          onPress={() => navigation.navigate("RootDetail", { root: item.root_buckwalter })}
        >
          <Text style={styles.root}>{buckToArabic(item.root_buckwalter)}</Text>
          <Text style={styles.meaning}>{item.meaning}</Text>
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
  root: { color: colors.gold, fontSize: 22, writingDirection: "rtl", fontFamily: font.arabic, textAlign: "right" },
  meaning: { color: colors.ink, fontSize: 15, lineHeight: 21, marginTop: 4 },
  empty: { color: colors.inkSoft, textAlign: "center", marginTop: 40, paddingHorizontal: 20, lineHeight: 20 },
});
