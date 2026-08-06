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
  const [instructions, setInstructions] = useState("");
  const [prompt, setPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // notes/questions recorded anywhere on this root
  const notes = useAsync(() => archive.notes.forRoot(root), [root]);
  const forms = uniqueForms(detail);
  const dictCount = detail?.meanings.length ?? 0;
  const noteCount = (notes.data ?? []).filter((n) => (n.text ?? "").trim()).length;

  const build = () => {
    if (!sense.trim()) return;
    setPrompt(buildSensePrompt({ root, detail, sense, notes: notes.data ?? [], instructions }));
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
            <label className="sp-label" htmlFor="sp-extra">
              Special instructions <span className="sp-optional">(optional)</span>
            </label>
            <textarea
              id="sp-extra"
              className="board-input"
              rows={2}
              placeholder="e.g. weigh Maqāyīs above the others · answer in Urdu · keep the physical sense in every form"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />

            <p className="sp-note">
              Carries <strong>{forms.length}</strong> form{forms.length === 1 ? "" : "s"} of this root,
              your <strong>{dictCount}</strong> dictionary entr{dictCount === 1 ? "y" : "ies"} and
              {" "}<strong>{noteCount}</strong> note{noteCount === 1 ? "" : "s"}/question{noteCount === 1 ? "" : "s"}.
              It tells the model to <strong>ignore tafsir and translation conventions</strong> and reason only from
              the lexicons and each form's pattern — then, where the sense holds, to return a
              {" "}<strong>brief and detail per form</strong> you can paste straight into the fields here.
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
              <button className="ctl" onClick={() => setPrompt(null)}>‹ Edit</button>
              <span className="sp-hint">
                Paste into your AI, then copy each form's BRIEF → label and DETAIL → meaning.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
