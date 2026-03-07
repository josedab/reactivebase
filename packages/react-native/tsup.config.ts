import { defineConfig } from "tsup"
export default defineConfig({
  entry: ["src/index.ts", "src/sqlite-storage.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["react", "react-native"],
  esbuildOptions(options) {
    options.jsx = "automatic"
  },
})
