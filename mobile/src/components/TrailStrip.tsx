import React, { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { TrailHop } from "../data/research";
import { colors } from "../theme/tokens";

const cnum = (k: string) => Number(k.split(":")[0]);

/**
 * A compact 114-sūrah map of a trail: each sūrah is a slim bar whose height
 * reflects how many hops fall in it; the sūrah holding the current hop is
 * highlighted. Tapping a sūrah jumps to its first hop.
 */
export function TrailStrip({
  hops,
  pos,
  onJumpToHop,
}: {
  hops: TrailHop[];
  pos: number;
  onJumpToHop: (hopIndex: number) => void;
}) {
  const { counts, firstHop, max } = useMemo(() => {
    const counts = new Map<number, number>();
    const firstHop = new Map<number, number>();
    hops.forEach((h, i) => {
      const c = cnum(h.verseKey);
      counts.set(c, (counts.get(c) ?? 0) + 1);
      if (!firstHop.has(c)) firstHop.set(c, i);
    });
    const max = Math.max(1, ...counts.values());
    return { counts, firstHop, max };
  }, [hops]);

  const currentChapter = hops[pos] ? cnum(hops[pos].verseKey) : -1;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {Array.from({ length: 114 }, (_, idx) => {
        const ch = idx + 1;
        const n = counts.get(ch) ?? 0;
        const isCurrent = ch === currentChapter;
        const h = n ? 8 + Math.round((n / max) * 22) : 3;
        return (
          <Pressable
            key={ch}
            disabled={!n}
            onPress={() => onJumpToHop(firstHop.get(ch)!)}
            style={styles.cell}
          >
            <View
              style={[
                styles.bar,
                { height: h, backgroundColor: n ? colors.gold : colors.border },
                isCurrent && styles.barCurrent,
              ]}
            />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { alignItems: "flex-end", paddingHorizontal: 6, paddingVertical: 6, minHeight: 40 },
  cell: { width: 6, justifyContent: "flex-end", alignItems: "center", height: 34 },
  bar: { width: 4, borderRadius: 2 },
  barCurrent: { backgroundColor: colors.lapis, width: 5 },
});
