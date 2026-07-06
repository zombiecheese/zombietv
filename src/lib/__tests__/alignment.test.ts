import { describe, it, expect } from 'vitest'
import { alignEndTime, resolveWindowAlignedEnd, applySequenceRange } from '../scheduler/alignment'

const at = (h: number, m: number) => new Date(2026, 5, 15, h, m, 0, 0) // local time — matches scheduler usage

describe('alignEndTime', () => {
  it('rounds up to the next half-hour by default', () => {
    expect(alignEndTime(at(20, 0)).getMinutes()).toBe(0)   // already aligned
    expect(alignEndTime(at(20, 1)).getMinutes()).toBe(30)
    expect(alignEndTime(at(20, 30)).getMinutes()).toBe(30) // already aligned
    expect(alignEndTime(at(20, 31)).getHours()).toBe(21)
    expect(alignEndTime(at(20, 31)).getMinutes()).toBe(0)
  })

  it('increment 0 means continuous (no padding)', () => {
    const d = at(20, 17)
    expect(alignEndTime(d, 0).getTime()).toBe(d.getTime())
  })

  it('supports tight 5-minute increments', () => {
    expect(alignEndTime(at(20, 21), 5).getMinutes()).toBe(25)
    expect(alignEndTime(at(20, 25), 5).getMinutes()).toBe(25)
  })

  it('showtime offset shifts boundaries (:05/:35)', () => {
    expect(alignEndTime(at(20, 0), 30, 5).getMinutes()).toBe(5)
    expect(alignEndTime(at(20, 6), 30, 5).getMinutes()).toBe(35)
    expect(alignEndTime(at(20, 36), 30, 5).getHours()).toBe(21)
    expect(alignEndTime(at(20, 36), 30, 5).getMinutes()).toBe(5)
    expect(alignEndTime(at(20, 35), 30, 5).getMinutes()).toBe(35) // exactly on boundary
  })

  it('hour increments with offset', () => {
    expect(alignEndTime(at(20, 10), 60, 5).getHours()).toBe(21)
    expect(alignEndTime(at(20, 10), 60, 5).getMinutes()).toBe(5)
  })
})

describe('resolveWindowAlignedEnd', () => {
  it('pads to the aligned boundary and reports filler minutes', () => {
    const { effectiveEnd, fillerMins } = resolveWindowAlignedEnd(at(20, 22), at(23, 0))
    expect(effectiveEnd.getMinutes()).toBe(30)
    expect(fillerMins).toBe(8)
  })

  it('clamps to the window end', () => {
    const { effectiveEnd, fillerMins } = resolveWindowAlignedEnd(at(22, 50), at(23, 0))
    expect(effectiveEnd.getHours()).toBe(23)
    expect(effectiveEnd.getMinutes()).toBe(0)
    expect(fillerMins).toBe(10)
  })

  it('continuous increment produces zero filler', () => {
    const end = at(20, 22)
    const { effectiveEnd, fillerMins } = resolveWindowAlignedEnd(end, at(23, 0), 0)
    expect(effectiveEnd.getTime()).toBe(end.getTime())
    expect(fillerMins).toBe(0)
  })
})

describe('applySequenceRange', () => {
  const eps = Array.from({ length: 10 }, (_, i) => `e${i + 1}`)

  it('full range passes through', () => {
    expect(applySequenceRange(eps)).toEqual(eps)
    expect(applySequenceRange(eps, 0, 1)).toEqual(eps)
  })

  it('slices fractional ranges', () => {
    expect(applySequenceRange(eps, 0, 0.5)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5'])
    expect(applySequenceRange(eps, 0.5, 1)).toEqual(['e6', 'e7', 'e8', 'e9', 'e10'])
    expect(applySequenceRange(eps, 0.75, 1)).toEqual(['e8', 'e9', 'e10'])
  })

  it('always returns at least one episode for non-empty input', () => {
    expect(applySequenceRange(eps, 0.95, 0.96).length).toBeGreaterThanOrEqual(1)
    expect(applySequenceRange(['only'], 0.99, 1)).toEqual(['only'])
  })

  it('degenerate or inverted ranges fall back to the full list', () => {
    expect(applySequenceRange(eps, 0.8, 0.2)).toEqual(eps)
    expect(applySequenceRange([], 0, 0.5)).toEqual([])
  })
})
