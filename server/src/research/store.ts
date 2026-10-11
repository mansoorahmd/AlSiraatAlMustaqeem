// Research store — the reader's own scholarship: cases (+ form_research/revisions), trails,
// notes, root meanings, motifs, indications, comparisons, settings, and the outbox of what they
// have published.
//
// One store per request, over that request's connection, already bound to the signed-in user
// (schema.ts): row-level security shows and admits only their rows, and every insert takes their
// user_id by default — so no query here names a user, and none can reach another's. The tables
// are migrations/0010_research_rls.sql. Every visible ordering is total (ids as the last key).

import type { ResearchDb } from "./pg-research.js";

const now = () => Date.now();
type Doc = Record<string, any>;
type MotifRow = { id: string; name: string; note: string; source?: string; created_at: number; updated_at: number };

export class ResearchStore {
  /**
   * `userId` is the signed-in account: what the reader's records are stamped with as their
   * author (author_id), so a record carries who wrote it wherever it's shown.
   */
  constructor(private db: ResearchDb, readonly userId: string) {}

  // -- cases --
  async listCases(): Promise<Doc[]> {
    return (await this.db.query<{ doc: string }>("SELECT doc FROM cases ORDER BY updated_at DESC, id"))
      .map((r) => JSON.parse(r.doc));
  }
  async getCase(id: string): Promise<Doc | undefined> {
    const row = await this.db.one<{ doc: string }>("SELECT doc FROM cases WHERE id = ?", [id]);
    return row ? JSON.parse(row.doc) : undefined;
  }
  async saveCase(doc: Doc): Promise<Doc> {
    const t = now();
    doc = { ...doc, updatedAt: t };
    doc.createdAt ??= t;
    const subject = doc.subject ?? {};
    await this.db.run(
      `INSERT INTO cases (id, subject_type, subject_value, title, status, verdict, spark_verse_key, doc, created_at, updated_at, author_id, origin)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (user_id, id) DO UPDATE SET subject_type=excluded.subject_type, subject_value=excluded.subject_value,
         title=excluded.title, status=excluded.status, verdict=excluded.verdict,
         spark_verse_key=excluded.spark_verse_key, doc=excluded.doc, updated_at=excluded.updated_at`,
      [doc.id, subject.type ?? "root", subject.value ?? "", doc.title ?? "", doc.status ?? "open",
       doc.verdict ?? "", subject.sparkVerseKey ?? null, JSON.stringify(doc), doc.createdAt, t,
       doc.authorId ?? this.userId, doc.origin ?? "local"],
    );
    await this.reconcileFormResearch(doc);
    return doc;
  }
  async deleteCase(id: string): Promise<boolean> {
    // its form research goes with it (ON DELETE CASCADE)
    return (await this.db.run("DELETE FROM cases WHERE id = ?", [id])).changes > 0;
  }

  /** Keep form_research in step with the case document — the case board is the source. */
  private async reconcileFormResearch(doc: Doc): Promise<void> {
    const caseId = doc.id;
    const root = (doc.subject ?? {}).value ?? "";
    const forms: Record<string, any> = doc.formResearch ?? {};
    const t = now();
    const old = new Map<string, { status: string; meaning: string }>();
    for (const r of await this.db.query<{ lemma: string; status: string; meaning: string }>(
      "SELECT lemma, status, meaning FROM form_research WHERE case_id = ?", [caseId],
    )) old.set(r.lemma, { status: r.status, meaning: r.meaning });

    for (const [lemma, fr] of Object.entries(forms)) {
      const status = fr.status ?? "open";
      const meaning = fr.meaning ?? "";
      const prev = old.get(lemma);
      old.delete(lemma);
      if (prev && prev.status === "established" && prev.meaning && prev.meaning !== meaning) {
        await this.db.run("INSERT INTO form_revisions (case_id, lemma, meaning, replaced_at) VALUES (?,?,?,?)",
          [caseId, lemma, prev.meaning, t]);
      }
      await this.db.run(
        `INSERT INTO form_research (case_id, root, lemma, status, meaning, established_at, updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT (user_id, case_id, lemma) DO UPDATE SET root=excluded.root, status=excluded.status,
           meaning=excluded.meaning, established_at=excluded.established_at, updated_at=excluded.updated_at`,
        [caseId, root, lemma, status, meaning, fr.establishedAt ?? null, t],
      );
    }
    for (const lemma of old.keys()) {
      await this.db.run("DELETE FROM form_research WHERE case_id = ? AND lemma = ?", [caseId, lemma]);
    }
  }

