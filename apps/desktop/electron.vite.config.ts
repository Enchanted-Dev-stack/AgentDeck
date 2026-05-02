import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "electron-vite";

const currentDirectory = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: resolve(currentDirectory, "src/electron/main.ts"),
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve(currentDirectory, "src/electron/preload.ts"),
      },
    },
  },
  renderer: {
    root: currentDirectory,
    build: {
      rollupOptions: {
        input: resolve(currentDirectory, "index.html"),
      },
    },
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5173,
    },
  },
});
