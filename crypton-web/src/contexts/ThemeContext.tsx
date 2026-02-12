"use client";

import { createContext, useContext, useEffect, ReactNode } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import type { ThemeColor, ThemeMode } from "@/types/theme";

type ThemeContextType = {
  color: ThemeColor;
  mode: ThemeMode;
  setColor: (color: ThemeColor) => void;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextType>({
  color: "muted-blue",
  mode: "dark",
  setColor: () => {},
  setMode: () => {},
});

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [color, setColor] = useLocalStorage<ThemeColor>(
    "theme-color",
    "muted-blue",
  );
  const [mode, setMode] = useLocalStorage<ThemeMode>("theme-mode", "dark");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", color);
    document.documentElement.setAttribute("data-mode", mode);
  }, [color, mode]);

  return (
    <ThemeContext.Provider value={{ color, mode, setColor, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
