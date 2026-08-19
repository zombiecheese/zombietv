'use client'

import { usePathname } from 'next/navigation'
import type { VHSSettings } from '@/lib/vhs-defaults'
import VHSOverlay from '@/components/VHSOverlay'
import VHSSettingsSync from '@/components/VHSSettingsSync'

interface Props {
  settings: VHSSettings
  children: React.ReactNode
}

export default function RouteVisualEffects({ settings, children }: Props) {
  const pathname = usePathname() ?? ''
  const isAdminRoute = pathname.startsWith('/admin')
  const curvature = isAdminRoute ? 0 : settings.crtCurvature
  const filterActive = !isAdminRoute && (
    settings.crtCurvature > 0
    || settings.chromaticAberration > 0
    || settings.overscanSoftnessEnabled
  )

  return (
    <>
      {!isAdminRoute && <VHSSettingsSync initialSettings={settings} />}

      <div
        style={{
          position: 'relative',
          width: '100vw',
          height: '100vh',
          overflow: 'hidden',
          filter: filterActive ? 'url(#crt-composite)' : undefined,
          // Tube geometry: rounded glass corners on the picture itself
          borderRadius: curvature > 0 ? `${(curvature * 2.2).toFixed(1)}vmin / ${(curvature * 2.8).toFixed(1)}vmin` : undefined,
        }}
      >
        {children}
      </div>
    </>
  )
}
