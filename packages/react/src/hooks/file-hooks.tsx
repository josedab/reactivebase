/**
 * useFile hook for React — reactive file state tracking.
 *
 * Usage:
 *   const { file, upload, progress, error } = useFile()
 *   await upload(fileInput.files[0])
 *   // file.status updates reactively: "uploading" → "processing" → "ready"
 */

import { useState, useCallback, useRef } from "react"
import { useReactiveBaseClient } from "../provider/provider.js"

export interface FileState {
  id: string | null
  status: "idle" | "uploading" | "processing" | "ready" | "error"
  progress: number
  url: string | null
  variants: Record<string, string>
  error: string | null
  metadata: Record<string, unknown>
}

export interface UseFileOptions {
  /** Accepted content types (e.g., ["image/*", "application/pdf"]) */
  accept?: string[]
  /** Max file size in bytes */
  maxSize?: number
  /** Processing pipeline name (server-side) */
  pipeline?: string
}

export interface UseFileReturn {
  file: FileState
  upload: (file: File | Blob, metadata?: Record<string, unknown>) => Promise<void>
  reset: () => void
}

const INITIAL_STATE: FileState = {
  id: null,
  status: "idle",
  progress: 0,
  url: null,
  variants: {},
  error: null,
  metadata: {},
}

export function useFile(options: UseFileOptions = {}): UseFileReturn {
  const [file, setFile] = useState<FileState>({ ...INITIAL_STATE })
  const client = useReactiveBaseClient()
  const abortRef = useRef<AbortController | null>(null)

  const upload = useCallback(
    async (input: File | Blob, metadata?: Record<string, unknown>) => {
      // Validate
      if (options.maxSize && input.size > options.maxSize) {
        setFile((f) => ({ ...f, status: "error", error: `File size exceeds ${options.maxSize} bytes` }))
        return
      }

      if (options.accept && options.accept.length > 0 && input.type) {
        const accepted = options.accept.some((pattern) => {
          if (pattern.endsWith("/*")) {
            return input.type.startsWith(pattern.replace("/*", "/"))
          }
          return input.type === pattern
        })
        if (!accepted) {
          setFile((f) => ({ ...f, status: "error", error: `File type "${input.type}" not accepted` }))
          return
        }
      }

      abortRef.current = new AbortController()
      setFile((f) => ({ ...f, status: "uploading", progress: 0, error: null }))

      try {
        // Read file data
        const buffer = await input.arrayBuffer()
        setFile((f) => ({ ...f, progress: 30 }))

        // Upload via client action
        const result = (await client.action("storage:upload", {
          data: Array.from(new Uint8Array(buffer)),
          contentType: input.type || "application/octet-stream",
          filename: input instanceof File ? input.name : "blob",
          pipeline: options.pipeline,
          metadata,
        })) as { id: string; url: string; variants?: Record<string, string> }

        setFile((f) => ({
          ...f,
          id: result.id,
          status: "ready",
          progress: 100,
          url: result.url,
          variants: result.variants ?? {},
          metadata: metadata ?? {},
        }))
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Upload failed"
        setFile((f) => ({ ...f, status: "error", error: message, progress: 0 }))
      }
    },
    [client, options.accept, options.maxSize, options.pipeline],
  )

  const reset = useCallback(() => {
    if (abortRef.current) abortRef.current.abort()
    setFile({ ...INITIAL_STATE })
  }, [])

  return { file, upload, reset }
}
