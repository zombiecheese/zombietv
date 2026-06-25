'use client'

// ChannelChange
// Renders the full-screen static burst that fires when the user switches
// between stations — just like pressing the channel button on a 1990s TV.
//
// Usage: mount it always; pass `active` prop to trigger the animation.
// It fires a CSS animation then calls onComplete when done.

import { useEffect, useRef } from 'react'

interface Props {
  active:     boolean
  onComplete: () => void
}

const STATIC_DURATION_MS = 600

export default function ChannelChange({ active, onComplete }: Props) {
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

    function drawFrame(now: number) {
      const elapsed  = now - startRef.current
      const progress = Math.min(elapsed / STATIC_DURATION_MS, 1)

      // Fill with random noise pixels
      const imageData = ctx!.createImageData(canvas!.width, canvas!.height)
      const data      = imageData.data

      for (let i = 0; i < data.length; i += 4) {
        const v   = Math.random() > 0.5 ? 255 : 0
        const mix = Math.random()
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
  }, [active, onComplete])

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
