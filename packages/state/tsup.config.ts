import { defineConfig } from "tsup"
export default defineConfig({
  entry: {
    index: "src/index.ts",
    "adapters/zustand": "src/adapters/zustand.ts",
    "adapters/jotai": "src/adapters/jotai.ts",
    "adapters/pinia": "src/adapters/pinia.ts",
    "adapters/nanostores": "src/adapters/nanostores.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
})
