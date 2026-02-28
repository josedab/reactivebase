/**
 * Reactive File & Media Pipeline for ReactiveBase.
 * Treats files as reactive entities with processing pipelines,
 * CDN integration, and real-time file state tracking.
 *
 * Usage:
 *   const pipeline = new FilePipeline()
 *   pipeline.addProcessor("image-resize", imageResizeProcessor({ width: 200, height: 200 }))
 *   pipeline.addProcessor("webp-convert", formatConvertProcessor("webp"))
 *
 *   const file = await pipeline.process(buffer, { contentType: "image/jpeg" })
 */

import { randomUUID } from "node:crypto"
import type { StorageBackend, StorageOptions } from "./storage.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export type FileStatus = "pending" | "uploading" | "processing" | "ready" | "error" | "deleted"

export interface ReactiveFile {
  id: string
  originalName: string
  contentType: string
  size: number
  status: FileStatus
  storageId: string | null
  variants: FileVariant[]
  metadata: Record<string, unknown>
  processingErrors: string[]
  createdAt: number
  updatedAt: number
}

export interface FileVariant {
  name: string
  storageId: string
  contentType: string
  size: number
  url?: string
  metadata?: Record<string, unknown>
}

export interface FileProcessor {
  name: string
  /** Process a file buffer and return transformed buffer with metadata */
  process(data: Buffer, options: ProcessorInput): Promise<ProcessorOutput>
  /** Content types this processor can handle (empty = all) */
  accepts?: string[]
}

export interface ProcessorInput {
  contentType: string
  filename: string
  metadata?: Record<string, unknown>
}

export interface ProcessorOutput {
  data: Buffer
  contentType: string
  metadata?: Record<string, unknown>
}

export interface PipelineConfig {
  /** Max file size in bytes (default: 50MB) */
  maxFileSize?: number
  /** Allowed content types (empty = all) */
  allowedTypes?: string[]
  /** Max concurrent processing jobs (default: 5) */
  maxConcurrent?: number
  /** Generate variant names automatically (default: true) */
  autoVariants?: boolean
}

export interface CdnConfig {
  /** CDN base URL */
  baseUrl: string
  /** Cache-Control header value */
  cacheControl?: string
  /** CDN purge function (called when file is updated/deleted) */
  purge?: (urls: string[]) => Promise<void>
}

export interface FileChangeEvent {
  fileId: string
  type: "created" | "processing" | "ready" | "variant_added" | "deleted" | "error"
  timestamp: number
  data?: unknown
}

// ─── File Pipeline ───────────────────────────────────────────────────────────

const DEFAULT_PIPELINE_CONFIG: Required<PipelineConfig> = {
  maxFileSize: 50 * 1024 * 1024,
  allowedTypes: [],
  maxConcurrent: 5,
  autoVariants: true,
}

export class FilePipeline {
  private processors: FileProcessor[] = []
  private config: Required<PipelineConfig>
  private activeJobs = 0

  constructor(config: PipelineConfig = {}) {
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...config }
  }

  /**
   * Add a processor to the pipeline.
   */
  addProcessor(processor: FileProcessor): void {
    this.processors.push(processor)
  }

  /**
   * Remove a processor by name.
   */
  removeProcessor(name: string): boolean {
    const idx = this.processors.findIndex((p) => p.name === name)
    if (idx === -1) return false
    this.processors.splice(idx, 1)
    return true
  }

  /**
   * Process a file through the pipeline, producing variants.
   */
  async process(
    data: Buffer,
    options: ProcessorInput,
  ): Promise<{ original: ProcessorOutput; variants: Array<{ name: string } & ProcessorOutput> }> {
    this.validateInput(data, options)

    if (this.activeJobs >= this.config.maxConcurrent) {
      throw new FilePipelineError("MAX_CONCURRENT", "Maximum concurrent processing jobs reached")
    }

    this.activeJobs++
    try {
      const variants: Array<{ name: string } & ProcessorOutput> = []

      for (const processor of this.processors) {
        if (processor.accepts && processor.accepts.length > 0) {
          if (!processor.accepts.includes(options.contentType)) continue
        }

        try {
          const result = await processor.process(data, options)
          variants.push({ name: processor.name, ...result })
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          throw new FilePipelineError("PROCESSING_FAILED", `Processor "${processor.name}" failed: ${msg}`)
        }
      }

      return {
        original: { data, contentType: options.contentType },
        variants,
      }
    } finally {
      this.activeJobs--
    }
  }

  /**
   * Get pipeline info.
   */
  getInfo(): { processors: string[]; config: Required<PipelineConfig>; activeJobs: number } {
    return {
      processors: this.processors.map((p) => p.name),
      config: this.config,
      activeJobs: this.activeJobs,
    }
  }

  private validateInput(data: Buffer, options: ProcessorInput): void {
    if (data.length > this.config.maxFileSize) {
      throw new FilePipelineError(
        "FILE_TOO_LARGE",
        `File size ${data.length} exceeds max ${this.config.maxFileSize}`,
      )
    }
    if (this.config.allowedTypes.length > 0 && !this.config.allowedTypes.includes(options.contentType)) {
      throw new FilePipelineError("INVALID_TYPE", `Content type "${options.contentType}" is not allowed`)
    }
  }
}

