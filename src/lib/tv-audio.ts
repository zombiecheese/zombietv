'use client'

// TV audio helpers.
//  - playTuneBlip(): the click + brief static hiss of an analog tuner changing
//    channel (generated with WebAudio — no audio assets needed).
//  - attachTvSpeaker(video): routes an HTML video element through a mono,
//    band-passed, gently compressed chain that sounds like a 3-inch TV
//    speaker. Idempotent per element; toggleable via setTvSpeakerEnabled.

let audioCtx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
    return audioCtx
  } catch {
    return null
  }
}

// Click + 120ms band-passed static burst.
export function playTuneBlip(): void {
  const ctx = getCtx()
  if (!ctx) return
  const now = ctx.currentTime

  // Mechanical click
  const osc = ctx.createOscillator()
  osc.type = 'square'
  osc.frequency.value = 1800
  const clickGain = ctx.createGain()
  clickGain.gain.setValueAtTime(0.06, now)
  clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03)
  osc.connect(clickGain).connect(ctx.destination)
  osc.start(now)
  osc.stop(now + 0.04)

  // Static hiss burst
  const durationSecs = 0.12
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * durationSecs), ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1)
  const noise = ctx.createBufferSource()
  noise.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 2800
  filter.Q.value = 0.6
  const noiseGain = ctx.createGain()
  noiseGain.gain.setValueAtTime(0.05, now)
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + durationSecs)
  noise.connect(filter).connect(noiseGain).connect(ctx.destination)
  noise.start(now)
}

// ── TV speaker chain ─────────────────────────────────────────────────────────

interface SpeakerChain {
  dry: GainNode      // bypass path
  wet: GainNode      // speaker-emulation path
}

const chains = new WeakMap<HTMLMediaElement, SpeakerChain>()
let speakerEnabled = false

export function setTvSpeakerEnabled(enabled: boolean): void {
  speakerEnabled = enabled
  // Update every known chain (WeakMap has no iteration — track via registry).
  for (const chain of chainRegistry) {
    applyChainState(chain)
  }
}

const chainRegistry = new Set<SpeakerChain>()

function applyChainState(chain: SpeakerChain): void {
  chain.wet.gain.value = speakerEnabled ? 1 : 0
  chain.dry.gain.value = speakerEnabled ? 0 : 1
}

// Attach (once) a switchable speaker-emulation chain to a media element.
// Safe to call repeatedly; subsequent calls only sync the enabled state.
export function attachTvSpeaker(video: HTMLMediaElement): void {
  const ctx = getCtx()
  if (!ctx) return

  const existing = chains.get(video)
  if (existing) {
    applyChainState(existing)
    return
  }

  try {
    const source = ctx.createMediaElementSource(video)

    // Bypass path
    const dry = ctx.createGain()

    // Speaker path: mono → band-pass → gentle compression
    const wet = ctx.createGain()
    const mono = ctx.createGain()
    mono.channelCount = 1
    mono.channelCountMode = 'explicit'
    mono.channelInterpretation = 'speakers'
    const highpass = ctx.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = 110
    const lowpass = ctx.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = 7800
    const presence = ctx.createBiquadFilter()
    presence.type = 'peaking'
    presence.frequency.value = 2200
    presence.gain.value = 3
    presence.Q.value = 0.9
    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -22
    compressor.ratio.value = 3.5
    compressor.attack.value = 0.004
    compressor.release.value = 0.18

    source.connect(dry).connect(ctx.destination)
    source.connect(mono)
    mono.connect(highpass).connect(lowpass).connect(presence).connect(compressor).connect(wet).connect(ctx.destination)

    const chain: SpeakerChain = { dry, wet }
    chains.set(video, chain)
    chainRegistry.add(chain)
    applyChainState(chain)
  } catch {
    // Element already has a source from another context or CORS-restricted —
    // audio keeps playing through the default path.
  }
}
