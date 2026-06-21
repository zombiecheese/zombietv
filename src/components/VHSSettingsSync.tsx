'use client'

// VHSSettingsSync
// Polls /api/vhs-settings every 30 seconds so that when an admin updates
// the VHS intensities, all connected clients pick up the change without
// needing a page reload.
//
// Renders nothing itself — it drives the VHSOverlay in the layout by
// updating a context that VHSOverlay subscribes to.
//
// Pattern: this is a "headless" sync component that lives in the layout tree.

import { createContext, useContext, useState, useEffect } from 'react'
import { DEFAULT_VHS_SETTINGS, type VHSSettings } from '@/lib/vhs-defaults'
import VHSOverlay from './VHSOverlay'

// ─── Context ─────────────────────────────────────────────────────────────────

export const VHSContext = createContext<VHSSettings>(DEFAULT_VHS_SETTINGS)
export const useVHSContext = () => useContext(VHSContext)

// ─── Sync component ──────────────────────────────────────────────────────────

interface Props {
  initialSettings: VHSSettings
}

export default function VHSSettingsSync({ initialSettings }: Props) {
  const [settings, setSettings] = useState<VHSSettings>(initialSettings)

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/vhs-settings')
        if (res.ok) {
          const data = await res.json()
          setSettings((prev) => ({ ...prev, ...data }))
        }
      } catch { /* keep current settings */ }
    }

    // Poll every 30 seconds — cheap, no WebSocket needed
    const interval = setInterval(poll, 30_000)
    return () => clearInterval(interval)
  }, [])

  // Render an updated VHSOverlay driven by the polled settings.
  // This replaces the static one rendered by the server layout.
  return (
    <VHSContext.Provider value={settings}>
      <VHSOverlay settings={settings} />
    </VHSContext.Provider>
  )
}
