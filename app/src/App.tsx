import { TopBar } from "./components/TopBar";
import { Home } from "./screens/Home";
import { ReadingRoom } from "./screens/ReadingRoom";
import { Investigate } from "./screens/Investigate";
import { Vault } from "./screens/Vault";
import { RootsExplorer } from "./screens/RootsExplorer";
import { Search } from "./screens/Search";
import { Motifs } from "./screens/Motifs";
import { Compare } from "./screens/Compare";
import { Divergences } from "./screens/Divergences";
import { RareLinks } from "./screens/RareLinks";
import { MyLinks } from "./screens/MyLinks";
import { Spellings } from "./screens/Spellings";
import { RuleChecks } from "./screens/RuleChecks";
import { Characters } from "./screens/Characters";
import { Dialogue } from "./screens/Dialogue";
import { Supplications } from "./screens/Supplications";
import { SurahFrame } from "./screens/SurahFrame";
import { Admin } from "./screens/Admin";
import { Shortcuts } from "./components/Shortcuts";
import { CommandPalette } from "./components/CommandPalette";
import { ExpressionBar } from "./components/ExpressionBar";
import { Toast } from "./components/Toast";
import { PlanLockNotice } from "./components/PlanLockNotice";
import { FeatureGate } from "./components/FeatureGate";
import { Guide } from "./screens/Guide";
import { useEffect } from "react";
import { AppProvider, useAppDispatch, useAppState, type Tab } from "./state/store";
import { CorpusAccessBanner } from "./components/CorpusAccessBanner";

function Screen({ tab }: { tab: Tab }) {
  if (tab === "home") return <Home />;
  // screens behind a plan feature (lib/features.ts): a tool is locked, your own work read-only
  if (tab === "search") return <FeatureGate feature="search" mode="lock"><Search /></FeatureGate>;
  if (tab === "investigate") return <FeatureGate feature="cases" mode="readonly"><Investigate /></FeatureGate>;
  if (tab === "vault") return <Vault />;
  if (tab === "roots") return <FeatureGate feature="roots" mode="lock"><RootsExplorer /></FeatureGate>;
  if (tab === "motifs") return <FeatureGate feature="motifs" mode="readonly"><Motifs /></FeatureGate>;
  if (tab === "compare") return <FeatureGate feature="compare" mode="lock"><Compare /></FeatureGate>;
  if (tab === "diverge") return <FeatureGate feature="divergences" mode="lock"><Divergences /></FeatureGate>;
  if (tab === "links") return <FeatureGate feature="lens" mode="lock"><RareLinks /></FeatureGate>;
  if (tab === "mylinks") return <FeatureGate feature="links" mode="readonly"><MyLinks /></FeatureGate>;
  if (tab === "spellings") return <FeatureGate feature="spelling" mode="lock"><Spellings /></FeatureGate>;
  if (tab === "rules") return <FeatureGate feature="rules" mode="readonly"><RuleChecks /></FeatureGate>;
  if (tab === "characters") return <FeatureGate feature="characters" mode="readonly"><Characters /></FeatureGate>;
  if (tab === "dialogue") return <FeatureGate feature="speakers" mode="readonly"><Dialogue /></FeatureGate>;
  if (tab === "supplications") return <FeatureGate feature="search" mode="lock"><Supplications /></FeatureGate>;
  if (tab === "frame") return <FeatureGate feature="compare" mode="lock"><SurahFrame /></FeatureGate>;
  if (tab === "admin") return <Admin />;
  if (tab === "guide") return <Guide />;
  return <ReadingRoom />;
}

/**
 * The screen that is showing and, behind the reader, the screen a jump into it was made from.
 * That one stays alive (hidden), so "Back to …" in the reader finds it as it was left: its
 * filters, what was open, the place on the page. It is rebuilt instead when the research changed
 * meanwhile (screenEpoch), so it shows what was done.
 */
function Screens() {
  const { tab, returnTo, screenEpoch, pendingScroll } = useAppState();
  const dispatch = useAppDispatch();
  const kept = tab === "read" && returnTo ? returnTo.tab : null;

  useEffect(() => {
    if (pendingScroll === null) return;
    const main = document.querySelector<HTMLElement>(".main");
    let tries = 0;
    let timer = 0;
    // a rebuilt screen loads first: keep trying until the page is long enough, then let go
    const attempt = () => {
      if (!main) { dispatch({ type: "scrollRestored" }); return; }
      main.scrollTop = pendingScroll;
      if (Math.abs(main.scrollTop - pendingScroll) < 2 || ++tries > 40) dispatch({ type: "scrollRestored" });
      else timer = window.setTimeout(attempt, 120);
    };
    attempt();
    return () => window.clearTimeout(timer);
  }, [pendingScroll, dispatch]);

  const slots: Tab[] = kept ? [kept, tab] : [tab];
  return (
    <>
      {slots.map((t) => (
        <div key={`${t}:${screenEpoch}`} className="screen-slot" hidden={t !== tab}>
          <Screen tab={t} />
        </div>
      ))}
    </>
  );
}

export default function App() {
  // Your research is your account's (on the research server), so there is no local file to
  // claim first: signed out, the banner under the top bar says so and offers to sign in.
  return (
    <AppProvider>
      <Shortcuts />
      <CommandPalette />
      <div className="shell">
        <TopBar />
        <CorpusAccessBanner />
        <main className="main">
          <Screens />
        </main>
        <ExpressionBar />
        <Toast />
        <PlanLockNotice />
      </div>
    </AppProvider>
  );
}
