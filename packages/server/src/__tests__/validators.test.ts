import { describe, it, expect } from "vitest"
import { v } from "../schema/validators.js"

describe("validators", () => {
  it("creates string validator", () => {
    const validator = v.string()
    expect(validator.type).toBe("string")
    expect(validator.pgType).toBe("text")
    expect(validator.isOptional).toBe(false)
  })

  it("creates number validator", () => {
    const validator = v.number()
    expect(validator.type).toBe("number")
    expect(validator.pgType).toBe("double precision")
  })

  it("creates integer validator", () => {
    const validator = v.integer()
    expect(validator.type).toBe("integer")
    expect(validator.pgType).toBe("integer")
  })

  it("creates boolean validator with default", () => {
    const validator = v.boolean({ default: false })
    expect(validator.type).toBe("boolean")
    expect(validator.pgType).toBe("boolean")
    expect(validator.options.default).toBe(false)
  })

  it("creates timestamp validator", () => {
    const validator = v.timestamp({ default: "now" })
    expect(validator.type).toBe("timestamp")
    expect(validator.pgType).toBe("timestamptz")
    expect(validator.options.default).toBe("now")
  })

  it("creates json validator", () => {
    const validator = v.json()
    expect(validator.type).toBe("json")
    expect(validator.pgType).toBe("jsonb")
  })

  it("creates array validator", () => {
    const validator = v.array(v.string())
    expect(validator.type).toBe("array")
    expect(validator.pgType).toBe("text[]")
  })

  it("creates enum validator", () => {
    const validator = v.enum("low", "medium", "high")
    expect(validator.type).toBe("enum")
    expect(validator.enumValues).toEqual(["low", "medium", "high"])
  })

  it("creates id reference validator", () => {
    const validator = v.id("users")
    expect(validator.type).toBe("id")
    expect(validator.pgType).toBe("text")
    expect(validator.referencedTable).toBe("users")
  })

  it("creates optional validator", () => {
    const inner = v.string()
    const validator = v.optional(inner)
    expect(validator.type).toBe("optional")
    expect(validator.isOptional).toBe(true)
    expect(validator.innerValidator).toBeDefined()
  })

  it("creates custom validator", () => {
    const validator = v.custom<unknown>("geometry")
    expect(validator.type).toBe("custom")
    expect(validator.pgType).toBe("geometry")
  })
})
