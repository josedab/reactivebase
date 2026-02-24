import { describe, it, expect, beforeEach } from "vitest"
import { encodeShareState, decodeShareState, generateLivePlaygroundHTML } from "../playground/live-playground.js"
import type { ShareableState } from "../playground/live-playground.js"
import { generateEmbeddableWidgetHTML, generateEmbedScript } from "../playground/embeddable-widget.js"
import { GuidedTutorialEngine, GUIDED_TUTORIALS } from "../playground/guided-tutorial.js"

// ─── ShareableState encoding ─────────────────────────────────────────────────

describe("encodeShareState / decodeShareState", () => {
  it("round-trips a shareable state", () => {
    const state: ShareableState = {
      schema: "CREATE TABLE t (id INT);",
      queries: "SELECT * FROM t;",
      data: { t: [{ id: 1 }] },
      version: 1,
    }
    const encoded = encodeShareState(state)
    expect(typeof encoded).toBe("string")

    const decoded = decodeShareState(encoded)
    expect(decoded.schema).toBe(state.schema)
    expect(decoded.queries).toBe(state.queries)
    expect(decoded.data).toEqual(state.data)
    expect(decoded.version).toBe(1)
  })

  it("throws on invalid encoded state", () => {
    const bad = Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64")
    expect(() => decodeShareState(bad)).toThrow("Invalid share state")
  })

  it("throws on malformed base64", () => {
    expect(() => decodeShareState("!!!not-base64")).toThrow()
  })
})

// ─── Live Playground HTML ────────────────────────────────────────────────────

describe("generateLivePlaygroundHTML", () => {
  it("generates HTML with default options", () => {
    const html = generateLivePlaygroundHTML()
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain("ReactiveBase Live Playground")
    expect(html).toContain("schema-editor")
    expect(html).toContain("query-panel")
    expect(html).toContain("results-panel")
    expect(html).toContain("tutorial-sidebar")
  })

  it("applies custom title and theme", () => {
    const html = generateLivePlaygroundHTML({ title: "My PG", theme: "light" })
    expect(html).toContain("My PG")
    expect(html).toContain('data-theme="light"')
  })

  it("escapes initial schema/query content", () => {
    const html = generateLivePlaygroundHTML({
      initialSchema: '<script>alert("xss")</script>',
      initialQuery: "SELECT * FROM t WHERE a < 1 && b > 2",
    })
    expect(html).not.toContain('<script>alert("xss")</script>')
    expect(html).toContain("&lt;script&gt;")
  })

  it("hides tutorial sidebar when disabled", () => {
    const html = generateLivePlaygroundHTML({ showTutorialSidebar: false })
    expect(html).toContain("display: none")
  })
})

// ─── Embeddable Widget ───────────────────────────────────────────────────────

describe("generateEmbeddableWidgetHTML", () => {
  it("generates widget HTML with defaults", () => {
    const html = generateEmbeddableWidgetHTML()
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain("ReactiveBase Playground")
    expect(html).toContain("Run ▶")
  })

  it("applies custom theme", () => {
    const html = generateEmbeddableWidgetHTML({ theme: "light" })
    expect(html).toContain("#ffffff")
  })

  it("includes initial schema", () => {
    const html = generateEmbeddableWidgetHTML({ initialSchema: "CREATE TABLE foo (id INT);" })
    expect(html).toContain("CREATE TABLE foo (id INT);")
  })
})

describe("generateEmbedScript", () => {
  it("generates a script tag", () => {
    const script = generateEmbedScript()
    expect(script).toContain("<script>")
    expect(script).toContain("</script>")
    expect(script).toContain("iframe")
    expect(script).toContain("playground.reactivebase.dev/embed")
  })

  it("embeds custom dimensions", () => {
    const script = generateEmbedScript({ width: "800px", height: "600px" })
    expect(script).toContain("800px")
    expect(script).toContain("600px")
  })
})

// ─── Guided Tutorial Engine ──────────────────────────────────────────────────

