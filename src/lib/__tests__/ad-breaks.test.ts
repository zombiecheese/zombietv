import { describe, it, expect } from 'vitest'
import { buildAdBreaks, buildContentAdBreaks, snapOffsetToChapter } from '../scheduler/ad-breaks'

const chaptersAt = (...mins: number[]) => mins.map((m) => ({ title: `ch${m}`, startOffsetMs: m * 60_000 }))

describe('buildAdBreaks', () => {
  it('places interval breaks strictly inside the content', () => {
    expect(buildAdBreaks(60, 15, true)).toEqual([
      { offsetMins: 15, durationMins: 3 },
      { offsetMins: 30, durationMins: 3 },
      { offsetMins: 45, durationMins: 3 },
    ])
  })

  it('returns nothing when disabled or interval invalid', () => {
    expect(buildAdBreaks(60, 15, false)).toEqual([])
    expect(buildAdBreaks(60, 0, true)).toEqual([])
  })

  it('short content gets no breaks', () => {
    expect(buildAdBreaks(10, 15, true)).toEqual([])
  })
})

describe('snapOffsetToChapter', () => {
  it('snaps to the nearest chapter within tolerance', () => {
    expect(snapOffsetToChapter(15, chaptersAt(13), 60)).toBe(13)
    expect(snapOffsetToChapter(15, chaptersAt(18, 40), 60)).toBe(18)
  })

  it('does not snap beyond tolerance', () => {
    expect(snapOffsetToChapter(15, chaptersAt(30), 60)).toBe(15)
  })

  it('ignores chapters at the very start and in the credits zone', () => {
    expect(snapOffsetToChapter(3, chaptersAt(1), 60)).toBe(3)     // <2min chapter ignored
    expect(snapOffsetToChapter(58, chaptersAt(59), 60)).toBe(58)  // >duration-2 ignored
  })

  it('passes through without chapters', () => {
    expect(snapOffsetToChapter(15, undefined, 60)).toBe(15)
    expect(snapOffsetToChapter(15, [], 60)).toBe(15)
  })
})

describe('buildContentAdBreaks', () => {
  it("'end' strategy yields no mid-roll breaks", () => {
    expect(buildContentAdBreaks({ durationMins: 90 }, 15, true, 'end')).toEqual([])
  })

  it("'center' strategy yields one mid break, chapter-snapped", () => {
    expect(buildContentAdBreaks({ durationMins: 90 }, 15, true, 'center')).toEqual([
      { offsetMins: 45, durationMins: 3 },
    ])
    expect(buildContentAdBreaks({ durationMins: 90, chapters: chaptersAt(48) }, 15, true, 'center')).toEqual([
      { offsetMins: 48, durationMins: 3 },
    ])
  })

  it("'center' skips very short content", () => {
    expect(buildContentAdBreaks({ durationMins: 15 }, 15, true, 'center')).toEqual([])
  })

  it("'standard' without chapters equals plain interval breaks", () => {
    expect(buildContentAdBreaks({ durationMins: 60 }, 15, true, 'standard')).toEqual(buildAdBreaks(60, 15, true))
    // undefined strategy defaults to standard
    expect(buildContentAdBreaks({ durationMins: 60 }, 15, true)).toEqual(buildAdBreaks(60, 15, true))
  })

  it("'standard' snaps each break to nearby chapters and stays sorted/deduped", () => {
    const breaks = buildContentAdBreaks(
      { durationMins: 60, chapters: chaptersAt(13, 32, 44) },
      15,
      true,
      'standard',
    )
    expect(breaks.map((b) => b.offsetMins)).toEqual([13, 32, 44])
  })

  it('two breaks snapping to the same chapter do not collide', () => {
    // Breaks at 20 and 25 both prefer the chapter at 22.
    const breaks = buildContentAdBreaks(
      { durationMins: 50, chapters: chaptersAt(22) },
      5,
      true,
      'standard',
    )
    const offsets = breaks.map((b) => b.offsetMins)
    expect(new Set(offsets).size).toBe(offsets.length)
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b))
  })

  it('disabled ads always yield nothing', () => {
    expect(buildContentAdBreaks({ durationMins: 90 }, 15, false, 'standard')).toEqual([])
    expect(buildContentAdBreaks({ durationMins: 90 }, 15, false, 'center')).toEqual([])
  })
})
