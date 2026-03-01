#!/usr/bin/env node

// Bumps the version field in all packages/*/package.json files.
// Usage: node scripts/version-bump.js <version>
// Example: node scripts/version-bump.js 0.2.0

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const version = process.argv[2]

if (!version) {
  console.error("Usage: node scripts/version-bump.js <version>")
  console.error("Example: node scripts/version-bump.js 0.2.0")
  process.exit(1)
}

if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`Invalid semver version: ${version}`)
  process.exit(1)
}

const scriptDir = fileURLToPath(new URL(".", import.meta.url))
const rootDir = resolve(scriptDir, "..")
const packagesDir = join(rootDir, "packages")

const dirs = readdirSync(packagesDir).filter((name) => {
  const fullPath = join(packagesDir, name)
  return statSync(fullPath).isDirectory()
})

let updated = 0

for (const dir of dirs) {
  const pkgPath = join(packagesDir, dir, "package.json")
  try {
    const raw = readFileSync(pkgPath, "utf-8")
    const pkg = JSON.parse(raw)
    const oldVersion = pkg.version
    pkg.version = version
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n")
    console.log(`  ${pkg.name}: ${oldVersion} → ${version}`)
    updated++
  } catch {
    // Skip directories without package.json
  }
}

console.log(`\nUpdated ${updated} packages to v${version}`)
