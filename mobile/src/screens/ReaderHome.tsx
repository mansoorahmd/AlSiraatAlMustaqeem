import React, { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/types";
import { useQuran } from "../state/DbContext";
import { getPref, openQuestionCount } from "../data/research";
import { VerseJump } from "../components/VerseJump";
import { colors } from "../theme/tokens";

type Props = NativeStackScreenProps<RootStackParamList, "ReaderHome">;

export default function ReaderHome({ navigation }: Props) {
  const { q, research } = useQuran();
  const chapters = useMemo(() => q.chapters(), [q]);

  // re-read the saved position + open-question count whenever we regain focus
  const [last, setLast] = useState<string | null>(null);
  const [openQ, setOpenQ] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setLast(getPref(research, "lastVerseKey"));
      setOpenQ(openQuestionCount(research));
    }, [research]),
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 4 }}>
          <Pressable onPress={() => navigation.navigate("Trail", {})} hitSlop={10}>
            <Text style={{ fontSize: 18, color: colors.tabInactive }}>⚲</Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate("OpenQuestions")} hitSlop={10}>
            <Text style={{ fontSize: 17, color: openQ > 0 ? colors.gold : colors.tabInactive }}>
              ❓{openQ > 0 ? ` ${openQ}` : ""}
            </Text>
          </Pressable>
        </View>
      ),
    });
  }, [navigation, openQ]);
  const lastChapter = last ? q.chapter(Number(last.split(":")[0])) : undefined;

  const ContinueBanner = last && lastChapter ? (
    <Pressable
      style={styles.continue}
      onPress={() =>
        navigation.navigate("Reader", { chapterId: lastChapter.id, focusVerseKey: last })
      }
    >
      <Text style={styles.continueLabel}>Continue reading</Text>
      <Text style={styles.continueWhere}>
        {lastChapter.name_simple} · {last}
      </Text>
    </Pressable>
  ) : null;

  const Header = (
    <View>
      <VerseJump q={q} onGo={(c, vk) => navigation.navigate("Reader", { chapterId: c, focusVerseKey: vk })} />
      {ContinueBanner}
    </View>
  );

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 12 }}
      data={chapters}
      keyExtractor={(c) => String(c.id)}
      ListHeaderComponent={Header}
      renderItem={({ item }) => (
        <Pressable
          style={styles.row}
          onPress={() => navigation.navigate("Reader", { chapterId: item.id })}
        >
          <View style={styles.num}>
            <Text style={styles.numText}>{item.id}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{item.name_simple}</Text>
            <Text style={styles.meta}>
              {item.revelation_place === "makkah" ? "Makkan" : "Madinan"} · {item.verses_count} āyāt
            </Text>
          </View>
          <Text style={styles.arabic}>{item.name_arabic}</Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  continue: {
    backgroundColor: colors.ink,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  continueLabel: { color: colors.amberStrong, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  continueWhere: { color: "#fff", fontSize: 17, fontWeight: "600", marginTop: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 8,
  },
  num: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surfaceAlt, marginRight: 12,
  },
  numText: { color: colors.gold, fontWeight: "700" },
  name: { color: colors.ink, fontSize: 16, fontWeight: "600" },
  meta: { color: colors.inkSoft, fontSize: 12, marginTop: 2 },
  arabic: { color: colors.ink, fontSize: 20, marginLeft: 10, writingDirection: "rtl" },
});
