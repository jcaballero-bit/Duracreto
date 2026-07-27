import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    globalSetup: ["./tests/setup/global-setup.ts"],
    setupFiles: ["./tests/setup/setup-env.ts"],
    // Las pruebas de integración comparten una BD SQLite; evitar concurrencia
    // entre archivos para que la limpieza entre pruebas sea determinista.
    fileParallelism: false,
  },
});