// ─── Reactive File Tracker ───────────────────────────────────────────────────

export class ReactiveFileTracker {
  private files = new Map<string, ReactiveFile>()
  private listeners: Array<(event: FileChangeEvent) => void> = []

  /**
   * Create a new tracked file.
   */
  create(originalName: string, contentType: string, size: number, metadata?: Record<string, unknown>): ReactiveFile {
    const file: ReactiveFile = {
      id: `file_${randomUUID()}`,
      originalName,
      contentType,
      size,
      status: "pending",
      storageId: null,
      variants: [],
      metadata: metadata ?? {},
      processingErrors: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.files.set(file.id, file)
    this.emit({ fileId: file.id, type: "created", timestamp: Date.now() })
    return file
  }

  /**
   * Update file status.
   */
  setStatus(fileId: string, status: FileStatus, error?: string): void {
    const file = this.files.get(fileId)
    if (!file) return

    file.status = status
    file.updatedAt = Date.now()
    if (error) file.processingErrors.push(error)

    const eventType = status === "error" ? "error" : status === "ready" ? "ready" : "processing"
    this.emit({ fileId, type: eventType, timestamp: Date.now(), data: error ? { error } : undefined })
  }

  /**
   * Set the primary storage ID.
   */
  setStorageId(fileId: string, storageId: string): void {
    const file = this.files.get(fileId)
    if (file) {
      file.storageId = storageId
      file.updatedAt = Date.now()
    }
  }

  /**
   * Add a processed variant.
   */
  addVariant(fileId: string, variant: FileVariant): void {
    const file = this.files.get(fileId)
    if (!file) return

    file.variants.push(variant)
    file.updatedAt = Date.now()
    this.emit({ fileId, type: "variant_added", timestamp: Date.now(), data: { variant: variant.name } })
  }

  /**
   * Mark a file as deleted.
   */
  markDeleted(fileId: string): void {
    const file = this.files.get(fileId)
    if (file) {
      file.status = "deleted"
      file.updatedAt = Date.now()
      this.emit({ fileId, type: "deleted", timestamp: Date.now() })
    }
  }

  /**
   * Get a file by ID.
   */
  get(fileId: string): ReactiveFile | undefined {
    return this.files.get(fileId)
  }

  /**
   * List files with optional status filter.
   */
  list(status?: FileStatus): ReactiveFile[] {
    const all = Array.from(this.files.values())
    return status ? all.filter((f) => f.status === status) : all
  }

  /**
   * Subscribe to file change events.
   */
  onChange(listener: (event: FileChangeEvent) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  private emit(event: FileChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Don't let listener errors break the pipeline
      }
    }
  }
}

// ─── CDN Integration ─────────────────────────────────────────────────────────

export class CdnIntegration {
  private config: CdnConfig

  constructor(config: CdnConfig) {
    this.config = {
      cacheControl: "public, max-age=31536000, immutable",
      ...config,
    }
  }

  /**
   * Generate CDN URL for a storage ID.
   */
  getUrl(storageId: string): string {
    return `${this.config.baseUrl}/${storageId}`
  }

  /**
   * Generate CDN URLs for a file and all its variants.
   */
  getFileUrls(file: ReactiveFile): Record<string, string> {
    const urls: Record<string, string> = {}
    if (file.storageId) {
      urls["original"] = this.getUrl(file.storageId)
    }
    for (const variant of file.variants) {
      urls[variant.name] = this.getUrl(variant.storageId)
    }
    return urls
  }

  /**
   * Purge cached files from CDN.
   */
  async purge(storageIds: string[]): Promise<void> {
    if (this.config.purge) {
      const urls = storageIds.map((id) => this.getUrl(id))
      await this.config.purge(urls)
    }
  }

