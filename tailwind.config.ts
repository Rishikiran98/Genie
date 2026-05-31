import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        genie: {
          bg: "#0b1020",
          card: "#141b30",
          accent: "#6d8bff",
          good: "#34d399",
          warn: "#fbbf24",
          bad: "#f87171",
        },
      },
    },
  },
  plugins: [],
};

export default config;
