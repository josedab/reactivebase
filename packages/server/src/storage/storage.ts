/**
 * File storage system for ReactiveBase.
 * Provides a pluggable storage backend (local filesystem, S3-compatible)
 * with reactive URL tracking for subscriptions.
 */

import { createHash, randomUUID } from "node:crypto"
import { writeFile, readFile, unlink, mkdir } from "node:fs/promises"
import { dirname, resolve, sep } from "node:path"
import { existsSync } from "node:fs"

export interface StorageBackend {
  /** Store a file and return a storage ID */
  put(data: Buffer, options: StorageOptions): Promise<string>
  /** Get a URL for a stored file */
  getUrl(storageId: string): Promise<string>
  /** Delete a stored file */
  delete(storageId: string): Promise<void>
  /** Check if a file exists */
  exists(storageId: string): Promise<boolean>
}

export interface StorageOptions {
  contentType?: string
  filename?: string
  metadata?: Record<string, string>
}

export interface StorageContext {
  /** Upload a file and return a storage ID */
  upload(data: Buffer | Uint8Array | string, options?: StorageOptions): Promise<string>
  /** Get a URL for a stored file */
  getUrl(storageId: string): Promise<string>
  /** Delete a stored file */
  delete(storageId: string): Promise<void>
}

/**
 * Local filesystem storage backend.
 * Stores files in a local directory. Suitable for development.
 */
export class LocalStorageBackend implements StorageBackend {
  /**
   * @param baseDir - Directory path where files are stored
   * @param baseUrl - Base URL for generating file URLs
   */
  constructor(
    private baseDir: string,
    private baseUrl: string = "http://localhost:4000/storage",
  ) {}

  /** Validate storageId to prevent path traversal */
  private safePath(storageId: string): string {
    if (storageId.includes(sep) || storageId.includes("/") || storageId.includes("\\") || storageId.includes("..")) {
      throw new Error("Invalid storage ID")
    }
    const filePath = resolve(this.baseDir, storageId)
    const resolvedBase = resolve(this.baseDir)
    if (!filePath.startsWith(resolvedBase + sep) && filePath !== resolvedBase) {
      throw new Error("Invalid storage ID")
    }
    return filePath
  }

  /**
   * @param data - The file data to store
   * @param options - Storage options including content type and metadata
   * @returns The generated storage ID
   */
  async put(data: Buffer, options: StorageOptions): Promise<string> {
    const hash = createHash("sha256").update(data).digest("hex").substring(0, 16)
    const ext = extensionFromContentType(options.contentType)
    const storageId = `${randomUUID().substring(0, 8)}_${hash}${ext}`

    const filePath = this.safePath(storageId)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, data)

    return storageId
  }

  /**
   * @param storageId - The ID of the stored file
   * @returns The URL for the stored file
   */
  async getUrl(storageId: string): Promise<string> {
    return `${this.baseUrl}/${storageId}`
  }

  /**
   * @param storageId - The ID of the stored file to delete
   */
  async delete(storageId: string): Promise<void> {
    const filePath = this.safePath(storageId)
    try {
      await unlink(filePath)
    } catch {
      // File may not exist
    }
  }

  /**
   * @param storageId - The ID of the stored file
   * @returns Whether the file exists
   */
  async exists(storageId: string): Promise<boolean> {
    return existsSync(this.safePath(storageId))
  }

  /**
   * Read file contents (for serving).
   *
   * @param storageId - The ID of the stored file
   * @returns The file contents as a Buffer
   */
  async read(storageId: string): Promise<Buffer> {
    return readFile(this.safePath(storageId))
  }
}

/**
 * S3-compatible storage backend.
 * Uses a generic interface to avoid hard dependency on AWS SDK.
 */
export class S3StorageBackend implements StorageBackend {
  /**
   * @param client - S3-compatible client instance
   * @param bucket - The S3 bucket name
   * @param prefix - Key prefix for stored objects
   * @param publicUrl - Optional public base URL for direct access
   */
  constructor(
    private client: S3ClientLike,
    private bucket: string,
    private prefix: string = "uploads/",
    private publicUrl?: string,
  ) {}

