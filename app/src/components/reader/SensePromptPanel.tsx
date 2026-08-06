// "Create prompt" — hand a proposed sense to an AI with everything it needs to
// test it against every form of the root: the forms themselves, the reader's
// dictionary entries, and their notes/questions. Two steps: name the sense, then
// review/copy the generated prompt.

import { useState } from "react";
import { archive } from "../../persistence/db";
import { useAsync } from "../../hooks/useAsync";
import type { RootDetail } from "../../api/types";
import { buildSensePrompt, uniqueForms } from "./sensePrompt";

const spaced = (r: string) => r.split("").join(" ");

interface Props {
  root: string;
  detail: RootDetail | null;
  /** prefill from the sense currently selected in the editor, if any */
  initialSense?: string;
  onClose: () => void;
}

export function SensePromptPanel({ root, detail, initialSense = "", onClose }: Props) {
  const [sense, setSense] = useState(initialSense);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // notes/questions recorded anywhere on this root
  const notes = useAsync(() => archive.notes.forRoot(root), [root]);
  const forms = uniqueForms(detail);
  const dictCount = detail?.meanings.length ?? 0;
  const noteCount = (notes.data ?? []).filter((n) => (n.text ?? "").trim()).length;

  const build = () => {
    if (!sense.trim()) return;
    setPrompt(buildSensePrompt({ root, detail, sense, notes: notes.data ?? [] }));
    setCopied(false);
  };

  const copy = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // clipboard blocked (insecure origin) — the textarea is selectable as a fallback
      setCopied(false);
    }
  };

  return (
    <div className="sp-overlay" onClick={onClose}>
      <div className="sp-panel" onClick={(e) => e.stopPropagation()}>
        <header className="sp-head">
          <span className="sp-title">
            Create prompt — test a sense across <span className="quran">{spaced(root)}</span>
          </span>
          <button className="se-close" onClick={onClose} title="Close">✕</button>
        </header>

        {prompt === null ? (
          <div className="sp-body">
            <label className="sp-label" htmlFor="sp-sense">Which sense do you want to test?</label>
            <textarea
              id="sp-sense"
              className="board-input"
              rows={3}
              autoFocus
              placeholder="e.g. to break through — to split what covers a thing so what is inside can come out"
              value={sense}
              onChange={(e) => setSense(e.target.value)}
            />
            <p className="sp-note">
              The prompt will carry <strong>{forms.length}</strong> form{forms.length === 1 ? "" : "s"} of this root,
              your <strong>{dictCount}</strong> dictionary entr{dictCount === 1 ? "y" : "ies"}, and
              {" "}<strong>{noteCount}</strong> note{noteCount === 1 ? "" : "s"}/question{noteCount === 1 ? "" : "s"} —
              and asks for a per-form verdict in a fixed format, using only that material.
            </p>
            <div className="sp-actions">
              <button className="ctl establish-btn" disabled={!sense.trim() || notes.loading} onClick={build}>
                Build prompt
              </button>
            </div>
          </div>
        ) : (
          <div className="sp-body">
            <textarea className="board-input sp-out" rows={18} readOnly value={prompt} onFocus={(e) => e.currentTarget.select()} />
            <div className="sp-actions">
              <button className="ctl establish-btn" onClick={copy}>{copied ? "✓ Copied" : "Copy prompt"}</button>
              <button className="ctl" onClick={() => setPrompt(null)}>‹ Edit sense</button>
              <span className="sp-hint">Paste into your AI of choice, then record its verdict as each form's meaning.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
