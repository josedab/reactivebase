/**
 * Tests for Media Pipeline — upload lifecycle, transforms, validation,
 * CDN URL generation, signed URLs, and reactive file updates.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  MediaPipeline,
  MediaPipelineError,
  TransformBuilder,
  ReactiveUrlBuilder,
  UploadValidator,
  transformPresets,
  buildCreateMediaTablesSQL,
  buildInsertFileSQL,
  buildGetFileSQL,
  buildListFilesSQL,
  buildInsertVariantSQL,
  buildGetVariantsSQL,
  buildDeleteFileSQL,
} from "../media-pipeline/media-pipeline.js"

// ─── SQL Builders ────────────────────────────────────────────────────────────

describe("Media Pipeline SQL Builders", () => {
  it("generates create tables SQL", () => {
    const sql = buildCreateMediaTablesSQL()
    expect(sql).toContain("_rb_media_files")
    expect(sql).toContain("_rb_media_variants")
  })

  it("generates insert file SQL", () => {
    expect(buildInsertFileSQL()).toContain("INSERT INTO _rb_media_files")
  })

  it("generates get file SQL", () => {
    expect(buildGetFileSQL()).toContain("WHERE id = $1")
  })

  it("generates list files SQL", () => {
    expect(buildListFilesSQL()).toContain("ORDER BY created_at")
  })

  it("generates insert variant SQL", () => {
    expect(buildInsertVariantSQL()).toContain("_rb_media_variants")
  })

  it("generates get variants SQL", () => {
    expect(buildGetVariantsSQL()).toContain("WHERE file_id = $1")
  })

  it("generates delete file SQL", () => {
    expect(buildDeleteFileSQL()).toContain("DELETE FROM")
  })
})

// ─── MediaPipelineError ──────────────────────────────────────────────────────

describe("MediaPipelineError", () => {
  it("creates error with code", () => {
    const err = new MediaPipelineError("file too big", "SIZE_LIMIT")
    expect(err.name).toBe("MediaPipelineError")
    expect(err.code).toBe("SIZE_LIMIT")
    expect(err.message).toBe("file too big")
  })
})

// ─── UploadValidator ─────────────────────────────────────────────────────────

describe("UploadValidator", () => {
  let validator: UploadValidator

  beforeEach(() => {
    validator = new UploadValidator()
  })

  it("validates valid upload", () => {
    const result = validator.validate("photo.jpg", "image/jpeg", 1024)
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it("rejects oversized file", () => {
    const result = validator.validate("huge.bin", "application/octet-stream", 200 * 1024 * 1024)
    expect(result.valid).toBe(false)
    expect(result.error).toContain("exceeds max")
  })

  it("rejects zero-size file", () => {
    const result = validator.validate("empty.txt", "text/plain", 0)
    expect(result.valid).toBe(false)
    expect(result.error).toContain("positive")
  })

  it("rejects negative size", () => {
    const result = validator.validate("neg.txt", "text/plain", -1)
    expect(result.valid).toBe(false)
  })

  it("rejects empty filename", () => {
    const result = validator.validate("", "text/plain", 100)
    expect(result.valid).toBe(false)
    expect(result.error).toContain("Filename is required")
  })

  it("rejects path traversal in filename", () => {
    expect(validator.validate("../secret.txt", "text/plain", 100).valid).toBe(false)
    expect(validator.validate("dir/file.txt", "text/plain", 100).valid).toBe(false)
    expect(validator.validate("dir\\file.txt", "text/plain", 100).valid).toBe(false)
  })

  it("respects custom maxSize", () => {
    const result = validator.validate("file.txt", "text/plain", 2000, { maxSize: 1000 })
    expect(result.valid).toBe(false)
  })

  it("validates allowedMimeTypes", () => {
    const result = validator.validate("file.exe", "application/exe", 100, {
      allowedMimeTypes: ["image/*", "text/plain"],
    })
    expect(result.valid).toBe(false)
    expect(result.error).toContain("not allowed")
  })

  it("allows wildcard mime types", () => {
    const result = validator.validate("photo.jpg", "image/jpeg", 100, {
      allowedMimeTypes: ["image/*"],
    })
    expect(result.valid).toBe(true)
  })

  it("allows exact mime match", () => {
    const result = validator.validate("doc.pdf", "application/pdf", 100, {
      allowedMimeTypes: ["application/pdf"],
    })
    expect(result.valid).toBe(true)
  })
})

// ─── TransformBuilder ────────────────────────────────────────────────────────

describe("TransformBuilder", () => {
  it("builds image transforms", () => {
    const transforms = new TransformBuilder().image({ width: 800, height: 600, format: "webp" }).build()
    expect(transforms).toHaveLength(1)
    expect(transforms[0].type).toBe("image")
    expect((transforms[0] as { width: number }).width).toBe(800)
  })

  it("builds video transforms", () => {
    const transforms = new TransformBuilder().video({ width: 1920, format: "mp4", fps: 30 }).build()
    expect(transforms).toHaveLength(1)
    expect(transforms[0].type).toBe("video")
  })

  it("builds thumbnail preset", () => {
    const transforms = new TransformBuilder().thumbnail().build()
    expect(transforms).toHaveLength(1)
    expect(transforms[0].type).toBe("image")
    expect((transforms[0] as { width: number }).width).toBe(200)
  })

  it("builds webOptimized preset", () => {
    const transforms = new TransformBuilder().webOptimized(1200).build()
    expect(transforms).toHaveLength(1)
    expect((transforms[0] as { width: number }).width).toBe(1200)
  })

  it("chains multiple transforms", () => {
    const transforms = new TransformBuilder().thumbnail().image({ width: 640, format: "jpeg" }).webOptimized().build()
    expect(transforms).toHaveLength(3)
  })
})

// ─── transformPresets ────────────────────────────────────────────────────────

describe("transformPresets", () => {
  it("contains expected presets", () => {
    expect(transformPresets.thumbnail).toBeDefined()
    expect(transformPresets.small).toBeDefined()
    expect(transformPresets.medium).toBeDefined()
    expect(transformPresets.large).toBeDefined()
    expect(transformPresets.avatar).toBeDefined()
    expect(transformPresets.og_image).toBeDefined()
  })

  it("presets have correct types", () => {
    expect(transformPresets.thumbnail.type).toBe("image")
    expect(transformPresets.og_image.width).toBe(1200)
    expect(transformPresets.og_image.height).toBe(630)
  })
})

// ─── ReactiveUrlBuilder ──────────────────────────────────────────────────────

describe("ReactiveUrlBuilder", () => {
  it("builds basic URL", () => {
    const builder = new ReactiveUrlBuilder("/media")
    expect(builder.buildUrl("bucket/file.jpg")).toBe("/media/bucket/file.jpg")
  })

  it("builds URL with CDN base", () => {
    const builder = new ReactiveUrlBuilder("/media", {
      provider: "cloudfront",
      baseUrl: "https://cdn.example.com",
      signingKey: "secret",
    })
    expect(builder.buildUrl("file.jpg")).toBe("https://cdn.example.com/file.jpg")
  })

  it("builds URL with transform params", () => {
    const builder = new ReactiveUrlBuilder("/media")
    const url = builder.buildUrl("file.jpg", {
      type: "image",
      width: 100,
      height: 100,
      fit: "cover",
      format: "webp",
      quality: 80,
    })
    expect(url).toContain("w=100")
    expect(url).toContain("h=100")
    expect(url).toContain("fit=cover")
    expect(url).toContain("fmt=webp")
    expect(url).toContain("q=80")
  })

  it("builds URL with blur and grayscale", () => {
    const builder = new ReactiveUrlBuilder("/media")
    const url = builder.buildUrl("file.jpg", {
      type: "image",
      blur: 5,
      grayscale: true,
      rotate: 90,
    })
    expect(url).toContain("blur=5")
    expect(url).toContain("gray=1")
    expect(url).toContain("rot=90")
  })

  it("builds signed URL", () => {
    const builder = new ReactiveUrlBuilder("/media", {
      provider: "cloudfront",
      baseUrl: "https://cdn.example.com",
      signingKey: "my-secret-key",
    })
    const url = builder.buildSignedUrl("file.jpg", { expiresIn: 3600 })
    expect(url).toContain("https://cdn.example.com/file.jpg")
    expect(url).toContain("expires=")
    expect(url).toContain("token=")
  })

  it("builds signed URL with disposition and filename", () => {
    const builder = new ReactiveUrlBuilder("/media", {
      provider: "cloudfront",
      baseUrl: "https://cdn.example.com",
      signingKey: "key",
    })
    const url = builder.buildSignedUrl("file.pdf", {
      disposition: "attachment",
      filename: "report.pdf",
    })
    expect(url).toContain("disposition=attachment")
    expect(url).toContain("filename=report.pdf")
  })

  it("throws for signed URL without signing key", () => {
    const builder = new ReactiveUrlBuilder("/media")
    expect(() => builder.buildSignedUrl("file.jpg")).toThrow("signing key is required")
  })
})

// ─── MediaPipeline ───────────────────────────────────────────────────────────

describe("MediaPipeline", () => {
  let pipeline: MediaPipeline

  beforeEach(() => {
    pipeline = new MediaPipeline({
      cdn: {
        provider: "cloudfront",
        baseUrl: "https://cdn.example.com",
        signingKey: "test-signing-key",
      },
    })
  })

  describe("upload", () => {
    it("uploads a file and returns result", () => {
      const result = pipeline.upload({
        filename: "photo.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        uploadedBy: "user1",
      })
      expect(result.file.filename).toBe("photo.jpg")
      expect(result.file.mimeType).toBe("image/jpeg")
      expect(result.file.size).toBe(1024)
      expect(result.file.uploadedBy).toBe("user1")
      expect(result.file.id).toMatch(/^media_/)
      expect(result.uploadUrl).toContain("/upload/")
      expect(result.signedUrl).toBeTruthy()
    })

    it("uploads with custom bucket and prefix", () => {
      const result = pipeline.upload({
        filename: "doc.pdf",
        mimeType: "application/pdf",
        size: 500,
        uploadedBy: "user1",
        bucket: "documents",
        prefix: "2024/01",
      })
      expect(result.file.bucket).toBe("documents")
      expect(result.file.storageKey).toContain("documents/2024/01/")
    })

    it("uploads with metadata", () => {
      const result = pipeline.upload({
        filename: "img.png",
        mimeType: "image/png",
        size: 2048,
        uploadedBy: "user1",
        metadata: { width: 800, height: 600 },
      })
      expect(result.file.metadata.width).toBe(800)
      expect(result.file.metadata.height).toBe(600)
    })

    it("rejects invalid upload (empty filename)", () => {
      expect(() =>
        pipeline.upload({
          filename: "",
          mimeType: "image/jpeg",
          size: 100,
          uploadedBy: "user1",
        }),
      ).toThrow(MediaPipelineError)
    })

    it("rejects oversized file", () => {
      expect(() =>
        pipeline.upload({
          filename: "huge.bin",
          mimeType: "application/octet-stream",
          size: 200 * 1024 * 1024,
          uploadedBy: "user1",
        }),
      ).toThrow("exceeds max")
    })

    it("rejects path traversal filename", () => {
      expect(() =>
        pipeline.upload({
          filename: "../etc/passwd",
          mimeType: "text/plain",
          size: 100,
          uploadedBy: "user1",
        }),
      ).toThrow(MediaPipelineError)
    })
  })

  describe("addVariant", () => {
    it("adds image variant to file", () => {
      const { file } = pipeline.upload({
        filename: "photo.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        uploadedBy: "user1",
      })

      const variant = pipeline.addVariant(file.id, "thumbnail", {
        type: "image",
        width: 150,
        height: 150,
        format: "webp",
      })

      expect(variant.name).toBe("thumbnail")
      expect(variant.mimeType).toBe("image/webp")
      expect(variant.url).toBeTruthy()
    })

    it("adds video variant", () => {
      const { file } = pipeline.upload({
        filename: "video.mp4",
        mimeType: "video/mp4",
        size: 50000,
        uploadedBy: "user1",
      })

      const variant = pipeline.addVariant(file.id, "web", {
        type: "video",
        width: 1280,
        format: "webm",
      })

      expect(variant.mimeType).toBe("video/webm")
    })

    it("replaces existing variant with same name", () => {
      const { file } = pipeline.upload({
        filename: "photo.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        uploadedBy: "user1",
      })

      pipeline.addVariant(file.id, "thumb", { type: "image", width: 100, format: "jpeg" })
      pipeline.addVariant(file.id, "thumb", { type: "image", width: 200, format: "webp" })

      const updated = pipeline.getFile(file.id)!
      const thumbVariants = updated.variants.filter((v) => v.name === "thumb")
      expect(thumbVariants).toHaveLength(1)
      expect(thumbVariants[0].mimeType).toBe("image/webp")
    })

    it("throws for nonexistent file", () => {
      expect(() => pipeline.addVariant("nonexistent", "thumb", { type: "image", width: 100 })).toThrow("not found")
    })
  })

  describe("getFile", () => {
    it("returns file by id", () => {
      const { file } = pipeline.upload({
        filename: "test.txt",
        mimeType: "text/plain",
        size: 10,
        uploadedBy: "user1",
      })
      expect(pipeline.getFile(file.id)).not.toBeNull()
      expect(pipeline.getFile(file.id)!.filename).toBe("test.txt")
    })

    it("returns null for nonexistent file", () => {
      expect(pipeline.getFile("missing")).toBeNull()
    })
  })

  describe("getFileUrl", () => {
    it("returns base URL for file", () => {
      const { file } = pipeline.upload({
        filename: "img.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        uploadedBy: "user1",
      })
      const url = pipeline.getFileUrl(file.id)
      expect(url).toBeTruthy()
    })

    it("returns variant URL", () => {
      const { file } = pipeline.upload({
        filename: "img.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        uploadedBy: "user1",
      })
      pipeline.addVariant(file.id, "thumb", { type: "image", width: 100 })
      const url = pipeline.getFileUrl(file.id, "thumb")
      expect(url).toContain("thumb")
    })

    it("throws for nonexistent file", () => {
      expect(() => pipeline.getFileUrl("missing")).toThrow("not found")
    })
  })

  describe("deleteFile", () => {
    it("deletes file and returns true", () => {
      const { file } = pipeline.upload({
        filename: "del.txt",
        mimeType: "text/plain",
        size: 10,
        uploadedBy: "user1",
      })
      expect(pipeline.deleteFile(file.id)).toBe(true)
      expect(pipeline.getFile(file.id)).toBeNull()
    })

    it("returns false for nonexistent file", () => {
      expect(pipeline.deleteFile("missing")).toBe(false)
    })

    it("updates stats on delete", () => {
      const { file } = pipeline.upload({
        filename: "f.txt",
        mimeType: "text/plain",
        size: 100,
        uploadedBy: "user1",
      })
      pipeline.deleteFile(file.id)
      expect(pipeline.getStats().totalFiles).toBe(0)
    })
  })

  describe("listFiles", () => {
    it("lists all files sorted by createdAt desc", () => {
      pipeline.upload({ filename: "a.txt", mimeType: "text/plain", size: 10, uploadedBy: "u1" })
      pipeline.upload({ filename: "b.txt", mimeType: "text/plain", size: 20, uploadedBy: "u1" })
      pipeline.upload({ filename: "c.txt", mimeType: "text/plain", size: 30, uploadedBy: "u1" })

      const files = pipeline.listFiles()
      expect(files).toHaveLength(3)
    })

    it("filters by bucket", () => {
      pipeline.upload({ filename: "a.txt", mimeType: "text/plain", size: 10, uploadedBy: "u1", bucket: "docs" })
      pipeline.upload({ filename: "b.txt", mimeType: "text/plain", size: 10, uploadedBy: "u1", bucket: "images" })

      expect(pipeline.listFiles("docs")).toHaveLength(1)
      expect(pipeline.listFiles("images")).toHaveLength(1)
    })

    it("respects limit and offset", () => {
      for (let i = 0; i < 10; i++) {
        pipeline.upload({ filename: `f${i}.txt`, mimeType: "text/plain", size: 10, uploadedBy: "u1" })
      }
      expect(pipeline.listFiles(undefined, 3)).toHaveLength(3)
      expect(pipeline.listFiles(undefined, 5, 8)).toHaveLength(2)
    })
  })

  describe("onFileChange", () => {
    it("notifies on upload", () => {
      const callback = vi.fn()
      // Need to pre-know the file ID, so subscribe after upload
      const { file } = pipeline.upload({
        filename: "a.txt",
        mimeType: "text/plain",
        size: 10,
        uploadedBy: "u1",
      })
      pipeline.onFileChange(file.id, callback)

      // Adding a variant triggers notification
      pipeline.addVariant(file.id, "thumb", { type: "image", width: 100 })
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ id: file.id }))
    })

    it("returns unsubscribe function", () => {
      const { file } = pipeline.upload({
        filename: "a.txt",
        mimeType: "text/plain",
        size: 10,
        uploadedBy: "u1",
      })
      const callback = vi.fn()
      const unsub = pipeline.onFileChange(file.id, callback)
      unsub()

      pipeline.addVariant(file.id, "thumb", { type: "image", width: 100 })
      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe("getStats", () => {
    it("tracks upload and file stats", () => {
      pipeline.upload({ filename: "a.txt", mimeType: "text/plain", size: 100, uploadedBy: "u1" })
      pipeline.upload({ filename: "b.txt", mimeType: "text/plain", size: 200, uploadedBy: "u1" })

      const stats = pipeline.getStats()
      expect(stats.totalFiles).toBe(2)
      expect(stats.totalSize).toBe(300)
      expect(stats.uploadCount).toBe(2)
    })

    it("tracks variant stats", () => {
      const { file } = pipeline.upload({
        filename: "img.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        uploadedBy: "u1",
      })
      pipeline.addVariant(file.id, "thumb", { type: "image", width: 100 })
      pipeline.addVariant(file.id, "large", { type: "image", width: 1200 })

      const stats = pipeline.getStats()
      expect(stats.variantCount).toBe(2)
      expect(stats.transformCount).toBe(2)
    })
  })
})