  /**
   * @param data - The file data to store
   * @param options - Storage options including content type and metadata
   * @returns The generated storage ID
   */
  async put(data: Buffer, options: StorageOptions): Promise<string> {
    const hash = createHash("sha256").update(data).digest("hex").substring(0, 16)
    const ext = extensionFromContentType(options.contentType)
    const storageId = `${randomUUID().substring(0, 8)}_${hash}${ext}`
    const key = `${this.prefix}${storageId}`

    await this.client.putObject({
      bucket: this.bucket,
      key,
      body: data,
      contentType: options.contentType ?? "application/octet-stream",
      metadata: options.metadata,
    })

    return storageId
  }

  /**
   * @param storageId - The ID of the stored file
   * @returns The URL for the stored file
   */
  async getUrl(storageId: string): Promise<string> {
    if (this.publicUrl) {
      return `${this.publicUrl}/${this.prefix}${storageId}`
    }
    return this.client.getSignedUrl({
      bucket: this.bucket,
      key: `${this.prefix}${storageId}`,
      expiresIn: 3600,
    })
  }

  /**
   * @param storageId - The ID of the stored file to delete
   */
  async delete(storageId: string): Promise<void> {
    await this.client.deleteObject({
      bucket: this.bucket,
      key: `${this.prefix}${storageId}`,
    })
  }

  /**
   * @param storageId - The ID of the stored file
   * @returns Whether the file exists in the bucket
   */
  async exists(storageId: string): Promise<boolean> {
    return this.client.headObject({
      bucket: this.bucket,
      key: `${this.prefix}${storageId}`,
    })
  }
}

/** Minimal S3 client interface for loose coupling */
export interface S3ClientLike {
  putObject(params: {
    bucket: string
    key: string
    body: Buffer
    contentType?: string
    metadata?: Record<string, string>
  }): Promise<void>
  getSignedUrl(params: { bucket: string; key: string; expiresIn: number }): Promise<string>
  deleteObject(params: { bucket: string; key: string }): Promise<void>
  headObject(params: { bucket: string; key: string }): Promise<boolean>
}

/**
 * In-memory storage backend for testing.
 */
export class MemoryStorageBackend implements StorageBackend {
  private files = new Map<string, { data: Buffer; options: StorageOptions }>()

  /**
   * @param data - The file data to store
   * @param options - Storage options including content type and metadata
   * @returns The generated storage ID
   */
  async put(data: Buffer, options: StorageOptions): Promise<string> {
    const storageId = `mem_${randomUUID().substring(0, 8)}`
    this.files.set(storageId, { data, options })
    return storageId
  }

  /**
   * @param storageId - The ID of the stored file
   * @returns A memory:// protocol URL for the stored file
   */
  async getUrl(storageId: string): Promise<string> {
    return `memory://${storageId}`
  }

  /**
   * @param storageId - The ID of the stored file to delete
   */
  async delete(storageId: string): Promise<void> {
    this.files.delete(storageId)
  }

  /**
   * @param storageId - The ID of the stored file
   * @returns Whether the file exists in memory
   */
  async exists(storageId: string): Promise<boolean> {
    return this.files.has(storageId)
  }

  /**
   * @param storageId - The ID of the stored file
   * @returns The raw file data, or undefined if not found
   */
  getData(storageId: string): Buffer | undefined {
    return this.files.get(storageId)?.data
  }

  get size(): number {
    return this.files.size
  }

  clear(): void {
    this.files.clear()
  }
}

/**
 * Create a storage context for use in server functions.
 *
 * @param backend - The storage backend to use
 * @returns A storage context wrapping the backend
 */
export function createStorageContext(backend: StorageBackend): StorageContext {
  return {
    async upload(data, options = {}) {
      const buffer = typeof data === "string" ? Buffer.from(data, "utf-8") : Buffer.from(data)
      return backend.put(buffer, options)
    },
    async getUrl(storageId) {
      return backend.getUrl(storageId)
    },
    async delete(storageId) {
      return backend.delete(storageId)
    },
  }
}

function extensionFromContentType(contentType?: string): string {
  if (!contentType) return ""
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "text/csv": ".csv",
    "application/json": ".json",
  }
  return map[contentType] ?? ""
}
