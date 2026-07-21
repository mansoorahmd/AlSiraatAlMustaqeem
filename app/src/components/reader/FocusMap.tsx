// The focus "connections map": every ayah the lens relates to, laid out by
// surah and heat-tinted by closeness (shared phrase length + shared roots).
// Click any badge to jump straight there — no linear stepping.

import { useMemo } from "react";
import type { FocusSpec } from "./focus";

interface Props {
  spec: FocusSpec;
  currentKey: string | null;
  surahName: (verseKey: string) => string;
  onJump: (verseKey: string) => void;
  onClose: () => void;
}

const cnum = (k: string) => parseInt(k.split(":")[0] || "0", 10);
const vnum = (k: string) => parseInt(k.split(":")[1] || "0", 10);

// gold heat ramp, weak → strong
const heat = (s: number) => `rgba(180, 83, 9, ${(0.1 + s * 0.8).toFixed(3)})`;

export function FocusMap({ spec, currentKey, surahName, onJump, onClose }: Props) {
  const { groups, strengthOf } = useMemo(() => {
    let maxRun = 1;
    let maxShared = 1;
    for (const k of spec.jumpKeys) {
      const r = spec.reasons.get(k);
      if (r) {
        maxRun = Math.max(maxRun, r.run.length);
        maxShared = Math.max(maxShared, r.shared.length);
      }
    }
    const strengthOf = (k: string) => {
      const r = spec.reasons.get(k);
      if (!r) return 0;
      return 0.6 * (r.run.length / maxRun) + 0.4 * (r.shared.length / maxShared);
    };
    const byChap = new Map<number, string[]>();
    for (const k of spec.jumpKeys) {
      const c = cnum(k);
      const list = byChap.get(c);
      if (list) list.push(k);
      else byChap.set(c, [k]);
    }
    const groups = [...byChap.entries()]
      .map(([chapter, keys]) => {
        keys.sort((a, b) => vnum(a) - vnum(b));
        return { chapter, keys, max: Math.max(...keys.map(strengthOf)) };
      })
      // strongest-connected surahs first, then mushaf order
      .sort((a, b) => b.max - a.max || a.chapter - b.chapter);
    return { groups, strengthOf };
  }, [spec]);

  return (
    <div className="fm-overlay" onClick={onClose}>
      <div className="focus-map" onClick={(e) => e.stopPropagation()} role="dialog">
        <header className="fm-head">
          <div>
            <h3 className="fm-title">Connections across the Book</h3>
            <p className="fm-sub">
              {spec.jumpKeys.length} ayahs linked to {spec.base.label}
              {surahName(spec.base.label) ? ` · ${surahName(spec.base.label)}` : ""}
              {" "}· across {groups.length} sūrah{groups.length > 1 ? "s" : ""}
            </p>
          </div>
          <button className="ctl" onClick={onClose} title="Close">✕</button>
        </header>

        <div className="fm-legend">
          <span className="fm-lg-label">weaker</span>
          <span className="fm-ramp" />
          <span className="fm-lg-label">stronger link</span>
          <span className="fm-lg-note">● = shares a phrase (roots in a row)</span>
        </div>

        <div className="fm-groups">
          {groups.map((g) => (
            <div className="fm-group" key={g.chapter}>
              <div className="fm-surah">
                <span className="fm-surah-num">{g.chapter}</span>
                <span className="fm-surah-name">{surahName(`${g.chapter}:1`)}</span>
                <span className="fm-surah-count">{g.keys.length}</span>
              </div>
              <div className="fm-badges">
                {g.keys.map((k) => {
                  const r = spec.reasons.get(k);
                  const s = strengthOf(k);
                  const phrase = (r?.run.length ?? 0) > 1;
                  const tip =
                    (phrase ? `phrase: ${r!.run.join(" ")} · ` : "") +
                    `${r?.shared.length ?? 0} shared root${(r?.shared.length ?? 0) === 1 ? "" : "s"}`;
                  return (
                    <button
                      key={k}
                      className={`fm-badge${k === currentKey ? " current" : ""}`}
                      style={{ background: heat(s), color: s > 0.55 ? "#fff" : "var(--ink)" }}
                      title={`${k} — ${tip}`}
                      onClick={() => onJump(k)}
                    >
                      {vnum(k)}
                      {phrase && <span className="fm-dot">●</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
