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

  return (
    <>
      {!isAdminRoute && <VHSSettingsSync initialSettings={settings} />}

      <div
        style={{
          position: 'relative',
          width: '100vw',
          height: '100vh',
          overflow: 'hidden',
          filter: curvature > 0 ? 'url(#crt-barrel)' : undefined,
        }}
      >
        {children}
      </div>
    </>
  )
}
