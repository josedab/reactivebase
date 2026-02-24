import { describe, it, expect, vi, beforeEach } from "vitest"
import { NeonBranchingAdapter, NeonBranchingError } from "../branching/neon-branching.js"
import { generateGitHubActionYAML, PRPreviewManager, PreviewError } from "../branching/github-action.js"
import { BranchDashboard } from "../branching/branch-dashboard.js"
import { DatabaseBranching } from "../branching/branching.js"
import type { NeonConfig } from "../branching/neon-branching.js"
import type { PreviewConfig } from "../branching/github-action.js"

// ─── Neon Branching Adapter ──────────────────────────────────────────────────

describe("NeonBranchingAdapter", () => {
  const config: NeonConfig = {
    apiKey: "neon_test_key",
    projectId: "proj_test",
  }

  it("throws if apiKey is missing", () => {
    expect(() => new NeonBranchingAdapter({ apiKey: "", projectId: "p" })).toThrow(NeonBranchingError)
  })

  it("uses default base URL", () => {
    const adapter = new NeonBranchingAdapter(config)
    expect(adapter).toBeDefined()
  })

  it("accepts custom base URL", () => {
    const adapter = new NeonBranchingAdapter({ ...config, baseUrl: "https://custom.api/v2/" })
    expect(adapter).toBeDefined()
  })

  it("createBranch calls Neon API", async () => {
    const mockResponse = {
      branch: {
        id: "br_123",
        name: "feature-x",
        parent_id: "br_main",
        created_at: "2024-01-01T00:00:00Z",
        current_state: "ready",
      },
      endpoints: [{ id: "ep_1", host: "ep-1.neon.tech", port: 5432, type: "read_write" }],
    }

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse),
      }),
    )

    const adapter = new NeonBranchingAdapter(config)
    const branch = await adapter.createBranch("proj_test", "feature-x", "br_main")

    expect(branch.id).toBe("br_123")
    expect(branch.name).toBe("feature-x")
    expect(branch.parentId).toBe("br_main")
    expect(branch.currentState).toBe("ready")
    expect(branch.endpoints).toHaveLength(1)
    expect(branch.endpoints[0].type).toBe("read_write")

    vi.unstubAllGlobals()
  })

  it("deleteBranch calls DELETE", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: () => Promise.resolve({}),
      }),
    )

    const adapter = new NeonBranchingAdapter(config)
    await expect(adapter.deleteBranch("proj_test", "br_123")).resolves.toBeUndefined()

    vi.unstubAllGlobals()
  })

  it("listBranches returns mapped branches", async () => {
    const mockResponse = {
      branches: [
        {
          id: "br_1",
          name: "main",
          parent_id: null,
          created_at: "2024-01-01T00:00:00Z",
          current_state: "ready",
        },
        {
          id: "br_2",
          name: "feature-a",
          parent_id: "br_1",
          created_at: "2024-01-02T00:00:00Z",
          current_state: "ready",
        },
      ],
    }

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse),
      }),
    )

    const adapter = new NeonBranchingAdapter(config)
    const branches = await adapter.listBranches("proj_test")

    expect(branches).toHaveLength(2)
    expect(branches[0].name).toBe("main")
    expect(branches[1].parentId).toBe("br_1")

    vi.unstubAllGlobals()
  })

  it("getConnectionString builds postgresql URL", async () => {
    const branchResponse = {
      branch: {
        id: "br_123",
        name: "test",
        parent_id: null,
        created_at: "2024-01-01T00:00:00Z",
        current_state: "ready",
      },
    }
    const endpointsResponse = {
      endpoints: [{ id: "ep_1", host: "ep-test.neon.tech", port: 5432, type: "read_write" }],
    }

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(branchResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(endpointsResponse),
        }),
    )

    const adapter = new NeonBranchingAdapter(config)
    const connStr = await adapter.getConnectionString("proj_test", "br_123")

    expect(connStr).toBe("postgresql://ep-test.neon.tech:5432/neondb")

    vi.unstubAllGlobals()
  })

  it("throws NeonBranchingError on API failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: () => Promise.resolve({ message: "Branch not found", code: "not_found" }),
      }),
    )

    const adapter = new NeonBranchingAdapter(config)
    await expect(adapter.getBranch("proj_test", "br_missing")).rejects.toThrow(NeonBranchingError)

    vi.unstubAllGlobals()
  })

  it("resetBranch calls POST on reset endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      }),
    )

    const adapter = new NeonBranchingAdapter(config)
    await expect(adapter.resetBranch("proj_test", "br_123")).resolves.toBeUndefined()

    const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(fetchCall[0]).toContain("/branches/br_123/reset")
    expect(fetchCall[1].method).toBe("POST")

    vi.unstubAllGlobals()
  })
})

