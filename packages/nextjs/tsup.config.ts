import { defineConfig } from "tsup"
export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["react", "next"],
  esbuildOptions(options) {
    options.jsx = "automatic"
  },
})
