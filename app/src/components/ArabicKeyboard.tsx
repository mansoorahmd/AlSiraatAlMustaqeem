// A tappable on-screen Arabic keyboard, so search (and root filters) work
// without a system Arabic layout. Emits single characters via onInsert.

const ROWS: string[][] = [
  ["ض", "ص", "ث", "ق", "ف", "غ", "ع", "ه", "خ", "ح", "ج", "د"],
  ["ش", "س", "ي", "ب", "ل", "ا", "ت", "ن", "م", "ك", "ط"],
  ["ذ", "ء", "ؤ", "ر", "ى", "ة", "و", "ز", "ظ"],
  ["أ", "إ", "آ", "ئ", "ٱ"],
];

interface Props {
  onInsert: (ch: string) => void;
  onBackspace: () => void;
  onClear?: () => void;
}

export function ArabicKeyboard({ onInsert, onBackspace, onClear }: Props) {
  return (
    <div className="akb" dir="rtl">
      {ROWS.map((row, i) => (
        <div key={i} className="akb-row">
          {row.map((ch) => (
            <button key={ch} className="akb-key quran" onClick={() => onInsert(ch)}>
              {ch}
            </button>
          ))}
        </div>
      ))}
      <div className="akb-row akb-controls">
        <button className="akb-key akb-wide" onClick={() => onInsert(" ")}>space</button>
        <button className="akb-key" onClick={onBackspace} title="Backspace">⌫</button>
        {onClear && <button className="akb-key" onClick={onClear} title="Clear">✕</button>}
      </div>
    </div>
  );
}
