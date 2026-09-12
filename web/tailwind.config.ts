import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/app/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Semantic RGB tokens are selected by data-app-theme in globals.css.
        paper: {
          DEFAULT: "rgb(var(--paper) / <alpha-value>)",
          50: "rgb(var(--paper-50) / <alpha-value>)",
          100: "rgb(var(--paper) / <alpha-value>)",
          200: "rgb(var(--paper-200) / <alpha-value>)",
          300: "rgb(var(--paper-300) / <alpha-value>)",
        },
        surface: "rgb(var(--surface) / <alpha-value>)",
        ink: {
          DEFAULT: "rgb(var(--ink) / <alpha-value>)",
          900: "rgb(var(--ink) / <alpha-value>)",
          800: "rgb(var(--ink-800) / <alpha-value>)",
          700: "rgb(var(--ink-700) / <alpha-value>)",
          600: "rgb(var(--ink-600) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "rgb(var(--muted) / <alpha-value>)",
          light: "rgb(var(--muted-light) / <alpha-value>)",
        },
        gold: {
          DEFAULT: "rgb(var(--gold) / <alpha-value>)",
          400: "rgb(var(--gold-400) / <alpha-value>)",
          500: "rgb(var(--gold) / <alpha-value>)",
          600: "rgb(var(--gold-600) / <alpha-value>)",
        },
        positive: {
          DEFAULT: "rgb(var(--positive) / <alpha-value>)",
          600: "rgb(var(--positive-600) / <alpha-value>)",
        },
        line: {
          DEFAULT: "rgb(var(--line) / <alpha-value>)",
          soft: "rgb(var(--line-soft) / <alpha-value>)",
        },
        night: {
          DEFAULT: "rgb(var(--night) / <alpha-value>)",
          800: "rgb(var(--night-800) / <alpha-value>)",
          700: "rgb(var(--night-700) / <alpha-value>)",
          600: "rgb(var(--night-600) / <alpha-value>)",
          foreground: "rgb(var(--night-foreground) / <alpha-value>)",
        },
        "on-accent": "rgb(var(--on-accent) / <alpha-value>)",
        board: {
          light: "rgb(var(--board-light) / <alpha-value>)",
          dark: "rgb(var(--board-dark) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      boxShadow: {
        board: "0 24px 60px -20px rgba(0,0,0,0.55)",
        card: "0 1px 2px rgba(29,27,23,0.04), 0 12px 34px -18px rgba(29,27,23,0.25)",
        pop: "0 24px 60px -12px rgba(0,0,0,0.35)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pop-in": {
          from: { opacity: "0", transform: "scale(0.94)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.5s ease-out both",
        "pop-in": "pop-in 0.18s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
