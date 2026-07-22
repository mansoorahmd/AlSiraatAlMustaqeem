// The compare workspace — pinned ayahs and roots shown side by side as columns,
// so near-parallels and near-synonyms can be studied together. Pins live in the
// session (store); each column can be removed, or the whole tray cleared.

import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useAppState, useAppDispatch, compareId, type CompareItem } from "../state/store";
import { VerseText } from "../components/VerseText";

const spaced = (r: string) => r.split("").join(" ");

function AyahColumn({ verseKey }: { verseKey: string }) {
  const { reading } = useAppState();
  const dispatch = useAppDispatch();
  const chapters = useAsync(() => api.chapters(), []);
  const verse = useAsync(() => api.verse(verseKey, { script: reading.script }), [verseKey, reading.script]);
  const tr = useAsync(() => api.verseTranslations(verseKey), [verseKey]);

  const surah = chapters.data?.find((c) => c.id === parseInt(verseKey.split(":")[0] ?? "", 10))?.name_simple ?? "";
  const translation = reading.translationOn
    ? (reading.translationId != null
        ? tr.data?.find((t) => t.resource_id === reading.translationId)
        : tr.data?.find((t) => t.resource_type !== "tafsir")) ?? undefined
    : undefined;

  return (
    <div className="cmp-body">
      <button className="cmp-open" onClick={() => dispatch({ type: "jumpToVerse", verseKey })}>
        read →
      </button>
      <p className="cmp-verse quran" dir="rtl">
        <VerseText text={verse.data && typeof verse.data.text === "string" ? verse.data.text : ""} />
      </p>
      {translation && <p className="cmp-translation">{translation.text}</p>}
      <span className="cmp-sub">{surah}</span>
    </div>
  );
}

function RootColumn({ buckwalter }: { buckwalter: string }) {
  const dispatch = useAppDispatch();
  const detail = useAsync(() => api.root(buckwalter), [buckwalter]);
  const links = useAsync(() => api.rootLinkages(buckwalter, { scope: "ayah", limit: 8 }), [buckwalter]);

  return (
    <div className="cmp-body">
      <button
        className="cmp-open"
        onClick={() =>
          dispatch({ type: "openRoot", root: { buckwalter, arabic: detail.data?.root_arabic ?? buckwalter } })
        }
      >
        lexicon →
      </button>
      {detail.data && (
        <>
          <p className="cmp-root-meaning">{detail.data.meaning_en ?? "—"}</p>
          <span className="cmp-sub">{detail.data.total_occurrences} occ · {detail.data.forms.length} forms</span>
          {detail.data.meanings.slice(0, 3).map((m, i) => (
            <p key={i} className={`cmp-lex${m.language === "arabic" ? " quran" : ""}`} dir={m.language === "arabic" ? "rtl" : "ltr"}>
              <span className="cmp-lex-src">{m.source}</span> {m.meaning}
            </p>
          ))}
          {links.data && links.data.length > 0 && (
            <div className="cmp-colloc">
              <span className="cmp-sub">keeps company with</span>
              <div className="root-colloc">
                {links.data.map((l) => (
                  <button
                    key={l.root_buckwalter}
                    className="colloc-chip"
                    onClick={() => dispatch({ type: "openRoot", root: { buckwalter: l.root_buckwalter, arabic: l.root_arabic } })}
                  >
                    <span className="quran">{spaced(l.root_arabic)}</span>
                    <span className="colloc-strength">{l.cooccur}×</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function Compare() {
  const { compare } = useAppState();
  const dispatch = useAppDispatch();

  return (
    <div className="sheet compare-screen">
      <header className="home-head">
        <h1>Compare</h1>
        <p className="subtitle">
          Study ayahs or roots side by side. Add with the “⇋ compare” button on any ayah or root page.
        </p>
      </header>

      {compare.length === 0 ? (
        <p className="home-empty">
          Nothing pinned yet. In the reader, use ⇋ on an ayah; on a root's page, use ⇋ compare —
          then they'll line up here.
        </p>
      ) : (
        <>
          <div className="cmp-toolbar">
            <span className="cmp-count">{compare.length} pinned</span>
            <button className="ctl" onClick={() => dispatch({ type: "clearCompare" })}>clear all</button>
          </div>
          <div className="cmp-columns">
            {compare.map((item: CompareItem) => (
              <section key={compareId(item)} className="cmp-col">
                <div className="cmp-head">
                  <span className="cmp-title quran">
                    {item.kind === "ayah" ? item.verseKey : spaced(item.arabic)}
                  </span>
                  <button
                    className="cmp-x"
                    title="Remove"
                    onClick={() => dispatch({ type: "unpinCompare", id: compareId(item) })}
                  >✕</button>
                </div>
                {item.kind === "ayah"
                  ? <AyahColumn verseKey={item.verseKey} />
                  : <RootColumn buckwalter={item.buckwalter} />}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
