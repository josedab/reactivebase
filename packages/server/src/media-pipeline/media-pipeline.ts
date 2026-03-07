// --------------------------------------------------------------------------
// Reactive File & Media Pipeline
// Reactive file URLs, server-side transforms, CDN integration, uploads
// --------------------------------------------------------------------------

import { createHmac, randomUUID } from "node:crypto"

// ── Storage & DB Types ─────────────────────────────────────────────────────

export type QueryExecutor = (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>

export interface FileStorageBackend {
  write(key: string, data: Buffer | Uint8Array, contentType: string): Promise<void>
  read(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface MediaFile {
  id: string
  filename: string
  mimeType: string
  size: number
  storageKey: string
  bucket: string
  url: string
  cdnUrl?: string
  metadata: MediaMetadata
  variants: MediaVariant[]
  uploadedBy: string
  createdAt: number
  updatedAt: number
}

export interface MediaMetadata {
  width?: number
  height?: number
  duration?: number
  format?: string
  codec?: string
  bitrate?: number
  colorSpace?: string
  orientation?: number
  exif?: Record<string, unknown>
}

export interface MediaVariant {
  name: string
  storageKey: string
  url: string
  mimeType: string
  size: number
  transform: ImageTransform | VideoTransform
  generatedAt: number
}

export interface ImageTransform {
  type: "image"
  width?: number
  height?: number
  fit?: "cover" | "contain" | "fill" | "inside" | "outside"
  format?: "jpeg" | "png" | "webp" | "avif"
  quality?: number
  blur?: number
  sharpen?: boolean
  grayscale?: boolean
  rotate?: number
  watermark?: WatermarkConfig
}

export interface VideoTransform {
  type: "video"
  width?: number
  height?: number
  format?: "mp4" | "webm" | "hls"
  bitrate?: number
  fps?: number
  thumbnail?: boolean
  thumbnailAt?: number
}

export interface WatermarkConfig {
  text?: string
  imageUrl?: string
  position: "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right"
  opacity: number
}

export interface UploadOptions {
  maxSize?: number
  allowedMimeTypes?: string[]
  generateVariants?: string[]
  bucket?: string
  prefix?: string
  cdnEnabled?: boolean
}

export interface UploadResult {
  file: MediaFile
  uploadUrl?: string
  signedUrl?: string
}

export interface CdnConfig {
  provider: "cloudfront" | "cloudflare" | "fastly" | "custom"
  baseUrl: string
  signingKey?: string
  cacheTtl?: number
  customDomain?: string
}

export interface SignedUrlOptions {
  expiresIn?: number
  disposition?: "inline" | "attachment"
  filename?: string
}

export interface MediaPipelineOptions {
  defaultBucket?: string
  maxFileSize?: number
  allowedMimeTypes?: string[]
  cdn?: CdnConfig
  transformConcurrency?: number
  signedUrlTtl?: number
  db?: QueryExecutor
  storage?: FileStorageBackend
}

export interface MediaPipelineStats {
  totalFiles: number
  totalSize: number
  variantCount: number
  uploadCount: number
  transformCount: number
}

// ── Error ──────────────────────────────────────────────────────────────────

export class MediaPipelineError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = "MediaPipelineError"
  }
}

// ── SQL Builders ───────────────────────────────────────────────────────────

export function buildCreateMediaTablesSQL(): string {
  return `
    CREATE TABLE IF NOT EXISTS _rb_media_files (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size BIGINT NOT NULL,
      storage_key TEXT NOT NULL UNIQUE,
      bucket TEXT NOT NULL DEFAULT 'default',
      url TEXT NOT NULL,
      cdn_url TEXT,
      metadata JSONB NOT NULL DEFAULT '{}',
      uploaded_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_media_bucket ON _rb_media_files (bucket, created_at);
    CREATE INDEX IF NOT EXISTS idx_media_mime ON _rb_media_files (mime_type);
    CREATE INDEX IF NOT EXISTS idx_media_user ON _rb_media_files (uploaded_by, created_at);

    CREATE TABLE IF NOT EXISTS _rb_media_variants (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL REFERENCES _rb_media_files(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      storage_key TEXT NOT NULL UNIQUE,
      url TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size BIGINT NOT NULL,
      transform JSONB NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (file_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_variant_file ON _rb_media_variants (file_id);
  `
}

export function buildInsertFileSQL(): string {
  return `
    INSERT INTO _rb_media_files (id, filename, mime_type, size, storage_key, bucket, url, cdn_url, metadata, uploaded_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `
}

export function buildGetFileSQL(): string {
  return `SELECT * FROM _rb_media_files WHERE id = $1`
}

export function buildListFilesSQL(): string {
  return `SELECT * FROM _rb_media_files WHERE bucket = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`
}

export function buildInsertVariantSQL(): string {
  return `
    INSERT INTO _rb_media_variants (id, file_id, name, storage_key, url, mime_type, size, transform)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (file_id, name) DO UPDATE SET storage_key = $4, url = $5, mime_type = $6, size = $7, transform = $8, generated_at = NOW()
  `
}

export function buildGetVariantsSQL(): string {
  return `SELECT * FROM _rb_media_variants WHERE file_id = $1`
}

export function buildDeleteFileSQL(): string {
  return `DELETE FROM _rb_media_files WHERE id = $1 RETURNING storage_key`
}

// ── Transform Builder ──────────────────────────────────────────────────────

export class TransformBuilder {
  private transforms: Array<ImageTransform | VideoTransform> = []

  image(options: Omit<ImageTransform, "type">): this {
    this.transforms.push({ type: "image", ...options })
    return this
  }

  video(options: Omit<VideoTransform, "type">): this {
    this.transforms.push({ type: "video", ...options })
    return this
  }

  thumbnail(width: number = 200, height: number = 200): this {
    this.transforms.push({ type: "image", width, height, fit: "cover", format: "webp", quality: 80 })
    return this
  }

  webOptimized(maxWidth: number = 1920): this {
    this.transforms.push({ type: "image", width: maxWidth, format: "webp", quality: 85 })
    return this
  }

  build(): Array<ImageTransform | VideoTransform> {
    return [...this.transforms]
  }
}

// ── URL Builder ────────────────────────────────────────────────────────────

export class ReactiveUrlBuilder {
  constructor(
    private readonly baseUrl: string,
    private readonly cdn?: CdnConfig,
  ) {}

  buildUrl(storageKey: string, transform?: ImageTransform): string {
    const base = this.cdn?.baseUrl || this.baseUrl

    if (!transform) {
      return `${base}/${storageKey}`
    }

    const params = new URLSearchParams()
    if (transform.width) params.set("w", String(transform.width))
    if (transform.height) params.set("h", String(transform.height))
    if (transform.fit) params.set("fit", transform.fit)
    if (transform.format) params.set("fmt", transform.format)
    if (transform.quality) params.set("q", String(transform.quality))
    if (transform.blur) params.set("blur", String(transform.blur))
    if (transform.grayscale) params.set("gray", "1")
    if (transform.rotate) params.set("rot", String(transform.rotate))

    const queryStr = params.toString()
    return queryStr ? `${base}/${storageKey}?${queryStr}` : `${base}/${storageKey}`
  }

  buildSignedUrl(storageKey: string, options: SignedUrlOptions = {}): string {
    const expiresIn = options.expiresIn ?? 3600
    const expires = Math.floor(Date.now() / 1000) + expiresIn
    const base = this.cdn?.baseUrl || this.baseUrl

    const params = new URLSearchParams()
    params.set("expires", String(expires))
    if (options.disposition) params.set("disposition", options.disposition)
    if (options.filename) params.set("filename", options.filename)

    // Simple token generation (use proper signing in production)
    const token = this.sign(`${storageKey}:${expires}`)
    params.set("token", token)

    return `${base}/${storageKey}?${params}`
  }

  private sign(data: string): string {
    const key = this.cdn?.signingKey
    if (!key) {
      throw new Error("CDN signing key is required for signed URL generation")
    }
    return createHmac("sha256", key).update(data).digest("base64url")
  }
}

// ── Upload Validator ───────────────────────────────────────────────────────

export class UploadValidator {
  constructor(private readonly defaults: UploadOptions = {}) {}

  validate(
    filename: string,
    mimeType: string,
    size: number,
    options?: UploadOptions,
  ): { valid: boolean; error?: string } {
    const opts = { ...this.defaults, ...options }
    const maxSize = opts.maxSize ?? 100 * 1024 * 1024 // 100MB default

    if (size > maxSize) {
      return { valid: false, error: `File size ${size} exceeds max ${maxSize}` }
    }

    if (size <= 0) {
      return { valid: false, error: "File size must be positive" }
    }

    if (!filename || filename.length === 0) {
      return { valid: false, error: "Filename is required" }
    }

    // Sanitize filename for path traversal
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      return { valid: false, error: "Invalid filename: contains path characters" }
    }

    if (opts.allowedMimeTypes && opts.allowedMimeTypes.length > 0) {
      const allowed = opts.allowedMimeTypes.some((pattern) => {
        if (pattern.endsWith("/*")) {
          return mimeType.startsWith(pattern.slice(0, -1))
        }
        return mimeType === pattern
      })
      if (!allowed) {
        return { valid: false, error: `MIME type ${mimeType} is not allowed` }
      }
    }

    return { valid: true }
  }
}

