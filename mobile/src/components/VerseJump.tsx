import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { QuranApi } from "../data/api";
import { colors } from "../theme/tokens";

/** "Go to āyah" shortcut — parses a verse key like 2:255 and jumps. */
export function VerseJump({
  q,
  onGo,
}: {
  q: QuranApi;
  onGo: (chapterId: number, verseKey: string) => void;
}) {
  const [text, setText] = useState("");
  const [err, setErr] = useState(false);

  const go = () => {
    const m = text.trim().match(/^(\d{1,3})\s*[:\s.]\s*(\d{1,3})$/);
    if (m) {
      const c = Number(m[1]);
      const v = Number(m[2]);
      const ch = q.chapter(c);
      if (ch && v >= 1 && v <= ch.verses_count) {
        onGo(c, `${c}:${v}`);
        setText("");
        setErr(false);
        return;
      }
    }
    setErr(true);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={(t) => { setText(t); setErr(false); }}
          placeholder="Go to āyah — e.g. 2:255"
          placeholderTextColor={colors.tabInactive}
          keyboardType="numbers-and-punctuation"
          returnKeyType="go"
          onSubmitEditing={go}
        />
        <Pressable style={styles.btn} onPress={go}>
          <Text style={styles.btnText}>Go</Text>
        </Pressable>
      </View>
      {err && <Text style={styles.err}>No such āyah — use chapter:verse, e.g. 2:255.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center" },
  input: {
    flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.ink, backgroundColor: colors.surface,
  },
  btn: { marginLeft: 8, backgroundColor: colors.ink, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 11 },
  btnText: { color: "#fff", fontWeight: "600" },
  err: { color: colors.danger, fontSize: 12, marginTop: 6 },
});
