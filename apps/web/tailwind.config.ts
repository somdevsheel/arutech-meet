import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#d9e6ff",
          200: "#b3ccff",
          300: "#6C9BFF",
          400: "#5b8bff",
          500: "#3B6FE0",
          600: "#2f59ba",
          700: "#254594",
          800: "#1c3573",
          900: "#16295f",
          // translucent panel tints used behind live/active/selected states
          tint: "#16264A",
          tint2: "#22304F",
          tint3: "#1B2544",
        },
        surface: {
          DEFAULT: "#0E0E11",
          raised: "#17171C",
          sunken: "#141419",
          elevated: "#1B1B21",
          tile: "#1E1E24",
          field: "#22222A",
          chip: "#2A2A33",
          border: "#26262E",
          border2: "#32323C",
        },
        ink: {
          DEFAULT: "#FFFFFF",
          2: "#E6E6EA",
          3: "#B9B9C4",
          muted: "#8A8A95",
          muted2: "#6F6F7A",
          faint: "#5E5E68",
        },
        success: { DEFAULT: "#35C46A", bg: "#12301F" },
        danger: { DEFAULT: "#E74C3C", strong: "#E02B3D" },
        warn: { DEFAULT: "#FF7A45", bg: "#3A1F14" },
        accent: { DEFAULT: "#A66BFF", bg: "#2A1B45" },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
