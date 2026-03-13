import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  // loadEnv reads .env files in the Node.js config context (process.env /
  // import.meta.env are not available here during the Vite config phase).
  const env = loadEnv(mode, ".", "");

  return {
    base: mode === "production" ? (env.VITE_BASE_PATH ?? "/entropy/") : "/",
    plugins: [
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        "@": "/src"
      }
    }
  };
});
