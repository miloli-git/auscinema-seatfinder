import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Web SPA for the seat-finder.
//
// The app makes same-origin requests by default (VITE_API_BASE empty); the dev
// and preview servers proxy the API routes to the running API. Override the
// proxy target with VITE_DEV_API_TARGET. To skip the proxy entirely and hit a
// CORS-enabled API directly, set VITE_API_BASE to its absolute URL.
const API_ROUTES = ["/cinemas", "/movies", "/sessions", "/seatmap", "/best", "/healthz"];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_DEV_API_TARGET || "http://localhost:3001";
  const proxy = Object.fromEntries(
    API_ROUTES.map((route) => [route, { target, changeOrigin: true }]),
  );

  return {
    plugins: [react()],
    server: { port: 5173, proxy },
    preview: { port: 4173, proxy },
  };
});
