// Structural validation for the Station.rules JSON blob at the API boundary.
// The scheduler parses rules permissively (fallbacks everywhere), which means
// malformed config silently degrades generation. Validating on save surfaces
// mistakes to the admin instead.

import { parseClockToMinutes } from './time'
import { isValidDateHint } from './date-hints'

const CHANNEL_TYPES = ['standard', 'weather', 'guide', 'loop', 'stream', 'web']
const BREAK_STRATEGIES = ['', 'standard', 'center', 'end']
const INCREMENTS = ['', '0', '5', '10', '15', '20', '30', '60']

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validateSlotList(list: unknown, label: string, errors: string[]): void {
  if (list == null) return
  if (!Array.isArray(list)) {
    errors.push(`${label} must be an array of slots`)
    return
  }
  list.forEach((slot, i) => {
    if (!isRecord(slot)) {
      errors.push(`${label}[${i}] must be an object`)
      return
    }
    const where = `${label}[${i}] (${String(slot.name ?? slot.key ?? i)})`

    const start = String(slot.start ?? '')
    if (start && start !== 'first' && parseClockToMinutes(start) == null) {
      errors.push(`${where}: start "${start}" is not HH:MM`)
    }
    const end = String(slot.end ?? '')
    if (end && end !== 'until_finished' && parseClockToMinutes(end) == null) {
      errors.push(`${where}: end "${end}" is not HH:MM`)
    }

    const strategy = slot.breakStrategy
    if (strategy != null && !BREAK_STRATEGIES.includes(String(strategy).toLowerCase())) {
      errors.push(`${where}: breakStrategy must be one of standard/center/end`)
    }

    const inc = slot.scheduleIncrement
    if (inc != null && inc !== '' && !INCREMENTS.includes(String(inc))) {
      errors.push(`${where}: scheduleIncrement must be one of 0/5/10/15/20/30/60`)
    }

    const marathon = slot.marathon
    if (marathon != null) {
      if (!isRecord(marathon)) {
        errors.push(`${where}: marathon must be an object`)
      } else {
        const chance = Number(marathon.chance)
        const count = Number(marathon.count)
        if (!Number.isFinite(chance) || chance <= 0 || chance > 1) {
          errors.push(`${where}: marathon.chance must be between 0 and 1`)
        }
        if (!Number.isFinite(count) || count < 1 || count > 12) {
          errors.push(`${where}: marathon.count must be 1–12 hours`)
        }
        const hint = String(marathon.hint ?? '')
        if (hint && !isValidDateHint(hint)) {
          errors.push(`${where}: marathon.hint "${hint}" is not a valid date hint`)
        }
      }
    }

    const windows = slot.fillerWindows
    if (windows != null) {
      if (!Array.isArray(windows)) {
        errors.push(`${where}: fillerWindows must be an array`)
      } else {
        windows.forEach((w, wi) => {
          if (!isRecord(w)) return
          const dur = Number(w.durationMins)
          if (!Number.isFinite(dur) || dur < 1) {
            errors.push(`${where}: fillerWindows[${wi}] durationMins must be >= 1`)
          }
          const seqStart = w.sequenceStart
          const seqEnd = w.sequenceEnd
          if (seqStart != null && (!Number.isFinite(Number(seqStart)) || Number(seqStart) < 0 || Number(seqStart) > 1)) {
            errors.push(`${where}: fillerWindows[${wi}] sequenceStart must be 0–1`)
          }
          if (seqEnd != null && (!Number.isFinite(Number(seqEnd)) || Number(seqEnd) < 0 || Number(seqEnd) > 1)) {
            errors.push(`${where}: fillerWindows[${wi}] sequenceEnd must be 0–1`)
          }
          if (seqStart != null && seqEnd != null && Number(seqEnd) <= Number(seqStart)) {
            errors.push(`${where}: fillerWindows[${wi}] sequenceEnd must be greater than sequenceStart`)
          }
        })
      }
    }
  })
}

