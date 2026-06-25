'use client'

// useVHSSettings
// Fetches VHS/CRT effect intensities from /api/vhs-settings.
// Falls back to sensible defaults if the API is unavailable.
// Admins can update these values; non-admin clients just read them.

import { useState, useEffect } from 'react'
import { DEFAULT_VHS_SETTINGS, type VHSSettings } from '@/lib/vhs-defaults'

// Re-export so consumers can import from one place.
export type { VHSSettings } from '@/lib/vhs-defaults'
export { DEFAULT_VHS_SETTINGS } from '@/lib/vhs-defaults'

export function useVHSSettings(): {
  settings: VHSSettings
  isLoading: boolean
} {
  const [settings, setSettings] = useState<VHSSettings>(DEFAULT_VHS_SETTINGS)
  const [isLoading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/vhs-settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setSettings({ ...DEFAULT_VHS_SETTINGS, ...data })
      })
      .catch(() => { /* keep defaults */ })
      .finally(() => setLoading(false))
  }, [])

  return { settings, isLoading }
}
