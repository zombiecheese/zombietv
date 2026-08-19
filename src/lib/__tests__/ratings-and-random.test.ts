import { describe, it, expect } from 'vitest'
import { ratingAllowed, stricterRating, classificationCeiling } from '../scheduler/ratings'
import { seededRandom01, seededShuffle, weightedRandomWith, mulberry32, seedToUInt32 } from '../seeded-random'
import { zonedTimeToUtc } from '../time'

const TZ = 'Australia/Sydney'
// June 2026: the 15th is a Monday, the 13th a Saturday.
const weekday = zonedTimeToUtc(2026, 5, 15, 12, 0, TZ)
const weekend = zonedTimeToUtc(2026, 5, 13, 12, 0, TZ)

describe('ratingAllowed / stricterRating', () => {
  it('enforces the ratings ladder', () => {
    expect(ratingAllowed('G', 'PG')).toBe(true)
    expect(ratingAllowed('M', 'PG')).toBe(false)
    expect(ratingAllowed('MA15+', 'MA15+')).toBe(true)
  })

  it('unknown ratings are allowed (fail open)', () => {
    expect(ratingAllowed('NR', 'G')).toBe(true)
    expect(ratingAllowed('G', 'weird')).toBe(true)
  })

  it('stricterRating picks the lower ceiling', () => {
    expect(stricterRating('M', 'PG')).toBe('PG')
    expect(stricterRating('MA15+', 'M')).toBe('M')
    expect(stricterRating('G', 'MA15+')).toBe('G')
  })
})

describe('classificationCeiling (AU zones)', () => {
  it('MA15+ zone runs 21:00–05:00', () => {
    expect(classificationCeiling(weekday, 21 * 60, TZ)).toBe('MA15+')
    expect(classificationCeiling(weekday, 2 * 60, TZ)).toBe('MA15+')
    expect(classificationCeiling(weekday, 4 * 60 + 59, TZ)).toBe('MA15+')
  })

  it('M zone starts 20:30', () => {
    expect(classificationCeiling(weekday, 20 * 60 + 30, TZ)).toBe('M')
    expect(classificationCeiling(weekday, 20 * 60 + 29, TZ)).toBe('PG')
  })

  it('weekday school-hours M window is 12:00–15:00', () => {
    expect(classificationCeiling(weekday, 12 * 60, TZ)).toBe('M')
    expect(classificationCeiling(weekday, 14 * 60 + 59, TZ)).toBe('M')
    expect(classificationCeiling(weekday, 15 * 60, TZ)).toBe('PG')
    // Weekend midday stays PG.
    expect(classificationCeiling(weekend, 13 * 60, TZ)).toBe('PG')
  })
})

describe('seeded randomness', () => {
  it('identical seeds produce identical results', () => {
    expect(seededRandom01('abc')).toBe(seededRandom01('abc'))
    expect(seededRandom01('abc')).not.toBe(seededRandom01('abd'))
    const list = [1, 2, 3, 4, 5, 6, 7, 8]
    expect(seededShuffle(list, 'seed-1')).toEqual(seededShuffle(list, 'seed-1'))
  })

  it('seededShuffle does not mutate its input', () => {
    const list = [1, 2, 3, 4]
    seededShuffle(list, 'x')
    expect(list).toEqual([1, 2, 3, 4])
  })

  it('marathon-style rolls are deterministic per seed', () => {
    const seed = 'seven:2026-10-31:Movie:1230:marathon'
    const roll1 = seededRandom01(seed)
    const roll2 = seededRandom01(seed)
    expect(roll1).toBe(roll2)
    expect(roll1).toBeGreaterThanOrEqual(0)
    expect(roll1).toBeLessThan(1)
  })

  it('weightedRandomWith honours a seeded RNG deterministically', () => {
    const items = [
      { item: 'a', weight: 1 },
      { item: 'b', weight: 5 },
      { item: 'c', weight: 1 },
    ]
    const pick = () => weightedRandomWith(items, mulberry32(seedToUInt32('pick-seed')))
    expect(pick()).toBe(pick())
  })

  it('weightedRandomWith handles edge cases', () => {
    expect(weightedRandomWith([])).toBeNull()
    expect(weightedRandomWith([{ item: 'only', weight: 1 }])).toBe('only')
  })
})
