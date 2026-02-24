import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      vibeclaw: path.resolve(__dirname, "vibeClaw/_package-export"),
    },
  },
  server: {
    allowedHosts: true,
  },
});