// ── Predefined Transform Presets ───────────────────────────────────────────

export const transformPresets: Record<string, ImageTransform> = {
  thumbnail: { type: "image", width: 150, height: 150, fit: "cover", format: "webp", quality: 75 },
  small: { type: "image", width: 320, format: "webp", quality: 80 },
  medium: { type: "image", width: 640, format: "webp", quality: 80 },
  large: { type: "image", width: 1280, format: "webp", quality: 85 },
  original_webp: { type: "image", format: "webp", quality: 90 },
  avatar: { type: "image", width: 96, height: 96, fit: "cover", format: "webp", quality: 80 },
  og_image: { type: "image", width: 1200, height: 630, fit: "cover", format: "jpeg", quality: 85 },
}

// ── Media Pipeline (Main Engine) ───────────────────────────────────────────

export class MediaPipeline {
  private files = new Map<string, MediaFile>()
  readonly urls: ReactiveUrlBuilder
  readonly validator: UploadValidator
  private readonly defaultBucket: string
  private readonly maxFileSize: number
  private readonly db?: QueryExecutor
  private readonly storage?: FileStorageBackend
  private stats: MediaPipelineStats = {
    totalFiles: 0,
    totalSize: 0,
    variantCount: 0,
    uploadCount: 0,
    transformCount: 0,
  }
  private subscribers = new Map<string, Set<(file: MediaFile) => void>>()

