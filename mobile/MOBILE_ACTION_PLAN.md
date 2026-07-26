# AlSiraat Mobile — Reader Action Plan

Bring the **full reading experience** of the web app to the Android app, offline.
The investigation side (Case Board, evidence cards, threads/clusters, form
dossier, establish/verdict flow, curated case files, case export) is **out of
scope for now** — deferred to a later phase. Everything that lives in or feeds
the **Reader** is in scope.

> Personal, non-board features that already exist stand: per-root **"my
> meaning"** stays (it's a reader/lexicon feature, not the case board).

---

## 1. Scope

**In (this phase):** everything a reader touches — reading mechanics, resume,
notes & questions, verbatim echoes, related āyāt + an āyah focus lens, trails,
margin marks, a reader dashboard, and the supporting Roots/Search finishing
work.

**Out (deferred):** the Investigate tab — Case Board (pan/zoom canvas, cards,
ink threads, clusters), the form dossier, establishing meanings / root verdict,
curated case files, and case/report export.

---

## 2. Current status

| Area | Web | Mobile today |
|---|---|---|
| Mushaf reader, scripts, word-by-word | ✅ | ✅ |
| Translations | ✅ | ✅ (all 168 editions bundled + picker) |
| Word → root lookup | ✅ | ✅ (word sheet → RootDetail) |
| Roots explorer + lexicon + collocations + my-meaning | ✅ | ✅ |
| Phrase search + Arabic keyboard | ✅ | ✅ |
| Related (free-text) search | ✅ composite | ✅ full composite (M4) |
| Font scaling, resume reading | ✅ | ✅ (M1) |
| Āyah copy/share, preferences sheet | — | ✅ (M1) |
| Notes & questions | ✅ V9 | ✅ (M2) |
| Verbatim echoes (≡) | ✅ V10 | ✅ (M3) |
| Related āyāt + focus lens | ✅ V8 | ✅ (M4) |
| Trails + rare-root marks | ✅ V5 | ✅ (M5) |
| Home dashboard | ✅ V11 | ✅ (M6) |
| Motifs, occurrences-by-form, recents | ✅ V14/15 | ✅ (M7) |
| Compare tray (āyāt/roots side by side) | ✅ V15 | ✅ |

### Beyond the web app (mobile-only, built after parity)

| Feature | Status | Notes |
|---|---|---|
| Spelling / rasm variants (✍) + word sheet | ✅ | morphology tag + skeleton; Ibrāhīm full vs small yāʾ, رأى vs رءا |
| Follow the thread — exact word **or** root | ✅ | exact written spelling (rasm) works for particles & names; both walk stop-by-stop |
| Root echo (↻) — same root twice in one āyah | ✅ | bright gold = adjacent/cognate-accusative; faint = same-āyah; tap to light |
| Wazn (صرف pattern) on the word sheet | ✅ | Form I–XII, active/passive participle, masdar + sense, aspect/voice, radicals |
| Compare → **named, saveable comparisons** | ✅ | vertical timeline + git-tree of shared roots; "✚ Add to Compare" everywhere; per-card global notes; rename/set-active/delete |
| Focus shortlist (persisted, on Home) | ✅ | ≤5 āyāt + ≤5 roots; ★ toggle; tap a Home āyah → reopen with its lens |
| Reader header sūra name → sūra list | ✅ | tap the ▾ title from any tab's reader |
| App icon, splash, marks legend / onboarding | ✅ | self-correcting-path logo; LegendSheet covers marks, word sheet, tools |

---

## 3. Architecture (unchanged)

Offline-first. Pure query modules depend on a small `Db` interface; on-device
it's `expo-sqlite`, in the parity harness it's `node:sqlite`. **Every new
data-layer module gets a golden-fixture parity check** (`npm run parity`) before
its UI is built, so the phone keeps returning byte-identical results to the
server.

Three data-layer ports remain, and they gate the reader features that need them:

- **`echoes.ts`** — the `EchoIndex` over folded surface words (repeated
  contiguous n-grams). Powers ≡ marks + the echo panel. → M3
- **`similarity/morphology.ts` + `similarity/compose.ts`** — blend the existing
  lexical score with POS n-gram scoring for `/verses/{key}/similar`. Powers
  Related āyāt + the focus lens, and upgrades Related **search** to full
  composite parity. → M4
- **root-frequency map** — one cheap `GROUP BY` for ⚲ rare-root marks. → M5

Client-side additions: a tiny key/value store (reuse `research.db`) for reading
prefs + last position, and new `research.db` tables for `trails` (and later
`motifs`).