  async formStatus(): Promise<Doc[]> {
    return this.db.query(
      `SELECT fr.lemma, fr.root, fr.status, fr.meaning, fr.case_id, c.status AS case_status
       FROM form_research fr JOIN cases c ON c.id = fr.case_id
       ORDER BY fr.case_id, fr.lemma`,
    );
  }
  async revisions(caseId: string, lemma: string): Promise<Doc[]> {
    return this.db.query(
      "SELECT meaning, replaced_at FROM form_revisions WHERE case_id = ? AND lemma = ? ORDER BY replaced_at DESC, id DESC",
      [caseId, lemma],
    );
  }

  // -- trails --
  async listTrails(): Promise<Doc[]> {
    return (await this.db.query<{ doc: string }>("SELECT doc FROM trails ORDER BY updated_at DESC, id"))
      .map((r) => JSON.parse(r.doc));
  }
  async saveTrail(doc: Doc): Promise<Doc> {
    const t = now();
    doc = { ...doc, updatedAt: t };
    doc.createdAt ??= t;
    await this.db.run(
      `INSERT INTO trails (id, name, subject, doc, created_at, updated_at, author_id, origin) VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT (user_id, id) DO UPDATE SET name=excluded.name, subject=excluded.subject, doc=excluded.doc, updated_at=excluded.updated_at`,
      [doc.id, doc.name ?? "", doc.subject ?? null, JSON.stringify(doc), doc.createdAt, t,
       doc.authorId ?? this.userId, doc.origin ?? "local"],
    );
    return doc;
  }
  async deleteTrail(id: string): Promise<boolean> {
    return (await this.db.run("DELETE FROM trails WHERE id = ?", [id])).changes > 0;
  }

