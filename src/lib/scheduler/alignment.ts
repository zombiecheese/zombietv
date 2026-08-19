// Slot end alignment — pure scheduler core, unit-testable.
//
// Default boundaries are the hour/half-hour. A station-wide schedule_offset
// shifts boundaries (e.g. offset 5 → :05/:35 showtimes), and a per-slot
// increment tightens or loosens padding (0 = continuous, no padding).

import { addMinutes, differenceInMinutes } from 'date-fns'

export function alignEndTime(date: Date, incrementMins = 30, offsetMins = 0): Date {
  if (incrementMins <= 0) return date
  const inc = Math.max(1, Math.round(incrementMins))
  const off = ((Math.round(offsetMins) % inc) + inc) % inc
  const mins = date.getMinutes()
  const rel = mins - off
  const steps = Math.max(0, Math.ceil(rel / inc))
  let target = off + steps * inc
  if (target < mins) target += inc
  return addMinutes(date, target - mins)
}

export function resolveWindowAlignedEnd(
  slotEnd: Date,
  windowEnd: Date,
  incrementMins = 30,
  offsetMins = 0,
): { effectiveEnd: Date; fillerMins: number } {
  const aligned = alignEndTime(slotEnd, incrementMins, offsetMins)
  const effectiveEnd = aligned.getTime() > windowEnd.getTime() ? windowEnd : aligned
  return {
    effectiveEnd,
    fillerMins: Math.max(0, differenceInMinutes(effectiveEnd, slotEnd)),
  }
}

// Restricts an episode order snapshot to a fractional range (sequence_start /
// sequence_end, both 0.0–1.0). Returns at least one episode when non-empty.
export function applySequenceRange<T>(list: T[], start?: number, end?: number): T[] {
  if (!list.length) return list
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
  const s = clamp01(Number.isFinite(Number(start)) ? Number(start) : 0)
  const e = clamp01(Number.isFinite(Number(end)) ? Number(end) : 1)
  if (s <= 0 && e >= 1) return list
  if (e <= s) return list
  const from = Math.min(list.length - 1, Math.floor(s * list.length))
  const to = Math.max(from + 1, Math.ceil(e * list.length))
  return list.slice(from, to)
}
