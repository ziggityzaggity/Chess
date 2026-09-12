export const TIME_CONTROLS = [
  { value: 3, label: "3 min", description: "Blitz" },
  { value: 10, label: "10 min", description: "Rapid" },
  { value: 30, label: "30 min", description: "Classical" },
  { value: "unlimited", label: "∞", description: "No time limit" },
] as const;

export type TimeControl = (typeof TIME_CONTROLS)[number]["value"];

export function parseTimeControl(value: string | null): TimeControl {
  if (value === "unlimited") return "unlimited";
  const minutes = Number(value);
  return minutes === 10 || minutes === 30 ? minutes : 3;
}

export function timeControlLabel(value: TimeControl): string {
  return value === "unlimited" ? "∞" : `${value} min per side`;
}
