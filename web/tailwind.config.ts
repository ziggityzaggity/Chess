import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Warm paper background used across the light "app shell" pages.
        paper: {
          DEFAULT: "#f3eee3",
          50: "#faf7f0",
          100: "#f3eee3",
          200: "#ebe3d3",
          300: "#e0d5c0",
        },
        // Near-black charcoal — body text and the primary (dark) buttons.
        ink: {
          DEFAULT: "#1d1b17",
          900: "#1d1b17",
          800: "#26231d",
          700: "#332f28",
          600: "#4a463c",
        },
        // Muted secondary text.
        muted: {
          DEFAULT: "#6e675b",
          light: "#8b8477",
        },
        // Walnut gold — the knight mark, links and selected states.
        gold: {
          DEFAULT: "#b0894f",
          400: "#c6a76e",
          500: "#b0894f",
          600: "#93703c",
        },
        // Muted forest green for "on" switches (matches the reference toggles).
        positive: {
          DEFAULT: "#5f7d4e",
          600: "#4f6a41",
        },
        // Hairline borders on light surfaces.
        line: {
          DEFAULT: "#e4dbc9",
          soft: "#eee7d9",
        },
        // Immersive dark surface for the live game screen.
        night: {
          DEFAULT: "#1b1916",
          800: "#232019",
          700: "#2c2822",
          600: "#3a352c",
        },
        // Board squares — driven by CSS variables so Settings can retheme them.
        board: {
          light: "var(--board-light)",
          dark: "var(--board-dark)",
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
