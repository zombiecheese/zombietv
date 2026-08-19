'use client'

// ChannelChange
// Analog tuning transition between channels.
//   mode 'roll'   — quick vertical sync tear / picture roll with black frames
//                   (the authentic look when switching between live channels)
//   mode 'static' — full static burst (tuning into a dead channel)
//
// Usage: mount it always; pass `active` prop to trigger the animation.
// It fires a canvas animation then calls onComplete when done.

import { useEffect, useRef } from 'react'

interface Props {
  active:     boolean
  onComplete: () => void
  mode?:      'roll' | 'static'
}

const STATIC_DURATION_MS = 600
const ROLL_DURATION_MS = 380

export default function ChannelChange({ active, onComplete, mode = 'roll' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef    = useRef<number>(0)
  const startRef  = useRef<number>(0)

  useEffect(() => {
    if (!active) return

    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width  = window.innerWidth
    canvas.height = window.innerHeight
    startRef.current = performance.now()
    const duration = mode === 'static' ? STATIC_DURATION_MS : ROLL_DURATION_MS

    function drawStaticFrame(progress: number) {
      // Fill with random noise pixels
      const imageData = ctx!.createImageData(canvas!.width, canvas!.height)
      const data      = imageData.data

      for (let i = 0; i < data.length; i += 4) {
        const v   = Math.random() > 0.5 ? 255 : 0
        // Mix static (early) → fade to black (late)
        const alpha = 255 * (1 - progress)
        data[i]     = v * (1 - progress)
        data[i + 1] = v * (1 - progress)
        data[i + 2] = v * (1 - progress)
        data[i + 3] = alpha
      }

      ctx!.putImageData(imageData, 0, 0)

      // Horizontal scan band
      const bandY = (progress * canvas!.height * 2) % canvas!.height
      ctx!.fillStyle = `rgba(255,255,255,${0.3 * (1 - progress)})`
      ctx!.fillRect(0, bandY - 4, canvas!.width, 8)
    }

    function drawRollFrame(progress: number) {
      const w = canvas!.width
      const h = canvas!.height

      // A couple of frames of true black at the cut, then the tear resolves.
      const blackAlpha = progress < 0.25 ? 1 : Math.max(0, 1 - (progress - 0.25) / 0.5)
      ctx!.clearRect(0, 0, w, h)
      ctx!.fillStyle = `rgba(0,0,0,${blackAlpha.toFixed(3)})`
      ctx!.fillRect(0, 0, w, h)

      // Rolling sync tear bands sweeping down the frame.
      const fade = 1 - progress
      for (let band = 0; band < 3; band++) {
        const y = ((progress * 1.6 + band * 0.33) % 1) * h
        const bandHeight = 6 + band * 10

        // Displaced-picture band: noisy grey smear
        ctx!.fillStyle = `rgba(160,170,185,${(0.16 * fade).toFixed(3)})`
        ctx!.fillRect(0, y, w, bandHeight)

        // Bright tear edge
        ctx!.fillStyle = `rgba(255,255,255,${(0.35 * fade).toFixed(3)})`
        ctx!.fillRect(0, y, w, 2)

        // Horizontal displacement streaks inside the band
        for (let s = 0; s < 6; s++) {
          const sy = y + Math.random() * bandHeight
          const sw = w * (0.2 + Math.random() * 0.6)
          const sx = Math.random() * (w - sw)
          ctx!.fillStyle = `rgba(220,225,235,${(0.12 * fade * Math.random()).toFixed(3)})`
          ctx!.fillRect(sx, sy, sw, 1)
        }
      }

      // Sparse noise rows for the first half.
      if (progress < 0.55) {
        const rows = Math.floor(14 * (1 - progress / 0.55))
        for (let r = 0; r < rows; r++) {
          const y = Math.random() * h
          ctx!.fillStyle = `rgba(255,255,255,${(0.05 + Math.random() * 0.1).toFixed(3)})`
          ctx!.fillRect(0, y, w, 1)
        }
      }
    }

    function drawFrame(now: number) {
      const elapsed  = now - startRef.current
      const progress = Math.min(elapsed / duration, 1)

      if (mode === 'static') drawStaticFrame(progress)
      else drawRollFrame(progress)

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(drawFrame)
      } else {
        ctx!.clearRect(0, 0, canvas!.width, canvas!.height)
        onComplete()
      }
    }

    rafRef.current = requestAnimationFrame(drawFrame)

    return () => {
      cancelAnimationFrame(rafRef.current)
    }
  }, [active, onComplete, mode])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position:      'fixed',
        inset:         0,
        zIndex:        9998,
        pointerEvents: 'none',
        display:       active ? 'block' : 'none',
      }}
    />
  )
}
