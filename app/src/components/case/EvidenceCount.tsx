// What a reading rests on, said beside the place it is established: one quiet line ("Rests on 12
// āyāt · 1 against · 3 of your observations · 2 dictionary entries · 1 tafsīr"), and, while only
// one āyah (or none) stands behind it, a reminder that one āyah is a lead. This only counts and
// reminds: establishing stays the reader's call, and no kind of source is weighed against another.

import { restsOnLine, type RestsOn, type RestsOnScope } from "../../cases/ops";

interface Props {
  rests: RestsOn;
  /** what the count is about */
  of: "form" | "ayah" | "verdict";
}

const THIN: Record<Props["of"], { none: string; one: string | null }> = {
  form: {
    none: "No āyah is pinned for this form yet. Pin the āyāt its meaning rests on.",
    one: "One āyah is a lead: look for a second, separate āyah that bears it out.",
  },
  ayah: {
    none: "This understanding rests on the āyah alone. Pin another āyah that bears it out.",
    // an āyah's own understanding is borne out by OTHER āyāt, so one other is already two
    one: null,
  },
  verdict: {
    none: "No āyah is pinned in this case yet.",
    one: "The whole case rests on one āyah. Look for a second, separate āyah before you close it.",
  },
};

export function EvidenceCount({ rests, of }: Props) {
  const scope: RestsOnScope = of === "ayah" ? "others" : "case";
  const line = restsOnLine(rests, scope);
  const reminder = rests.ayahs === 0 ? THIN[of].none : rests.ayahs === 1 ? THIN[of].one : null;
  if (!line && !reminder) return null;
  return (
    <div className="rests-on-block">
      {line && <p className="rests-on" role="note">{line}</p>}
      {reminder && <p className="evidence-count thin" role="note">{reminder}</p>}
    </div>
  );
}

/** The line alone, for a summary place (the root page, the case details). */
export function RestsOnLine({ rests, scope = "case" }: { rests: RestsOn; scope?: RestsOnScope }) {
  const line = restsOnLine(rests, scope);
  return line ? <p className="rests-on" role="note">{line}</p> : null;
}