  constructor(options: MediaPipelineOptions = {}) {
    this.defaultBucket = options.defaultBucket ?? "default"
    this.maxFileSize = options.maxFileSize ?? 100 * 1024 * 1024
    this.db = options.db
    this.storage = options.storage
    this.urls = new ReactiveUrlBuilder("/media", options.cdn)
    this.validator = new UploadValidator({
      maxSize: this.maxFileSize,
      allowedMimeTypes: options.allowedMimeTypes,
    })
  }

  upload(params: {
    filename: string
    mimeType: string
    size: number
    uploadedBy: string
    data?: Buffer | Uint8Array
    metadata?: Partial<MediaMetadata>
    bucket?: string
    prefix?: string
  }): UploadResult | Promise<UploadResult> {
    const { filename, mimeType, size, uploadedBy } = params
    const bucket = params.bucket ?? this.defaultBucket

    const validation = this.validator.validate(filename, mimeType, size)
    if (!validation.valid) {
      throw new MediaPipelineError(validation.error!, "VALIDATION_ERROR")
    }

    const id = `media_${randomUUID()}`
    const prefix = params.prefix ? `${params.prefix}/` : ""
    const storageKey = `${bucket}/${prefix}${id}/${filename}`
    const url = this.urls.buildUrl(storageKey)

    const file: MediaFile = {
      id,
      filename,
      mimeType,
      size,
      storageKey,
      bucket,
      url,
      metadata: { ...params.metadata } as MediaMetadata,
      variants: [],
      uploadedBy,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.files.set(id, file)
    this.stats.totalFiles++
    this.stats.totalSize += size
    this.stats.uploadCount++

    this.notifySubscribers(file)

    const result: UploadResult = {
      file,
      uploadUrl: `/upload/${id}`,
      signedUrl: this.urls.buildSignedUrl(storageKey),
    }

    const hasAsyncWork = (this.storage && params.data) || this.db
    if (!hasAsyncWork) {
      return result
    }

    return (async () => {
      if (this.storage && params.data) {
        await this.storage.write(file.storageKey, params.data!, file.mimeType)
      }
      if (this.db) {
        const sql = buildInsertFileSQL()
        const dbParams = [
          file.id,
          file.filename,
          file.mimeType,
          file.size,
          file.storageKey,
          file.bucket,
          file.url,
          file.cdnUrl || null,
          JSON.stringify(file.metadata),
          file.uploadedBy,
        ]
        await this.db(sql, dbParams).catch((err: unknown) => {
          if (process.env.NODE_ENV !== "production") {
            console.debug("[ReactiveBase] DB persistence error:", err instanceof Error ? err.message : err)
          }
        })
      }
      return result
    })()
  }

  addVariant(
    fileId: string,
    name: string,
    transform: ImageTransform | VideoTransform,
    variantSize: number = 0,
  ): MediaVariant {
    const file = this.files.get(fileId)
    if (!file) {
      throw new MediaPipelineError(`File ${fileId} not found`, "FILE_NOT_FOUND")
    }

    const storageKey = `${file.bucket}/variants/${fileId}/${name}`
    const resultMimeType =
      transform.type === "image"
        ? `image/${(transform as ImageTransform).format || "webp"}`
        : `video/${(transform as VideoTransform).format || "mp4"}`

    const variant: MediaVariant = {
      name,
      storageKey,
      url: this.urls.buildUrl(storageKey),
      mimeType: resultMimeType,
      size: variantSize,
      transform,
      generatedAt: Date.now(),
    }

    // Replace existing variant with same name
    file.variants = file.variants.filter((v) => v.name !== name)
    file.variants.push(variant)
    file.updatedAt = Date.now()
    this.stats.variantCount++
    this.stats.transformCount++

    this.notifySubscribers(file)
    return variant
  }

  getFile(id: string): MediaFile | null {
    return this.files.get(id) || null
  }

  getFileUrl(id: string, variant?: string, transform?: ImageTransform): string {
    const file = this.files.get(id)
    if (!file) {
      throw new MediaPipelineError(`File ${id} not found`, "FILE_NOT_FOUND")
    }

    if (variant) {
      const v = file.variants.find((v) => v.name === variant)
      if (v) return v.url
    }

    return this.urls.buildUrl(file.storageKey, transform)
  }

  deleteFile(id: string): boolean | Promise<boolean> {
    const file = this.files.get(id)
    if (!file) return false

    this.stats.totalSize -= file.size
    this.stats.totalFiles--
    this.stats.variantCount -= file.variants.length

    this.files.delete(id)

    const hasAsyncWork = this.storage || this.db
    if (!hasAsyncWork) {
      return true
    }

    return (async () => {
      if (this.storage) {
        await this.storage.delete(file.storageKey).catch((err: unknown) => {
          if (process.env.NODE_ENV !== "production") {
            console.debug("[ReactiveBase] DB persistence error:", err instanceof Error ? err.message : err)
          }
        })
        for (const variant of file.variants) {
          await this.storage.delete(variant.storageKey).catch((err: unknown) => {
            if (process.env.NODE_ENV !== "production") {
              console.debug("[ReactiveBase] DB persistence error:", err instanceof Error ? err.message : err)
            }
          })
        }
      }
      if (this.db) {
        const sql = buildDeleteFileSQL()
        await this.db(sql, [id]).catch((err: unknown) => {
          if (process.env.NODE_ENV !== "production") {
            console.debug("[ReactiveBase] DB persistence error:", err instanceof Error ? err.message : err)
          }
        })
      }
      return true
    })()
  }

  listFiles(bucket?: string, limit: number = 50, offset: number = 0): MediaFile[] {
    let files = Array.from(this.files.values())
    if (bucket) files = files.filter((f) => f.bucket === bucket)
    files.sort((a, b) => b.createdAt - a.createdAt)
    return files.slice(offset, offset + limit)
  }

  onFileChange(fileId: string, callback: (file: MediaFile) => void): () => void {
    if (!this.subscribers.has(fileId)) this.subscribers.set(fileId, new Set())
    this.subscribers.get(fileId)!.add(callback)
    return () => this.subscribers.get(fileId)?.delete(callback)
  }

  getStats(): MediaPipelineStats {
    return { ...this.stats }
  }

  async getFileData(fileId: string): Promise<Buffer | null> {
    const file = this.getFile(fileId)
    if (!file) return null
    if (this.storage && file.storageKey) {
      return this.storage.read(file.storageKey)
    }
    return null
  }

  async initTables(): Promise<void> {
    if (!this.db) return
    const sql = buildCreateMediaTablesSQL()
    await this.db(sql, [])
  }

  private notifySubscribers(file: MediaFile): void {
    const subs = this.subscribers.get(file.id)
    if (subs) {
      for (const sub of subs) {
        try {
          sub(file)
        } catch {
          /* swallow */
        }
      }
    }
  }
}
