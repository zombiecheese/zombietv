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
  const chroma      = vhsSettings.chromaticAberration
  // RGB convergence error (px) and chroma bandwidth smear driven by the
  // chromatic aberration knob; luma softness by the overscan toggle.
  const convergencePx = (chroma * 1.1).toFixed(2)
  const chromaBlur    = (chroma * 1.3).toFixed(2)
  const lumaBlur      = vhsSettings.overscanSoftnessEnabled ? '0.42 0.12' : '0 0'

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

        {/* Composite CRT filter chain — referenced by the viewport wrapper.
            Stages: RGB convergence split + chroma smear (colour bleed),
            luma bandwidth softness, then barrel displacement. */}
        <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }} aria-hidden="true">
          <defs>
            <filter id="crt-composite" colorInterpolationFilters="sRGB">
              {/* Split the picture into R / G / B planes */}
              <feColorMatrix in="SourceGraphic" type="matrix"
                values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red" />
              <feColorMatrix in="SourceGraphic" type="matrix"
                values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green" />
              <feColorMatrix in="SourceGraphic" type="matrix"
                values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue" />
              {/* Misconverge red right / blue left, smear chroma horizontally
                  (NTSC chroma bandwidth is far below luma bandwidth) */}
              <feOffset in="red" dx={convergencePx} dy="0" result="redShift" />
              <feGaussianBlur in="redShift" stdDeviation={`${chromaBlur} 0`} result="redSmear" />
              <feOffset in="blue" dx={`-${convergencePx}`} dy="0" result="blueShift" />
              <feGaussianBlur in="blueShift" stdDeviation={`${chromaBlur} 0`} result="blueSmear" />
              {/* Recombine planes additively */}
              <feComposite in="redSmear" in2="green" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="rg" />
              <feComposite in="rg" in2="blueSmear" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="recombined" />
              {/* Analog bandwidth: soften horizontally more than vertically */}
              <feGaussianBlur in="recombined" stdDeviation={lumaBlur} result="soft" />
              {/* Tube geometry: smooth low-frequency displacement */}
              <feTurbulence
                type="fractalNoise"
                baseFrequency={`${0.0007 * curvature}`}
                numOctaves="1"
                result="warpNoise"
              />
              <feDisplacementMap
                in="soft"
                in2="warpNoise"
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
