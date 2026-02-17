export const themeColors = [
  "muted-red",
  "muted-green",
  "muted-blue",
  "dark-red",
  "dark-green",
  "dark-blue",
] as const;

export type ThemeColor = (typeof themeColors)[number];
export type ThemeMode = "light" | "dark";