// ─── GitHub Action YAML Generator ────────────────────────────────────────────

describe("generateGitHubActionYAML", () => {
  it("generates valid YAML with defaults", () => {
    const yaml = generateGitHubActionYAML()

    expect(yaml).toContain("name: reactivebase Preview Environment")
    expect(yaml).toContain("pull_request:")
    expect(yaml).toContain("opened, synchronize, reopened, closed")
    expect(yaml).toContain("preview-create:")
    expect(yaml).toContain("preview-cleanup:")
    expect(yaml).toContain("npx reactivebase branch create")
    expect(yaml).toContain("npx reactivebase branch delete")
    expect(yaml).toContain("actions/checkout@v4")
    expect(yaml).toContain("Migration dry-run preview")
    expect(yaml).toContain("Apply migrations on preview")
    expect(yaml).toContain("Comment PR with preview URL")
    expect(yaml).toContain("Comment PR with cleanup notice")
  })

  it("accepts custom config", () => {
    const yaml = generateGitHubActionYAML({
      projectName: "my-app",
      nodeVersion: "18",
      migrationDryRun: false,
    })

    expect(yaml).toContain("name: my-app Preview Environment")
    expect(yaml).toContain('node-version: "18"')
    expect(yaml).not.toContain("Migration dry-run preview")
  })

  it("includes extra env vars", () => {
    const yaml = generateGitHubActionYAML({
      envVars: { CUSTOM_VAR: "${{ secrets.CUSTOM }}" },
    })

    expect(yaml).toContain("CUSTOM_VAR:")
  })
})

// ─── PR Preview Manager ─────────────────────────────────────────────────────

describe("PRPreviewManager", () => {
  let branching: DatabaseBranching
  let manager: PRPreviewManager

  beforeEach(() => {
    branching = new DatabaseBranching({ strategy: "schema", maxBranches: 50 })
    manager = new PRPreviewManager(branching)
  })

  it("creates a preview for a PR", async () => {
    const preview = await manager.createPreview(42, "feature-x", "abc123")

    expect(preview.prNumber).toBe(42)
    expect(preview.branch).toBe("feature-x")
    expect(preview.commitSha).toBe("abc123")
    expect(preview.dbBranch).toBe("pr-42")
    expect(preview.status).toBe("active")
    expect(preview.previewUrl).toContain("pr-42")
  })

  it("lists active previews", async () => {
    await manager.createPreview(1, "feat-a", "sha1")
    await manager.createPreview(2, "feat-b", "sha2")

    const previews = manager.listPreviews()
    expect(previews).toHaveLength(2)
  })

  it("gets a preview by PR number", async () => {
    await manager.createPreview(10, "fix-bug", "sha10")

    const preview = manager.getPreview(10)
    expect(preview).toBeDefined()
    expect(preview!.prNumber).toBe(10)
  })

  it("returns undefined for missing preview", () => {
    expect(manager.getPreview(999)).toBeUndefined()
  })

  it("updates a preview with new commit", async () => {
    await manager.createPreview(5, "feature-y", "sha_old")
    const updated = await manager.updatePreview(5, "sha_new")

    expect(updated.commitSha).toBe("sha_new")
    expect(updated.status).toBe("active")
    expect(updated.migrationStatus).toBe("pending")
  })

  it("throws PreviewError when updating non-existent preview", async () => {
    await expect(manager.updatePreview(999, "sha")).rejects.toThrow(PreviewError)
  })

  it("destroys a preview", async () => {
    await manager.createPreview(7, "temp", "sha7")
    await manager.destroyPreview(7)

    expect(manager.getPreview(7)).toBeUndefined()
    expect(manager.listPreviews()).toHaveLength(0)
  })

  it("destroyPreview is safe for non-existent PR", async () => {
    await expect(manager.destroyPreview(404)).resolves.toBeUndefined()
  })

  it("re-creates preview if already exists", async () => {
    await manager.createPreview(3, "feat-c", "sha_v1")
    const preview2 = await manager.createPreview(3, "feat-c", "sha_v2")

    expect(preview2.commitSha).toBe("sha_v2")
    expect(manager.listPreviews()).toHaveLength(1)
  })

  it("generates migration preview markdown", async () => {
    await manager.createPreview(42, "feat", "sha")
    const md = await manager.generateMigrationPreview("pr-42")

    expect(md).toContain("Migration Preview")
    expect(md).toContain("pr-42")
    expect(md).toContain("main")
  })
})

