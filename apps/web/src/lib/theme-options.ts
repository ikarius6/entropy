export const RESOLVED_THEME_VALUES = ["dark", "light", "ocean", "forest", "sunset"] as const;

export type ResolvedTheme = (typeof RESOLVED_THEME_VALUES)[number];
export type Theme = ResolvedTheme | "system";
export type ThemeMode = "dark" | "light";

export type ThemeOption = {
  value: Theme;
  label: string;
  description: string;
  preview: readonly [string, string, string];
};

export const THEME_VALUES = ["system", ...RESOLVED_THEME_VALUES] as const satisfies readonly Theme[];

export const THEME_OPTIONS: readonly ThemeOption[] = [
  {
    value: "system",
    label: "System",
    description: "Follow your operating system preference automatically.",
    preview: ["#161412", "#1f1c19", "#8b9a6d"]
  },
  {
    value: "dark",
    label: "Dark",
    description: "The original Entropy look with warm dark surfaces.",
    preview: ["#161412", "#1f1c19", "#d6a56a"]
  },
  {
    value: "light",
    label: "Light",
    description: "A bright neutral theme for daytime use.",
    preview: ["#f8f9fa", "#ffffff", "#176ec1"]
  },
  {
    value: "ocean",
    label: "Ocean",
    description: "Cool deep-blue tones with bright cyan highlights.",
    preview: ["#091724", "#0f2437", "#56bfff"]
  },
  {
    value: "forest",
    label: "Forest",
    description: "Dense green panels with earthy highlights.",
    preview: ["#0c140f", "#142018", "#7cd685"]
  },
  {
    value: "sunset",
    label: "Sunset",
    description: "A warm light palette with soft amber contrast.",
    preview: ["#fff7f0", "#ffffff", "#e66f51"]
  }
] as const;

export const THEME_CLASS_NAMES: Record<ResolvedTheme, string> = {
  dark: "theme-dark",
  light: "theme-light",
  ocean: "theme-ocean",
  forest: "theme-forest",
  sunset: "theme-sunset"
};

export const THEME_MODES: Record<ResolvedTheme, ThemeMode> = {
  dark: "dark",
  light: "light",
  ocean: "dark",
  forest: "dark",
  sunset: "light"
};

const THEME_VALUE_SET = new Set<string>(THEME_VALUES);

export function isTheme(value: string | null): value is Theme {
  return typeof value === "string" && THEME_VALUE_SET.has(value);
}

export function resolveSystemTheme(prefersLight: boolean): ResolvedTheme {
  return prefersLight ? "light" : "dark";
}
