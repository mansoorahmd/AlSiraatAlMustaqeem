import React, { createContext, Suspense, useContext, useMemo } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { SQLiteProvider, useSQLiteContext, type SQLiteDatabase } from "expo-sqlite";
import { ExpoDb, openResearchDb, QURAN_DB_NAME, type Db } from "../data/db";
import { makeApi, type QuranApi } from "../data/api";
import { colors } from "../theme/tokens";

interface DbCtx {
  q: QuranApi;
  db: Db;
  research: Db;
}

const Ctx = createContext<DbCtx | null>(null);

export function useQuran(): DbCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useQuran must be used inside <DbProvider>");
  return v;
}

// Runs once, before children render: enforce read-only on the corpus connection.
async function initQuranDb(db: SQLiteDatabase): Promise<void> {
  await db.execAsync("PRAGMA query_only = ON");
}

export function DbProvider({ children }: { children: React.ReactNode }) {
  return (
    <DbErrorBoundary>
      <Suspense fallback={<Splash message="Preparing the Quran corpus (first launch only)…" />}>
        <SQLiteProvider
          databaseName={QURAN_DB_NAME}
          assetSource={{ assetId: require("../../assets/db/quran-mobile.db") }}
          onInit={initQuranDb}
          useSuspense
        >
          <Bridge>{children}</Bridge>
        </SQLiteProvider>
      </Suspense>
    </DbErrorBoundary>
  );
}

function Bridge({ children }: { children: React.ReactNode }) {
  const raw = useSQLiteContext();
  const value = useMemo<DbCtx>(() => {
    const db: Db = new ExpoDb(raw);
    const research = openResearchDb();
    return { db, research, q: makeApi(db) };
  }, [raw]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function Splash({ message }: { message: string }) {
  return (
    <View style={styles.center}>
      <Image
        source={require("../../assets/adaptive-icon.png")}
        style={styles.logo}
        resizeMode="contain"
      />
      <Text style={styles.brand}>AlSiraat AlMustaqeem</Text>
      <ActivityIndicator color={colors.gold} size="large" style={{ marginTop: 24 }} />
      <Text style={styles.msg}>{message}</Text>
    </View>
  );
}

class DbErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <View style={styles.center}>
          <Text style={styles.err}>Could not open the corpus.</Text>
          <Text style={styles.errDetail}>{this.state.error.message}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0E3B34", padding: 24 },
  logo: { width: 180, height: 180 },
  brand: { color: colors.gold, fontSize: 20, fontWeight: "600", marginTop: 8, letterSpacing: 0.5 },
  msg: { marginTop: 16, color: "#cdd8cf", textAlign: "center" },
  err: { color: colors.danger, fontWeight: "600", fontSize: 16 },
  errDetail: { color: colors.inkSoft, marginTop: 8, textAlign: "center" },
});
