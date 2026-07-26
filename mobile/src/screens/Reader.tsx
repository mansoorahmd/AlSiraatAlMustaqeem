import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View,
  type ViewToken,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import type { CompositeMatch, Script, Translation, TranslationResource, Verse, Word } from "../types";
import { SCRIPT_LABELS } from "../types";
import { useQuran } from "../state/DbContext";
import { getPref, setPref, notesForChapter, addToActiveCompare, addFocus, removeFocus, isFocused, FOCUS_CAP } from "../data/research";
import { toast } from "../ui/toast";
import type { SpellingVariant } from "../data/spellings";
import { NotesPanel, type NoteScope } from "../components/NotesPanel";
import { EchoPanel } from "../components/EchoPanel";
import { RelatedPanel } from "../components/RelatedPanel";
import { VariantPanel } from "../components/VariantPanel";
import { LegendSheet } from "../components/LegendSheet";
import { VerseText } from "../components/VerseText";
import { WordGrid } from "../components/WordGrid";
import { Chip } from "../components/ui";
import { colors } from "../theme/tokens";

type Props = NativeStackScreenProps<RootStackParamList, "Reader">;

const SCRIPTS: Script[] = ["uthmani", "imlaei", "indopak", "uthmani_simple", "tajweed"];
const RARE_THRESHOLD = 25; // a root occurring ≤ this many times is "rare" (⚲)

// Root echo (↻): a root occurring 2+ times in one āyah. `adjacent` flags a tight
// repeat at neighbouring word positions (cognate accusative مفعول مطلق, emphatic
// doubling) — ranked strongest.
function rootEcho(words: Word[]) {
  const pos = new Map<string, number[]>();
  for (const w of words) {
    if (!w.root) continue;
    const a = pos.get(w.root);
    if (a) a.push(w.position);
    else pos.set(w.root, [w.position]);
  }
  const roots = new Set<string>();
  let adjacent = false;
  for (const [r, ps] of pos) {
    if (ps.length < 2) continue;
    roots.add(r);
    ps.sort((a, b) => a - b);
    for (let i = 1; i < ps.length; i++) if (ps[i]! - ps[i - 1]! === 1) adjacent = true;
  }
  return { has: roots.size > 0, roots, adjacent };
}

const FONT_MIN = 0.8;
const FONT_MAX = 1.7;
const FONT_STEP = 0.15;

