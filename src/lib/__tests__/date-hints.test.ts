import { describe, it, expect } from 'vitest'
import {
  dayPartForMinutes,
  parseMonthDay,
  dateRangeMatches,
  dateHintMatches,
  isValidDateHint,
  parseDayParts,
  filterPoolByHints,
} from '../date-hints'

describe('dayPartForMinutes', () => {
  it('maps the broadcast day into the five FS42-style day parts', () => {
    expect(dayPartForMinutes(6 * 60)).toBe('morning')
    expect(dayPartForMinutes(9 * 60 + 59)).toBe('morning')
    expect(dayPartForMinutes(10 * 60)).toBe('daytime')
    expect(dayPartForMinutes(16 * 60 + 59)).toBe('daytime')
    expect(dayPartForMinutes(17 * 60)).toBe('prime')
    expect(dayPartForMinutes(22 * 60 + 59)).toBe('prime')
    expect(dayPartForMinutes(23 * 60)).toBe('late')
    expect(dayPartForMinutes(1 * 60 + 59)).toBe('late')
    expect(dayPartForMinutes(2 * 60)).toBe('overnight')
    expect(dayPartForMinutes(5 * 60 + 59)).toBe('overnight')
  })

  it('normalizes out-of-range minutes', () => {
    expect(dayPartForMinutes(24 * 60)).toBe('late')      // wraps to 00:00
    expect(dayPartForMinutes(-60)).toBe('late')          // wraps to 23:00
  })
})

describe('parseMonthDay', () => {
  it('parses valid month-day strings', () => {
    expect(parseMonthDay('October 15')).toEqual({ month: 10, day: 15 })
    expect(parseMonthDay('  january 1 ')).toEqual({ month: 1, day: 1 })
  })

  it('rejects malformed values', () => {
    expect(parseMonthDay('Octember 15')).toBeNull()
    expect(parseMonthDay('October')).toBeNull()
    expect(parseMonthDay('October 45')).toBeNull()
    expect(parseMonthDay('')).toBeNull()
  })
})

describe('dateRangeMatches', () => {
  it('matches inclusive in-year ranges', () => {
    expect(dateRangeMatches('October 15 - October 31', 10, 15)).toBe(true)
    expect(dateRangeMatches('October 15 - October 31', 10, 31)).toBe(true)
    expect(dateRangeMatches('October 15 - October 31', 10, 14)).toBe(false)
    expect(dateRangeMatches('October 15 - October 31', 11, 1)).toBe(false)
  })

  it('wraps the year boundary', () => {
    expect(dateRangeMatches('December 24 - January 2', 12, 25)).toBe(true)
    expect(dateRangeMatches('December 24 - January 2', 1, 2)).toBe(true)
    expect(dateRangeMatches('December 24 - January 2', 1, 3)).toBe(false)
    expect(dateRangeMatches('December 24 - January 2', 6, 15)).toBe(false)
  })

  it('rejects malformed ranges', () => {
    expect(dateRangeMatches('October 15', 10, 15)).toBe(false)
    expect(dateRangeMatches('Foo 1 - Bar 2', 1, 1)).toBe(false)
  })
})

describe('dateHintMatches', () => {
  const june6Friday = { month: 6, day: 6, weekday: 5 }

  it('empty hints always match', () => {
    expect(dateHintMatches('', june6Friday)).toBe(true)
    expect(dateHintMatches(undefined, june6Friday)).toBe(true)
    expect(dateHintMatches(null, june6Friday)).toBe(true)
  })

  it('matches month names', () => {
    expect(dateHintMatches('June', june6Friday)).toBe(true)
    expect(dateHintMatches('october', june6Friday)).toBe(false)
  })

  it('matches quarters', () => {
    expect(dateHintMatches('Q2', june6Friday)).toBe(true)
    expect(dateHintMatches('Q4', june6Friday)).toBe(false)
  })

  it('matches weekdays', () => {
    expect(dateHintMatches('friday', june6Friday)).toBe(true)
    expect(dateHintMatches('monday', june6Friday)).toBe(false)
  })

  it('matches date ranges', () => {
    expect(dateHintMatches('June 1 - June 10', june6Friday)).toBe(true)
    expect(dateHintMatches('June 7 - June 10', june6Friday)).toBe(false)
  })

  it('unknown tokens never match', () => {
    expect(dateHintMatches('sometime', june6Friday)).toBe(false)
  })
})

describe('isValidDateHint', () => {
  it('accepts all supported formats and empty', () => {
    for (const hint of ['', 'October', 'q3', 'friday', 'October 15 - October 31', 'December 24 - January 2']) {
      expect(isValidDateHint(hint)).toBe(true)
    }
  })

  it('rejects invalid strings', () => {
    for (const hint of ['Octember', 'Q5', 'someday', 'October 15 -', 'April 31 - May 1x - June']) {
      expect(isValidDateHint(hint)).toBe(false)
    }
  })
})

describe('parseDayParts', () => {
  it('parses known tokens and drops junk', () => {
    expect(parseDayParts('morning, prime')).toEqual(['morning', 'prime'])
    expect(parseDayParts('MORNING')).toEqual(['morning'])
    expect(parseDayParts('brunch,daytime')).toEqual(['daytime'])
    expect(parseDayParts(null)).toEqual([])
  })
})

describe('filterPoolByHints', () => {
  const morningCtx = { minutesOfDay: 8 * 60, month: 6, day: 6 }
  const primeCtx = { minutesOfDay: 20 * 60, month: 6, day: 6 }
  const decemberCtx = { minutesOfDay: 8 * 60, month: 12, day: 20 }

  const plain = { id: 'plain', dayParts: null, dateRange: null, exclusive: false }
  const morningOnly = { id: 'morning', dayParts: 'morning', dateRange: null, exclusive: false }
  const xmas = { id: 'xmas', dayParts: null, dateRange: 'December 1 - December 26', exclusive: false }
  const xmasExclusive = { id: 'xmas-x', dayParts: null, dateRange: 'December 1 - December 26', exclusive: true }

  it('unhinted items are always eligible', () => {
    expect(filterPoolByHints([plain], primeCtx)).toEqual([plain])
  })

  it('day-part hinted items only match their window', () => {
    expect(filterPoolByHints([plain, morningOnly], morningCtx)).toEqual([plain, morningOnly])
    expect(filterPoolByHints([plain, morningOnly], primeCtx)).toEqual([plain])
  })

  it('date-range hinted items only match their calendar window', () => {
    expect(filterPoolByHints([plain, xmas], decemberCtx)).toEqual([plain, xmas])
    expect(filterPoolByHints([plain, xmas], morningCtx)).toEqual([plain])
  })

  it('a matching exclusive item takes over the pool', () => {
    expect(filterPoolByHints([plain, xmas, xmasExclusive], decemberCtx)).toEqual([xmasExclusive])
    // Outside its window the exclusive item is inert.
    expect(filterPoolByHints([plain, xmas, xmasExclusive], morningCtx)).toEqual([plain])
  })
})
