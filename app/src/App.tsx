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
import { AppProvider, useAppState } from "./state/store";
import { CorpusAccessBanner } from "./components/CorpusAccessBanner";

function Screen() {
  const { tab } = useAppState();
  if (tab === "home") return <Home />;
  if (tab === "search") return <Search />;
  if (tab === "investigate") return <Investigate />;
  if (tab === "vault") return <Vault />;
  if (tab === "roots") return <RootsExplorer />;
  if (tab === "motifs") return <Motifs />;
  if (tab === "compare") return <Compare />;
  if (tab === "diverge") return <Divergences />;
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
      </div>
    </AppProvider>
  );
}
