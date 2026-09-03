"use client";

// Client-side app settings (board theme + board behaviour toggles), persisted
// to localStorage and applied to the document as CSS variables so the board can
// be re-themed live from the Settings page. No backend is involved.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type BoardThemeId = "walnut" | "stone" | "forest";

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
};

export interface Settings {
  boardTheme: BoardThemeId;
  showCoordinates: boolean;
  highlightLastMove: boolean;
  playSounds: boolean;
}

const DEFAULTS: Settings = {
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
  root.style.setProperty("--board-light", theme.light);
  root.style.setProperty("--board-dark", theme.dark);
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);

  // Hydrate from localStorage once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Settings>;
        setSettings((s) => ({ ...s, ...parsed }));
      }
    } catch {
      /* ignore malformed / unavailable storage */
    }
  }, []);

  // Keep the board CSS variables in sync with the chosen theme.
  useEffect(() => {
    applyBoardTheme(settings.boardTheme);
  }, [settings.boardTheme]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
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
  if (!ctx) throw new Error("useSettings must be used within <SettingsProvider>");
  return ctx;
}
