import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import type { QuranApi } from "../data/api";
import type { Db } from "../data/db";
import {
  addAiPrompt, getAiDicts, getAiIncludeTranslation, getAiPrompts, getAiPromptSel,
  removeAiPrompt, setAiDicts, setAiIncludeTranslation, setAiPromptSel,
} from "../data/research";
import { composeAyahShare, composeRootShare } from "../lib/aishare";
import { colors } from "../theme/tokens";

/** Pre-share options: choose (and save) a prompt line and which dictionaries to
 *  include, then hand the bundle to the OS share sheet. */
export function ShareSheet({
  visible,
  onClose,
  kind,
  target,
  q,
  research,
  editionIds,
}: {
  visible: boolean;
  onClose: () => void;
  kind: "ayah" | "root";
  target: string | null; // verseKey or root buckwalter
  q: QuranApi;
  research: Db;
  editionIds: Set<number>;
}) {
  const [prompts, setPrompts] = useState<string[]>([]);
  const [promptSel, setPromptSel] = useState<string>("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [dicts, setDicts] = useState<Set<string>>(new Set());
  const [includeTr, setIncludeTr] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPrompts(getAiPrompts(research));
    setPromptSel(getAiPromptSel(research));
    const srcs = q.dictionarySources();
    setSources(srcs);
    const saved = getAiDicts(research);
    setDicts(new Set(saved ?? srcs)); // null → all
    setIncludeTr(getAiIncludeTranslation(research));
    setAdding(false);
    setDraft("");
  }, [visible, research, q]);

  const toggleDict = (s: string) =>
    setDicts((prev) => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });

  const saveDraft = () => {
    const next = addAiPrompt(research, draft);
    setPrompts(next);
    setPromptSel(draft.trim());
    setDraft("");
    setAdding(false);
  };
  const deletePrompt = (p: string) => {
    setPrompts(removeAiPrompt(research, p));
    if (promptSel === p) setPromptSel("");
  };

  const doShare = () => {
    if (busy) return;
    setAiPromptSel(research, promptSel);
    setAiDicts(research, [...dicts]);
    setAiIncludeTranslation(research, includeTr);
    // "all sources selected" → null (include the built-in gloss too); a subset →
    // exactly those sources, nothing extra
    const allSelected = sources.length > 0 && dicts.size === sources.length;
    const dictsParam = allSelected ? null : [...dicts];
    const opts = { prompt: promptSel || "", dicts: dictsParam, translation: includeTr };
    setBusy(true);
    // defer so the "Preparing…" state paints before the (heavy, synchronous)
    // compose over every root in the āyah
    setTimeout(() => {
      const msg = kind === "ayah" && target
        ? composeAyahShare(q, research, target, editionIds, opts)
        : target ? composeRootShare(q, research, target, opts) : "";
      setBusy(false);
      onClose();
      if (msg) Share.share({ message: msg });
    }, 40);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>Share with…</Text>
            <Pressable onPress={onClose} hitSlop={10}><Text style={styles.done}>Cancel</Text></Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 8 }} style={{ maxHeight: 420 }}>
            {kind === "ayah" && (
              <Pressable style={styles.trRow} onPress={() => setIncludeTr((v) => !v)}>
                <Text style={styles.check}>{includeTr ? "☑" : "☐"}</Text>
                <Text style={styles.promptText}>Include translation</Text>
              </Pressable>
            )}

            <Text style={styles.section}>Prompt</Text>
            <Pressable style={styles.promptRow} onPress={() => setPromptSel("")}>
              <Text style={styles.radio}>{promptSel === "" ? "◉" : "○"}</Text>
              <Text style={styles.promptText}>No prompt (data only)</Text>
            </Pressable>
            {prompts.map((p) => (
              <View key={p} style={styles.promptRow}>
                <Pressable style={styles.promptTap} onPress={() => setPromptSel(p)}>
                  <Text style={styles.radio}>{promptSel === p ? "◉" : "○"}</Text>
                  <Text style={styles.promptText}>{p}</Text>
                </Pressable>
                <Pressable onPress={() => deletePrompt(p)} hitSlop={8}><Text style={styles.del}>✕</Text></Pressable>
              </View>
            ))}
            {adding ? (
              <View style={styles.addBox}>
                <TextInput
                  style={styles.input}
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="write a prompt to save…"
                  placeholderTextColor={colors.tabInactive}
                  multiline
                  autoFocus
                />
                <View style={styles.addBtns}>
                  <Pressable style={styles.saveBtn} onPress={saveDraft}><Text style={styles.saveText}>Save</Text></Pressable>
                  <Pressable onPress={() => { setAdding(false); setDraft(""); }}><Text style={styles.cancelText}>Cancel</Text></Pressable>
                </View>
              </View>
            ) : (
              <Pressable onPress={() => setAdding(true)}><Text style={styles.addLink}>＋ New prompt</Text></Pressable>
            )}

            {sources.length > 0 && (
              <>
                <View style={styles.dictHead}>
                  <Text style={styles.section}>Include dictionaries</Text>
                  <View style={{ flexDirection: "row", gap: 12 }}>
                    <Pressable onPress={() => setDicts(new Set(sources))}><Text style={styles.quick}>All</Text></Pressable>
                    <Pressable onPress={() => setDicts(new Set())}><Text style={styles.quick}>None</Text></Pressable>
                  </View>
                </View>
                <View style={styles.chips}>
                  {sources.map((s) => {
                    const on = dicts.has(s);
                    return (
                      <Pressable key={s} style={[styles.chip, on && styles.chipOn]} onPress={() => toggleDict(s)}>
                        <Text style={[styles.chipText, on && styles.chipTextOn]}>{on ? "✓ " : ""}{s}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}
          </ScrollView>

          <Pressable style={[styles.shareBtn, busy && styles.shareBtnBusy]} onPress={doShare} disabled={busy}>
            {busy ? (
              <View style={styles.busyRow}>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={styles.shareText}>Preparing…</Text>
              </View>
            ) : (
              <Text style={styles.shareText}>⇱ Share</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 16, fontWeight: "700", color: colors.ink },
  done: { color: colors.lapis, fontWeight: "600", fontSize: 15 },
  section: { color: colors.inkSoft, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 14, marginBottom: 6 },
  trRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, marginTop: 4 },
  check: { color: colors.gold, fontSize: 18, width: 22 },
  promptRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 },
  promptTap: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: 8 },
  radio: { color: colors.gold, fontSize: 16, width: 20 },
  promptText: { color: colors.ink, fontSize: 14, lineHeight: 20, flex: 1 },
  del: { color: colors.inkSoft, fontSize: 14, paddingLeft: 10 },
  addLink: { color: colors.lapis, fontSize: 14, fontWeight: "600", marginTop: 6 },
  addBox: { marginTop: 6 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, minHeight: 56, textAlignVertical: "top", color: colors.ink, backgroundColor: colors.bg },
  addBtns: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 8 },
  saveBtn: { backgroundColor: colors.ink, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 7 },
  saveText: { color: "#fff", fontWeight: "600" },
  cancelText: { color: colors.inkSoft },
  dictHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  quick: { color: colors.lapis, fontSize: 13, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.bg },
  chipOn: { borderColor: colors.gold, backgroundColor: colors.amber },
  chipText: { color: colors.inkSoft, fontSize: 13 },
  chipTextOn: { color: colors.ink, fontWeight: "600" },
  shareBtn: { backgroundColor: colors.gold, borderRadius: 12, paddingVertical: 13, alignItems: "center", marginTop: 14 },
  shareBtnBusy: { opacity: 0.8 },
  busyRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  shareText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
