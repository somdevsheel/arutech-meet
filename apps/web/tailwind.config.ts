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
          300: "#82aaff",
          400: "#5b8bff",
          500: "#3366ff",
          600: "#254edb",
          700: "#1c3bad",
          800: "#182f85",
          900: "#16295f",
        },
        surface: {
          DEFAULT: "#0b0f19",
          raised: "#121826",
          border: "#232b3d",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
