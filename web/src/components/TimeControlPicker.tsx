"use client";

import { TIME_CONTROLS, type TimeControl } from "@/lib/timeControl";

export function TimeControlPicker({
  value,
  onChange,
}: {
  value: TimeControl;
  onChange: (value: TimeControl) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-ink">
        Time per player
      </legend>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {TIME_CONTROLS.map((time) => (
          <label key={time.value} className="relative min-w-0 cursor-pointer">
            <input
              type="radio"
              name="time-control"
              value={time.value}
              checked={value === time.value}
              onChange={() => onChange(time.value)}
              aria-label={
                time.value === "unlimited"
                  ? "Unlimited time"
                  : `${time.value} minutes`
              }
              className="peer sr-only"
            />
            <span className="flex h-full flex-col rounded-2xl border border-line bg-paper-50 px-4 py-4 text-ink transition hover:border-gold peer-checked:border-gold peer-checked:bg-gold/10 peer-checked:ring-1 peer-checked:ring-gold peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-gold">
              <span aria-hidden="true" className="text-xl font-bold leading-7">
                {time.label}
              </span>
              <span className="mt-1 text-xs text-muted">
                {time.description}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
