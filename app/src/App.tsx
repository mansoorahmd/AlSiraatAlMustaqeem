import { TopBar } from "./components/TopBar";
import { Home } from "./screens/Home";
import { ReadingRoom } from "./screens/ReadingRoom";
import { Investigate } from "./screens/Investigate";
import { Vault } from "./screens/Vault";
import { RootsExplorer } from "./screens/RootsExplorer";
import { Search } from "./screens/Search";
import { AppProvider, useAppState } from "./state/store";

function Screen() {
  const { tab } = useAppState();
  if (tab === "home") return <Home />;
  if (tab === "search") return <Search />;
  if (tab === "investigate") return <Investigate />;
  if (tab === "vault") return <Vault />;
  if (tab === "roots") return <RootsExplorer />;
  return <ReadingRoom />;
}

export default function App() {
  return (
    <AppProvider>
      <div className="shell">
        <TopBar />
        <main className="main">
          <Screen />
        </main>
      </div>
    </AppProvider>
  );
}