  // -- notes --
  private static noteRow(r: any): Doc {
    return {
      id: r.id, verseKey: r.verse_key, wordPosition: r.word_position, kind: r.kind,
      text: r.text, answer: r.answer ?? "", resolved: !!r.resolved,
      lemma: r.lemma ?? null, root: r.root ?? null, source: r.source ?? "me",
      authorId: r.author_id ?? null, origin: r.origin ?? "local",
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }
  async getNote(id: string): Promise<Doc | undefined> {
    const r = await this.db.one("SELECT * FROM notes WHERE id = ?", [id]);
    return r ? ResearchStore.noteRow(r) : undefined;
  }
  async listNotes(opts: { verse?: string; root?: string; lemma?: string } = {}): Promise<Doc[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts.verse) { clauses.push("verse_key = ?"); params.push(opts.verse); }
    if (opts.root) { clauses.push("root = ?"); params.push(opts.root); }
    if (opts.lemma) { clauses.push("lemma = ?"); params.push(opts.lemma); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return (await this.db.query(`SELECT * FROM notes ${where} ORDER BY created_at, id`, params)).map(ResearchStore.noteRow);
  }
  async saveNote(doc: Doc): Promise<Doc> {
    const t = now();
    doc = { ...doc, updatedAt: t };
    doc.createdAt ??= t;
    await this.db.run(
      `INSERT INTO notes (id, verse_key, word_position, kind, text, answer, resolved, lemma, root, source, created_at, updated_at, author_id, origin)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (user_id, id) DO UPDATE SET verse_key=excluded.verse_key, word_position=excluded.word_position,
         kind=excluded.kind, text=excluded.text, answer=excluded.answer, resolved=excluded.resolved,
         lemma=excluded.lemma, root=excluded.root, updated_at=excluded.updated_at`,
      [doc.id, doc.verseKey, doc.wordPosition ?? null, doc.kind ?? "note", doc.text ?? "",
       doc.answer ?? "", doc.resolved ? 1 : 0, doc.lemma ?? null, doc.root ?? null,
       doc.source === "ai" ? "ai" : "me", doc.createdAt, t,
       doc.authorId ?? this.userId, doc.origin ?? "local"],
    );
    return doc;
  }
  async deleteNote(id: string): Promise<boolean> {
    return (await this.db.run("DELETE FROM notes WHERE id = ?", [id])).changes > 0;
  }

  // -- user root meanings --
  async getRootMeaning(root: string): Promise<Doc> {
    const row = await this.db.one<{ root: string; meaning: string; updated_at: number }>(
      "SELECT root, meaning, updated_at FROM user_root_meanings WHERE root = ?", [root],
    );
    return { root, meaning: row?.meaning ?? "", updatedAt: row?.updated_at ?? 0 };
  }
  async listRootMeanings(): Promise<Doc[]> {
    return (await this.db.query<{ root: string; meaning: string; updated_at: number }>(
      "SELECT root, meaning, updated_at FROM user_root_meanings ORDER BY updated_at DESC, root",
    )).map((r) => ({ root: r.root, meaning: r.meaning, updatedAt: r.updated_at }));
  }
  async setRootMeaning(root: string, meaning: string): Promise<Doc> {
    const t = now();
    const text = (meaning ?? "").trim();
    if (!text) {
      await this.db.run("DELETE FROM user_root_meanings WHERE root = ?", [root]);
      return { root, meaning: "", updatedAt: t };
    }
    await this.db.run(
      `INSERT INTO user_root_meanings (root, meaning, updated_at, author_id, origin) VALUES (?,?,?,?,?)
       ON CONFLICT (user_id, root) DO UPDATE SET meaning=excluded.meaning, updated_at=excluded.updated_at`,
      [root, text, t, this.userId, "local"],
    );
    return { root, meaning: text, updatedAt: t };
  }
  async deleteRootMeaning(root: string): Promise<boolean> {
    return (await this.db.run("DELETE FROM user_root_meanings WHERE root = ?", [root])).changes > 0;
  }

  // -- motifs (بيوت) --
  private async motifRoots(id: string): Promise<string[]> {
    return (await this.db.query<{ root: string }>(
      "SELECT root FROM motif_roots WHERE motif_id = ? ORDER BY added_at, root", [id],
    )).map((r) => r.root);
  }
  private static motifRow(m: MotifRow, roots: string[]): Doc {
    return {
      id: m.id, name: m.name, note: m.note, source: m.source ?? "me",
      roots, createdAt: m.created_at, updatedAt: m.updated_at,
    };
  }
  private async withRoots(rows: MotifRow[]): Promise<Doc[]> {
    const out: Doc[] = [];
    for (const m of rows) out.push(ResearchStore.motifRow(m, await this.motifRoots(m.id)));
    return out;
  }
  async listMotifs(): Promise<Doc[]> {
    return this.withRoots(await this.db.query<MotifRow>("SELECT * FROM motifs ORDER BY updated_at DESC, id"));
  }
  async getMotif(id: string): Promise<Doc | undefined> {
    const m = await this.db.one<MotifRow>("SELECT * FROM motifs WHERE id = ?", [id]);
    return m ? ResearchStore.motifRow(m, await this.motifRoots(m.id)) : undefined;
  }
  async motifsForRoot(root: string): Promise<Doc[]> {
    return this.withRoots(await this.db.query<MotifRow>(
      `SELECT m.* FROM motifs m JOIN motif_roots mr ON mr.motif_id = m.id
       WHERE mr.root = ? ORDER BY m.name, m.id`,
      [root],
    ));
  }
  async saveMotif(doc: Doc): Promise<Doc> {
    const t = now();
    const id = doc.id;
    const existing = await this.getMotif(id);
    await this.db.run(
      `INSERT INTO motifs (id, name, note, source, created_at, updated_at, author_id, origin) VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT (user_id, id) DO UPDATE SET name=excluded.name, note=excluded.note, updated_at=excluded.updated_at`,
      [id, doc.name ?? "", doc.note ?? "", doc.source === "ai" ? "ai" : existing?.source ?? "me",
       doc.createdAt ?? t, t, doc.authorId ?? this.userId, doc.origin ?? "local"],
    );
    return {
      id, name: doc.name ?? "", note: doc.note ?? "",
      source: existing?.source ?? (doc.source === "ai" ? "ai" : "me"),
      roots: await this.motifRoots(id), updatedAt: t,
    };
  }
  async deleteMotif(id: string): Promise<boolean> {
    await this.db.run("DELETE FROM motif_roots WHERE motif_id = ?", [id]);
    return (await this.db.run("DELETE FROM motifs WHERE id = ?", [id])).changes > 0;
  }
  async addMotifRoot(id: string, root: string): Promise<void> {
    await this.db.run(
      "INSERT INTO motif_roots (motif_id, root, added_at) VALUES (?,?,?) ON CONFLICT DO NOTHING",
      [id, root, now()],
    );
    await this.db.run("UPDATE motifs SET updated_at = ? WHERE id = ?", [now(), id]);
  }
  async removeMotifRoot(id: string, root: string): Promise<void> {
    await this.db.run("DELETE FROM motif_roots WHERE motif_id = ? AND root = ?", [id, root]);
    await this.db.run("UPDATE motifs SET updated_at = ? WHERE id = ?", [now(), id]);
  }

  // -- comparisons (named, saveable boards of pinned āyāt & roots) --
  private static setRow(r: any): Doc {
    return { id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at, count: Number(r.count ?? 0) };
  }
  private static itemRow(r: any): Doc {
    return { id: r.id, setId: r.set_id, kind: r.kind, ref: r.ref, label: r.label ?? null, createdAt: r.created_at };
  }
  private async touchCompareSet(id: string): Promise<void> {
    await this.db.run("UPDATE compare_sets SET updated_at = ? WHERE id = ?", [now(), id]);
  }

  /** All saved comparisons, most-recently-touched first, with member counts. */
  async listCompareSets(): Promise<Doc[]> {
    return (await this.db.query(
      `SELECT s.id, s.title, s.created_at, s.updated_at, COUNT(c.id) AS count
       FROM compare_sets s LEFT JOIN compare_items c ON c.set_id = s.id
       GROUP BY s.id, s.title, s.created_at, s.updated_at ORDER BY s.updated_at DESC, s.id`,
    )).map(ResearchStore.setRow);
  }
  async getCompareSet(id: string): Promise<Doc | undefined> {
    const r = await this.db.one(
      `SELECT s.id, s.title, s.created_at, s.updated_at, COUNT(c.id) AS count
       FROM compare_sets s LEFT JOIN compare_items c ON c.set_id = s.id WHERE s.id = ?
       GROUP BY s.id, s.title, s.created_at, s.updated_at`,
      [id],
    );
    return r ? ResearchStore.setRow(r) : undefined;
  }
  async saveCompareSet(doc: Doc): Promise<Doc> {
    const t = now();
    await this.db.run(
      `INSERT INTO compare_sets (id, title, created_at, updated_at, author_id, origin) VALUES (?,?,?,?,?,?)
       ON CONFLICT (user_id, id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`,
      [doc.id, doc.title ?? "", doc.createdAt ?? t, t, doc.authorId ?? this.userId, doc.origin ?? "local"],
    );
    return (await this.getCompareSet(doc.id))!;
  }
  async deleteCompareSet(id: string): Promise<boolean> {
    await this.db.run("DELETE FROM compare_items WHERE set_id = ?", [id]);
    return (await this.db.run("DELETE FROM compare_sets WHERE id = ?", [id])).changes > 0;
  }
  async listCompareItems(setId: string): Promise<Doc[]> {
    return (await this.db.query("SELECT * FROM compare_items WHERE set_id = ? ORDER BY created_at, id", [setId]))
      .map(ResearchStore.itemRow);
  }
  async addCompareItem(setId: string, doc: Doc): Promise<Doc> {
    await this.db.run(
      `INSERT INTO compare_items (id, set_id, kind, ref, label, created_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT (user_id, set_id, kind, ref) DO NOTHING`,
      [doc.id, setId, doc.kind, doc.ref, doc.label ?? null, doc.createdAt ?? now()],
    );
    await this.touchCompareSet(setId);
    // return the row that now holds this (set,kind,ref) — its own id or the pre-existing one
    const r = await this.db.one("SELECT * FROM compare_items WHERE set_id = ? AND kind = ? AND ref = ?", [setId, doc.kind, doc.ref]);
    return ResearchStore.itemRow(r);
  }
  async removeCompareItem(setId: string, itemId: string): Promise<boolean> {
    const changed = (await this.db.run("DELETE FROM compare_items WHERE id = ? AND set_id = ?", [itemId, setId])).changes > 0;
    if (changed) await this.touchCompareSet(setId);
    return changed;
  }
  async clearCompareItems(setId: string): Promise<void> {
    await this.db.run("DELETE FROM compare_items WHERE set_id = ?", [setId]);
    await this.touchCompareSet(setId);
  }

  // -- provenance: what an AI proposed through the MCP server ------------------
  /** Everything tagged source='ai', for the reader to review. */
  async listProposed(): Promise<Doc> {
    return {
      notes: (await this.db.query("SELECT * FROM notes WHERE source = 'ai' ORDER BY created_at DESC, id"))
        .map(ResearchStore.noteRow),
      indications: (await this.db.query("SELECT * FROM word_indications WHERE source = 'ai' ORDER BY created_at DESC, id"))
        .map(ResearchStore.indicationRow),
    };
  }
  /** Accept a proposal: it becomes the reader's own record. */
  async acceptProposed(kind: "note" | "indication", id: string): Promise<boolean> {
    const table = kind === "note" ? "notes" : "word_indications";
    return (await this.db.run(`UPDATE ${table} SET source = 'me' WHERE id = ? AND source = 'ai'`, [id])).changes > 0;
  }

  // -- word indications: meanings anchored at the ROOT (one primary per root), each
  //    carrying per-FORM refinements. A word's gloss = its form's refinement of
  //    the root's primary indication, else that indication's text. Words with no root keep
  //    standalone lemma indications. --
  private static indicationRow(r: any): Doc {
    return {
      id: r.id, root: r.root ?? null, lemma: r.lemma ?? null,
      scope: r.scope ?? "lemma", parentId: r.parent_id ?? null,
      label: r.label ?? "", meaning: r.meaning ?? "",
      primary: !!r.is_primary, source: r.source ?? "me",
      authorId: r.author_id ?? null, origin: r.origin ?? "local",
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }

  async getIndication(id: string): Promise<Doc | undefined> {
    const r = await this.db.one("SELECT * FROM word_indications WHERE id = ?", [id]);
    return r ? ResearchStore.indicationRow(r) : undefined;
  }
  /** The indications of a root, primary first. */
  async rootIndications(root: string): Promise<Doc[]> {
    return (await this.db.query(
      "SELECT * FROM word_indications WHERE scope='root' AND root=? ORDER BY is_primary DESC, created_at, id", [root],
    )).map(ResearchStore.indicationRow);
  }
  /** Standalone lemma indications (words with no root). */
  async lemmaIndications(lemma: string): Promise<Doc[]> {
    return (await this.db.query(
      "SELECT * FROM word_indications WHERE scope='lemma' AND parent_id IS NULL AND lemma=? ORDER BY is_primary DESC, created_at, id",
      [lemma],
    )).map(ResearchStore.indicationRow);
  }
  /** A root indication's refinement for one form (lemma), if written. */
  async refinementFor(parentId: string, lemma: string): Promise<Doc | null> {
    const r = await this.db.one(
      "SELECT * FROM word_indications WHERE parent_id=? AND lemma=? ORDER BY created_at, id LIMIT 1", [parentId, lemma]);
    return r ? ResearchStore.indicationRow(r) : null;
  }
  async refinementsForParent(parentId: string): Promise<Doc[]> {
    return (await this.db.query(
      "SELECT * FROM word_indications WHERE parent_id=? ORDER BY created_at, id", [parentId],
    )).map(ResearchStore.indicationRow);
  }

  /** Everything the word menu needs: the word's root indications (each with THIS
   *  form's refinement) and, for rootless words, standalone lemma indications.
   *
   *  `surface` is the word AS WRITTEN (form_arabic). Refinements are now keyed by surface form
   *  so a plural (أَصْلَٰب) can differ from its singular (صُّلْب) — but we fall back to the lemma
   *  key so refinements written before the switch keep matching. */
  async indicationsForWord(lemma: string | null, root: string | null, surface?: string | null): Promise<Doc> {
    const refine = async (id: string) =>
      (surface ? await this.refinementFor(id, surface) : null) ??
      (lemma ? await this.refinementFor(id, lemma) : null);
    const rootIndications: Doc[] = [];
    if (root) {
      for (const s of await this.rootIndications(root)) {
        rootIndications.push({
          ...s,
          refinement: await refine(s.id),
          refinedCount: (await this.refinementsForParent(s.id)).length, // how many forms are done
        });
      }
    }
    const lemmaIndications = (!root && lemma) ? await this.lemmaIndications(lemma) : [];
    return {
      root, lemma, rootIndications, lemmaIndications,
      // The community's readings are not served from here: the app reads them live from
      // GET /community/readings (gated) and merges them in.
      communityRoot: [],
      communityLemma: [],
    };
  }

  private async clearRootPrimary(root: string, exceptId?: string): Promise<void> {
    await this.db.run(
      `UPDATE word_indications SET is_primary=0 WHERE scope='root' AND root=?${exceptId ? " AND id!=?" : ""}`,
      exceptId ? [root, exceptId] : [root]);
  }
  private async clearLemmaPrimary(lemma: string, exceptId?: string): Promise<void> {
    await this.db.run(
      `UPDATE word_indications SET is_primary=0 WHERE scope='lemma' AND parent_id IS NULL AND lemma=?${exceptId ? " AND id!=?" : ""}`,
      exceptId ? [lemma, exceptId] : [lemma]);
  }

  /** Create/update a root indication (root set) OR a standalone lemma indication (rootless). */
  async saveIndication(doc: Doc): Promise<Doc> {
    const t = now();
    const existing = await this.getIndication(doc.id);
    const root = doc.root ?? existing?.root ?? null;
    const lemma = doc.lemma ?? existing?.lemma ?? null;
    const scope = doc.scope ?? existing?.scope ?? (root ? "root" : "lemma");
    const had = Number(scope === "root"
      ? await this.db.scalar("SELECT COUNT(*) FROM word_indications WHERE scope='root' AND root=?", [root]) ?? 0
      : await this.db.scalar("SELECT COUNT(*) FROM word_indications WHERE scope='lemma' AND parent_id IS NULL AND lemma=?", [lemma]) ?? 0);
    const primary = doc.primary ?? existing?.primary ?? had === 0;
    await this.db.run(
      `INSERT INTO word_indications (id, root, lemma, scope, parent_id, label, meaning, is_primary, source, created_at, updated_at, author_id, origin)
       VALUES (?,?,?,?,NULL,?,?,?,?,?,?,?,?)
       ON CONFLICT (user_id, id) DO UPDATE SET root=excluded.root, lemma=excluded.lemma, scope=excluded.scope,
         label=excluded.label, meaning=excluded.meaning, is_primary=excluded.is_primary, updated_at=excluded.updated_at`,
      [doc.id, root, lemma, scope, doc.label ?? "", doc.meaning ?? "", primary ? 1 : 0,
       doc.source === "ai" ? "ai" : existing?.source ?? "me", existing?.createdAt ?? t, t,
       doc.authorId ?? this.userId, doc.origin ?? "local"],
    );
    if (primary) {
      if (scope === "root" && root) await this.clearRootPrimary(root, doc.id);
      else if (lemma) await this.clearLemmaPrimary(lemma, doc.id);
    }
    return (await this.getIndication(doc.id))!;
  }

  /** Create/update a per-form refinement of a root indication (upsert by parent+lemma). */
  async saveRefinement(doc: Doc): Promise<Doc | undefined> {
    const parent = await this.getIndication(doc.parentId);
    if (!parent || parent.scope !== "root") return undefined;
    const t = now();
    const existing = await this.refinementFor(doc.parentId, doc.lemma);
    const id = existing?.id ?? doc.id;
    await this.db.run(
      `INSERT INTO word_indications (id, root, lemma, scope, parent_id, label, meaning, is_primary, source, created_at, updated_at, author_id, origin)
       VALUES (?,?,?, 'lemma', ?, ?, ?, 0, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, id) DO UPDATE SET label=excluded.label, meaning=excluded.meaning, updated_at=excluded.updated_at`,
      [id, parent.root, doc.lemma, doc.parentId, doc.label ?? "", doc.meaning ?? "",
       doc.source === "ai" ? "ai" : existing?.source ?? "me", existing?.createdAt ?? t, t,
       doc.authorId ?? this.userId, doc.origin ?? "local"],
    );
    return this.getIndication(id);
  }

  async deleteIndication(id: string): Promise<boolean> {
    const s = await this.getIndication(id);
    if (!s) return false;
    // deleting a root indication removes its refinements too
    await this.db.run("DELETE FROM word_indications WHERE id=? OR parent_id=?", [id, id]);
    if (s.primary && s.scope === "root" && s.root) {
      const next = await this.db.one<{ id: string }>(
        "SELECT id FROM word_indications WHERE scope='root' AND root=? ORDER BY created_at, id LIMIT 1", [s.root]);
      if (next) await this.db.run("UPDATE word_indications SET is_primary=1 WHERE id=?", [next.id]);
    } else if (s.primary && s.scope === "lemma" && !s.parentId && s.lemma) {
      const next = await this.db.one<{ id: string }>(
        "SELECT id FROM word_indications WHERE scope='lemma' AND parent_id IS NULL AND lemma=? ORDER BY created_at, id LIMIT 1", [s.lemma]);
      if (next) await this.db.run("UPDATE word_indications SET is_primary=1 WHERE id=?", [next.id]);
    }
    return true;
  }

  /** Make a root indication (or a standalone lemma indication) the primary in its group. */
  async setPrimaryIndication(id: string): Promise<Doc | undefined> {
    const s = await this.getIndication(id);
    if (!s) return undefined;
    if (s.scope === "root" && s.root) await this.clearRootPrimary(s.root);
    else if (s.scope === "lemma" && !s.parentId && s.lemma) await this.clearLemmaPrimary(s.lemma);
    else return s; // refinements have no primary
    await this.db.run("UPDATE word_indications SET is_primary=1, updated_at=? WHERE id=?", [now(), id]);
    return this.getIndication(id);
  }

  /** Reader gloss data: for each root with a PRIMARY indication, its base text and
   *  per-form refinement texts; plus rootless lemma primaries. */
  async glossData(): Promise<Doc> {
    const primaries = (await this.db.query(
      "SELECT * FROM word_indications WHERE scope='root' AND is_primary=1 ORDER BY root, id",
    )).map(ResearchStore.indicationRow);
    const roots = primaries
      .map((p) => ({ root: p.root, text: p.label || p.meaning }))
      .filter((x) => x.text);
    const refinements: Doc[] = [];
    for (const p of primaries) {
      for (const r of await this.refinementsForParent(p.id)) {
        const text = r.label || r.meaning;
        if (text) refinements.push({ root: p.root, lemma: r.lemma, text });
      }
    }
    const lemmas = (await this.db.query(
      "SELECT * FROM word_indications WHERE scope='lemma' AND parent_id IS NULL AND is_primary=1 ORDER BY lemma, id",
    ))
      .map(ResearchStore.indicationRow)
      .map((s) => ({ lemma: s.lemma, text: s.label || s.meaning }))
      .filter((x) => x.text);
    return { roots, refinements, lemmas };
  }

  // ---- outbound submission ledger (what I've offered upstream) ------------------
  private static submissionRow(r: {
    local_ref: string; submission_id: string; content_hash: string; kind: string; status: string; submitted_at: number;
  }): Doc {
    return {
      localRef: r.local_ref, submissionId: r.submission_id, contentHash: r.content_hash,
      kind: r.kind, status: r.status, submittedAt: r.submitted_at,
    };
  }

  /** What was submitted for this record, if anything. */
  async getSubmissionFor(localRef: string): Promise<Doc | undefined> {
    const r = await this.db.one<any>("SELECT * FROM derived_submissions WHERE local_ref = ?", [localRef]);
    return r ? ResearchStore.submissionRow(r) : undefined;
  }

  async listSubmissionLog(): Promise<Doc[]> {
    return (await this.db.query<any>("SELECT * FROM derived_submissions ORDER BY submitted_at DESC, local_ref"))
      .map(ResearchStore.submissionRow);
  }

  /** Record (or replace) what was submitted for a record. */
  async recordSubmission(doc: Doc): Promise<Doc> {
    const t = now();
    await this.db.run(
      `INSERT INTO derived_submissions (local_ref, submission_id, content_hash, kind, status, submitted_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT (user_id, local_ref) DO UPDATE SET submission_id=excluded.submission_id,
         content_hash=excluded.content_hash, kind=excluded.kind,
         status=excluded.status, submitted_at=excluded.submitted_at`,
      [doc.localRef, doc.submissionId, doc.contentHash, doc.kind ?? "", doc.status ?? "submitted", t],
    );
    return (await this.getSubmissionFor(doc.localRef))!;
  }

  /** Has this reader proposed a reading of this subject, and does it still match? */
  async getProposal(subjectKind: string, subjectValue: string): Promise<Doc | undefined> {
    const r = await this.db.one<{ content_hash: string; proposed_at: number }>(
      "SELECT content_hash, proposed_at FROM derived_proposed_claims WHERE subject_kind = ? AND subject_value = ?",
      [subjectKind, subjectValue]);
    return r ? { contentHash: r.content_hash, proposedAt: r.proposed_at } : undefined;
  }

  /** Record that a reading was proposed upstream (drop-safe outbox, mirrors recordSubmission). */
  async recordProposal(doc: Doc): Promise<Doc> {
    await this.db.run(
      `INSERT INTO derived_proposed_claims (subject_kind, subject_value, content_hash, proposed_at)
       VALUES (?,?,?,?)
       ON CONFLICT (user_id, subject_kind, subject_value)
         DO UPDATE SET content_hash=excluded.content_hash, proposed_at=excluded.proposed_at`,
      [doc.subjectKind, doc.subjectValue, doc.contentHash, now()],
    );
    return (await this.getProposal(doc.subjectKind, doc.subjectValue))!;
  }

  // ---- settings: device-independent key -> JSON value --------------------------
  async getSetting(key: string): Promise<unknown> {
    const row = await this.db.one<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
    if (!row) return undefined;
    try { return JSON.parse(row.value); } catch { return undefined; }
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, JSON.stringify(value ?? null), now()],
    );
  }
}
