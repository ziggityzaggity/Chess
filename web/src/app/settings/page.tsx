"use client";

import { useState } from "react";
import { Toggle } from "@/components/Toggle";
import { KnightMark } from "@/components/Logo";
import { StaticBoard, START_BOARD } from "@/components/StaticBoard";
import { APP_THEMES, BOARD_THEMES, useSettings } from "@/lib/settings";

const TABS = [
  "Appearance",
  "Board",
  "Game",
  "Notifications",
  "Privacy",
] as const;
type Tab = (typeof TABS)[number];

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("Appearance");

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="text-4xl font-black tracking-tight text-ink sm:text-5xl">
        Settings
      </h1>
      <p className="mt-3 text-base text-muted">
        Keep the board comfortable and the game your way.
      </p>
      <div className="mt-9 grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav
          aria-label="Settings sections"
          className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible"
        >
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tab === t}
              aria-controls="settings-panel"
              onClick={() => setTab(t)}
              className={`whitespace-nowrap rounded-2xl px-4 py-2.5 text-left text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold ${
                tab === t
                  ? "bg-surface text-ink shadow-sm"
                  : "text-muted hover:bg-surface/60 hover:text-ink"
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
        <section
          id="settings-panel"
          aria-labelledby="settings-heading"
          className="min-w-0 rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-8"
        >
          {tab === "Appearance" ? (
            <AppearancePanel />
          ) : tab === "Board" ? (
            <BoardPanel />
          ) : (
            <PlaceholderPanel tab={tab} />
          )}
        </section>
      </div>
    </main>
  );
}

function AppearancePanel() {
  const { settings, update } = useSettings();
  return (
    <div>
      <h2 id="settings-heading" className="text-2xl font-bold text-ink">
        Appearance
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Set the mood for your next move. Choose a colour palette for the app.
      </p>
      <fieldset className="mt-6">
        <legend className="text-xs font-bold uppercase tracking-wider text-muted">
          App theme
        </legend>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {Object.values(APP_THEMES).map((theme) => (
            <ThemeChoice
              key={theme.id}
              name="app-theme"
              value={theme.id}
              label={theme.name}
              description={theme.description}
              checked={settings.appTheme === theme.id}
              onChange={() => update({ appTheme: theme.id })}
            >
              <span
                data-app-theme={theme.id}
                aria-hidden="true"
                className="block overflow-hidden rounded-xl border border-line bg-paper p-4"
              >
                <span className="flex items-center justify-between border-b border-line pb-3">
                  <KnightMark className="h-6 w-6 text-gold" />
                  <span className="flex gap-1.5">
                    <span className="h-1.5 w-7 rounded bg-muted/40" />
                    <span className="h-1.5 w-4 rounded bg-muted/25" />
                  </span>
                </span>
                <span className="mt-3 flex items-center gap-3 rounded-lg bg-surface p-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gold/15">
                    <KnightMark className="h-6 w-6 text-gold" />
                  </span>
                  <span className="flex-1">
                    <span className="block h-2 w-3/4 rounded bg-ink" />
                    <span className="mt-2 block h-1.5 w-1/2 rounded bg-muted/40" />
                  </span>
                </span>
                <span className="mt-3 flex items-center justify-between">
                  <span className="flex gap-1.5">
                    {["bg-ink", "bg-gold", "bg-positive"].map((color) => (
                      <span
                        key={color}
                        className={`h-3 w-3 rounded-full ${color}`}
                      />
                    ))}
                  </span>
                  <span className="h-5 w-16 rounded-full bg-ink" />
                </span>
              </span>
            </ThemeChoice>
          ))}
        </div>
      </fieldset>
      <SaveNote
        message={`${APP_THEMES[settings.appTheme].name} appearance selected.`}
      />
    </div>
  );
}

function BoardPanel() {
  const { settings, update } = useSettings();
  return (
    <div>
      <h2 id="settings-heading" className="text-2xl font-bold text-ink">
        Board
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Find your favourite squares. Board colours are independent of the app
        theme.
      </p>
      <fieldset className="mt-6">
        <legend className="text-xs font-bold uppercase tracking-wider text-muted">
          Board theme
        </legend>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Object.values(BOARD_THEMES).map((theme) => (
            <ThemeChoice
              key={theme.id}
              name="board-theme"
              value={theme.id}
              label={theme.name}
              checked={settings.boardTheme === theme.id}
              onChange={() => update({ boardTheme: theme.id })}
            >
              <span
                aria-hidden="true"
                className="grid aspect-[2/1] grid-cols-4 grid-rows-2 overflow-hidden rounded-lg ring-1 ring-black/5"
              >
                {Array.from({ length: 8 }, (_, i) => (
                  <span
                    key={i}
                    style={{
                      backgroundColor:
                        (Math.floor(i / 4) + (i % 4)) % 2 === 0
                          ? theme.light
                          : theme.dark,
                    }}
                  />
                ))}
              </span>
            </ThemeChoice>
          ))}
        </div>
      </fieldset>
      <div className="mt-6 flex flex-col items-center gap-5 rounded-2xl border border-line bg-paper-50 p-5 sm:flex-row">
        <div
          className="w-40 shrink-0"
          role="img"
          aria-label={`${BOARD_THEMES[settings.boardTheme].name} board preview with chess pieces`}
        >
          <StaticBoard board={START_BOARD} />
        </div>
        <div>
          <h3 className="text-sm font-bold text-ink">A look at your board</h3>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">
            Your selected colours appear on every board, from the first move to
            checkmate.
          </p>
        </div>
      </div>
      <div className="mt-6 divide-y divide-line">
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
      <SaveNote
        message={`${BOARD_THEMES[settings.boardTheme].name} board selected.`}
      />
    </div>
  );
}

function ThemeChoice({
  name,
  value,
  label,
  description,
  checked,
  onChange,
  children,
}: {
  name: string;
  value: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <label className="relative min-w-0 cursor-pointer">
      <input
        type="radio"
        name={name}
        value={value}
        aria-label={label}
        checked={checked}
        onChange={onChange}
        className="peer sr-only"
      />
      <span className="block h-full rounded-2xl border border-line p-3 transition hover:border-gold peer-checked:border-gold peer-checked:ring-1 peer-checked:ring-gold peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-gold">
        {children}
        <span className="mt-3 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-ink">{label}</span>
          <span
            aria-hidden="true"
            className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-xs ${checked ? "border-gold bg-gold text-on-accent" : "border-line"}`}
          >
            {checked ? "✓" : ""}
          </span>
        </span>
        {description && (
          <span className="mt-1 block text-xs leading-relaxed text-muted">
            {description}
          </span>
        )}
      </span>
    </label>
  );
}

function SaveNote({ message }: { message: string }) {
  return (
    <p role="status" className="mt-6 text-xs leading-relaxed text-muted">
      <span className="font-semibold text-ink">{message}</span> Changes apply
      immediately and save in this browser.
    </p>
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
    <div className="flex items-center justify-between gap-4 py-4">
      <span className="text-sm font-medium text-ink">{label}</span>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

function PlaceholderPanel({ tab }: { tab: Tab }) {
  return (
    <div>
      <h2 id="settings-heading" className="text-2xl font-bold text-ink">
        {tab}
      </h2>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
        {tab} preferences are coming soon. You can already customise the app and
        board in Appearance and Board.
      </p>
      <div className="mt-6 rounded-2xl border border-dashed border-line bg-paper-50 p-6 text-sm text-muted">
        Nothing to configure yet.
      </div>
    </div>
  );
}
