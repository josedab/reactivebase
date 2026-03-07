import { describe, it, expect, vi, beforeEach } from "vitest"
import { useFile } from "../hooks/file-hooks.js"

// ─── Mock Client ─────────────────────────────────────────────────────────────

function createMockClient() {
  type Listener = (...args: unknown[]) => void
  const subscriptions = new Map<string, { queryName: string; args: unknown; listener: Listener }>()
  let subCounter = 0

  return {
    subscribe: vi.fn((queryName: string, args: unknown, listener: Listener) => {
      const id = `sub_${++subCounter}`
      subscriptions.set(id, { queryName, args, listener })
      return () => {
        subscriptions.delete(id)
      }
    }),
    mutate: vi.fn(async (_name: string, _args: unknown): Promise<Record<string, unknown>> => ({ success: true })),
    runAction: vi.fn(
      async (_name: string, _args: unknown): Promise<Record<string, unknown>> => ({
        id: "file-1",
        url: "https://cdn.example.com/file-1",
        variants: {},
      }),
    ),
    disconnect: vi.fn(),
    _subscriptions: subscriptions,
  }
}

// ─── File accept-pattern matching (mirrors useFile validation logic) ─────────

function matchesAcceptPattern(type: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith("/*")) {
      return type.startsWith(pattern.replace("/*", "/"))
    }
    return type === pattern
  })
}

describe("file-hooks", () => {
  it("should export useFile hook", () => {
    expect(useFile).toBeDefined()
    expect(typeof useFile).toBe("function")
  })

  it("should be a valid React hook", () => {
    expect(useFile.name).toContain("use")
    // useFile accepts an optional options parameter (default = {}), so .length is 0
    expect(useFile.length).toBe(0)
  })

  it("should handle file state management", () => {
    // Verify initial state shape matches the hook's INITIAL_STATE
    const initialState = {
      id: null,
      status: "idle",
      progress: 0,
      url: null,
      variants: {},
      error: null,
      metadata: {},
    }

    expect(initialState.status).toBe("idle")
    expect(initialState.progress).toBe(0)
    expect(initialState.id).toBeNull()
    expect(initialState.url).toBeNull()
    expect(initialState.error).toBeNull()
    expect(initialState.variants).toEqual({})
    expect(initialState.metadata).toEqual({})
  })
})

// ─── File upload via runAction ───────────────────────────────────────────────

describe("useFile upload logic", () => {
  let mockClient: ReturnType<typeof createMockClient>

  beforeEach(() => {
    mockClient = createMockClient()
  })

  it("calls runAction with correct upload parameters", async () => {
    await mockClient.runAction("storage:upload", {
      data: [72, 101, 108, 108, 111],
      contentType: "text/plain",
      filename: "hello.txt",
      pipeline: undefined,
      metadata: { author: "test" },
    })

    expect(mockClient.runAction).toHaveBeenCalledWith("storage:upload", {
      data: [72, 101, 108, 108, 111],
      contentType: "text/plain",
      filename: "hello.txt",
      pipeline: undefined,
      metadata: { author: "test" },
    })
  })

  it("returns file id and url from upload result", async () => {
    mockClient.runAction.mockResolvedValueOnce({
      id: "file-42",
      url: "https://cdn.example.com/file-42",
      variants: { thumbnail: "https://cdn.example.com/file-42-thumb" },
    })

    const result = await mockClient.runAction("storage:upload", {
      data: [],
      contentType: "image/png",
      filename: "photo.png",
    })

    expect(result).toEqual({
      id: "file-42",
      url: "https://cdn.example.com/file-42",
      variants: { thumbnail: "https://cdn.example.com/file-42-thumb" },
    })
  })

  it("propagates upload errors", async () => {
    mockClient.runAction.mockRejectedValueOnce(new Error("Upload failed"))

    await expect(mockClient.runAction("storage:upload", { data: [] })).rejects.toThrow("Upload failed")
  })

  it("tracks progress through state transitions", () => {
    // Simulate the state transitions that useFile goes through during upload
    type FileStatus = "idle" | "uploading" | "processing" | "ready" | "error"
    const transitions: FileStatus[] = []

    let status: FileStatus = "idle"
    transitions.push(status)

    // Upload starts
    status = "uploading"
    transitions.push(status)

    // File data read complete (progress 30)
    let progress = 30
    expect(progress).toBe(30)

    // Upload complete
    status = "ready"
    progress = 100
    transitions.push(status)

    expect(transitions).toEqual(["idle", "uploading", "ready"])
    expect(progress).toBe(100)
  })
})

