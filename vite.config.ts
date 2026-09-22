import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { DEFAULT_AI_MODEL } from "./src/lib/agent-config";

export default defineConfig(({ command }) => ({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    dedupe: ["react", "react-dom"],
  },
  ssr: { external: ["cloudflare:workers"] },
  build: { rolldownOptions: { external: ["cloudflare:workers"] } },
  server: { host: "127.0.0.1", port: 8080 },
  plugins: [
    tailwindcss(),
    tanstackStart({ server: { entry: "server" } }),
    react(),
    ...(command === "build"
      ? [
          nitro({
            preset: "cloudflare-module",
            cloudflare: {
              wrangler: {
                name: "biodiscovery-ia",
                compatibility_date: "2026-09-22",
                compatibility_flags: ["nodejs_compat"],
                ai: { binding: "AI" },
                vars: {
                  AI_MODEL: process.env["AI_MODEL"] || DEFAULT_AI_MODEL,
                  ...(process.env["MAP_API_URL"]
                    ? { MAP_API_URL: process.env["MAP_API_URL"]! }
                    : {}),
                },
                ...(process.env["HYPERDRIVE_ID"]
                  ? { hyperdrive: [{ binding: "HYPERDRIVE", id: process.env["HYPERDRIVE_ID"]! }] }
                  : {}),
              },
            },
          }),
        ]
      : []),
  ],
}));
