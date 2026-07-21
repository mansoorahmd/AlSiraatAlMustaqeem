// Motifs (بيوت) — reader-defined collections of roots that share a linguistic
// motif. Browse them, see their member roots (click to open the lexicon page),
// rename, or delete. Roots are added to a motif from a root's page.

import { useMemo, useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { archive, newId } from "../persistence/db";
import { useAppDispatch } from "../state/store";

const spaced = (r: string) => r.split("").join(" ");

export function Motifs() {
  const dispatch = useAppDispatch();
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);

  const motifs = useAsync(() => archive.motifs.all(), [version]);
  const roots = useAsync(() => api.listRoots({ limit: 2000 }), []);
  const arabicOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of roots.data ?? []) m.set(r.root_buckwalter, r.root_arabic);
    return m;
  }, [roots.data]);

  const [newName, setNewName] = useState("");
  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    await archive.motifs.save({ id: newId("motif"), name });
    setNewName("");
    refresh();
  };
  const rename = async (id: string, name: string, createdAt?: number) => {
    await archive.motifs.save({ id, name, createdAt });
    refresh();
  };
  const remove = async (id: string) => {
    await archive.motifs.remove(id);
    refresh();
  };
  const openRoot = (bw: string) =>
    dispatch({ type: "openRoot", root: { buckwalter: bw, arabic: arabicOf.get(bw) ?? bw } });

  const list = motifs.data ?? [];

  return (
    <div className="sheet motifs-screen">
      <header className="home-head">
        <h1 className="quran">بُيوت</h1>
        <p className="subtitle">
          Motifs — your own collections of roots that share a linguistic motif. Add roots to a motif
          from any root's page.
        </p>
      </header>

      <div className="motif-create">
        <input
          className="motif-new-input"
          placeholder="new motif (بيت) name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") create(); }}
        />
        <button className="ink-action" onClick={create} disabled={!newName.trim()}>＋ Create motif</button>
      </div>

      {motifs.loading && <p className="loading">Opening your motifs…</p>}
      {list.length === 0 && !motifs.loading && (
        <p className="home-empty">No motifs yet. Create one above, then tag roots into it from their pages.</p>
      )}

      <div className="motif-cards">
        {list.map((m) => (
          <section key={m.id} className="motif-card">
            <div className="motif-card-head">
              <input
                className="motif-name"
                value={m.name}
                onChange={(e) => rename(m.id, e.target.value, m.createdAt)}
              />
              <span className="motif-count">{m.roots.length}</span>
              <button className="motif-del" title="Delete motif" onClick={() => remove(m.id)}>✕</button>
            </div>
            {m.roots.length === 0 ? (
              <p className="home-empty">No roots yet.</p>
            ) : (
              <div className="motif-root-chips">
                {m.roots.map((bw) => (
                  <button key={bw} className="chip motif-root-chip quran" onClick={() => openRoot(bw)} title="Open lexicon page">
                    {spaced(arabicOf.get(bw) ?? bw)}
                  </button>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
