import { describe, it, expect, beforeEach } from "vitest"
import { DatabaseBranching, BranchingError, generateBranchTableSQL } from "../branching/branching.js"

describe("DatabaseBranching", () => {
  let branching: DatabaseBranching

  beforeEach(() => {
    branching = new DatabaseBranching({ strategy: "schema", defaultBranch: "main" })
  })

  describe("branch creation", () => {
    it("creates a branch from main", async () => {
      const branch = await branching.createBranch("feature-x", { createdBy: "alice" })
      expect(branch.name).toBe("feature-x")
      expect(branch.parentBranch).toBe("main")
      expect(branch.status).toBe("active")
      expect(branch.schemaName).toContain("feature_x")
      expect(branch.createdBy).toBe("alice")
    })

    it("rejects duplicate branch names", async () => {
      await branching.createBranch("feature-x")
      await expect(branching.createBranch("feature-x")).rejects.toThrow(BranchingError)
    })

    it("rejects when max branches reached", async () => {
      const small = new DatabaseBranching({ maxBranches: 2 }) // 1 is main
      await small.createBranch("b1")
      await expect(small.createBranch("b2")).rejects.toThrow("Maximum")
    })

    it("rejects branching from nonexistent parent", async () => {
      await expect(branching.createBranch("x", { fromBranch: "nonexistent" })).rejects.toThrow(BranchingError)
    })

    it("generates connection string for schema strategy", async () => {
      const branch = await branching.createBranch("feat")
      expect(branch.connectionString).toContain("search_path")
    })

    it("generates Neon branch ID for neon strategy", async () => {
      const neonBranching = new DatabaseBranching({ strategy: "neon" })
      const branch = await neonBranching.createBranch("feat")
      expect(branch.neonBranchId).toContain("br_feat")
    })
  })

  describe("branch navigation", () => {
    it("switches between branches", async () => {
      await branching.createBranch("feature-x")
      expect(branching.activeBranch).toBe("main")

      await branching.switchBranch("feature-x")
      expect(branching.activeBranch).toBe("feature-x")
    })

    it("rejects switching to nonexistent branch", async () => {
      await expect(branching.switchBranch("nonexistent")).rejects.toThrow(BranchingError)
    })

    it("generates search path SQL", async () => {
      await branching.createBranch("feature-x")
      await branching.switchBranch("feature-x")
      const { sql } = branching.getSearchPathSQL()
      expect(sql).toContain("rb_branch_feature_x")
    })
  })

  describe("listing", () => {
    it("lists all branches", async () => {
      await branching.createBranch("a")
      await branching.createBranch("b")
      expect(branching.listBranches()).toHaveLength(3) // main + a + b
    })

    it("lists only active branches", async () => {
      await branching.createBranch("a")
      await branching.createBranch("b")
      await branching.deleteBranch("a")
      expect(branching.listActiveBranches()).toHaveLength(2) // main + b
    })
  })

  describe("merge and delete", () => {
    it("merges a branch", async () => {
      await branching.createBranch("feature-x")
      const diff = await branching.mergeBranch("feature-x")
      expect(diff.sourceBranch).toBe("feature-x")
      expect(branching.getBranch("feature-x")?.status).toBe("merged")
    })

    it("rejects merging nonexistent branch", async () => {
      await expect(branching.mergeBranch("nope")).rejects.toThrow(BranchingError)
    })

    it("deletes a branch", async () => {
      await branching.createBranch("temp")
      await branching.deleteBranch("temp")
      expect(branching.getBranch("temp")).toBeUndefined()
    })

    it("cannot delete the default branch", async () => {
      await expect(branching.deleteBranch("main")).rejects.toThrow("Cannot delete")
    })

    it("switches to default when current branch is deleted", async () => {
      await branching.createBranch("temp")
      await branching.switchBranch("temp")
      await branching.deleteBranch("temp")
      expect(branching.activeBranch).toBe("main")
    })
  })

  describe("PR integration", () => {
    it("creates a PR branch", async () => {
      const branch = await branching.createPRBranch({
        prNumber: 42,
        branch: "feat/login",
        commitSha: "abc123",
        repository: "org/repo",
        author: "bob",
      })
      expect(branch.name).toBe("pr-42")
      expect(branch.prNumber).toBe(42)
      expect(branch.metadata).toEqual(expect.objectContaining({ pr: 42, author: "bob" }))
    })

    it("finds branch for a PR", async () => {
      await branching.createPRBranch({ prNumber: 42, branch: "f", commitSha: "abc", repository: "r", author: "a" })
      const found = branching.getBranchForPR(42)
      expect(found?.name).toBe("pr-42")
    })

    it("cleans up PR branch", async () => {
      await branching.createPRBranch({ prNumber: 42, branch: "f", commitSha: "abc", repository: "r", author: "a" })
      await branching.cleanupPRBranch(42)
      expect(branching.getBranchForPR(42)).toBeUndefined()
    })

    it("replaces existing PR branch on recreate", async () => {
      await branching.createPRBranch({ prNumber: 42, branch: "f", commitSha: "abc", repository: "r", author: "a" })
      const branch2 = await branching.createPRBranch({
        prNumber: 42,
        branch: "f",
        commitSha: "def",
        repository: "r",
        author: "a",
      })
      expect(branch2.metadata).toEqual(expect.objectContaining({ commitSha: "def" }))
    })
  })

  describe("GitHub Action", () => {
    it("generates valid YAML", () => {
      const yaml = branching.generateGitHubActionYAML()
      expect(yaml).toContain("name: ReactiveBase Preview Environment")
      expect(yaml).toContain("pull_request")
      expect(yaml).toContain("reactivebase branch create")
    })
  })

  describe("SQL builders", () => {
    it("generates branch table SQL", () => {
      const sql = generateBranchTableSQL()
      expect(sql).toContain("_reactivebase_branches")
      expect(sql).toContain("parent_branch")
    })
  })
})