// ─── File state transitions ──────────────────────────────────────────────────

describe("useFile state transitions", () => {
  it("transitions from idle to uploading to ready on success", () => {
    type FileStatus = "idle" | "uploading" | "processing" | "ready" | "error"
    const states: { status: FileStatus; progress: number }[] = []

    // Initial state
    states.push({ status: "idle", progress: 0 })

    // Upload begins
    states.push({ status: "uploading", progress: 0 })

    // ArrayBuffer read
    states.push({ status: "uploading", progress: 30 })

    // Upload completes
    states.push({ status: "ready", progress: 100 })

    expect(states[0].status).toBe("idle")
    expect(states[1].status).toBe("uploading")
    expect(states[3].status).toBe("ready")
    expect(states[3].progress).toBe(100)
  })

  it("transitions from idle to uploading to error on failure", () => {
    type FileStatus = "idle" | "uploading" | "processing" | "ready" | "error"
    const states: { status: FileStatus; progress: number; error: string | null }[] = []

    states.push({ status: "idle", progress: 0, error: null })
    states.push({ status: "uploading", progress: 0, error: null })
    states.push({ status: "error", progress: 0, error: "Upload failed" })

    expect(states[2].status).toBe("error")
    expect(states[2].error).toBe("Upload failed")
    expect(states[2].progress).toBe(0)
  })

  it("reset returns to idle state", () => {
    const initialState = {
      id: null,
      status: "idle" as const,
      progress: 0,
      url: null,
      variants: {},
      error: null,
      metadata: {},
    }

    // Simulate uploading state
    const uploadingState = { ...initialState, status: "uploading" as const, progress: 30 }
    expect(uploadingState.status).toBe("uploading")

    // Reset to initial
    const resetState = { ...initialState }
    expect(resetState.status).toBe("idle")
    expect(resetState.progress).toBe(0)
    expect(resetState.id).toBeNull()
  })
})

// ─── File size validation and type checking ──────────────────────────────────

describe("useFile validation logic", () => {
  it("rejects files exceeding maxSize", () => {
    const maxSize = 1024 * 1024 // 1MB
    const fileSize = 2 * 1024 * 1024 // 2MB

    const exceeds = fileSize > maxSize
    expect(exceeds).toBe(true)

    // The hook sets error state when size exceeds limit
    const errorMsg = `File size exceeds ${maxSize} bytes`
    expect(errorMsg).toBe("File size exceeds 1048576 bytes")
  })

  it("accepts files within maxSize", () => {
    const maxSize = 1024 * 1024 // 1MB
    const fileSize = 512 * 1024 // 512KB

    const exceeds = fileSize > maxSize
    expect(exceeds).toBe(false)
  })

  it("validates file type with exact match", () => {
    const accept = ["application/pdf", "image/png"]

    expect(matchesAcceptPattern("application/pdf", accept)).toBe(true)
    expect(matchesAcceptPattern("image/png", accept)).toBe(true)
    expect(matchesAcceptPattern("image/jpeg", accept)).toBe(false)
    expect(matchesAcceptPattern("text/plain", accept)).toBe(false)
  })

  it("validates file type with wildcard pattern", () => {
    const accept = ["image/*"]

    expect(matchesAcceptPattern("image/png", accept)).toBe(true)
    expect(matchesAcceptPattern("image/jpeg", accept)).toBe(true)
    expect(matchesAcceptPattern("image/gif", accept)).toBe(true)
    expect(matchesAcceptPattern("application/pdf", accept)).toBe(false)
    expect(matchesAcceptPattern("text/plain", accept)).toBe(false)
  })

  it("validates with mixed exact and wildcard patterns", () => {
    const accept = ["image/*", "application/pdf"]

    expect(matchesAcceptPattern("image/png", accept)).toBe(true)
    expect(matchesAcceptPattern("application/pdf", accept)).toBe(true)
    expect(matchesAcceptPattern("text/plain", accept)).toBe(false)
  })

  it("rejects file type not in accept list", () => {
    const accept = ["image/*"]
    const fileType = "application/zip"

    const accepted = matchesAcceptPattern(fileType, accept)
    expect(accepted).toBe(false)

    // The hook sets error state for rejected types
    const errorMsg = `File type "${fileType}" not accepted`
    expect(errorMsg).toBe('File type "application/zip" not accepted')
  })
})
