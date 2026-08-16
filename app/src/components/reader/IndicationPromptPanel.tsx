// "Create prompt" — hand a proposed indication to an AI with everything it needs to
// test it against every form of the root: the forms themselves, the reader's
// dictionary entries, and their notes/questions. Two steps: name the indication, then
// review/copy the generated prompt.

import { useState } from "react";
import { archive } from "../../persistence/db";
import { useAsync } from "../../hooks/useAsync";
import type { RootDetail } from "../../api/types";
import { buildIndicationPrompt, uniqueForms } from "./indicationPrompt";

const spaced = (r: string) => r.split("").join("\u00A0"); // nbsp: root letters must not wrap (ه د ي)

interface Props {
  root: string;
  detail: RootDetail | null;
  /** prefill from the indication currently selected in the editor, if any */
  initialIndication?: string;
  onClose: () => void;
}

export function IndicationPromptPanel({ root, detail, initialIndication = "", onClose }: Props) {
  const [indication, setIndication] = useState(initialIndication);
  const [instructions, setInstructions] = useState("");
  const [prompt, setPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // notes/questions recorded anywhere on this root
  const notes = useAsync(() => archive.notes.forRoot(root), [root]);
  const forms = uniqueForms(detail);
  const dictCount = detail?.meanings.length ?? 0;
  const noteCount = (notes.data ?? []).filter((n) => (n.text ?? "").trim()).length;

  const build = () => {
    if (!indication.trim()) return;
    setPrompt(buildIndicationPrompt({ root, detail, indication, notes: notes.data ?? [], instructions }));
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
    <div className="ip-overlay" onClick={onClose}>
      <div className="ip-panel" onClick={(e) => e.stopPropagation()}>
        <header className="ip-head">
          <span className="ip-title">
            Create prompt — test an indication across <span className="quran">{spaced(root)}</span>
          </span>
          <button className="ie-close" onClick={onClose} title="Close">✕</button>
        </header>

        {prompt === null ? (
          <div className="ip-body">
            <label className="ip-label" htmlFor="ip-indication">Which indication do you want to test?</label>
            <textarea
              id="ip-indication"
              className="board-input"
              rows={3}
              autoFocus
              placeholder="e.g. to break through — to split what covers a thing so what is inside can come out"
              value={indication}
              onChange={(e) => setIndication(e.target.value)}
            />
            <label className="ip-label" htmlFor="ip-extra">
              Special instructions <span className="ip-optional">(optional)</span>
            </label>
            <textarea
              id="ip-extra"
              className="board-input"
              rows={2}
              placeholder="e.g. weigh Maqāyīs above the others · answer in Urdu · keep the physical indication in every form"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />

            <p className="ip-note">
              Carries <strong>{forms.length}</strong> form{forms.length === 1 ? "" : "s"} of this root,
              your <strong>{dictCount}</strong> dictionary entr{dictCount === 1 ? "y" : "ies"} and
              {" "}<strong>{noteCount}</strong> note{noteCount === 1 ? "" : "s"}/question{noteCount === 1 ? "" : "s"}.
              It tells the model to <strong>ignore tafsir and translation conventions</strong> and reason only from
              the lexicons and each form's pattern — then, where the indication holds, to return a
              {" "}<strong>brief and detail per form</strong> you can paste straight into the fields here.
            </p>
            <div className="ip-actions">
              <button className="ctl establish-btn" disabled={!indication.trim() || notes.loading} onClick={build}>
                Build prompt
              </button>
            </div>
          </div>
        ) : (
          <div className="ip-body">
            <textarea className="board-input ip-out" rows={18} readOnly value={prompt} onFocus={(e) => e.currentTarget.select()} />
            <div className="ip-actions">
              <button className="ctl establish-btn" onClick={copy}>{copied ? "✓ Copied" : "Copy prompt"}</button>
              <button className="ctl" onClick={() => setPrompt(null)}>‹ Edit</button>
              <span className="ip-hint">
                Paste into your AI, then copy each form's BRIEF → label and DETAIL → meaning.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
