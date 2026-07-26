import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        khata: { DEFAULT: "#0f766e", warm: "#f59e0b", firm: "#dc2626" },
      },
    },
  },
  plugins: [],
};
export default config;
