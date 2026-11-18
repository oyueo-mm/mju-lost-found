import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // The D-2 cutover rehearsal keeps an archived application under .vercel.
    exclude: [...configDefaults.exclude, ".vercel/**"],
    setupFiles: ["./scripts/db/test-setup.ts"],
  },
});
