import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import type { Word } from "../types";
import type { QuranApi } from "../data/api";
import type { Db } from "../data/db";
import type { SpellingVariant } from "../data/spellings";
import type { Wazn } from "../data/wazn";
import { NotesPanel, type NoteScope } from "./NotesPanel";
import { colors, font } from "../theme/tokens";

const RARE_THRESHOLD = 25;

/** The bottom sheet shown when a word is tapped — anywhere an āyah is rendered.
 *  Root, wazn (صرف form), spelling variants, follow-thread, and notes. */
export function WordSheet({
  word,
  rootFreq,
  variants,
  wazn,
  onJumpVerse,
  onClose,
  onOpenRoot,
  onFollowWord,
  onFollowRoot,
  onOpenNotes,
}: {
  word: Word | null;
  rootFreq: number | null;
  variants: SpellingVariant[];
  wazn: Wazn | null;
  onJumpVerse: (verseKey: string) => void;
  onClose: () => void;
  onOpenRoot: (rootBuckwalter: string) => void;
  onFollowWord: (surface: string, label: string) => void;
  onFollowRoot: (rootBuckwalter: string) => void;
  onOpenNotes: (w: Word) => void;
}) {
  return (
    <Modal visible={!!word} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          {word && (
            <>
              <Text style={styles.sheetArabic}>{word.arabic}</Text>
              {!!word.transliteration && <Text style={styles.sheetTranslit}>{word.transliteration}</Text>}
              {!!word.gloss && <Text style={styles.sheetGloss}>{word.gloss}</Text>}
              <View style={styles.sheetMeta}>
                {!!word.pos && <Text style={styles.sheetMetaText}>{word.pos}</Text>}
                {!!word.lemma && <Text style={styles.sheetMetaText}>lemma {word.lemma}</Text>}
              </View>

              {wazn && (
                <View style={styles.waznBox}>
                  <Text style={styles.waznLabel}>وزن · FORM</Text>
                  <View style={styles.waznHead}>
                    {!!wazn.wazn && <Text style={styles.waznPattern}>{wazn.wazn}</Text>}
                    {!!wazn.radicals && (
                      <Text style={styles.waznRadicals}>on {wazn.radicals.join(" · ")}</Text>
                    )}
                  </View>
                  <Text style={styles.waznName}>{wazn.label}</Text>
                  {(!!wazn.aspect || !!wazn.voice) && (
                    <Text style={styles.waznGram}>{[wazn.aspect, wazn.voice].filter(Boolean).join(" · ")}</Text>
                  )}
                  {!!wazn.sense && <Text style={styles.waznSense}>{wazn.sense}</Text>}
                </View>
              )}

              {variants.length > 1 && (
                <View style={styles.variantsBox}>
                  <Text style={styles.variantsTitle}>✍ Written {variants.length} ways in the mushaf</Text>
                  {variants.map((v, i) => (
                    <View key={i} style={styles.variantRow}>
                      <Text style={styles.variantArabic}>{v.surface}</Text>
                      <Text style={styles.variantCount}>×{v.count}</Text>
                      <Pressable onPress={() => onJumpVerse(v.verses[0]!)} hitSlop={8}>
                        <Text style={styles.variantJump}>{v.verses[0]} →</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}

              {rootFreq != null && rootFreq <= RARE_THRESHOLD && (
                <Text style={styles.rareLine}>⚲ rare root · appears {rootFreq} time{rootFreq === 1 ? "" : "s"} in the Book</Text>
              )}
              {word.root_buckwalter ? (
                <Pressable style={styles.rootBtn} onPress={() => onOpenRoot(word.root_buckwalter!)}>
                  <Text style={styles.rootBtnText}>Investigate root {word.root ?? word.root_buckwalter}  →</Text>
                </Pressable>
              ) : (
                <Text style={styles.noRoot}>No root for this word (particle / proper noun).</Text>
              )}
              {!!word.arabic && (
                <Pressable style={styles.notesBtn} onPress={() => onFollowWord(word.arabic!, word.arabic!)}>
                  <Text style={styles.notesBtnText}>⚲ Follow this exact word · {word.arabic}</Text>
                </Pressable>
              )}
              {!!word.root_buckwalter && (
                <Pressable style={styles.notesBtn} onPress={() => onFollowRoot(word.root_buckwalter!)}>
                  <Text style={styles.notesBtnText}>⚲ Follow the root {word.root ?? ""}</Text>
                </Pressable>
              )}
              <Pressable style={styles.notesBtn} onPress={() => onOpenNotes(word)}>
                <Text style={styles.notesBtnText}>✎ Notes &amp; questions</Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * One word sheet (+ notes) shared across a whole list of āyāt — call `open(vk,
 * word)` from any VerseText's onWordPress and render `sheet` once. Avoids
 * mounting a modal per āyah in panels that show many verses.
 */
export function useWordSheet(opts: {
  q: QuranApi;
  research: Db;
  onOpenRoot: (rootBuckwalter: string) => void;
  onFollowWord: (surface: string, label: string) => void;
  onFollowRoot: (rootBuckwalter: string) => void;
  onJumpVerse?: (verseKey: string) => void;
}) {
  const { q, research, onOpenRoot, onFollowWord, onFollowRoot, onJumpVerse } = opts;
  const [sel, setSel] = useState<{ vk: string; word: Word } | null>(null);
  const [notes, setNotes] = useState<NoteScope | null>(null);
  const freq = q.rootFrequencies();

  const open = (verseKey: string, word: Word) => setSel({ vk: verseKey, word });

  const sheet = (
    <>
      <WordSheet
        word={sel?.word ?? null}
        rootFreq={sel?.word.root ? freq.get(sel.word.root) ?? null : null}
        variants={sel ? q.spellingVariants(sel.vk, sel.word.position) : []}
        wazn={sel ? q.wazn(sel.vk, sel.word.position) : null}
        onJumpVerse={(vk) => { setSel(null); onJumpVerse?.(vk); }}
        onClose={() => setSel(null)}
        onOpenRoot={(bw) => { setSel(null); onOpenRoot(bw); }}
        onFollowWord={(s, l) => { setSel(null); onFollowWord(s, l); }}
        onFollowRoot={(bw) => { setSel(null); onFollowRoot(bw); }}
        onOpenNotes={(w) => {
          const vk = sel?.vk;
          setSel(null);
          if (vk) setNotes({ verseKey: vk, wordPosition: w.position, lemma: w.lemma, root: w.root, wordArabic: w.arabic });
        }}
      />
      <NotesPanel visible={!!notes} scope={notes} research={research} onClose={() => setNotes(null)} />
    </>
  );

  return { open, sheet };
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    padding: 22, paddingBottom: 34,
  },
  sheetArabic: { fontSize: 40, lineHeight: 60, paddingBottom: 6, includeFontPadding: true, color: colors.ink, textAlign: "center", writingDirection: "rtl", fontFamily: font.arabic },
  sheetTranslit: { fontSize: 15, color: colors.lapis, textAlign: "center", marginTop: 6 },
  sheetGloss: { fontSize: 17, color: colors.ink, textAlign: "center", marginTop: 6, fontWeight: "600" },
  sheetMeta: { flexDirection: "row", justifyContent: "center", gap: 14, marginTop: 10 },
  sheetMetaText: { color: colors.inkSoft, fontSize: 13 },
  waznBox: {
    marginTop: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    backgroundColor: colors.surfaceAlt, padding: 12, alignItems: "center",
  },
  waznLabel: { color: colors.inkSoft, fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  waznHead: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6 },
  waznPattern: { color: colors.gold, fontSize: 30, lineHeight: 48, paddingBottom: 8, includeFontPadding: true, fontFamily: font.arabic, writingDirection: "rtl" },
  waznRadicals: { color: colors.inkSoft, fontSize: 15, writingDirection: "rtl", fontFamily: font.arabic },
  waznName: { color: colors.ink, fontSize: 14, fontWeight: "600", marginTop: 6 },
  waznGram: { color: colors.lapis, fontSize: 13, marginTop: 2 },
  waznSense: { color: colors.inkSoft, fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 4 },
  variantsBox: {
    marginTop: 14, borderWidth: 1, borderColor: colors.amberStrong, borderRadius: 10,
    backgroundColor: colors.amber, padding: 12,
  },
  variantsTitle: { color: colors.ink, fontSize: 13, fontWeight: "700", marginBottom: 8 },
  variantRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  variantArabic: { color: colors.ink, fontSize: 26, lineHeight: 44, paddingBottom: 4, includeFontPadding: true, writingDirection: "rtl", flex: 1, fontFamily: font.arabic },
  variantCount: { color: colors.inkSoft, fontSize: 13, marginHorizontal: 10 },
  variantJump: { color: colors.lapis, fontSize: 13, fontWeight: "600" },
  rareLine: { color: colors.gold, fontSize: 13, textAlign: "center", marginTop: 12 },
  rootBtn: { marginTop: 18, backgroundColor: colors.ink, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  rootBtnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  noRoot: { color: colors.inkSoft, textAlign: "center", marginTop: 16 },
  notesBtn: {
    marginTop: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingVertical: 11, alignItems: "center",
  },
  notesBtnText: { color: colors.lapis, fontWeight: "600", fontSize: 15 },
});
