import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { createLogger, defineConfig } from "vite";

// Some deps (TanStack Router, etc.) ship sourceMappingURL comments but omit
// the .map files, so Vite spams "Failed to load source map". Harmless —
// filter those lines out of the dev logger.
const logger = createLogger();
const originalWarn = logger.warn;
logger.warn = (msg, options) => {
  if (msg.includes("Failed to load source map")) return;
  originalWarn(msg, options);
};

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
  },
  customLogger: logger,
  server: {
    port: 3000,
  },
  plugins: [
    tailwindcss(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart({
      router: {
        codeSplittingOptions: {
          // HMR wrapper (TSRSplit*) can end up out of scope with the current plugin
          // pipeline; keep lazy route splitting without the stable HMR shim.
          addHmr: false,
        },
      },
    }),
    react(),
  ],
});
