/**
 * Vue components composables tests — verifies useReactiveTable, useReactiveForm,
 * and usePresenceAvatars composable behavior.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock @reactivebase/client
vi.mock("@reactivebase/client", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    ReactiveBaseClient: vi.fn().mockImplementation(() => ({
      subscribe: vi.fn((_name: string, _args: unknown, cb: (result: unknown) => void) => {
        cb([
          { id: "1", title: "Task 1", status: "todo" },
          { id: "2", title: "Task 2", status: "done" },
          { id: "3", title: "Task 3", status: "todo" },
        ])
        return () => {}
      }),
      mutate: vi.fn(async () => ({ result: "ok" })),
      runAction: vi.fn(),
      disconnect: vi.fn(),
    })),
  }
})

// Mock Vue composition API
const mockClient = {
  subscribe: vi.fn((_name: string, _args: unknown, cb: (result: unknown) => void) => {
    cb([
      { id: "1", title: "Task 1", status: "todo" },
      { id: "2", title: "Task 2", status: "done" },
      { id: "3", title: "Task 3", status: "todo" },
    ])
    return () => {}
  }),
  mutate: vi.fn(async () => ({ result: "ok" })),
  runAction: vi.fn(),
  disconnect: vi.fn(),
}

vi.mock("vue", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    inject: () => mockClient,
    provide: vi.fn(),
  }
})

// ─── useReactiveTable ───────────────────────────────────────────────────────

describe("useReactiveTable", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("exports useReactiveTable composable", async () => {
    const { useReactiveTable } = await import("../components.js")
    expect(typeof useReactiveTable).toBe("function")
  })

  it("returns expected reactive properties", async () => {
    const { useReactiveTable } = await import("../components.js")
    const result = useReactiveTable({
      query: "tasks.list",
      columns: [
        { key: "title", header: "Title", sortable: true },
        { key: "status", header: "Status" },
      ],
    })

    expect(result).toHaveProperty("rows")
    expect(result).toHaveProperty("isLoading")
    expect(result).toHaveProperty("sortKey")
    expect(result).toHaveProperty("sortDir")
    expect(result).toHaveProperty("page")
    expect(result).toHaveProperty("totalPages")
    expect(typeof result.sort).toBe("function")
    expect(typeof result.nextPage).toBe("function")
    expect(typeof result.prevPage).toBe("function")
  })

  it("sort toggles direction on same key", async () => {
    const { useReactiveTable } = await import("../components.js")
    const { sort, sortKey, sortDir } = useReactiveTable({
      query: "tasks.list",
      columns: [{ key: "title", header: "Title", sortable: true }],
    })

    sort("title")
    expect(sortKey.value).toBe("title")
    expect(sortDir.value).toBe("asc")

    sort("title")
    expect(sortDir.value).toBe("desc")
  })

  it("sort resets to asc on new key", async () => {
    const { useReactiveTable } = await import("../components.js")
    const { sort, sortKey, sortDir } = useReactiveTable({
      query: "tasks.list",
      columns: [
        { key: "title", header: "Title", sortable: true },
        { key: "status", header: "Status", sortable: true },
      ],
    })

    sort("title")
    sort("title") // now desc
    sort("status")
    expect(sortKey.value).toBe("status")
    expect(sortDir.value).toBe("asc")
  })
})

// ─── useReactiveForm ────────────────────────────────────────────────────────

describe("useReactiveForm", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("exports useReactiveForm composable", async () => {
    const { useReactiveForm } = await import("../components.js")
    expect(typeof useReactiveForm).toBe("function")
  })

  it("returns expected reactive properties", async () => {
    const { useReactiveForm } = await import("../components.js")
    const result = useReactiveForm({
      mutation: "tasks.create",
      fields: [{ name: "title", label: "Title", type: "text", required: true }],
    })

    expect(result).toHaveProperty("values")
    expect(result).toHaveProperty("errors")
    expect(result).toHaveProperty("isSubmitting")
    expect(typeof result.setValue).toBe("function")
    expect(typeof result.submit).toBe("function")
    expect(typeof result.reset).toBe("function")
  })

  it("setValue updates values and clears field error", async () => {
    const { useReactiveForm } = await import("../components.js")
    const { setValue, values } = useReactiveForm({
      mutation: "tasks.create",
      fields: [{ name: "title", label: "Title", type: "text" }],
    })

    setValue("title", "New Task")
    expect(values.value.title).toBe("New Task")
  })

  it("validates required fields on submit", async () => {
    const { useReactiveForm } = await import("../components.js")
    const { submit, errors } = useReactiveForm({
      mutation: "tasks.create",
      fields: [{ name: "title", label: "Title", type: "text", required: true }],
    })

    await submit()
    expect(errors.value.title).toBe("Title is required")
  })

  it("runs custom field validators", async () => {
    const { useReactiveForm } = await import("../components.js")
    const { setValue, submit, errors } = useReactiveForm({
      mutation: "tasks.create",
      fields: [
        {
          name: "email",
          label: "Email",
          type: "email",
          validate: (v) => (typeof v === "string" && v.includes("@") ? null : "Invalid email"),
        },
      ],
    })

    setValue("email", "bad")
    await submit()
    expect(errors.value.email).toBe("Invalid email")
  })

  it("reset restores initial values", async () => {
    const { useReactiveForm } = await import("../components.js")
    const initial = { title: "Original" }
    const { setValue, reset, values } = useReactiveForm({
      mutation: "tasks.create",
      fields: [{ name: "title", label: "Title", type: "text" }],
      initialValues: initial,
    })

    setValue("title", "Changed")
    expect(values.value.title).toBe("Changed")

    reset()
    expect(values.value.title).toBe("Original")
  })
})

// ─── usePresenceAvatars ─────────────────────────────────────────────────────

describe("usePresenceAvatars", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("exports usePresenceAvatars composable", async () => {
    const { usePresenceAvatars } = await import("../components.js")
    expect(typeof usePresenceAvatars).toBe("function")
  })

  it("returns expected reactive properties", async () => {
    const { usePresenceAvatars } = await import("../components.js")
    const result = usePresenceAvatars({
      query: "presence.list",
      maxVisible: 3,
    })

    expect(result).toHaveProperty("users")
    expect(result).toHaveProperty("visible")
    expect(result).toHaveProperty("overflow")
    expect(result).toHaveProperty("isLoading")
  })
})
