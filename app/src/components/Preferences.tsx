// Reading preferences — script, size, translation, gloss. These belong with the reader's own
// settings on Home rather than in the top bar: they're set occasionally, not per-action, and
// the chrome is better spent on navigation.
//
// Every value persists in research.db (via the settings store), so it follows the reader
// between the web and desktop builds.

import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useAppState, useAppDispatch } from "../state/store";
import type { Script } from "../api/types";

const SCRIPTS: { id: Script; label: string }[] = [
  { id: "uthmani", label: "عثماني" },
  { id: "imlaei", label: "إملائي" },
  { id: "indopak", label: "ہندی" },
];

export function Preferences() {
  const { reading } = useAppState();
  const dispatch = useAppDispatch();
  const translations = useAsync(() => api.translationResources(), []);
  const { script, translationOn, translationId, myGlossOn, fontScale } = reading;

  return (
    <div className="prefs">
      <div className="settings-row">
        <span className="settings-label">Script</span>
        <span className="ctl-group" role="radiogroup">
          {SCRIPTS.map((s) => (
            <button
              key={s.id}
              className={`ctl${script === s.id ? " active" : ""}`}
              onClick={() => dispatch({ type: "setScript", script: s.id })}
            >
              {s.label}
            </button>
          ))}
        </span>
      </div>

      <div className="settings-row">
        <span className="settings-label">Size</span>
        <span className="ctl-group">
          <button className="ctl" onClick={() => dispatch({ type: "setFontScale", scale: fontScale - 0.1 })}>A−</button>
          <button className="ctl" onClick={() => dispatch({ type: "setFontScale", scale: 1 })}>A</button>
          <button className="ctl" onClick={() => dispatch({ type: "setFontScale", scale: fontScale + 0.1 })}>A+</button>
        </span>
      </div>

      <div className="settings-row">
        <span className="settings-label">Translation</span>
        <button
          className={`ctl${translationOn ? " active" : ""}`}
          onClick={() => dispatch({ type: "setTranslationOn", on: !translationOn })}
        >
          {translationOn ? "on" : "off"}
        </button>
      </div>

      {translationOn && (
        <div className="settings-row">
          <span className="settings-label">Edition</span>
          <select
            className="settings-select"
            value={translationId ?? ""}
            onChange={(e) =>
              dispatch({ type: "setTranslationId", id: e.target.value ? Number(e.target.value) : null })
            }
            disabled={!translations.data || translations.data.length === 0}
          >
            <option value="">Auto</option>
            {(translations.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name ?? r.author_name ?? `#${r.id}`}
                {r.language_name ? ` · ${r.language_name}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="settings-row">
        <span className="settings-label">My gloss</span>
        <button
          className={`ctl${myGlossOn ? " active" : ""}`}
          onClick={() => dispatch({ type: "setMyGlossOn", on: !myGlossOn })}
        >
          {myGlossOn ? "on" : "off"}
        </button>
      </div>
    </div>
  );
}