---

## 4. Milestones

Each milestone is independently shippable and verified (typecheck + on-device
smoke test; data ports also add parity fixtures).

### M1 — Reading polish & resume ✅ DONE
- **Preferences sheet** (⚙ in the nav bar) holding all reading settings, each
  **persisted** in `research.db`: script (Uthmani/Imlaei/IndoPak/Tajweed),
  text-size, word-by-word, per-word "Meanings", and the translations picker.
- **Resume reading** — the top āyah in view is saved (`lastVerseKey`); the
  chapter list shows a **Continue reading** banner that jumps back.
- **Āyah actions** — a ⋯ button per āyah: Copy Arabic, Copy with translation,
  Share (always clean Uthmani text).
- **Tap any word in either view** — continuous view renders the selected script
  with each word tappable (script tokens aligned 1:1 to word positions, āyah-end
  marker dropped); word-by-word shows canonical forms.
- **Rendering fix** — strips only unrenderable Private-Use-Area glyphs
  (IndoPak's font-specific waqf codepoints that showed as tofu) + zero-width
  controls; all standard Unicode pause/sajda marks are preserved.
- **Follow-up (→ M8 font pass):** bundle a proper Quran font (Uthmanic + an
  IndoPak face) so the PUA waqf symbols render instead of being omitted.
- Maps: web V1 + V11 resume.

### M2 — Notes & questions  (web V9) ✅ DONE
> Shipped: reusable `NotesPanel`; notes/questions on āyah or word; answer/
> reopen/edit/delete; lapis word markers (colour only — no underline, to keep
> harakat clear); ✎ āyah button with count; word-sheet root cross-references
> with jump; global **Open Questions** screen + ❓ header badge. All in the
> `notes` table of `research.db`.
- Attach a **note** or **question** to a whole āyah or a specific **word**
  (from the word sheet and an āyah ✎ affordance).
- **Answerable questions** (resolve/reopen), edit/delete.
- **Markers** — a dotted underline on worded notes; ✎ + count by the āyah number.
- **Cross-references** — word notes store lemma + root; the word sheet surfaces
  "N notes on this root · M open ?" across forms.
- **Open Questions** view (header badge / Home tile) listing every unresolved
  question with jump-to.
- Data: `research.db` notes ops already ported — build the UI + wire markers.

### M3 — Verbatim echoes (≡)  (web V10) ✅ DONE
> Shipped: `EchoIndex` ported on-device (built off the first frame, cached);
> parity harness extended with the known-repeat checks (Ar-Raḥmān refrain,
> basmala→27:30, chapter-55 set) — all green. ≡ mark on āyāt that carry a
> repeated phrase; **EchoPanel** lists each maximal repeated phrase, the other
> āyāt it occurs in (verse key · sūrah, tap to jump), and **Compare here** to
> pull those āyāt inline (with the reader's selected translations shown under
> each). (Inline sub-word span highlight deferred to a later
> polish pass — v1 shows the folded phrase + full comparison āyāt.)

### M4 — Related āyāt + Focus lens  (web V8) ✅ DONE
> Shipped: `similarity/{lexical,morphology,compose,freetext}.ts` ported
> on-device (one shared engine for `/similar` + free-text search, built once).
> Parity harness extended with `similar_2:143/55:13/1:1/112:1` and the `search`
> fixtures — all green (scores/shared/pattern/phrase_run within 1e-4). **Related
> search** upgraded from lexical-only to **full composite**. **Related āyāt**
> sheet from a āyah's ⋯ menu (closest-first, score, shared roots, phrase run,
> jump). **Āyah focus lens**: pin from ⋯ → sticky banner (base · Connections
> map · close), ⊙ on every matching āyah, shared-root words lit gold, and ⊙ →
> "why in focus" (that match's shared roots + phrase run). Case-based lens stays
> out with the investigation tab. Note: first similar/search/focus call builds
> the engine (~2–3s one-time), cached after.

### M5 — Trails + margin marks  (web V5) ✅ DONE
> Two threads per word: **Follow this exact word** (the written surface — rasm,
> so vowel/case marks are ignored but a differently-spelled form like Ibrāhīm's
> small-yāʾ vs full-yāʾ stays its own thread; works for rootless particles like
> مِمَّا and for proper nouns) and **Follow the root** (all derived forms). Each
> Trail highlights the exact occurrence word at every stop and shows the
> selected translations.
>
> Shipped: **Follow the thread** from a word's sheet → a **Trail** screen that
> walks every occurrence of that root, the current word lit gold, the selected
> translations shown beneath it, prev/next, **Open in reader**, and a
> **114-sūrah TrailStrip** (bar height = hits per
> sūrah, current sūrah in lapis, tap a sūrah to jump). **Save trail** →
> `research.db` `trails`; a saved-trails shelf (empty state + ⚲ header entry)
> resumes at the saved position. **⚲ rare-root**: cached root-frequency map;
> a ⚲ mark on āyāt containing a root that occurs ≤ 25× in the Book, and a
> "rare root · appears N times" line in the word sheet. (Promote-to-case
> deferred with the investigation tab.)

### M6 — Reader dashboard  (web V11, reader subset) ✅ DONE
> Shipped: a **Home** tab (now the default landing) tying the reader together —
> a **Continue reading** card (resumes at `lastVerseKey`), stat tiles for
> **open questions** and **my meanings**, a **Recent trails** list (resume at
> saved position), and **Explore** links to Roots and Search. Cross-tab
> navigation into the Read/Roots/Search stacks. New **My meanings** screen
> (lists the reader's personal root definitions → RootDetail), plus
> `listUserRootMeanings` / `userRootMeaningCount` helpers. Open cases excluded
> with the investigation tab.

### M7 — Roots & Search finishing  (web V12–V15, reader-relevant) ✅ DONE
> Shipped: root page **occurrences grouped by form** (lemma sub-headers with POS
> + count; toggle to mushaf order). **Motifs** — `research.db` `motifs` /
> `motif_roots`; a `MotifPicker` sheet on the root page ("❦ Add to motif",
> create + tick membership); a **Motifs** screen (create/rename/delete, member
> root chips → open root, long-press to remove) reached from the Roots header
> and Home. **Recent searches** (capped, in prefs) shown as tap-to-rerun chips.
> Jump-to verse key was done in M6. **Compare tray** ✅ — a `compare` table +
> a Compare tab. **Redesigned for phones** (was horizontal columns): now a
> vertical **timeline** — a spine with nodes and collapsible cards, and shared
> roots **colour-threaded** down the page (each recurring root gets a lane
> colour; the same colour reappearing across cards is the git-tree linkage).
> A top "threads" legend lists shared roots ×count; each card shows a
> "shares with above" row of coloured dots. Pin āyāt / roots from the reader
> ⋯ menu and root pages; collapse, remove, clear.

### Wazn (صرف pattern) on the word sheet
> Tapping a word now shows its **wazn** — the morphological measure its shape
> carries. Derived from corpus tags (`verb_form` I–XII, `derivation` =
> ACT PCPL / PASS PCPL / VN, aspect, voice) mapped to the canonical template:
> verbs → فَعَلَ … اِسْتَفْعَلَ (+ a plain-language sense per form, and
> past/present/command · passive); active participle → فَاعِل / مُفْعِل / مُسْتَفْعِل …;
> passive participle → مَفْعُول / مُفْعَل …; masdar → تَفْعِيل / إِفْعَال / اِسْتِفْعَال …
> (Form I masdar is سماعي, shown without a fixed measure). The pattern is the
> abstract ف‑ع‑ل measure shown beside the root's three radicals (no fabricated
> surface, so weak/assimilated roots aren't misrepresented). `data/wazn.ts` +
> `api.wazn(vk,pos)`. Validated: ٱسْتِبْدَال→اِسْتِفْعَال, مُرْسَل→مُفْعَل, ٱهْدِ→فَعَلَ.

### Focus shortlist (persisted, Home-surfaced)
> A persisted **Focus** shortlist (table `focus`, survives restart): up to **5
> āyāt + 5 roots** (`FOCUS_CAP`). Toggle from the reader ⋯ (★ Add/Remove Focus)
> and a root page (☆/★ Focus); over-cap adds are refused with a toast. **Home
> shows an "In focus" section** — focused āyāt as tap-to-open rows and focused
> roots as gold chips, each with a ✕ to remove. Distinct from the ephemeral
> reading **Focus lens** (⊙, highlights a base āyah's connections while reading),
> which stays a separate tool.

### Compare → saveable, named comparisons
> Compare is now a workspace of **named comparisons** (data: `compare_sets` +
> `compare.set_id`; migration moves any legacy pins into "My comparison").
> Always-live: pins land in the **active** comparison; the Compare tab lists all
> saved comparisons (title · count · updated · active flag), opens into the
> timeline board, and supports rename (tap title), set-active, delete, clear,
> and new. **"✚ Add to Compare" is everywhere an āyah shows** — reader ⋯, echo
> panel, related/focus panel, root occurrences, and trail hops (`addToActiveCompare`
> + Android toast). Each āyah card has a **✎ Note** that opens the *global* āyah
> note (same store as the reader — edits reflect everywhere).

### Root echo (↻) — same root twice in one āyah
> A ↻ mark flags any āyah where a root repeats (e.g. cognate accusative
> مفعول مطلق نَصْرًا نَصَرَ, or الرَّحْمَٰنِ الرَّحِيمِ). **Bright gold ↻** = a tight
> adjacent repeat (highest signal); **faint ↻** = the root echoed elsewhere in
> the āyah. Tap the mark to light up every repeated-root word in place. Computed
> live from the āyah's own words (no index). Added to the LegendSheet.

### M8 — Polish & release 🟡 MOSTLY DONE
Shipped (in-app):
- **Backup** — Home → "Back up my research" exports `research.db` via the OS
  share sheet (`expo-sharing`).
- **First-use loading** — Related/Focus show a "Preparing…" overlay instead of
  a silent freeze while the similarity index builds; Search already had this.
- **Off-main-thread index builds** — the echo (≡) and spelling-variant (✍)
  indexes now build via an async read + chunked yielding `warmup()` (`Db.queryAsync`),
  so the reader no longer freezes when marks appear.
- **Reading guide / onboarding** — a `LegendSheet` explains every mark
  (≡ ✍ ⚲ ⊙ ✎ ⋯) and the word colours; shown once on first launch and
  reopenable from Home and the reader's ⓘ button.
- **App icon** — a gold "straight path toward the light" on deep green, wired as
  the icon + Android adaptive icon + splash.
- **Reader perf** — FlatList `removeClippedSubviews` / windowing tuned for long
  sūrahs (already virtualized).
- **Font scaffolding** — Arabic text reads `font.arabic`; drop a `.ttf` in
  `assets/fonts/` and enable per `assets/fonts/README.md`.
- **Release config** — `eas.json` with `preview` (APK) and `production` (AAB)
  profiles; README documents `eas build`.

Needs your machine / assets (can't be done from here):
- Run the actual **`eas build`** (needs your Expo account) to get the APK/AAB.
- Add the **Quran font binaries** (`UthmanicHafs.ttf`, an IndoPak face) — this
  is what makes IndoPak's PUA waqf marks render instead of being stripped.

Deferred (optional): Tajweed colour rendering, dark ("candlelight") theme,
deeper screen-reader/a11y pass, and precomputing the similarity index off-thread
(echo/variant are already non-blocking; the composite engine still builds
on-demand behind its "Preparing…" overlay).

---

## 5. Component inventory to add

- Reader: `FontControl`, `AyahActions`, `MarginRail`, `NotesPanel`,
  `EchoPanel`, `RelatedAyahSheet`, `FocusBanner` + `FocusMap`, `TrailStrip`.
- Data: `data/echoes.ts`, `similarity/morphology.ts`, `similarity/compose.ts`,
  `data/frequencies.ts`; `research.db` gains `trails` (+ `motifs` in M7) and a
  `kv` prefs table.
- State: reading prefs + `lastVerseKey`, active trail, active focus lens.
- Reader extras: **rasm (spelling) variants** — tapping a word written
  differently across the mushaf (إبراهيم full-yāʾ vs small-yāʾ; قال vs قٰل;
  رَأَىٰ vs رَءَا hamza-on-alif vs hamza-on-the-line) shows "✍ written N ways"
  in the word sheet with each spelling, count, and a jump. Same words are
  matched by morphology (`raw_features`) + a normalized skeleton (hamza seats
  and alif/maqṣūra/dagger collapsed), so verb inflections and causatives don't
  false-flag. (`data/spellings.ts`.) A precomputed `VariantIndex`
  (`data/variants.ts`) drives a subtle **✍ mark** on āyāt in the reader that
  contain such a word — built once over the corpus, cached, deferred off the
  first frame.

## 6. Out of scope (deferred phase)

Investigate tab and everything board-related: Case Board canvas, evidence
cards, ink threads, clusters, form dossier, establish/verdict/close, reopen
with revisions, curated case files, case report/MD export.

## 7. Open questions

1. Reading prefs & resume — device-local `kv` in `research.db`, or
   `AsyncStorage`? (Leaning `research.db` so everything user-generated is in one
   backupable file.)
2. Trail strip on a phone — full 114-sūrah horizontal strip, or a compact
   "hops list + mini-map"?
3. Related-āyāt on first use builds an in-memory index (~78k rows) — acceptable
   one-time pause, or precompute/persist into `research.db`?
