"use client";

// Browser-local appearance and board preferences, shared by every page.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export const APP_THEMES = {
  classic: {
    id: "classic",
    name: "Classic",
    description: "Warm paper & walnut gold",
  },
  ocean: { id: "ocean", name: "Ocean", description: "Cool mist & deep blue" },
  sage: { id: "sage", name: "Sage", description: "Soft linen & garden green" },
  midnight: {
    id: "midnight",
    name: "Midnight",
    description: "Dark navy & soft lavender",
  },
} as const;

export type AppThemeId = keyof typeof APP_THEMES;
export type BoardThemeId =
  "walnut" | "stone" | "forest" | "glacier" | "rosewood" | "slate";

export interface BoardTheme {
  id: BoardThemeId;
  name: string;
  light: string;
  dark: string;
}

export const BOARD_THEMES: Record<BoardThemeId, BoardTheme> = {
  walnut: { id: "walnut", name: "Walnut", light: "#e8cfa6", dark: "#a17a4c" },
  stone: { id: "stone", name: "Stone", light: "#dad7d0", dark: "#8f8b83" },
  forest: { id: "forest", name: "Forest", light: "#ebecd0", dark: "#6f9b54" },
  glacier: {
    id: "glacier",
    name: "Glacier",
    light: "#dcebf0",
    dark: "#638b9e",
  },
  rosewood: {
    id: "rosewood",
    name: "Rosewood",
    light: "#f0ddd5",
    dark: "#a56f78",
  },
  slate: { id: "slate", name: "Slate", light: "#dfe3ed", dark: "#747f9d" },
};

export interface Settings {
  appTheme: AppThemeId;
  boardTheme: BoardThemeId;
  showCoordinates: boolean;
  highlightLastMove: boolean;
  playSounds: boolean;
}

const DEFAULTS: Settings = {
  appTheme: "classic",
  boardTheme: "walnut",
  showCoordinates: true,
  highlightLastMove: true,
  playSounds: false,
};

const STORAGE_KEY = "pychess:settings";

interface SettingsContextValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function applyBoardTheme(id: BoardThemeId) {
  const theme = BOARD_THEMES[id] ?? BOARD_THEMES.walnut;
  const root = document.documentElement;
  // RGB channels allow Tailwind opacity modifiers on coordinate labels.
  const rgb = (hex: string) =>
    hex
      .slice(1)
      .match(/.{2}/g)!
      .map((v) => parseInt(v, 16))
      .join(" ");
  root.style.setProperty("--board-light", rgb(theme.light));
  root.style.setProperty("--board-dark", rgb(theme.dark));
}

function readSettings(value: unknown): Settings {
  if (!value || typeof value !== "object") return DEFAULTS;
  const saved = value as Record<string, unknown>;
  return {
    appTheme:
      typeof saved.appTheme === "string" &&
      Object.hasOwn(APP_THEMES, saved.appTheme)
        ? (saved.appTheme as AppThemeId)
        : DEFAULTS.appTheme,
    boardTheme:
      typeof saved.boardTheme === "string" &&
      Object.hasOwn(BOARD_THEMES, saved.boardTheme)
        ? (saved.boardTheme as BoardThemeId)
        : DEFAULTS.boardTheme,
    showCoordinates:
      typeof saved.showCoordinates === "boolean"
        ? saved.showCoordinates
        : DEFAULTS.showCoordinates,
    highlightLastMove:
      typeof saved.highlightLastMove === "boolean"
        ? saved.highlightLastMove
        : DEFAULTS.highlightLastMove,
    playSounds:
      typeof saved.playSounds === "boolean"
        ? saved.playSounds
        : DEFAULTS.playSounds,
  };
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [ready, setReady] = useState(false);

  // Hydrate from localStorage once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setSettings(readSettings(JSON.parse(raw)));
      }
    } catch {
      /* ignore malformed / unavailable storage */
    }
    setReady(true);
  }, []);

  // Keep the board CSS variables in sync with the chosen theme.
  useEffect(() => {
    applyBoardTheme(settings.boardTheme);
  }, [settings.boardTheme]);

  useEffect(() => {
    document.documentElement.dataset.appTheme = settings.appTheme;
  }, [settings.appTheme]);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* Preferences still work for this session when storage is unavailable. */
    }
  }, [settings, ready]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const value = useMemo(() => ({ settings, update }), [settings, update]);

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx)
    throw new Error("useSettings must be used within <SettingsProvider>");
  return ctx;
}
