// Root layout
// Fetches VHS settings server-side and applies route-aware visual effects.

import { DEFAULT_VHS_SETTINGS, type VHSSettings } from '@/lib/vhs-defaults'
import RouteVisualEffects from '@/components/RouteVisualEffects'

async function getVHSSettings(): Promise<VHSSettings> {
  try {
    // Absolute URL required for server-side fetch in Next.js
    const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
    // Next.js extends the native fetch with a `next` option for ISR revalidation.
    // lib.dom.d.ts does not know about it, so we cast the options object.
    const fetchOpts = { next: { revalidate: 60 } } as RequestInit
    const res  = await fetch(`${base}/api/vhs-settings`, fetchOpts)
    if (!res.ok) return DEFAULT_VHS_SETTINGS
    return { ...DEFAULT_VHS_SETTINGS, ...(await res.json()) }
  } catch {
    return DEFAULT_VHS_SETTINGS
  }
}

export const metadata = {
  title:       'Zombie TV — 1990s Australian Broadcast Simulator',
  description: 'Watch 24/7 era-accurate 1990s Australian television.',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const vhsSettings = await getVHSSettings()
  const curvature   = vhsSettings.crtCurvature

  return (
    <html lang="en">
      <head>
        {/* Blocking CSS to prevent white flash before React hydration */}
        <style dangerouslySetInnerHTML={{__html: 'html,body{margin:0;padding:0;background-color:#000;overflow:hidden}'}} />
      </head>
      <body style={{
        margin:          0,
        padding:         0,
        overflow:        'hidden',
        backgroundColor: '#000',
      }}>

        {/* SVG filter for CRT barrel distortion — referenced by body filter */}
        <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }} aria-hidden="true">
          <defs>
            <filter id="crt-barrel">
              <feTurbulence
                type="fractalNoise"
                baseFrequency={`${0.0005 * curvature}`}
                numOctaves="1"
                result="noise"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="noise"
                scale={`${curvature * 8}`}
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          </defs>
        </svg>

        <RouteVisualEffects settings={vhsSettings}>
          {children}
        </RouteVisualEffects>

      </body>
    </html>
  )
}
