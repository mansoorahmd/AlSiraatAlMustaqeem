// Design tokens — a calm, paper-leaning light theme echoing the web app.

export const colors = {
  bg: "#faf8f3",
  surface: "#ffffff",
  surfaceAlt: "#f3efe6",
  border: "#e3ddd0",
  ink: "#2b2620",
  inkSoft: "#6b6353",
  gold: "#b8860b",
  lapis: "#2c5aa0",
  amber: "#f4e2b8",
  amberStrong: "#e9c766",
  danger: "#a3341f",
  tabActive: "#2b2620",
  tabInactive: "#9a9282",
};

export const font = {
  arabic: "quran" as string | undefined, // Amiri Quran, loaded in App.tsx via expo-font
  ui: undefined as string | undefined,
};

export const radii = { sm: 6, md: 10, lg: 16 };
export const space = (n: number) => n * 4;
