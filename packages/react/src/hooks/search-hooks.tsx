/**
 * Pre-built SearchInput React component for full-text search.
 * Provides debounced input with reactive search results.
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { useReactiveBaseClient } from "../provider/provider.js"

export interface UseSearchOptions {
  /** Debounce delay in ms (default: 300) */
  debounceMs?: number
  /** Minimum characters before searching (default: 2) */
  minChars?: number
  /** Max results (default: 20) */
  limit?: number
  /** Search mode */
  mode?: "fulltext" | "fuzzy"
}

export interface UseSearchReturn<T = unknown> {
  /** Current search query */
  query: string
  /** Set search query */
  setQuery: (query: string) => void
  /** Search results */
  results: T[]
  /** Whether search is loading */
  isLoading: boolean
  /** Error if any */
  error: Error | null
  /** Total result count */
  totalCount: number
  /** Clear results */
  clear: () => void
}

/**
 * Hook for reactive full-text search.
 * Debounces input and automatically re-executes when data changes.
 */
export function useSearch<T = unknown>(
  searchFn: { _name: string },
  options: UseSearchOptions = {},
): UseSearchReturn<T> {
  const { debounceMs = 300, minChars = 2, limit = 20 } = options
  const client = useReactiveBaseClient()

  const [query, setQuery] = useState("")
  const [results, setResults] = useState<T[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const executeSearch = useCallback(
    async (searchQuery: string) => {
      if (searchQuery.length < minChars) {
        setResults([])
        setTotalCount(0)
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const result = await client.mutate(searchFn._name, {
          query: searchQuery,
          limit,
          mode: options.mode ?? "fulltext",
        })
        setResults((result as { rows: T[] })?.rows ?? (result as T[]) ?? [])
        setTotalCount((result as { totalCount?: number })?.totalCount ?? 0)
      } catch (err: unknown) {
        setError(err instanceof Error ? err : new Error(String(err)))
        setResults([])
      } finally {
        setIsLoading(false)
      }
    },
    [client, searchFn._name, minChars, limit, options.mode],
  )

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)

    if (query.length < minChars) {
      setResults([])
      setTotalCount(0)
      return
    }

    timerRef.current = setTimeout(() => {
      executeSearch(query)
    }, debounceMs)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [query, debounceMs, minChars, executeSearch])

  const clear = useCallback(() => {
    setQuery("")
    setResults([])
    setTotalCount(0)
    setError(null)
  }, [])

  return { query, setQuery, results, isLoading, error, totalCount, clear }
}

export interface SearchInputProps {
  /** Placeholder text */
  placeholder?: string
  /** Search function reference */
  searchFn: { _name: string }
  /** Debounce delay in ms */
  debounceMs?: number
  /** Minimum characters before searching */
  minChars?: number
  /** Max results */
  limit?: number
  /** Callback when a result is selected */
  onSelect?: (item: unknown) => void
  /** Render function for each result */
  renderResult?: (item: unknown, index: number) => React.ReactNode
  /** CSS class name */
  className?: string
}

/**
 * Pre-built search input component with dropdown results.
 * Connects to ReactiveBase full-text search.
 */
export function SearchInput(props: SearchInputProps): React.ReactElement {
  const {
    placeholder = "Search...",
    searchFn,
    debounceMs = 300,
    minChars = 2,
    limit = 10,
    onSelect,
    renderResult,
    className,
  } = props

  const { query, setQuery, results, isLoading, clear } = useSearch(searchFn, {
    debounceMs,
    minChars,
    limit,
  })

  const [showDropdown, setShowDropdown] = useState(false)

  return (
    <div className={`rb-search-input ${className ?? ""}`} style={{ position: "relative" }}>
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setShowDropdown(true)
        }}
        onFocus={() => setShowDropdown(true)}
        onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
        placeholder={placeholder}
        style={{
          width: "100%",
          padding: "8px 12px",
          fontSize: "14px",
          border: "1px solid #ddd",
          borderRadius: "6px",
        }}
      />

      {isLoading && (
        <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)" }}>⏳</div>
      )}

      {showDropdown && results.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: "white",
            border: "1px solid #ddd",
            borderRadius: "0 0 6px 6px",
            maxHeight: "300px",
            overflowY: "auto",
            zIndex: 1000,
            boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
          }}
        >
          {results.map((item, i) => (
            <div
              key={i}
              onClick={() => {
                onSelect?.(item)
                setShowDropdown(false)
                clear()
              }}
              style={{
                padding: "8px 12px",
                cursor: "pointer",
                borderBottom: "1px solid #f0f0f0",
              }}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLDivElement).style.backgroundColor = "#f5f5f5"
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLDivElement).style.backgroundColor = "transparent"
              }}
            >
              {renderResult ? renderResult(item, i) : JSON.stringify(item)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
