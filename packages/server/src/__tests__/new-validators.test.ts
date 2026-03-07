import { describe, it, expect } from "vitest"
import { v } from "../schema/validators.js"
import { s, validateArgs, ValidationError } from "../validation/args-validation.js"

describe("new schema validators", () => {
  it("creates url validator", () => {
    const validator = v.url()
    expect(validator.type).toBe("url")
    expect(validator.pgType).toBe("text")
    expect(validator.isOptional).toBe(false)
  })

  it("creates uuid validator", () => {
    const validator = v.uuid()
    expect(validator.type).toBe("uuid")
    expect(validator.pgType).toBe("uuid")
  })

  it("creates uuid validator with auto-generation default", () => {
    const validator = v.uuid({ default: "gen_random_uuid()" })
    expect(validator.options.default).toBe("gen_random_uuid()")
  })

  it("creates email validator", () => {
    const validator = v.email()
    expect(validator.type).toBe("email")
    expect(validator.pgType).toBe("text")
  })

  it("creates regex validator", () => {
    const validator = v.regex(/^[A-Z]{3}-\d+$/)
    expect(validator.type).toBe("regex")
    expect(validator.pgType).toBe("text")
    expect(validator.options.__regexPattern).toBe("^[A-Z]{3}-\\d+$")
    expect(validator.options.__regexFlags).toBe("")
  })

  it("creates regex validator with flags", () => {
    const validator = v.regex(/^hello$/i)
    expect(validator.options.__regexFlags).toBe("i")
  })
})

describe("new args validation builders", () => {
  describe("s.id()", () => {
    it("validates non-empty string", () => {
      const schema = { userId: s.id("users") }
      expect(() => validateArgs({ userId: "abc123" }, schema)).not.toThrow()
    })

    it("rejects empty string", () => {
      const schema = { userId: s.id() }
      expect(() => validateArgs({ userId: "" }, schema)).toThrow(ValidationError)
    })

    it("rejects missing required id", () => {
      const schema = { userId: s.id() }
      expect(() => validateArgs({}, schema)).toThrow(ValidationError)
    })

    it("allows optional id", () => {
      const schema = { userId: s.id().optional() }
      expect(() => validateArgs({}, schema)).not.toThrow()
    })
  })

  describe("s.enum()", () => {
    it("validates allowed values", () => {
      const schema = { status: s.enum(["active", "inactive", "banned"] as const) }
      expect(() => validateArgs({ status: "active" }, schema)).not.toThrow()
    })

    it("rejects disallowed values", () => {
      const schema = { status: s.enum(["active", "inactive"] as const) }
      expect(() => validateArgs({ status: "unknown" }, schema)).toThrow(ValidationError)
    })

    it("allows optional enum", () => {
      const schema = { priority: s.enum(["low", "high"] as const).optional() }
      expect(() => validateArgs({}, schema)).not.toThrow()
    })
  })

  describe("s.object()", () => {
    it("validates nested objects", () => {
      const schema = {
        address: s.object({
          street: s.string(),
          city: s.string(),
        }),
      }
      expect(() => validateArgs({ address: { street: "123 Main", city: "NYC" } }, schema)).not.toThrow()
    })

    it("rejects non-objects", () => {
      const schema = { address: s.object({ street: s.string() }) }
      expect(() => validateArgs({ address: "not an object" }, schema)).toThrow(ValidationError)
    })

    it("validates nested required fields", () => {
      const schema = {
        address: s.object({
          street: s.string(),
          zip: s.string(),
        }),
      }
      expect(() => validateArgs({ address: { street: "Main St" } }, schema)).toThrow(ValidationError)
    })

    it("allows optional nested objects", () => {
      const schema = { meta: s.object({ key: s.string() }).optional() }
      expect(() => validateArgs({}, schema)).not.toThrow()
    })
  })

  describe("s.url()", () => {
    it("validates valid URLs", () => {
      const schema = { website: s.url() }
      expect(() => validateArgs({ website: "https://example.com" }, schema)).not.toThrow()
    })

    it("rejects invalid URLs", () => {
      const schema = { website: s.url() }
      expect(() => validateArgs({ website: "not-a-url" }, schema)).toThrow(ValidationError)
    })

    it("allows optional URLs", () => {
      const schema = { website: s.url().optional() }
      expect(() => validateArgs({}, schema)).not.toThrow()
    })
  })

  describe("s.string().url()", () => {
    it("validates URLs via chain", () => {
      const schema = { link: s.string().url() }
      expect(() => validateArgs({ link: "https://github.com" }, schema)).not.toThrow()
    })

    it("rejects invalid URLs via chain", () => {
      const schema = { link: s.string().url() }
      expect(() => validateArgs({ link: "bad" }, schema)).toThrow(ValidationError)
    })
  })
})
