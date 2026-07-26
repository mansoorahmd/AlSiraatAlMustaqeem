import React from "react";
import { Text, View, ActivityIndicator } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { RootStackParamList } from "./src/navigation/types";
import { DbProvider } from "./src/state/DbContext";
import Home from "./src/screens/Home";
import MyMeanings from "./src/screens/MyMeanings";
import ReaderHome from "./src/screens/ReaderHome";
import Reader from "./src/screens/Reader";
import SearchScreen from "./src/screens/Search";
import RootsExplorer from "./src/screens/RootsExplorer";
import RootDetail from "./src/screens/RootDetail";
import OpenQuestions from "./src/screens/OpenQuestions";
import Trail from "./src/screens/Trail";
import Motifs from "./src/screens/Motifs";
import Compare from "./src/screens/Compare";
import { colors } from "./src/theme/tokens";

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bg,
    card: colors.surface,
    text: colors.ink,
    primary: colors.gold,
    border: colors.border,
  },
};

const screenOpts = {
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.ink,
  headerTitleStyle: { color: colors.ink },
  contentStyle: { backgroundColor: colors.bg },
} as const;

const HomeNav = createNativeStackNavigator<RootStackParamList>();
function HomeStack() {
  return (
    <HomeNav.Navigator screenOptions={screenOpts}>
      <HomeNav.Screen name="Home" component={Home} options={{ title: "AlSiraat AlMustaqeem" }} />
    </HomeNav.Navigator>
  );
}

const ReadNav = createNativeStackNavigator<RootStackParamList>();
function ReadStack() {
  return (
    <ReadNav.Navigator screenOptions={screenOpts}>
      <ReadNav.Screen name="ReaderHome" component={ReaderHome} options={{ title: "Read" }} />
      <ReadNav.Screen name="Reader" component={Reader} />
      <ReadNav.Screen name="RootDetail" component={RootDetail} />
      <ReadNav.Screen name="OpenQuestions" component={OpenQuestions} options={{ title: "Open questions" }} />
      <ReadNav.Screen name="Trail" component={Trail} options={{ title: "Trail" }} />
    </ReadNav.Navigator>
  );
}

const SearchNav = createNativeStackNavigator<RootStackParamList>();
function SearchStack() {
  return (
    <SearchNav.Navigator screenOptions={screenOpts}>
      <SearchNav.Screen name="Search" component={SearchScreen} options={{ title: "Search" }} />
      <SearchNav.Screen name="Reader" component={Reader} />
      <SearchNav.Screen name="RootDetail" component={RootDetail} />
      <SearchNav.Screen name="Trail" component={Trail} options={{ title: "Trail" }} />
    </SearchNav.Navigator>
  );
}

const RootsNav = createNativeStackNavigator<RootStackParamList>();
function RootsStack() {
  return (
    <RootsNav.Navigator screenOptions={screenOpts}>
      <RootsNav.Screen name="RootsExplorer" component={RootsExplorer} options={{ title: "Roots" }} />
      <RootsNav.Screen name="RootDetail" component={RootDetail} />
      <RootsNav.Screen name="MyMeanings" component={MyMeanings} options={{ title: "My meanings" }} />
      <RootsNav.Screen name="Motifs" component={Motifs} options={{ title: "Motifs" }} />
      <RootsNav.Screen name="Reader" component={Reader} />
      <RootsNav.Screen name="Trail" component={Trail} options={{ title: "Trail" }} />
    </RootsNav.Navigator>
  );
}

const CompareNav = createNativeStackNavigator<RootStackParamList>();
function CompareStack() {
  return (
    <CompareNav.Navigator screenOptions={screenOpts}>
      <CompareNav.Screen name="Compare" component={Compare} options={{ title: "Compare" }} />
    </CompareNav.Navigator>
  );
}

const Tabs = createBottomTabNavigator();
const tabIcon = (glyph: string) => ({ color }: { color: string }) =>
  <Text style={{ fontSize: 18, color }}>{glyph}</Text>;

export default function App() {
  const [fontsLoaded] = useFonts({ quran: require("./assets/fonts/AmiriQuran-Regular.ttf") });
  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <DbProvider>
        <NavigationContainer theme={navTheme}>
          <Tabs.Navigator
            screenOptions={{
              headerShown: false,
              tabBarActiveTintColor: colors.tabActive,
              tabBarInactiveTintColor: colors.tabInactive,
              tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
            }}
          >
            <Tabs.Screen name="HomeTab" component={HomeStack} options={{ title: "Home", tabBarIcon: tabIcon("⌂") }} />
            <Tabs.Screen
              name="ReadTab"
              component={ReadStack}
              options={{ title: "Read", tabBarIcon: tabIcon("﷽") }}
              listeners={({ navigation }) => ({
                // tapping the Read tab always returns to the sūra list, not
                // wherever you last left the reader
                tabPress: () => { navigation.navigate("ReadTab", { screen: "ReaderHome" }); },
              })}
            />
            <Tabs.Screen name="SearchTab" component={SearchStack} options={{ title: "Search", tabBarIcon: tabIcon("🔍") }} />
            <Tabs.Screen name="RootsTab" component={RootsStack} options={{ title: "Roots", tabBarIcon: tabIcon("ⵣ") }} />
            <Tabs.Screen name="CompareTab" component={CompareStack} options={{ title: "Compare", tabBarIcon: tabIcon("⇋") }} />
          </Tabs.Navigator>
        </NavigationContainer>
      </DbProvider>
    </SafeAreaProvider>
  );
}
