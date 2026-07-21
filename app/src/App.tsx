import { TopBar } from "./components/TopBar";
import { ReadingRoom } from "./screens/ReadingRoom";
import { Investigate } from "./screens/Investigate";
import { Vault } from "./screens/Vault";
import { AppProvider, useAppState } from "./state/store";

function Screen() {
  const { tab } = useAppState();
  if (tab === "investigate") return <Investigate />;
  if (tab === "vault") return <Vault />;
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
