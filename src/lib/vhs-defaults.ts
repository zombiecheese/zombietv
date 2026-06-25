// Shared VHS settings defaults — no 'use client' directive.
// Imported by both the server layout and the client useVHSSettings hook.

export interface VHSSettings {
  scanlines:           number
  noise:               number
  chromaticAberration: number
  vignette:            number
  crtCurvature:        number
  flicker:             number
  ghosting:            number
  trackingNoise:       number
  horizontalJitter:    number
  syncWobbleJumpsEnabled: boolean
  overscanSoftnessEnabled: boolean
  debugOverlayEnabled: boolean
}

export const DEFAULT_VHS_SETTINGS: VHSSettings = {
  scanlines:           0.5,
  noise:               0.3,
  chromaticAberration: 0.4,
  vignette:            0.5,
  crtCurvature:        0.4,
  flicker:             0.3,
  ghosting:            0.35,
  trackingNoise:       0.25,
  horizontalJitter:    0.2,
  syncWobbleJumpsEnabled: true,
  overscanSoftnessEnabled: true,
  debugOverlayEnabled: false,
}
