import { describe, it, expect, beforeEach } from "vitest"
import {
  PlaygroundEngine,
  PlaygroundError,
  generatePlaygroundHTML,
  generatePlaygroundTableSQL,
  buildSaveSessionSQL,
  buildLoadSessionSQL,
  buildListSessionsSQL,
  buildDeleteSessionSQL,
  PLAYGROUND_TEMPLATES,
  BUILTIN_TUTORIALS,
} from "../playground/playground.js"

describe("PlaygroundEngine", () => {
  let engine: PlaygroundEngine

  beforeEach(() => {
    engine = new PlaygroundEngine()
  })

  describe("session lifecycle", () => {
    it("creates a session with default title", () => {
      const session = engine.createSession()
      expect(session.id).toMatch(/^pg-/)
      expect(session.title).toBe("Untitled Playground")
      expect(engine.sessionCount).toBe(1)
    })

    it("creates a session with custom title", () => {
      const session = engine.createSession("My Playground")
      expect(session.title).toBe("My Playground")
    })

    it("creates a session from template", () => {
      const session = engine.createSession(undefined, "todo-app")
      expect(session.title).toBe("Todo App")
      expect(session.schemaCode).toContain("defineSchema")
      expect(session.queryCode).toContain("query")
      expect(session.mutationCode).toContain("mutation")
    })

    it("throws on invalid template", () => {
      expect(() => engine.createSession(undefined, "nonexistent")).toThrow(PlaygroundError)
    })

    it("retrieves an existing session", () => {
      const created = engine.createSession("Test")
      const retrieved = engine.getSession(created.id)
      expect(retrieved.id).toBe(created.id)
    })

    it("throws when getting non-existent session", () => {
      expect(() => engine.getSession("missing")).toThrow(PlaygroundError)
    })

    it("checks session existence", () => {
      const session = engine.createSession()
      expect(engine.hasSession(session.id)).toBe(true)
      expect(engine.hasSession("missing")).toBe(false)
    })

    it("updates a session", () => {
      const session = engine.createSession()
      engine.updateSession(session.id, { title: "Updated", schemaCode: "new schema" })
      const updated = engine.getSession(session.id)
      expect(updated.title).toBe("Updated")
      expect(updated.schemaCode).toBe("new schema")
    })

    it("deletes a session", () => {
      const session = engine.createSession()
      engine.deleteSession(session.id)
      expect(engine.sessionCount).toBe(0)
    })

    it("throws when deleting non-existent session", () => {
      expect(() => engine.deleteSession("missing")).toThrow(PlaygroundError)
    })

    it("lists sessions sorted by updated time", () => {
      const s1 = engine.createSession("First")
      const s2 = engine.createSession("Second")
      const s3 = engine.createSession("Third")
      const a1 = s1 as unknown as Record<string, unknown>
      const a2 = s2 as unknown as Record<string, unknown>
      const a3 = s3 as unknown as Record<string, unknown>
      a1.updatedAt = 1000
      a2.updatedAt = 2000
      a3.updatedAt = 3000
      const sessions = engine.listSessions()
      expect(sessions).toHaveLength(3)
      expect(sessions[0].title).toBe("Third")
      expect(sessions[2].title).toBe("First")
    })

    it("evicts oldest session when max reached", () => {
      const eng = new PlaygroundEngine({ maxSessions: 2 })
      eng.createSession("First")
      eng.createSession("Second")
      eng.createSession("Third")
      expect(eng.sessionCount).toBe(2)
    })
  })

  describe("code execution", () => {
    it("executes code and returns success result", () => {
      const session = engine.createSession()
      const result = engine.execute(session.id, "block-1", 'console.log("hello")')
      expect(result.status).toBe("success")
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
      expect(result.output).toBeDefined()
    })

    it("records results on the session", () => {
      const session = engine.createSession()
      engine.execute(session.id, "block-1", "const x = 1")
      const updated = engine.getSession(session.id)
      expect(updated.results).toHaveLength(1)
      expect(updated.results[0].blockId).toBe("block-1")
    })

    it("replaces results for the same blockId", () => {
      const session = engine.createSession()
      engine.execute(session.id, "block-1", "const x = 1")
      engine.execute(session.id, "block-1", "const x = 2")
      const updated = engine.getSession(session.id)
      expect(updated.results).toHaveLength(1)
    })

    it("parses imports and exports from code", () => {
      const session = engine.createSession()
      const result = engine.execute(
        session.id,
        "block-1",
        `import { query } from "@reactivebase/server"\nexport const listTasks = query(async (ctx) => {})`,
      )
      expect(result.status).toBe("success")
      const output = result.output as Record<string, unknown>
      expect(output.imports).toContain("query")
      expect(output.exports).toContain("listTasks")
    })
  })

  describe("tutorials", () => {
    it("lists available tutorials", () => {
      expect(engine.availableTutorials.length).toBeGreaterThan(0)
    })

    it("gets a tutorial by ID", () => {
      const tutorial = engine.getTutorial("getting-started")
      expect(tutorial.title).toContain("Todo")
      expect(tutorial.steps.length).toBeGreaterThan(0)
    })

    it("throws on unknown tutorial", () => {
      expect(() => engine.getTutorial("nonexistent")).toThrow(PlaygroundError)
    })

    it("starts a tutorial and returns first step", () => {
      const session = engine.createSession()
      const step = engine.startTutorial(session.id, "getting-started")
      expect(step.id).toBe("step-1-schema")
    })

    it("tracks tutorial progress", () => {
      const session = engine.createSession()
      engine.startTutorial(session.id, "getting-started")

      const result: Parameters<typeof engine.validateStep>[3] = {
        blockId: "test",
        status: "success",
        output: "data",
        durationMs: 10,
        timestamp: Date.now(),
      }

      const validation = engine.validateStep(session.id, "getting-started", "step-1-schema", result)
      expect(validation.passed).toBe(true)

      const progress = engine.getTutorialProgress(session.id, "getting-started")
      expect(progress.completedSteps).toContain("step-1-schema")
      expect(progress.totalSteps).toBe(5)
      expect(progress.isComplete).toBe(false)
    })

    it("gets next incomplete step", () => {
      const session = engine.createSession()
      engine.startTutorial(session.id, "getting-started")

      const successResult = {
        blockId: "test",
        status: "success" as const,
        output: "data",
        durationMs: 10,
        timestamp: Date.now(),
      }

      engine.validateStep(session.id, "getting-started", "step-1-schema", successResult)
      const next = engine.getNextStep(session.id, "getting-started")
      expect(next?.id).toBe("step-2-query")
    })

    it("returns null when tutorial is complete", () => {
      const session = engine.createSession()
      engine.startTutorial(session.id, "getting-started")

      const tutorial = engine.getTutorial("getting-started")
      const successResult = {
        blockId: "test",
        status: "success" as const,
        output: "data",
        durationMs: 10,
        timestamp: Date.now(),
      }

      for (const step of tutorial.steps) {
        engine.validateStep(session.id, "getting-started", step.id, successResult)
      }

      expect(engine.getNextStep(session.id, "getting-started")).toBeNull()
      const progress = engine.getTutorialProgress(session.id, "getting-started")
      expect(progress.isComplete).toBe(true)
    })
  })

  describe("session sharing", () => {
    it("encodes and decodes a session", () => {
      const session = engine.createSession("Shared")
      engine.updateSession(session.id, {
        schemaCode: "schema code",
        queryCode: "query code",
      })

      const encoded = engine.encodeSession(session.id)
      expect(encoded).toBeTruthy()

      const decoded = engine.decodeSession(encoded)
      expect(decoded.title).toBe("Shared")
      expect(decoded.schemaCode).toBe("schema code")
      expect(decoded.queryCode).toBe("query code")
    })

    it("throws on invalid encoded data", () => {
      expect(() => engine.decodeSession("!!!invalid!!!")).toThrow(PlaygroundError)
    })
  })

  describe("templates", () => {
    it("provides built-in templates", () => {
      expect(engine.templates.length).toBe(5)
      expect(engine.templates.map((t) => t.id)).toContain("todo-app")
      expect(engine.templates.map((t) => t.id)).toContain("chat-room")
    })

    it("all templates have required fields", () => {
      for (const template of engine.templates) {
        expect(template.name).toBeTruthy()
        expect(template.schema).toContain("defineSchema")
        expect(template.queries).toContain("query")
        expect(template.mutations).toContain("mutation")
      }
    })
  })
})

