// One-tap backup of the reader's research.db (notes, questions, meanings,
// trails, prefs) via the OS share sheet — save to Drive, email it to yourself,
// etc. Everything the reader has produced lives in this single file.

import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { researchDbPath } from "../data/db";

export async function backupResearch(): Promise<void> {
  const src = researchDbPath();
  if (!src) throw new Error("Research database isn't ready yet.");
  const from = src.startsWith("file://") ? src : `file://${src}`;
  const stamp = new Date().toISOString().slice(0, 10);
  const dest = `${FileSystem.cacheDirectory}alsiraat-research-${stamp}.db`;

  await FileSystem.copyAsync({ from, to: dest });

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing isn't available on this device.");
  }
  await Sharing.shareAsync(dest, {
    mimeType: "application/x-sqlite3",
    dialogTitle: "Back up your research",
    UTI: "public.database",
  });
}