  /**
   * Get cache headers for serving files.
   */
  getCacheHeaders(): Record<string, string> {
    return { "Cache-Control": this.config.cacheControl ?? "public, max-age=31536000" }
  }
}

// ─── Built-in Processors ─────────────────────────────────────────────────────

/**
 * Create an image resize processor stub.
 * In production, integrate with sharp or similar library.
 */
export function imageResizeProcessor(options: {
  width: number
  height: number
  fit?: "cover" | "contain" | "fill"
}): FileProcessor {
  return {
    name: `resize-${options.width}x${options.height}`,
    accepts: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    async process(data, input) {
      // Stub: in production, use sharp or similar
      return {
        data,
        contentType: input.contentType,
        metadata: {
          width: options.width,
          height: options.height,
          fit: options.fit ?? "cover",
          originalSize: data.length,
        },
      }
    },
  }
}

/**
 * Create a format conversion processor stub.
 */
export function formatConvertProcessor(targetFormat: "webp" | "avif" | "png" | "jpeg"): FileProcessor {
  const contentTypeMap: Record<string, string> = {
    webp: "image/webp",
    avif: "image/avif",
    png: "image/png",
    jpeg: "image/jpeg",
  }

  return {
    name: `convert-${targetFormat}`,
    accepts: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    async process(data) {
      // Stub: in production, use sharp or ffmpeg
      return {
        data,
        contentType: contentTypeMap[targetFormat],
        metadata: { format: targetFormat },
      }
    },
  }
}

/**
 * Create a video transcode processor stub.
 */
export function videoTranscodeProcessor(options: {
  format: "mp4" | "webm"
  quality?: "low" | "medium" | "high"
}): FileProcessor {
  return {
    name: `transcode-${options.format}-${options.quality ?? "medium"}`,
    accepts: ["video/mp4", "video/webm", "video/quicktime", "video/avi"],
    async process(data, input) {
      // Stub: in production, use ffmpeg
      return {
        data,
        contentType: `video/${options.format}`,
        metadata: {
          format: options.format,
          quality: options.quality ?? "medium",
          originalType: input.contentType,
        },
      }
    },
  }
}

// ─── Managed Upload Helper ───────────────────────────────────────────────────

/**
 * Full managed upload: track, process, store, and return reactive file.
 */
export async function managedUpload(
  data: Buffer,
  options: {
    filename: string
    contentType: string
    backend: StorageBackend
    pipeline?: FilePipeline
    tracker?: ReactiveFileTracker
    cdn?: CdnIntegration
  },
): Promise<ReactiveFile> {
  const tracker = options.tracker ?? new ReactiveFileTracker()
  const file = tracker.create(options.filename, options.contentType, data.length)

  try {
    tracker.setStatus(file.id, "uploading")

    // Store original
    const storageId = await options.backend.put(data, {
      contentType: options.contentType,
      filename: options.filename,
    })
    tracker.setStorageId(file.id, storageId)

    // Process through pipeline if provided
    if (options.pipeline) {
      tracker.setStatus(file.id, "processing")
      const result = await options.pipeline.process(data, {
        contentType: options.contentType,
        filename: options.filename,
      })

      for (const variant of result.variants) {
        const variantStorageId = await options.backend.put(variant.data, {
          contentType: variant.contentType,
          filename: `${variant.name}_${options.filename}`,
        })

        let url: string | undefined
        if (options.cdn) {
          url = options.cdn.getUrl(variantStorageId)
        }

        tracker.addVariant(file.id, {
          name: variant.name,
          storageId: variantStorageId,
          contentType: variant.contentType,
          size: variant.data.length,
          url,
          metadata: variant.metadata,
        })
      }
    }

    tracker.setStatus(file.id, "ready")
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    tracker.setStatus(file.id, "error", message)
  }

  return tracker.get(file.id)!
}

// ─── SQL Builders ────────────────────────────────────────────────────────────

export function generateFileTrackingTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_files (
  id TEXT PRIMARY KEY,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  storage_id TEXT,
  metadata JSONB DEFAULT '{}',
  processing_errors TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _reactivebase_file_variants (
  id SERIAL PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES _reactivebase_files(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  storage_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  url TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_files_status ON _reactivebase_files(status);
CREATE INDEX IF NOT EXISTS idx_file_variants_file ON _reactivebase_file_variants(file_id);
`.trim()
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class FilePipelineError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "FilePipelineError"
  }
}
