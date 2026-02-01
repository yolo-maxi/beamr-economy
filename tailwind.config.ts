import type { Config } from "tailwindcss";

export default {
  content: [
    "./index.html", 
    "./src/**/*.{ts,tsx}",
    "./node_modules/agentation/dist/*.{js,mjs}",
  ],
  theme: {
    extend: {
      fontFamily: {
        pixel: ['"Silkscreen"', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;

