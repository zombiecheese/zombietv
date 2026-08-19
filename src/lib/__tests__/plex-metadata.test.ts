import { describe, it, expect } from 'vitest'
import { cutPointCandidates, effectiveRuntimeMins, buildContentAdBreaks } from '../scheduler/ad-breaks'
import { monthDayDistanceDays, seasonalAffinityMultiplier, anniversaryYears } from '../date-hints'

const mins = (m: number) => m * 60_000

describe('cutPointCandidates', () => {
  it('includes chapters plus intro-end and credits-start markers', () => {
    const candidates = cutPointCandidates({
      durationMins: 45,
      chapters: [{ title: 'c1', startOffsetMs: mins(10) }],
      markers: [
        { type: 'intro', startMs: mins(0), endMs: mins(2) },
        { type: 'credits', startMs: mins(42), endMs: mins(45) },
      ],
    })
    const offsets = candidates.map((c) => c.startOffsetMs)
    expect(offsets).toContain(mins(10)) // chapter
    expect(offsets).toContain(mins(2))  // intro end
    expect(offsets).toContain(mins(42)) // credits start
  })

  it('works with markers only (no chapters — the common TV rip case)', () => {
    const breaks = buildContentAdBreaks(
      {
        durationMins: 44,
        markers: [{ type: 'credits', startMs: mins(41), endMs: mins(44) }],
      },
      15,
      true,
      'standard',
    )
    // The 30-min interval break stays; the 15-min break has no nearby cut point.
    expect(breaks.length).toBeGreaterThan(0)
  })
})

describe('effectiveRuntimeMins', () => {
  it('trims long credit rolls near the end', () => {
    // 45-min episode, credits start at 40:00 → play to 41, save 4 minutes.
    expect(effectiveRuntimeMins({
      durationMins: 45,
      markers: [{ type: 'credits', startMs: mins(40), endMs: mins(45) }],
    })).toBe(41)
  })

  it('ignores credits markers that are not near the end (multi-part credits)', () => {
    expect(effectiveRuntimeMins({
      durationMins: 60,
      markers: [{ type: 'credits', startMs: mins(30), endMs: mins(31) }],
    })).toBe(60)
  })

  it('does not trim when savings are under 3 minutes', () => {
    expect(effectiveRuntimeMins({
      durationMins: 45,
      markers: [{ type: 'credits', startMs: mins(43), endMs: mins(45) }],
    })).toBe(45)
  })

  it('passes through without markers', () => {
    expect(effectiveRuntimeMins({ durationMins: 88 })).toBe(88)
    expect(effectiveRuntimeMins({ durationMins: 88, markers: [] })).toBe(88)
  })
})

describe('monthDayDistanceDays', () => {
  it('measures simple distances', () => {
    expect(monthDayDistanceDays(6, 10, 6, 10)).toBe(0)
    expect(monthDayDistanceDays(6, 10, 6, 17)).toBe(7)
  })

  it('wraps the year boundary', () => {
    expect(monthDayDistanceDays(12, 30, 1, 2)).toBe(3)
    expect(monthDayDistanceDays(1, 1, 12, 31)).toBe(1)
  })
})

describe('seasonalAffinityMultiplier', () => {
  it('boosts content near its original air date', () => {
    expect(seasonalAffinityMultiplier('1994-12-25', 12, 20)).toBe(1.6)  // within 7 days
    expect(seasonalAffinityMultiplier('1994-12-25', 12, 10)).toBe(1.2)  // within 21 days
    expect(seasonalAffinityMultiplier('1994-12-25', 6, 15)).toBe(1)     // out of season
  })

  it('handles the year boundary (Christmas episode airing in early January)', () => {
    expect(seasonalAffinityMultiplier('1994-12-30', 1, 2)).toBe(1.6)
  })

  it('is neutral without a valid air date', () => {
    expect(seasonalAffinityMultiplier(undefined, 12, 25)).toBe(1)
    expect(seasonalAffinityMultiplier('not-a-date', 12, 25)).toBe(1)
  })
})

describe('anniversaryYears', () => {
  it('detects exact month/day anniversaries', () => {
    expect(anniversaryYears('1994-10-31', 10, 31, 2026)).toBe(32)
  })

  it('returns null off-anniversary or same-year', () => {
    expect(anniversaryYears('1994-10-31', 10, 30, 2026)).toBeNull()
    expect(anniversaryYears('2026-10-31', 10, 31, 2026)).toBeNull()
    expect(anniversaryYears(undefined, 10, 31, 2026)).toBeNull()
  })
})
