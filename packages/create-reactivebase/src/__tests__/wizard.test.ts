import { describe, it, expect } from "vitest"
import { runWizard, generateDependencies, generateConfigFile, generateEnvFile } from "../wizard.js"
import type { WizardOptions } from "../wizard.js"

describe("wizard exports", () => {
  it("exports runWizard function", () => {
    expect(typeof runWizard).toBe("function")
  })

  it("exports generateDependencies function", () => {
    expect(typeof generateDependencies).toBe("function")
  })

  it("exports generateConfigFile function", () => {
    expect(typeof generateConfigFile).toBe("function")
  })

  it("exports generateEnvFile function", () => {
    expect(typeof generateEnvFile).toBe("function")
  })
})

describe("generateDependencies", () => {
  it("returns dependencies and devDependencies for default options", () => {
    const options: WizardOptions = {
      projectName: "test-app",
      framework: "react",
      auth: "jwt",
      database: "pglite",
      template: "blank",
    }
    const result = generateDependencies(options)
    expect(result).toHaveProperty("dependencies")
    expect(result).toHaveProperty("devDependencies")
    expect(result.dependencies["@reactivebase/server"]).toBeDefined()
    expect(result.dependencies["@reactivebase/client"]).toBeDefined()
    expect(result.dependencies["@reactivebase/react"]).toBeDefined()
  })

  it("includes pglite dependency when database is pglite", () => {
    const options: WizardOptions = {
      projectName: "test-app",
      framework: "none",
      auth: "none",
      database: "pglite",
      template: "blank",
    }
    const result = generateDependencies(options)
    expect(result.dependencies["@electric-sql/pglite"]).toBeDefined()
  })

  it("omits framework deps when framework is none", () => {
    const options: WizardOptions = {
      projectName: "test-app",
      framework: "none",
      auth: "none",
      database: "url",
      template: "blank",
    }
    const result = generateDependencies(options)
    expect(result.dependencies["@reactivebase/react"]).toBeUndefined()
    expect(result.dependencies["@reactivebase/vue"]).toBeUndefined()
  })
})

describe("generateConfigFile", () => {
  it("generates config with jwt auth", () => {
    const options: WizardOptions = {
      projectName: "test-app",
      framework: "react",
      auth: "jwt",
      database: "url",
      template: "blank",
    }
    const config = generateConfigFile(options)
    expect(config).toContain("defineConfig")
    expect(config).toContain("jwtProvider")
  })

  it("generates config with pglite database", () => {
    const options: WizardOptions = {
      projectName: "test-app",
      framework: "react",
      auth: "none",
      database: "pglite",
      template: "blank",
    }
    const config = generateConfigFile(options)
    expect(config).toContain("pglite")
  })
})

describe("generateEnvFile", () => {
  it("includes DATABASE_URL for url database", () => {
    const options: WizardOptions = {
      projectName: "test-app",
      framework: "react",
      auth: "none",
      database: "url",
      template: "blank",
    }
    const env = generateEnvFile(options)
    expect(env).toContain("DATABASE_URL")
  })

  it("includes JWT_SECRET for jwt auth", () => {
    const options: WizardOptions = {
      projectName: "test-app",
      framework: "react",
      auth: "jwt",
      database: "pglite",
      template: "blank",
    }
    const env = generateEnvFile(options)
    expect(env).toContain("JWT_SECRET")
  })
})
