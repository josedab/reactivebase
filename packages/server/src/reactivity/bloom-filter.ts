/**
 * Bloom Filter — memory-efficient probabilistic set membership testing.
 * Uses FNV-1a and MurmurHash-like hash functions for bit position calculation.
 */

/**
 * Simple Bloom filter for memory-efficient set membership testing.
 * Uses multiple hash functions to reduce false positive rate.
 */
export class BloomFilter {
  private bits: Uint8Array
  private hashCount: number
  private size: number
  private insertedCount = 0

  /**
   * Create a new BloomFilter.
   *
   * @param expectedItems - Expected number of items to be inserted
   * @param falsePositiveRate - Desired false positive rate
   */
  constructor(expectedItems: number, falsePositiveRate: number = 0.01) {
    // Calculate optimal size and hash count
    this.size = Math.max(64, Math.ceil((-expectedItems * Math.log(falsePositiveRate)) / (Math.LN2 * Math.LN2)))
    this.hashCount = Math.max(1, Math.round((this.size / expectedItems) * Math.LN2))
    this.bits = new Uint8Array(Math.ceil(this.size / 8))
  }

  /**
   * Add a value to the bloom filter.
   *
   * @param value - String value to insert
   */
  add(value: string): void {
    for (const pos of this.getPositions(value)) {
      this.bits[Math.floor(pos / 8)] |= 1 << (pos % 8)
    }
    this.insertedCount++
  }

  /**
   * Test whether a value may be in the set.
   *
   * @param value - String value to test
   * @returns True if the value might be in the set (may be a false positive)
   */
  has(value: string): boolean {
    for (const pos of this.getPositions(value)) {
      if (!(this.bits[Math.floor(pos / 8)] & (1 << (pos % 8)))) {
        return false
      }
    }
    return true
  }

  get count(): number {
    return this.insertedCount
  }

  get memoryBytes(): number {
    return this.bits.length
  }

  private getPositions(value: string): number[] {
    const positions: number[] = []
    const h1 = this.fnv1a(value)
    const h2 = this.murmur3Like(value)

    for (let i = 0; i < this.hashCount; i++) {
      positions.push(Math.abs((h1 + i * h2) % this.size))
    }
    return positions
  }

  private fnv1a(str: string): number {
    let hash = 0x811c9dc5
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i)
      hash = (hash * 0x01000193) >>> 0
    }
    return hash
  }

  private murmur3Like(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
    }
    return Math.abs(hash) || 1
  }
}

/**
 * Auto-tuned bloom filter that adjusts false-positive rates based on observed
 * invalidation patterns. Starts with a default FP rate and adapts based on the
 * ratio of false invalidations to total checks.
 */
export class AutoTunedBloomFilter {
  private filter: BloomFilter
  private checkCount = 0
  private falsePositiveCount = 0
  private currentFpRate: number
  private readonly minFpRate: number
  private readonly maxFpRate: number

  constructor(expectedItems: number, initialFpRate: number = 0.01, minFpRate: number = 0.001, maxFpRate: number = 0.1) {
    this.currentFpRate = initialFpRate
    this.minFpRate = minFpRate
    this.maxFpRate = maxFpRate
    this.filter = new BloomFilter(expectedItems, initialFpRate)
  }

  add(value: string): void {
    this.filter.add(value)
  }

  has(value: string): boolean {
    return this.filter.has(value)
  }

  /** Record a confirmed false positive for tuning */
  recordFalsePositive(): void {
    this.falsePositiveCount++
    this.checkCount++
  }

  /** Record a true positive or true negative check */
  recordCheck(): void {
    this.checkCount++
  }

  /** Get recommended FP rate for next rebuild based on observed patterns */
  get recommendedFpRate(): number {
    if (this.checkCount < 100) return this.currentFpRate
    const observedFpRate = this.falsePositiveCount / this.checkCount
    if (observedFpRate > this.currentFpRate * 1.5) {
      return Math.max(this.minFpRate, this.currentFpRate * 0.5)
    }
    if (observedFpRate < this.currentFpRate * 0.1) {
      return Math.min(this.maxFpRate, this.currentFpRate * 2)
    }
    return this.currentFpRate
  }

  get count(): number {
    return this.filter.count
  }

  get memoryBytes(): number {
    return this.filter.memoryBytes
  }

  get stats(): { checkCount: number; falsePositiveCount: number; observedFpRate: number } {
    return {
      checkCount: this.checkCount,
      falsePositiveCount: this.falsePositiveCount,
      observedFpRate: this.checkCount > 0 ? this.falsePositiveCount / this.checkCount : 0,
    }
  }
}
