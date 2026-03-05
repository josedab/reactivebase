/**
 * Shared ID generation utility for cloud platform modules.
 */

/**
 * Creates an ID generator with an auto-incrementing counter.
 * Each call to the returned function produces a unique ID
 * in the format `{prefix}_{counter}_{timestamp_base36}`.
 */
export function createIdGenerator(): (prefix: string) => string {
  let counter = 0
  return (prefix: string): string => {
    return `${prefix}_${++counter}_${Date.now().toString(36)}`
  }
}
