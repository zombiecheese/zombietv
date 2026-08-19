// Shared VHS settings defaults — no 'use client' directive.
// Imported by both the server layout and the client useVHSSettings hook.

export type OffAirStyle = 'testcard' | 'bluescreen' | 'static'

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
  // Era-authenticity extras
  fourByThreeEnabled:       boolean   // pillarbox the picture into a 4:3 tube
  compositeArtifactsEnabled: boolean  // dot crawl + chroma bleed
  phosphorBloomEnabled:     boolean   // bright-area glow
  shadowMaskEnabled:        boolean   // RGB phosphor triad stripe pattern
  tvSpeakerAudioEnabled:    boolean   // mono band-passed "3-inch speaker" audio
  channelChangeSoundEnabled: boolean  // click + static blip when tuning
  offAirStyle:              OffAirStyle // dead-channel look
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
  fourByThreeEnabled:       false,
  compositeArtifactsEnabled: true,
  phosphorBloomEnabled:     true,
  shadowMaskEnabled:        true,
  tvSpeakerAudioEnabled:    false,
  channelChangeSoundEnabled: true,
  offAirStyle:              'testcard',
}