describe("GuidedTutorialEngine", () => {
  let engine: GuidedTutorialEngine

  beforeEach(() => {
    engine = new GuidedTutorialEngine()
  })

  describe("tutorials", () => {
    it("loads built-in tutorials", () => {
      expect(engine.tutorialCount).toBe(GUIDED_TUTORIALS.length)
      expect(engine.tutorialCount).toBeGreaterThanOrEqual(3)
    })

    it("lists all tutorials", () => {
      const list = engine.listTutorials()
      expect(list.length).toBe(GUIDED_TUTORIALS.length)
    })

    it("gets tutorial by id", () => {
      const t = engine.getTutorial("getting-started")
      expect(t).toBeDefined()
      expect(t!.title).toBe("Getting Started")
    })

    it("returns undefined for unknown tutorial", () => {
      expect(engine.getTutorial("nonexistent")).toBeUndefined()
    })

    it("accepts custom tutorials", () => {
      const custom = new GuidedTutorialEngine([
        {
          id: "custom",
          title: "Custom",
          description: "test",
          difficulty: "beginner",
          estimatedMinutes: 5,
          steps: [],
        },
      ])
      expect(custom.tutorialCount).toBe(GUIDED_TUTORIALS.length + 1)
      expect(custom.getTutorial("custom")).toBeDefined()
    })
  })

  describe("session lifecycle", () => {
    it("starts a tutorial session", () => {
      const session = engine.startTutorial("getting-started")
      expect(session.sessionId).toMatch(/^guided-/)
      expect(session.tutorialId).toBe("getting-started")
      expect(session.currentStep).toBe(0)
      expect(session.completedSteps.size).toBe(0)
      expect(engine.sessionCount).toBe(1)
    })

    it("throws when starting unknown tutorial", () => {
      expect(() => engine.startTutorial("nonexistent")).toThrow("Tutorial not found")
    })
  })

  describe("submitStep", () => {
    it("passes valid code for step 0 of getting-started", () => {
      const session = engine.startTutorial("getting-started")
      const code = `import { defineSchema, defineTable, v } from "@reactivebase/server"
export default defineSchema({
  tasks: defineTable({ title: v.string(), done: v.boolean() }),
})`
      const result = engine.submitStep(session.sessionId, 0, code)
      expect(result.passed).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it("fails on invalid code and provides hint", () => {
      const session = engine.startTutorial("getting-started")
      const result = engine.submitStep(session.sessionId, 0, "console.log('hello')")
      expect(result.passed).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.hint).toBeDefined()
    })

    it("auto-advances currentStep on success", () => {
      const session = engine.startTutorial("getting-started")
      const code = `import { defineSchema, defineTable, v } from "@reactivebase/server"
export default defineSchema({
  tasks: defineTable({ title: v.string(), done: v.boolean() }),
})`
      engine.submitStep(session.sessionId, 0, code)
      expect(session.currentStep).toBe(1)
    })

    it("returns error for unknown session", () => {
      const result = engine.submitStep("bad-id", 0, "code")
      expect(result.passed).toBe(false)
      expect(result.errors).toContain("Session not found")
    })

    it("returns error for unknown step index", () => {
      const session = engine.startTutorial("getting-started")
      const result = engine.submitStep(session.sessionId, 99, "code")
      expect(result.passed).toBe(false)
      expect(result.errors).toContain("Step not found")
    })
  })

  describe("getProgress", () => {
    it("returns initial progress", () => {
      const session = engine.startTutorial("getting-started")
      const progress = engine.getProgress(session.sessionId)
      expect(progress).toBeDefined()
      expect(progress!.completedSteps).toBe(0)
      expect(progress!.completionPercent).toBe(0)
      expect(progress!.totalSteps).toBeGreaterThan(0)
    })

    it("updates after completing a step", () => {
      const session = engine.startTutorial("getting-started")
      const code = `import { defineSchema, defineTable, v } from "@reactivebase/server"
export default defineSchema({
  tasks: defineTable({ title: v.string(), done: v.boolean() }),
})`
      engine.submitStep(session.sessionId, 0, code)
      const progress = engine.getProgress(session.sessionId)
      expect(progress!.completedSteps).toBe(1)
      expect(progress!.completionPercent).toBeGreaterThan(0)
    })

    it("returns undefined for unknown session", () => {
      expect(engine.getProgress("bad-id")).toBeUndefined()
    })
  })

  describe("getHint", () => {
    it("returns progressive hints", () => {
      const session = engine.startTutorial("getting-started")
      const hint1 = engine.getHint(session.sessionId, 0)
      expect(hint1).toBeDefined()
      expect(typeof hint1).toBe("string")

      const hint2 = engine.getHint(session.sessionId, 0)
      expect(hint2).toBeDefined()
      expect(hint2).not.toBe(hint1)
    })

    it("returns undefined when all hints exhausted", () => {
      const session = engine.startTutorial("getting-started")
      const tutorial = engine.getTutorial("getting-started")!
      const stepHintCount = tutorial.steps[0].hints.length

      for (let i = 0; i < stepHintCount; i++) {
        engine.getHint(session.sessionId, 0)
      }
      expect(engine.getHint(session.sessionId, 0)).toBeUndefined()
    })

    it("returns undefined for unknown session", () => {
      expect(engine.getHint("bad-id", 0)).toBeUndefined()
    })
  })

  describe("full tutorial completion", () => {
    it("completes getting-started tutorial end to end", () => {
      const session = engine.startTutorial("getting-started")
      const tutorial = engine.getTutorial("getting-started")!

      // Step 0: Schema
      engine.submitStep(
        session.sessionId,
        0,
        `import { defineSchema, defineTable, v } from "@reactivebase/server"\nexport default defineSchema({ tasks: defineTable({ title: v.string(), done: v.boolean() }) })`,
      )

      // Step 1: Mutation
      engine.submitStep(
        session.sessionId,
        1,
        `import { mutation } from "@reactivebase/server"\nexport const addTask = mutation(async (ctx) => { return ctx.db.tasks.insert({ title: "test" }) })`,
      )

      // Step 2: Query
      engine.submitStep(
        session.sessionId,
        2,
        `import { query } from "@reactivebase/server"\nexport const listTasks = query(async (ctx) => { return ctx.db.tasks.where({}) })`,
      )

      const progress = engine.getProgress(session.sessionId)
      expect(progress!.completedSteps).toBe(tutorial.steps.length)
      expect(progress!.completionPercent).toBe(100)
    })
  })
})