// ─── Branch Dashboard ────────────────────────────────────────────────────────

describe("BranchDashboard", () => {
  let branching: DatabaseBranching
  let dashboard: BranchDashboard

  beforeEach(() => {
    branching = new DatabaseBranching({ strategy: "schema" })
    dashboard = new BranchDashboard(branching)
  })

  it("returns branch tree with root", () => {
    const tree = dashboard.getBranchTree()

    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe("main")
    expect(tree[0].children).toHaveLength(0)
  })

  it("builds hierarchical tree from branches", async () => {
    await branching.createBranch("feature-a", { fromBranch: "main", createdBy: "test" })
    await branching.createBranch("feature-b", { fromBranch: "main", createdBy: "test" })

    const tree = dashboard.getBranchTree()

    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe("main")
    expect(tree[0].children).toHaveLength(2)
    expect(tree[0].children.map((c) => c.name).sort()).toEqual(["feature-a", "feature-b"])
  })

  it("getBranchDiff returns diff for existing branch", async () => {
    await branching.createBranch("feature-x", { fromBranch: "main", createdBy: "test" })

    const diff = await dashboard.getBranchDiff("feature-x")
    expect(diff).toBeDefined()
    expect(diff!.sourceBranch).toBe("feature-x")
    expect(diff!.targetBranch).toBe("main")
  })

  it("getBranchDiff returns null for missing branch", async () => {
    const diff = await dashboard.getBranchDiff("nonexistent")
    expect(diff).toBeNull()
  })

  it("generates dashboard HTML", async () => {
    await branching.createBranch("dev", { fromBranch: "main", createdBy: "test" })

    const html = await dashboard.generateDashboardHTML()

    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain("ReactiveBase Branch Dashboard")
    expect(html).toContain("Branch Tree")
    expect(html).toContain("main")
    expect(html).toContain("dev")
    expect(html).toContain("All Branches")
    expect(html).toContain("Schema Diff Viewer")
    expect(html).toContain("Active PR Previews")
  })

  it("dashboard shows previews when source provided", async () => {
    const previewSource = {
      listPreviews: () => [
        {
          prNumber: 42,
          branch: "feature-x",
          commitSha: "abc",
          dbBranch: "pr-42",
          previewUrl: "https://preview-42.test.dev",
          status: "active" as const,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          migrationStatus: "applied" as const,
          metadata: {},
        },
      ],
    }

    const dashWithPreviews = new BranchDashboard(branching, previewSource)
    const html = await dashWithPreviews.generateDashboardHTML()

    expect(html).toContain("#42")
    expect(html).toContain("preview-42.test.dev")
  })

  it("dashboard handles empty state", async () => {
    const html = await dashboard.generateDashboardHTML()

    expect(html).toContain("1 branch")
    expect(html).toContain("0 active previews")
  })
})
