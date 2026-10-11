import React, { useCallback, useMemo, useState } from "react";
import {
  FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import type { Db } from "../data/db";
import {
  addNote, answerNote, deleteNote, editNote, notesForRoot, notesForVerse, reopenNote,
  type Note,
} from "../data/research";
import { colors, font } from "../theme/tokens";

export interface NoteScope {
  verseKey: string;
  wordPosition?: number | null;
  lemma?: string | null;
  root?: string | null;
  wordArabic?: string | null;
}

export function NotesPanel({
  visible,
  onClose,
  research,
  scope,
  onChanged,
  onJump,
}: {
  visible: boolean;
  onClose: () => void;
  research: Db;
  scope: NoteScope | null;
  onChanged?: () => void;
  onJump?: (verseKey: string, wordPosition?: number | null) => void;
}) {
  const [tick, setTick] = useState(0);
  const [draft, setDraft] = useState("");
  const refresh = useCallback(() => {
    setTick((t) => t + 1);
    onChanged?.();
  }, [onChanged]);

  const wordScoped = scope?.wordPosition != null;

  const notes = useMemo<Note[]>(() => {
    if (!scope) return [];
    const all = notesForVerse(research, scope.verseKey);
    return all.filter((n) =>
      wordScoped ? n.word_position === scope.wordPosition : n.word_position == null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, research, tick, wordScoped]);

  const rootNotes = useMemo<Note[]>(() => {
    if (!scope?.root) return [];
    return notesForRoot(research, scope.root).filter(
      (n) => !(n.verse_key === scope.verseKey && n.word_position === scope.wordPosition),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, research, tick]);
  const rootOpen = rootNotes.filter((n) => n.kind === "question" && !n.answer).length;

  if (!scope) return null;

  const add = (kind: "note" | "question") => {
    const text = draft.trim();
    if (!text) return;
    addNote(research, {
      kind,
      verseKey: scope.verseKey,
      wordPosition: scope.wordPosition ?? null,
      lemma: scope.lemma ?? null,
      root: scope.root ?? null,
      text,
    });
    setDraft("");
    refresh();
  };

  const title = wordScoped
    ? `Notes · ${scope.wordArabic ?? "word"}`
    : `Notes · āyah ${scope.verseKey}`;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose}>
              <Text style={styles.done}>Done</Text>
            </Pressable>
          </View>

          {!!scope.root && (
            <Text style={styles.crossRef}>
              🔗 {rootNotes.length} note{rootNotes.length === 1 ? "" : "s"} on root {scope.root}
              {rootOpen ? ` · ${rootOpen} open ?` : ""}
            </Text>
          )}

          <View style={styles.addRow}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="write a note or question…"
              placeholderTextColor={colors.tabInactive}
              multiline
            />
          </View>
          <View style={styles.addBtns}>
            <Pressable style={[styles.addBtn, styles.noteBtn]} onPress={() => add("note")}>
              <Text style={styles.addBtnText}>＋ Note</Text>
            </Pressable>
            <Pressable style={[styles.addBtn, styles.qBtn]} onPress={() => add("question")}>
              <Text style={styles.addBtnText}>？ Question</Text>
            </Pressable>
          </View>

          <FlatList
            data={notes}
            keyExtractor={(n) => String(n.id)}
            style={{ maxHeight: 300, marginTop: 6 }}
            ListEmptyComponent={<Text style={styles.empty}>No notes here yet.</Text>}
            renderItem={({ item }) => (
              <NoteRow note={item} research={research} onChanged={refresh} />
            )}
          />

          {rootNotes.length > 0 && (
            <>
              <Text style={styles.section}>Elsewhere on this root</Text>
              <FlatList
                data={rootNotes}
                keyExtractor={(n) => "x" + n.id}
                style={{ maxHeight: 150 }}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.xref}
                    onPress={() => onJump?.(item.verse_key, item.word_position)}
                  >
                    <Text style={styles.xrefKey}>
                      {item.verse_key}{item.kind === "question" ? " · ?" : ""}
                    </Text>
                    <Text style={styles.xrefText} numberOfLines={1}>{item.text}</Text>
                  </Pressable>
                )}
              />
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function NoteRow({ note, research, onChanged }: { note: Note; research: Db; onChanged: () => void }) {
  const [answer, setAnswer] = useState("");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);
  const isQuestion = note.kind === "question";
  const resolved = isQuestion && !!note.answer;

  return (
    <View style={styles.note}>
      <View style={styles.noteTop}>
        <Text style={[styles.kind, isQuestion ? styles.kindQ : styles.kindN]}>
          {isQuestion ? (resolved ? "answered" : "question") : "note"}
        </Text>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Pressable onPress={() => setEditing((e) => !e)}>
            <Text style={styles.action}>edit</Text>
          </Pressable>
          <Pressable onPress={() => { deleteNote(research, note.id); onChanged(); }}>
            <Text style={[styles.action, { color: colors.danger }]}>delete</Text>
          </Pressable>
        </View>
      </View>

      {editing ? (
        <View>
          <TextInput style={styles.input} value={text} onChangeText={setText} multiline />
          <Pressable
            style={styles.saveBtn}
            onPress={() => { editNote(research, note.id, text.trim()); setEditing(false); onChanged(); }}
          >
            <Text style={styles.saveText}>Save</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.noteText}>{note.text}</Text>
      )}

      {isQuestion && resolved && (
        <View style={styles.answerBox}>
          <Text style={styles.answerText}>{note.answer}</Text>
          <Pressable onPress={() => { reopenNote(research, note.id); onChanged(); }}>
            <Text style={styles.action}>reopen</Text>
          </Pressable>
        </View>
      )}
      {isQuestion && !resolved && (
        <View style={styles.answerRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={answer}
            onChangeText={setAnswer}
            placeholder="answer…"
            placeholderTextColor={colors.tabInactive}
          />
          <Pressable
            style={styles.saveBtn}
            onPress={() => { if (answer.trim()) { answerNote(research, note.id, answer.trim()); onChanged(); } }}
          >
            <Text style={styles.saveText}>Resolve</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 28,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  title: { fontSize: 15, fontWeight: "700", color: colors.ink },
  done: { color: colors.lapis, fontWeight: "600", fontSize: 15 },
  crossRef: { color: colors.lapis, fontSize: 13, marginBottom: 8, writingDirection: "rtl", fontFamily: font.arabic, textAlign: "left" },
  addRow: { flexDirection: "row" },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10,
    color: colors.ink, backgroundColor: colors.bg, minHeight: 42, flex: 1,
  },
  addBtns: { flexDirection: "row", gap: 10, marginTop: 8 },
  addBtn: { flex: 1, borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  noteBtn: { backgroundColor: colors.ink },
  qBtn: { backgroundColor: colors.lapis },
  addBtnText: { color: "#fff", fontWeight: "600" },
  empty: { color: colors.inkSoft, textAlign: "center", paddingVertical: 16 },
  section: { color: colors.inkSoft, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 12, marginBottom: 6 },
  note: { borderTopWidth: 1, borderTopColor: colors.surfaceAlt, paddingVertical: 10 },
  noteTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  kind: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  kindQ: { color: colors.lapis },
  kindN: { color: colors.inkSoft },
  action: { color: colors.inkSoft, fontSize: 13 },
  noteText: { color: colors.ink, fontSize: 15, lineHeight: 21 },
  answerBox: { marginTop: 6, backgroundColor: "#eef6ee", borderRadius: 8, padding: 8 },
  answerText: { color: "#245a24", fontSize: 14, marginBottom: 4 },
  answerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  saveBtn: { backgroundColor: colors.ink, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, alignItems: "center", marginTop: 8 },
  saveText: { color: "#fff", fontWeight: "600" },
  xref: { paddingVertical: 7, borderTopWidth: 1, borderTopColor: colors.surfaceAlt },
  xrefKey: { color: colors.gold, fontSize: 11, fontWeight: "700" },
  xrefText: { color: colors.ink, fontSize: 13, marginTop: 1 },
});
