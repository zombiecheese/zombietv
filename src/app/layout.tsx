// Root layout
// Fetches VHS settings server-side and applies route-aware visual effects.

import { DEFAULT_VHS_SETTINGS, type VHSSettings } from '@/lib/vhs-defaults'
import RouteVisualEffects from '@/components/RouteVisualEffects'
import { getAppName, getAppTagline } from '@/lib/app-settings'
import { getGlobalVHSSettings } from '@/lib/vhs-settings'

// Metadata and VHS settings are read from the database at request time.
// Forcing dynamic rendering prevents Next.js from querying the DB during
// `next build` (which has no database available in CI/container builds).
export const dynamic = 'force-dynamic'

async function getVHSSettings(): Promise<VHSSettings> {
  try {
    return await getGlobalVHSSettings()
  } catch {
    return DEFAULT_VHS_SETTINGS
  }
}

export async function generateMetadata() {
  const [name, tagline] = await Promise.all([getAppName(), getAppTagline()])
  return {
    title:       tagline ? `${name} — ${tagline}` : name,
    description: 'Watch 24/7 era-accurate 1990s television.',
  }
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
                baseFrequency={`${0.0007 * curvature}`}
                numOctaves="1"
                result="noise"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="noise"
                scale={`${curvature * 12}`}
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
