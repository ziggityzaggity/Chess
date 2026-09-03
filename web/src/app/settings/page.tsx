"use client";

import { useState } from "react";
import { Toggle } from "@/components/Toggle";
import { BOARD_THEMES, useSettings, type BoardThemeId } from "@/lib/settings";

const TABS = ["Appearance", "Board", "Game", "Notifications", "Privacy"] as const;
type Tab = (typeof TABS)[number];

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("Board");

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="text-4xl font-black tracking-tight text-ink sm:text-5xl">
        Settings
      </h1>
      <p className="mt-3 text-base text-muted">
        Keep the board comfortable and the game your way.
      </p>

      <div className="mt-9 grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* Tab rail */}
        <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`whitespace-nowrap rounded-2xl px-4 py-2.5 text-left text-sm font-semibold transition ${
                tab === t
                  ? "bg-white text-ink shadow-sm"
                  : "text-muted hover:bg-white/60 hover:text-ink"
              }`}
            >
              {t}
            </button>
          ))}
        </nav>

        {/* Panel */}
        <div className="rounded-3xl border border-line bg-white p-6 shadow-card sm:p-8">
          {tab === "Board" ? <BoardPanel /> : <PlaceholderPanel tab={tab} />}
        </div>
      </div>
    </main>
  );
}

function BoardPanel() {
  const { settings, update } = useSettings();
  const [saved, setSaved] = useState(false);

  function save() {
    // Settings already persist on every change; this just confirms it.
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-ink">Board</h2>

      <h3 className="mt-6 text-xs font-bold uppercase tracking-wider text-muted">
        Theme
      </h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {Object.values(BOARD_THEMES).map((theme) => {
          const active = settings.boardTheme === theme.id;
          return (
            <button
              key={theme.id}
              type="button"
              onClick={() => update({ boardTheme: theme.id as BoardThemeId })}
              className={`flex items-center gap-3 rounded-2xl border p-3 transition ${
                active
                  ? "border-gold ring-1 ring-gold/40"
                  : "border-line hover:border-ink/15"
              }`}
            >
              <ThemeSwatch light={theme.light} dark={theme.dark} />
              <span className="text-sm font-semibold text-ink">{theme.name}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-8 divide-y divide-line">
        <ToggleRow
          label="Show coordinates"
          checked={settings.showCoordinates}
          onChange={(v) => update({ showCoordinates: v })}
        />
        <ToggleRow
          label="Highlight last move"
          checked={settings.highlightLastMove}
          onChange={(v) => update({ highlightLastMove: v })}
        />
        <ToggleRow
          label="Play move sounds"
          checked={settings.playSounds}
          onChange={(v) => update({ playSounds: v })}
        />
      </div>

      <div className="mt-8 flex items-center justify-end gap-3">
        {saved && (
          <span className="text-sm font-semibold text-positive">Saved ✓</span>
        )}
        <button
          type="button"
          onClick={save}
          className="rounded-full bg-ink px-7 py-3 text-sm font-bold text-paper shadow-card transition hover:bg-ink-800"
        >
          Save changes
        </button>
      </div>
    </div>
  );
}

function ThemeSwatch({ light, dark }: { light: string; dark: string }) {
  return (
    <span className="grid h-10 w-10 shrink-0 grid-cols-2 grid-rows-2 overflow-hidden rounded-lg ring-1 ring-black/5">
      <span style={{ background: dark }} />
      <span style={{ background: light }} />
      <span style={{ background: light }} />
      <span style={{ background: dark }} />
    </span>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-4">
      <span className="text-sm font-medium text-ink">{label}</span>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

function PlaceholderPanel({ tab }: { tab: Tab }) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-ink">{tab}</h2>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
        {tab} preferences are part of the design and will land here. For now, the
        Board tab is fully wired — pick a theme and it updates your board live.
      </p>
      <div className="mt-6 rounded-2xl border border-dashed border-line bg-paper-50 p-6 text-sm text-muted">
        Nothing to configure yet.
      </div>
    </div>
  );
}
