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
import { Admin } from "./screens/Admin";
import { Shortcuts } from "./components/Shortcuts";
import { CommandPalette } from "./components/CommandPalette";
import { ExpressionBar } from "./components/ExpressionBar";
import { Toast } from "./components/Toast";
import { PlanLockNotice } from "./components/PlanLockNotice";
import { FeatureGate } from "./components/FeatureGate";
import { AppProvider, useAppState } from "./state/store";
import { CorpusAccessBanner } from "./components/CorpusAccessBanner";

function Screen() {
  const { tab } = useAppState();
  if (tab === "home") return <Home />;
  // screens behind a plan feature (lib/features.ts): a tool is locked, your own work read-only
  if (tab === "search") return <FeatureGate feature="search" mode="lock"><Search /></FeatureGate>;
  if (tab === "investigate") return <FeatureGate feature="cases" mode="readonly"><Investigate /></FeatureGate>;
  if (tab === "vault") return <Vault />;
  if (tab === "roots") return <FeatureGate feature="roots" mode="lock"><RootsExplorer /></FeatureGate>;
  if (tab === "motifs") return <FeatureGate feature="motifs" mode="readonly"><Motifs /></FeatureGate>;
  if (tab === "compare") return <FeatureGate feature="compare" mode="lock"><Compare /></FeatureGate>;
  if (tab === "diverge") return <FeatureGate feature="divergences" mode="lock"><Divergences /></FeatureGate>;
  if (tab === "admin") return <Admin />;
  return <ReadingRoom />;
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
          <Screen />
        </main>
        <ExpressionBar />
        <Toast />
        <PlanLockNotice />
      </div>
    </AppProvider>
  );
}