describe("PLAYGROUND_TEMPLATES", () => {
  it("has 5 templates", () => {
    expect(PLAYGROUND_TEMPLATES).toHaveLength(5)
  })

  it("covers all categories", () => {
    const categories = PLAYGROUND_TEMPLATES.map((t) => t.category)
    expect(categories).toContain("starter")
    expect(categories).toContain("realtime")
    expect(categories).toContain("collaboration")
    expect(categories).toContain("dashboard")
    expect(categories).toContain("ai")
  })
})

describe("BUILTIN_TUTORIALS", () => {
  it("has at least 2 tutorials", () => {
    expect(BUILTIN_TUTORIALS.length).toBeGreaterThanOrEqual(2)
  })

  it("each tutorial has steps with required fields", () => {
    for (const tutorial of BUILTIN_TUTORIALS) {
      expect(tutorial.steps.length).toBeGreaterThan(0)
      for (const step of tutorial.steps) {
        expect(step.id).toBeTruthy()
        expect(step.title).toBeTruthy()
        expect(step.code).toBeTruthy()
        expect(step.hints.length).toBeGreaterThan(0)
      }
    }
  })
})

describe("generatePlaygroundHTML", () => {
  it("generates valid HTML", () => {
    const html = generatePlaygroundHTML()
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain("ReactiveBase Playground")
    expect(html).toContain("code-editor")
  })

  it("respects custom title", () => {
    const html = generatePlaygroundHTML({ title: "My Custom Playground" })
    expect(html).toContain("My Custom Playground")
  })

  it("includes templates in HTML", () => {
    const html = generatePlaygroundHTML()
    expect(html).toContain("Todo App")
    expect(html).toContain("Chat Room")
  })

  it("includes tutorial links", () => {
    const html = generatePlaygroundHTML()
    expect(html).toContain("getting-started")
  })
})