export default function Reader({ route, navigation }: Props) {
  const { chapterId, focusVerseKey, focusWordPos, openLens } = route.params;
  const { q, research } = useQuran();

  // reading preferences — all persisted in research.db so they survive reopening
  const [script, setScript] = useState<Script>(() => {
    const s = getPref(research, "script") as Script | null;
    return s && SCRIPTS.includes(s) ? s : "uthmani";
  });
  const [showGloss, setShowGloss] = useState<boolean>(() => getPref(research, "showWords") !== "0");
  const [showLabels, setShowLabels] = useState<boolean>(() => getPref(research, "showLabels") !== "0");
  const [editionIds, setEditionIds] = useState<Set<number>>(() => {
    const e = getPref(research, "editions");
    if (e == null) return new Set([20, 54]); // first run: Saheeh Intl + Urdu
    return new Set(e ? e.split(",").map(Number).filter((n) => !Number.isNaN(n)) : []);
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [selected, setSelected] = useState<{ word: Word; verseKey: string } | null>(null);
  const [actionVerse, setActionVerse] = useState<Verse | null>(null);
  const [notesScope, setNotesScope] = useState<NoteScope | null>(null);
  const [notesVersion, setNotesVersion] = useState(0);
  const [echoVerse, setEchoVerse] = useState<string | null>(null);
  const [echoSet, setEchoSet] = useState<Set<string>>(new Set());
  const [variantSet, setVariantSet] = useState<Set<string>>(new Set());
  const [variantVerse, setVariantVerse] = useState<string | null>(null);
  const [echoRootVerse, setEchoRootVerse] = useState<string | null>(null); // which āyah's root-echo is lit
  const [legend, setLegend] = useState(false);
  const [related, setRelated] = useState<{ title: string; matches: CompositeMatch[]; baseKey?: string } | null>(null);
  const [lens, setLens] = useState<{ baseKey: string; matches: Map<string, CompositeMatch> } | null>(null);
  const [working, setWorking] = useState(false);

  // similarity indexes build on first use (~2–3s once); run after a paint so the
  // "Preparing…" overlay shows instead of a silent freeze
  const runHeavy = (fn: () => void) => {
    setActionVerse(null);
    setWorking(true);
    setTimeout(() => {
      try { fn(); } finally { setWorking(false); }
    }, 30);
  };
  const openRelated = (key: string) =>
    runHeavy(() => setRelated({ title: `Related to ${key}`, matches: q.similar(key, { topK: 40 }), baseKey: key }));
  const focusOn = (key: string) =>
    runHeavy(() => {
      const ms = q.similar(key, { topK: 300 });
      setLens({ baseKey: key, matches: new Map(ms.map((m) => [m.verse_key, m])) });
    });
  const jumpTo = (vk: string) =>
    navigation.push("Reader", { chapterId: Number(vk.split(":")[0]), focusVerseKey: vk });
  const addAyahToCompare = (vk: string) => {
    const r = addToActiveCompare(research, "ayah", vk, null);
    toast(r.added ? `Added ${vk} to “${r.title}”` : `${vk} is already in “${r.title}”`);
  };
  const toggleFocusAyah = (vk: string) => {
    if (isFocused(research, "ayah", vk)) { removeFocus(research, "ayah", vk); toast(`Removed ${vk} from Focus`); return; }
    const r = addFocus(research, "ayah", vk, null);
    toast(r.ok ? `${vk} added to Focus` : r.reason === "full" ? `Focus is full (max ${FOCUS_CAP} āyāt)` : `${vk} is already in Focus`);
  };
  const [fontScale, setFontScale] = useState<number>(() => {
    const v = Number(getPref(research, "fontScale"));
    return v >= FONT_MIN && v <= FONT_MAX ? v : 1;
  });

  const applyScript = (s: Script) => {
    setScript(s);
    setPref(research, "script", s);
  };
  const toggleWords = () =>
    setShowGloss((prev) => {
      const next = !prev;
      setPref(research, "showWords", next ? "1" : "0");
      return next;
    });
  const toggleLabels = () =>
    setShowLabels((prev) => {
      const next = !prev;
      setPref(research, "showLabels", next ? "1" : "0");
      return next;
    });
  const changeFont = (delta: number) => {
    setFontScale((prev) => {
      const next = Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round((prev + delta) * 100) / 100));
      setPref(research, "fontScale", String(next));
      return next;
    });
  };

  const chapter = useMemo(() => q.chapter(chapterId), [q, chapterId]);
  const resources = useMemo(() => q.translationResources(), [q]);
  const freq = useMemo(() => q.rootFrequencies(), [q]);
  const verses = useMemo(
    () => q.chapterVerses(chapterId, { script, withWords: true }),
    [q, chapterId, script],
  );
  const listRef = useRef<FlatList<Verse>>(null);

  // opened from Home's "In focus" āyah → drop straight into its Focus lens
  const lensAutoOpened = useRef(false);
  useEffect(() => {
    if (lensAutoOpened.current || !openLens || !focusVerseKey || verses.length === 0) return;
    lensAutoOpened.current = true;
    focusOn(focusVerseKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openLens, focusVerseKey, verses.length]);

  // notes attached anywhere in this chapter → reader markers (refresh on change)
  const chapterNotes = useMemo(
    () => notesForChapter(research, chapterId),
    [research, chapterId, notesVersion],
  );
  const ayahNoteCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of chapterNotes) if (n.word_position == null) m.set(n.verse_key, (m.get(n.verse_key) ?? 0) + 1);
    return m;
  }, [chapterNotes]);
  const wordNoted = useMemo(() => {
    const m = new Map<string, Set<number>>();
    for (const n of chapterNotes) {
      if (n.word_position != null) {
        if (!m.has(n.verse_key)) m.set(n.verse_key, new Set());
        m.get(n.verse_key)!.add(n.word_position);
      }
    }
    return m;
  }, [chapterNotes]);
  const bumpNotes = () => setNotesVersion((v) => v + 1);

  // build the echo index off the first frame so opening a sūrah isn't blocked;
  // it's cached after the first build, so later chapters resolve instantly
  // echo (≡) marks — index warms off the main thread, then marks appear
  useEffect(() => {
    let alive = true;
    q.echoesReady().then(() => { if (alive) setEchoSet(new Set(q.chapterEchoes(chapterId))); });
    return () => { alive = false; };
  }, [q, chapterId]);

  // spelling-variant (✍) marks — same non-blocking warm-up
  useEffect(() => {
    let alive = true;
    q.variantsReady().then(() => { if (alive) setVariantSet(q.variantVerses(chapterId)); });
    return () => { alive = false; };
  }, [q, chapterId]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: chapter?.name_simple ?? `Sūrah ${chapterId}`,
      headerRight: () => (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 4 }}>
          <Pressable onPress={() => setLegend(true)} hitSlop={12}>
            <Text style={{ fontSize: 18, color: colors.inkSoft }}>ⓘ</Text>
          </Pressable>
          <Pressable onPress={() => setPrefsOpen(true)} hitSlop={12}>
            <Text style={{ fontSize: 20, color: colors.ink }}>⚙</Text>
          </Pressable>
        </View>
      ),
    });
  }, [navigation, chapter, chapterId]);

  // scroll to the focus verse (from an occurrence / search / trail / echo jump).
  // Variable-height rows mean a far-down target may not be measured yet, so we
  // retry (onScrollToIndexFailed estimates an offset first, then re-attempts).
  const focusIndex = useRef<number>(-1);
  const scrollToFocus = useCallback((animated: boolean) => {
    const idx = focusIndex.current;
    if (idx >= 0) listRef.current?.scrollToIndex({ index: idx, viewPosition: 0.2, animated });
  }, []);
  useEffect(() => {
    if (!focusVerseKey) { focusIndex.current = -1; return; }
    const idx = verses.findIndex((v) => v.verse_key === focusVerseKey);
    focusIndex.current = idx;
    if (idx < 0) return;
    const t = setTimeout(() => scrollToFocus(true), 300);
    return () => clearTimeout(t);
  }, [focusVerseKey, verses, scrollToFocus]);

  const translationsFor = useCallback(
    (key: string): Translation[] =>
      editionIds.size ? q.verseTranslations(key).filter((t) => editionIds.has(t.resource_id)) : [],
    [q, editionIds],
  );

  const toggleEdition = (id: number) =>
    setEditionIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      setPref(research, "editions", [...next].join(","));
      return next;
    });

  // resume-reading: remember the top-most visible āyah (debounced)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const top = viewableItems[0]?.item as Verse | undefined;
    if (!top) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setPref(research, "lastVerseKey", top.verse_key), 700);
  });
  const viewConfig = useRef({ itemVisiblePercentThreshold: 50 });

  // clean (markup-free) Arabic for copy/share, regardless of the on-screen script
  const cleanArabic = (key: string) => (q.verse(key, { script: "uthmani" })?.text as string) ?? "";
  const composeShare = (v: Verse, withTranslations: boolean) => {
    let out = `${cleanArabic(v.verse_key)}\n(${v.verse_key})`;
    if (withTranslations) {
      const ts = translationsFor(v.verse_key);
      if (ts.length) out += "\n\n" + ts.map((t) => t.text).join("\n\n");
    }
    return out;
  };
  const copyVerse = async (v: Verse, withTranslations: boolean) => {
    await Clipboard.setStringAsync(composeShare(v, withTranslations));
    setActionVerse(null);
  };
  const shareVerse = async (v: Verse) => {
    await Share.share({ message: composeShare(v, true) });
    setActionVerse(null);
  };

  const arabicSize = Math.round(26 * fontScale);
  const verseSize = Math.round(28 * fontScale);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {lens && (
        <View style={styles.lensBanner}>
          <Pressable style={{ flex: 1 }} onPress={() => jumpTo(lens.baseKey)}>
            <Text style={styles.lensLabel}>⊙ FOCUS LENS</Text>
            <Text style={styles.lensBase}>
              {lens.baseKey} · {q.chapter(Number(lens.baseKey.split(":")[0]))?.name_simple}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setRelated({ title: `Focus · ${lens.baseKey}`, matches: [...lens.matches.values()].slice(0, 60), baseKey: lens.baseKey })}
            style={styles.lensConnBtn}
          >
            <Text style={styles.lensConnText}>Connections {lens.matches.size}</Text>
          </Pressable>
          <Pressable onPress={() => setLens(null)} hitSlop={10} style={{ paddingHorizontal: 6 }}>
            <Text style={styles.lensClose}>✕</Text>
          </Pressable>
        </View>
      )}
      <FlatList
        ref={listRef}
        data={verses}
        keyExtractor={(v) => v.verse_key}
        contentContainerStyle={{ padding: 14, paddingBottom: 48 }}
        removeClippedSubviews
        windowSize={9}
        maxToRenderPerBatch={8}
        initialNumToRender={8}
        onScrollToIndexFailed={(info) => {
          // target row isn't measured yet: jump near it, then retry once rendered
          const offset = Math.max(0, info.averageItemLength * info.index - 80);
          listRef.current?.scrollToOffset({ offset, animated: false });
          setTimeout(() => scrollToFocus(true), 140);
        }}
        onViewableItemsChanged={onViewable.current}
        viewabilityConfig={viewConfig.current}
        renderItem={({ item }) => {
          const focused = item.verse_key === focusVerseKey;
          // drop the trailing āyah-end marker (null POS) so tokens/words align
          const words = (item.words ?? []).filter((w) => w.pos != null);
          const noted = wordNoted.get(item.verse_key);
          const ayahNotes = ayahNoteCount.get(item.verse_key) ?? 0;
          const match = lens?.matches.get(item.verse_key);
          const focusRoots = match ? new Set(match.shared) : undefined;
          const hasRare = words.some((w) => w.root != null && (freq.get(w.root) ?? 1e9) <= RARE_THRESHOLD);
          const echo = rootEcho(words);
          const echoLit = echoRootVerse === item.verse_key;
          const litRoots = echoLit ? new Set([...(focusRoots ?? []), ...echo.roots]) : focusRoots;
          return (
            <View style={[styles.verse, focused && styles.verseFocused, !!match && styles.verseInFocus]}>
              <View style={styles.verseHead}>
                <Text style={styles.verseKey}>{item.verse_key}</Text>
                <View style={styles.verseTools}>
                  {variantSet.has(item.verse_key) && (
                    <Pressable onPress={() => setVariantVerse(item.verse_key)} hitSlop={10} style={styles.verseMore}>
                      <Text style={styles.variantMark}>✍</Text>
                    </Pressable>
                  )}
                  {hasRare && <Text style={styles.rareMark}>⚲</Text>}
                  {echo.has && (
                    <Pressable onPress={() => setEchoRootVerse(echoLit ? null : item.verse_key)} hitSlop={10} style={styles.verseMore}>
                      <Text style={[echo.adjacent ? styles.echoRootStrong : styles.echoRootMark, echoLit && styles.echoRootActive]}>↻</Text>
                    </Pressable>
                  )}
                  {match && (
                    <Pressable
                      onPress={() => setRelated({ title: `Why in focus · ${item.verse_key}`, matches: [match], baseKey: lens?.baseKey })}
                      hitSlop={10}
                      style={styles.verseMore}
                    >
                      <Text style={[styles.verseMoreText, { color: colors.gold }]}>⊙</Text>
                    </Pressable>
                  )}
                  {echoSet.has(item.verse_key) && (
                    <Pressable onPress={() => setEchoVerse(item.verse_key)} hitSlop={10} style={styles.verseMore}>
                      <Text style={[styles.verseMoreText, { color: colors.gold }]}>≡</Text>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => setNotesScope({ verseKey: item.verse_key })}
                    hitSlop={10}
                    style={styles.verseMore}
                  >
                    <Text style={[styles.verseMoreText, ayahNotes > 0 && { color: colors.lapis }]}>
                      ✎{ayahNotes > 0 ? ` ${ayahNotes}` : ""}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => setActionVerse(item)} hitSlop={10} style={styles.verseMore}>
                    <Text style={styles.verseMoreText}>⋯</Text>
                  </Pressable>
                </View>
              </View>

              {showGloss && words.length ? (
                <WordGrid
                  words={words}
                  showGloss={showLabels}
                  onWordPress={(w) => setSelected({ word: w, verseKey: item.verse_key })}
                  arabicSize={arabicSize}
                  notedPositions={noted}
                  highlightRoots={litRoots}
                />
              ) : (
                <VerseText
                  text={(item.text as string) ?? ""}
                  words={words}
                  onWordPress={(w) => setSelected({ word: w, verseKey: item.verse_key })}
                  size={verseSize}
                  notedPositions={noted}
                  highlightRoots={litRoots}
                />
              )}

              {translationsFor(item.verse_key).map((t) => (
                <View key={t.resource_id} style={styles.translation}>
                  <Text style={[styles.translationText, { fontSize: Math.round(15 * fontScale) }]}>{t.text}</Text>
                  <Text style={styles.translationBy}>— {t.resource_name ?? t.language_name}</Text>
                </View>
              ))}
            </View>
          );
        }}
      />

      <WordSheet
        word={selected?.word ?? null}
        rootFreq={selected?.word.root ? freq.get(selected.word.root) ?? null : null}
        variants={selected ? q.spellingVariants(selected.verseKey, selected.word.position) : []}
        onJumpVerse={(vk) => { setSelected(null); jumpTo(vk); }}
        onClose={() => setSelected(null)}
        onOpenRoot={(bw) => {
          setSelected(null);
          navigation.navigate("RootDetail", { root: bw });
        }}
        onFollowWord={(surface, label) => {
          setSelected(null);
          navigation.push("Trail", { word: surface, label });
        }}
        onFollowRoot={(bw) => {
          setSelected(null);
          navigation.push("Trail", { root: bw });
        }}
        onOpenNotes={(w) => {
          const vk = selected?.verseKey;
          setSelected(null);
          if (vk) setNotesScope({ verseKey: vk, wordPosition: w.position, lemma: w.lemma, root: w.root, wordArabic: w.arabic });
        }}
      />

      <NotesPanel
        visible={!!notesScope}
        scope={notesScope}
        research={research}
        onClose={() => setNotesScope(null)}
        onChanged={bumpNotes}
        onJump={(vk) => {
          setNotesScope(null);
          navigation.push("Reader", { chapterId: Number(vk.split(":")[0]), focusVerseKey: vk });
        }}
      />

      <VariantPanel
        visible={!!variantVerse}
        verseKey={variantVerse}
        q={q}
        onClose={() => setVariantVerse(null)}
        onJump={(vk) => { setVariantVerse(null); jumpTo(vk); }}
      />

      <LegendSheet visible={legend} onClose={() => setLegend(false)} />

      <EchoPanel
        visible={!!echoVerse}
        verseKey={echoVerse}
        q={q}
        editionIds={editionIds}
        onClose={() => setEchoVerse(null)}
        onAddCompare={addAyahToCompare}
        onJump={(vk) => {
          setEchoVerse(null);
          navigation.push("Reader", { chapterId: Number(vk.split(":")[0]), focusVerseKey: vk });
        }}
      />

      <RelatedPanel
        visible={!!related}
        title={related?.title ?? ""}
        matches={related?.matches ?? []}
        q={q}
        editionIds={editionIds}
        baseKey={related?.baseKey}
        onClose={() => setRelated(null)}
        onAddCompare={addAyahToCompare}
        onJump={(vk) => { setRelated(null); jumpTo(vk); }}
      />

      {working && (
        <View style={styles.overlay}>
          <ActivityIndicator color={colors.gold} size="large" />
          <Text style={styles.overlayText}>Preparing related āyāt…</Text>
        </View>
      )}

      <EditionPicker
        visible={pickerOpen}
        resources={resources}
        selected={editionIds}
        onToggle={toggleEdition}
        onClose={() => setPickerOpen(false)}
      />

      <Modal visible={prefsOpen} transparent animationType="slide" onRequestClose={() => setPrefsOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPrefsOpen(false)}>
          <Pressable style={styles.prefsSheet} onPress={() => {}}>
            <View style={styles.pickerHead}>
              <Text style={styles.pickerTitle}>Reading preferences</Text>
              <Pressable onPress={() => setPrefsOpen(false)}>
                <Text style={styles.pickerDone}>Done</Text>
              </Pressable>
            </View>

            <Text style={styles.prefLabel}>Script</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6 }}>
              {SCRIPTS.map((s) => (
                <Chip key={s} label={SCRIPT_LABELS[s]} active={script === s} onPress={() => applyScript(s)} />
              ))}
            </ScrollView>

            <Text style={styles.prefLabel}>Text size</Text>
            <View style={styles.prefRow}>
              <Pressable style={styles.fontBtn} onPress={() => changeFont(-FONT_STEP)}>
                <Text style={styles.fontBtnText}>A−</Text>
              </Pressable>
              <Text style={styles.prefValue}>{Math.round(fontScale * 100)}%</Text>
              <Pressable style={styles.fontBtn} onPress={() => changeFont(FONT_STEP)}>
                <Text style={[styles.fontBtnText, { fontSize: 20 }]}>A+</Text>
              </Pressable>
            </View>

            <Text style={styles.prefLabel}>Display</Text>
            <View style={styles.prefRow}>
              <Chip label="Word-by-word" active={showGloss} onPress={toggleWords} />
              {showGloss && <Chip label="Meanings" active={showLabels} onPress={toggleLabels} />}
              <Chip
                label={`Translations (${editionIds.size})`}
                active={editionIds.size > 0}
                onPress={() => setPickerOpen(true)}
              />
            </View>
            <Text style={styles.prefHint}>
              Tap any word for its root — in either view. Continuous follows the selected script;
              word-by-word shows canonical forms with optional meanings.
            </Text>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!actionVerse} transparent animationType="fade" onRequestClose={() => setActionVerse(null)}>
        <Pressable style={styles.backdrop} onPress={() => setActionVerse(null)}>
          <Pressable style={styles.actionSheet} onPress={() => {}}>
            {actionVerse && (
              <>
                <Text style={styles.actionKey}>Āyah {actionVerse.verse_key}</Text>
                <Pressable style={styles.actionRow} onPress={() => copyVerse(actionVerse, false)}>
                  <Text style={styles.actionText}>Copy Arabic</Text>
                </Pressable>
                <Pressable style={styles.actionRow} onPress={() => copyVerse(actionVerse, true)}>
                  <Text style={styles.actionText}>Copy with translation</Text>
                </Pressable>
                <Pressable style={styles.actionRow} onPress={() => shareVerse(actionVerse)}>
                  <Text style={styles.actionText}>Share…</Text>
                </Pressable>
                <Pressable style={styles.actionRow} onPress={() => openRelated(actionVerse.verse_key)}>
                  <Text style={styles.actionText}>Related āyāt</Text>
                </Pressable>
                <Pressable style={styles.actionRow} onPress={() => focusOn(actionVerse.verse_key)}>
                  <Text style={styles.actionText}>⊙ Focus lens (highlight connections)</Text>
                </Pressable>
                <Pressable
                  style={styles.actionRow}
                  onPress={() => { toggleFocusAyah(actionVerse.verse_key); setActionVerse(null); }}
                >
                  <Text style={styles.actionText}>
                    {isFocused(research, "ayah", actionVerse.verse_key) ? "★ Remove from Focus" : "★ Add to Focus"}
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.actionRow}
                  onPress={() => { addAyahToCompare(actionVerse.verse_key); setActionVerse(null); }}
                >
                  <Text style={styles.actionText}>⇋ Add to Compare</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function EditionPicker({
  visible,
  resources,
  selected,
  onToggle,
  onClose,
}: {
  visible: boolean;
  resources: TranslationResource[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.pickerSheet} onPress={() => {}}>
          <View style={styles.pickerHead}>
            <Text style={styles.pickerTitle}>Translations & tafsir ({selected.size} shown)</Text>
            <Pressable onPress={onClose}>
              <Text style={styles.pickerDone}>Done</Text>
            </Pressable>
          </View>
          <FlatList
            data={resources}
            keyExtractor={(r) => String(r.id)}
            style={{ maxHeight: 460 }}
            renderItem={({ item }) => {
              const on = selected.has(item.id);
              return (
                <Pressable style={styles.editionRow} onPress={() => onToggle(item.id)}>
                  <Text style={[styles.check, on && styles.checkOn]}>{on ? "☑" : "☐"}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.editionName}>{item.name ?? item.author_name ?? `#${item.id}`}</Text>
                    <Text style={styles.editionLang}>
                      {item.language_name}{item.resource_type === "tafsir" ? " · tafsir" : ""}
                    </Text>
                  </View>
                </Pressable>
              );
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function WordSheet({
  word,
  rootFreq,
  variants,
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

const styles = StyleSheet.create({
  controls: {
    paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
  },
  sep: { width: 1, height: 22, backgroundColor: colors.border, marginRight: 8, marginBottom: 8 },
  fontBtn: {
    width: 40, height: 34, borderRadius: 8, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, alignItems: "center", justifyContent: "center",
    marginRight: 8, marginBottom: 8,
  },
  fontBtnText: { color: colors.ink, fontSize: 15, fontWeight: "600" },
  actionSheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 34,
  },
  actionKey: { color: colors.gold, fontWeight: "700", fontSize: 13, marginBottom: 6 },
  actionRow: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.surfaceAlt },
  actionText: { color: colors.ink, fontSize: 16 },
  verse: {
    backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    padding: 14, marginBottom: 12,
  },
  verseFocused: { borderColor: colors.gold, backgroundColor: "#fffdf5" },
  verseInFocus: { borderColor: colors.amberStrong },
  lensBanner: {
    flexDirection: "row", alignItems: "center", backgroundColor: colors.ink,
    paddingHorizontal: 14, paddingVertical: 10, gap: 8,
  },
  lensLabel: { color: colors.amberStrong, fontSize: 10, fontWeight: "700", letterSpacing: 0.6 },
  lensBase: { color: "#fff", fontSize: 15, fontWeight: "600", marginTop: 2 },
  lensConnBtn: { backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  lensConnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  lensClose: { color: "#fff", fontSize: 18 },
  verseHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  verseKey: { color: colors.gold, fontWeight: "700", fontSize: 12 },
  verseTools: { flexDirection: "row", alignItems: "center", gap: 4 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(250,248,243,0.85)", alignItems: "center", justifyContent: "center",
  },
  overlayText: { color: colors.inkSoft, marginTop: 12, fontSize: 14 },
  rareMark: { color: colors.inkSoft, fontSize: 15, paddingHorizontal: 4 },
  variantMark: { color: colors.amberStrong, fontSize: 15, paddingHorizontal: 4 },
  echoRootMark: { color: colors.inkSoft, fontSize: 16, paddingHorizontal: 4 },
  echoRootStrong: { color: colors.gold, fontSize: 16, fontWeight: "700", paddingHorizontal: 4 },
  echoRootActive: { color: colors.lapis },
  rareLine: { color: colors.gold, fontSize: 13, textAlign: "center", marginTop: 12 },
  verseMore: { paddingHorizontal: 8, paddingVertical: 2 },
  verseMoreText: { color: colors.inkSoft, fontSize: 16, lineHeight: 20 },
  notesBtn: {
    marginTop: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingVertical: 11, alignItems: "center",
  },
  notesBtnText: { color: colors.lapis, fontWeight: "600", fontSize: 15 },
  translation: { marginTop: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  translationText: { color: colors.ink, fontSize: 15, lineHeight: 22 },
  translationBy: { color: colors.inkSoft, fontSize: 11, marginTop: 3 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    padding: 22, paddingBottom: 34,
  },
  sheetArabic: { fontSize: 40, color: colors.ink, textAlign: "center", writingDirection: "rtl" },
  sheetTranslit: { fontSize: 15, color: colors.lapis, textAlign: "center", marginTop: 6 },
  sheetGloss: { fontSize: 17, color: colors.ink, textAlign: "center", marginTop: 6, fontWeight: "600" },
  variantsBox: {
    marginTop: 14, borderWidth: 1, borderColor: colors.amberStrong, borderRadius: 10,
    backgroundColor: colors.amber, padding: 12,
  },
  variantsTitle: { color: colors.ink, fontSize: 13, fontWeight: "700", marginBottom: 8 },
  variantRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  variantArabic: { color: colors.ink, fontSize: 26, writingDirection: "rtl", flex: 1 },
  variantCount: { color: colors.inkSoft, fontSize: 13, marginHorizontal: 10 },
  variantJump: { color: colors.lapis, fontSize: 13, fontWeight: "600" },
  sheetMeta: { flexDirection: "row", justifyContent: "center", gap: 14, marginTop: 10 },
  sheetMetaText: { color: colors.inkSoft, fontSize: 13 },
  rootBtn: {
    marginTop: 18, backgroundColor: colors.ink, borderRadius: 10, paddingVertical: 12, alignItems: "center",
  },
  rootBtnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  noRoot: { color: colors.inkSoft, textAlign: "center", marginTop: 16 },
  pickerSheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 28,
  },
  prefsSheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 30,
  },
  prefLabel: {
    color: colors.inkSoft, fontSize: 12, fontWeight: "700", textTransform: "uppercase",
    letterSpacing: 0.6, marginTop: 14, marginBottom: 8,
  },
  prefRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  prefValue: { color: colors.ink, fontSize: 15, fontWeight: "600", marginHorizontal: 14, marginBottom: 8 },
  prefHint: { color: colors.inkSoft, fontSize: 12, marginTop: 10, lineHeight: 17 },
  pickerHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  pickerTitle: { fontSize: 15, fontWeight: "700", color: colors.ink },
  pickerDone: { color: colors.lapis, fontWeight: "600", fontSize: 15 },
  editionRow: { flexDirection: "row", alignItems: "center", paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.surfaceAlt },
  check: { fontSize: 20, color: colors.inkSoft, marginRight: 12 },
  checkOn: { color: colors.gold },
  editionName: { color: colors.ink, fontSize: 14 },
  editionLang: { color: colors.inkSoft, fontSize: 11, marginTop: 1 },
});
