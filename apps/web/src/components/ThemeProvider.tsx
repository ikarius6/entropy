import React, { createContext, useContext, useEffect, useState } from "react";
import { isTheme, resolveSystemTheme, THEME_CLASS_NAMES, THEME_MODES, type Theme } from "../lib/theme-options";

export type { Theme } from "../lib/theme-options";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "entropy-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => {
    const storedTheme = localStorage.getItem(storageKey);
    return isTheme(storedTheme) ? storedTheme : defaultTheme;
  });

  useEffect(() => {
    const root = window.document.documentElement;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
    const themeClassNames = Object.values(THEME_CLASS_NAMES);

    const applyTheme = (selectedTheme: Theme) => {
      const resolvedTheme = selectedTheme === "system"
        ? resolveSystemTheme(mediaQuery.matches)
        : selectedTheme;

      root.classList.remove(...themeClassNames);
      root.classList.add(THEME_CLASS_NAMES[resolvedTheme]);
      root.style.colorScheme = THEME_MODES[resolvedTheme];
    };

    applyTheme(theme);

    if (theme !== "system") {
      return;
    }

    const handleChange = () => {
      applyTheme("system");
    };

    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, [theme]);

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme);
      setTheme(theme);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");

  return context;
};
