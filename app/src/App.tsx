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
import { Shortcuts } from "./components/Shortcuts";
import { CommandPalette } from "./components/CommandPalette";
import { ExpressionBar } from "./components/ExpressionBar";
import { Toast } from "./components/Toast";
import { AppProvider, useAppState } from "./state/store";
import { useEffect, useState } from "react";
import { OwnerGate } from "./components/OwnerGate";
import { fetchIdentity } from "./persistence/db";

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
  return <ReadingRoom />;
}

export default function App() {
  // Ask whose research this is before anything else, so nothing is ever written
  // un-attributed. Undecided → render nothing rather than flashing the app then the gate.
  const [claimed, setClaimed] = useState<boolean | null>(null);
  useEffect(() => {
    fetchIdentity()
      .then((id) => setClaimed(!!id.owner))
      .catch(() => setClaimed(true)); // server unreachable: don't block the reader with a gate
  }, []);

  if (claimed === null) return null;
  if (!claimed) return <OwnerGate onClaimed={() => setClaimed(true)} />;

  return (
    <AppProvider>
      <Shortcuts />
      <CommandPalette />
      <div className="shell">
        <TopBar />
        <main className="main">
          <Screen />
        </main>
        <ExpressionBar />
        <Toast />
      </div>
    </AppProvider>
  );
}