// Returns a list of human-readable problems; empty = valid.
export function validateStationRules(rules: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(rules)) return ['rules must be an object']

  const channelType = String(rules.channel_type ?? 'standard').trim().toLowerCase() || 'standard'
  if (!CHANNEL_TYPES.includes(channelType)) {
    errors.push(`channel_type "${channelType}" must be one of ${CHANNEL_TYPES.join('/')}`)
  }

  if (channelType === 'weather') {
    const w = rules.weather
    if (!isRecord(w)) {
      errors.push('weather channel requires a weather config (latitude/longitude)')
    } else {
      const lat = Number(w.latitude)
      const lon = Number(w.longitude)
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.push('weather.latitude must be a number between -90 and 90')
      if (!Number.isFinite(lon) || lon < -180 || lon > 180) errors.push('weather.longitude must be a number between -180 and 180')
    }
  }

  if (channelType === 'stream' || channelType === 'web') {
    const cfg = rules[channelType]
    const url = isRecord(cfg) ? String(cfg.url ?? '').trim() : ''
    if (!url || !/^https?:\/\//i.test(url)) {
      errors.push(`${channelType} channel requires an http(s) url`)
    }
  }

  if (channelType === 'loop') {
    const cfg = rules.loop
    if (!isRecord(cfg) || !String(cfg.contentId ?? '').trim()) {
      errors.push('loop channel requires loop.contentId (YouTube video or playlist ID)')
    }
  }

  const ad = rules.ad_policy
  if (ad != null) {
    if (!isRecord(ad)) {
      errors.push('ad_policy must be an object')
    } else {
      for (const key of ['break_interval_tv', 'break_interval_movie'] as const) {
        const v = ad[key]
        if (v != null && (!Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 240)) {
          errors.push(`ad_policy.${key} must be 0–240 minutes`)
        }
      }
    }
  }

  const offset = rules.schedule_offset
  if (offset != null && (!Number.isFinite(Number(offset)) || Number(offset) < 0 || Number(offset) > 29)) {
    errors.push('schedule_offset must be 0–29 minutes')
  }

  const slotConfig = rules.slot_config
  if (slotConfig != null) {
    if (!isRecord(slotConfig)) {
      errors.push('slot_config must be an object with weekday/weekend arrays')
    } else {
      validateSlotList(slotConfig.weekday, 'slot_config.weekday', errors)
      validateSlotList(slotConfig.weekend, 'slot_config.weekend', errors)
    }
  }

  const overrides = rules.date_overrides
  if (overrides != null) {
    if (!Array.isArray(overrides)) {
      errors.push('date_overrides must be an array')
    } else {
      overrides.forEach((entry, i) => {
        if (!isRecord(entry)) {
          errors.push(`date_overrides[${i}] must be an object`)
          return
        }
        const dates = String(entry.dates ?? '').trim()
        if (!dates) errors.push(`date_overrides[${i}]: dates is required`)
        else if (!isValidDateHint(dates)) errors.push(`date_overrides[${i}]: dates "${dates}" is not a valid date/range/month/quarter/weekday`)
        const dayType = String(entry.dayType ?? '').trim().toLowerCase()
        if (dayType && dayType !== 'weekday' && dayType !== 'weekend') {
          errors.push(`date_overrides[${i}]: dayType must be blank, "weekday" or "weekend"`)
        }
        if (entry.slots != null) validateSlotList(entry.slots, `date_overrides[${i}].slots`, errors)
      })
    }
  }

  const presets = rules.slot_presets
  if (presets != null) {
    if (!isRecord(presets)) {
      errors.push('slot_presets must be an object mapping preset names to slot settings')
    } else {
      for (const [name, preset] of Object.entries(presets)) {
        if (!isRecord(preset)) errors.push(`slot_presets.${name} must be an object`)
      }
    }
  }

  return errors
}