describe("SQL builders", () => {
  it("generatePlaygroundTableSQL creates tables", () => {
    const sql = generatePlaygroundTableSQL()
    expect(sql).toContain("_reactivebase_playground_sessions")
    expect(sql).toContain("CREATE TABLE")
  })

  it("buildSaveSessionSQL generates upsert", () => {
    const session = {
      id: "pg-1",
      title: "Test",
      code: "",
      schemaCode: "schema",
      queryCode: "query",
      mutationCode: "mutation",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      results: [],
    }
    const { sql, params } = buildSaveSessionSQL(session)
    expect(sql).toContain("INSERT INTO")
    expect(sql).toContain("ON CONFLICT")
    expect(params).toHaveLength(6)
  })

  it("buildLoadSessionSQL generates select", () => {
    const { sql, params } = buildLoadSessionSQL("pg-1")
    expect(sql).toContain("SELECT")
    expect(params).toEqual(["pg-1"])
  })

  it("buildListSessionsSQL generates select with limit", () => {
    const { sql, params } = buildListSessionsSQL(10)
    expect(sql).toContain("ORDER BY")
    expect(params).toEqual([10])
  })

  it("buildDeleteSessionSQL generates delete", () => {
    const { sql, params } = buildDeleteSessionSQL("pg-1")
    expect(sql).toContain("DELETE")
    expect(params).toEqual(["pg-1"])
  })
})
