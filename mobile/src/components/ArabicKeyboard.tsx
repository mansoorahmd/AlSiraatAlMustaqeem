import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AR_ROWS } from "../lib/arabic";
import { colors } from "../theme/tokens";

/** Compact on-screen Arabic keyboard so no system Arabic layout is needed. */
export function ArabicKeyboard({
  onKey,
  onBackspace,
  onClear,
}: {
  onKey: (ch: string) => void;
  onBackspace: () => void;
  onClear: () => void;
}) {
  return (
    <View style={styles.wrap}>
      {AR_ROWS.map((row, i) => (
        <View key={i} style={styles.row}>
          {row.map((ch) => (
            <Pressable key={ch} style={styles.key} onPress={() => onKey(ch)}>
              <Text style={styles.keyText}>{ch}</Text>
            </Pressable>
          ))}
        </View>
      ))}
      <View style={styles.row}>
        <Pressable style={[styles.key, styles.wide]} onPress={() => onKey(" ")}>
          <Text style={styles.keyText}>space</Text>
        </Pressable>
        <Pressable style={styles.key} onPress={onBackspace}>
          <Text style={styles.keyText}>⌫</Text>
        </Pressable>
        <Pressable style={styles.key} onPress={onClear}>
          <Text style={styles.keyText}>✕</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 4, paddingVertical: 8, backgroundColor: colors.surfaceAlt, borderTopWidth: 1, borderTopColor: colors.border },
  row: { flexDirection: "row", justifyContent: "center", marginVertical: 3 },
  key: {
    minWidth: 30, height: 38, paddingHorizontal: 6, marginHorizontal: 2,
    borderRadius: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  wide: { minWidth: 120 },
  keyText: { fontSize: 18, color: colors.ink },
});
