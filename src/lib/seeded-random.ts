// Deterministic seeded randomness shared by the scheduler and playback.
// Identical seeds always produce identical sequences, so schedule regeneration
// and per-viewer filler queues stay stable across runs.

import { createHash } from 'crypto'

export function seedToUInt32(seed: string): number {
  const hash = createHash('sha256').update(seed).digest()
  return hash.readUInt32LE(0)
}

export function mulberry32(a: number): () => number {
  return () => {
    let t = a += 0x6D2B79F5
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A single deterministic sample in [0, 1) for the given seed.
export function seededRandom01(seed: string): number {
  return mulberry32(seedToUInt32(seed))()
}

// Fisher-Yates shuffle driven by the seed (input array is not mutated).
export function seededShuffle<T>(items: T[], seed: string): T[] {
  const result = [...items]
  const rand = mulberry32(seedToUInt32(seed))

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }

  return result
}

// Weighted random pick using the supplied RNG (defaults to Math.random).
export function weightedRandomWith<T>(
  items: Array<{ item: T; weight: number }>,
  rand: () => number = Math.random,
): T | null {
  if (!items.length) return null
  const total = items.reduce((s, i) => s + i.weight, 0)
  let r = rand() * total
  for (const { item, weight } of items) {
    r -= weight
    if (r <= 0) return item
  }
  return items[items.length - 1].item
}
