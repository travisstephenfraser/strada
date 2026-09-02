import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],

  // The assignment names its public variables NEXT_PUBLIC_*. Vite exposes only VITE_*
  // by default; envPrefix takes an array, so the assignment's names work verbatim in a
  // Vite app with no pretence of being Next.js.
  //
  // This is also the app's strongest secret-handling guarantee, and it is structural
  // rather than a convention: DATABASE_URL matches neither prefix, so `import.meta.env`
  // cannot expose it even if someone writes the reference. The array REPLACES the
  // default, so "VITE_" has to be listed explicitly.
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  server: {
    port: 5173,
  },
});
