# Quran fonts (optional but recommended)

By default the reader uses the device's system Arabic font. For an authentic
mushaf look — and to render IndoPak's Private-Use-Area waqf symbols that are
otherwise stripped — bundle a proper Quran font here.

## Where to get a font

- **Amiri Quran** (easiest, OFL — free for any use): Google Fonts →
  https://fonts.google.com/specimen/Amiri+Quran → "Get font" / Download.
  Gives `AmiriQuran-Regular.ttf`. Classical Naskh, standard-Unicode Quran marks.
- **KFGQPC HAFS Uthmanic Script** (the King Fahd Complex mushaf face; free to
  use & distribute, no modification): the official complex, or mirrors such as
  cufonfonts / font.download. File is `UthmanicHafs.ttf`-style.

Either covers the Uthmani/Imlaei scripts well. A matching **IndoPak** face is a
separate, font-specific case (its pause marks use Private-Use-Area codepoints
tied to the source font); if you don't add one, IndoPak simply keeps rendering
without those PUA marks.

## Enable (runtime load — works in Expo Go, no rebuild)

1. Drop the `.ttf` into this folder, e.g. `assets/fonts/AmiriQuran-Regular.ttf`.
2. Install expo-font:  `npx expo install expo-font`
3. Load it in `App.tsx` (top of the `App` component) and gate render:

   ```tsx
   import { useFonts } from "expo-font";
   // …
   const [fontsLoaded] = useFonts({
     quran: require("./assets/fonts/AmiriQuran-Regular.ttf"),
   });
   if (!fontsLoaded) return null; // or a splash
   ```
4. Point Arabic text at it in `src/theme/tokens.ts`:

   ```ts
   export const font = { arabic: "quran", ui: undefined };
   ```

All reading text (`VerseText`, `WordGrid`) already reads `font.arabic`, so this
one change applies the font everywhere. Reload — no native rebuild needed.
