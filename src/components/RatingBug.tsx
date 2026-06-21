'use client'

// RatingBug
// Displays the Australian classification board rating in the corner of the
// screen, exactly as it appeared during 1990s Australian broadcast TV.
// Shown for 5 seconds at the start of a program, then fades out.

import { useEffect, useState } from 'react'

type Rating = 'G' | 'PG' | 'M' | 'MA15+' | 'AV' | 'R18+'

interface RatingConfig {
  bg:    string
  fg:    string
  label: string
}

const RATING_STYLES: Record<Rating, RatingConfig> = {
  'G':     { bg: '#006400', fg: '#ffffff', label: 'G'     },
  'PG':    { bg: '#00008b', fg: '#ffffff', label: 'PG'    },
  'M':     { bg: '#8b0000', fg: '#ffffff', label: 'M'     },
  'MA15+': { bg: '#8b0000', fg: '#ffffff', label: 'MA 15+'},
  'AV':    { bg: '#4b0082', fg: '#ffffff', label: 'AV'    },
  'R18+':  { bg: '#000000', fg: '#ff0000', label: 'R 18+' },
}

interface Props {
  rating:    string
  visible:   boolean
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
}

export default function RatingBug({
  rating,
  visible,
  position = 'top-right',
}: Props) {
  const [opacity, setOpacity] = useState(0)

  const normalized = rating?.toUpperCase() as Rating
  const config     = RATING_STYLES[normalized] ?? RATING_STYLES['PG']

  useEffect(() => {
    if (visible) {
      setOpacity(1)
      // Fade out after 5 seconds
      const t = setTimeout(() => setOpacity(0), 5_000)
      return () => clearTimeout(t)
    } else {
      setOpacity(0)
    }
  }, [visible, rating])

  const posStyles: Record<string, React.CSSProperties> = {
    'top-left':     { top: 16, left: 16 },
    'top-right':    { top: 16, right: 16 },
    'bottom-left':  { bottom: 16, left: 16 },
    'bottom-right': { bottom: 16, right: 16 },
  }

  return (
    <div
      style={{
        position:   'absolute',
        ...posStyles[position],
        opacity,
        transition: 'opacity 0.8s ease',
        zIndex:     50,
        display:    'flex',
        flexDirection: 'column',
        alignItems: 'center',
        pointerEvents: 'none',
      }}
    >
      {/* Main rating box */}
      <div
        style={{
          backgroundColor: config.bg,
          color:           config.fg,
          fontFamily:      'Arial Black, Arial, sans-serif',
          fontWeight:      900,
          fontSize:        '1.4rem',
          letterSpacing:   '0.05em',
          padding:         '6px 12px',
          border:          `3px solid ${config.fg}`,
          minWidth:        '56px',
          textAlign:       'center',
          lineHeight:      1,
        }}
      >
        {config.label}
      </div>
      {/* Classification board label */}
      <div
        style={{
          backgroundColor: '#000',
          color:           '#fff',
          fontFamily:      'Arial, sans-serif',
          fontSize:        '0.45rem',
          letterSpacing:   '0.15em',
          padding:         '2px 6px',
          textAlign:       'center',
          borderTop:       'none',
          border:          '1px solid #555',
        }}
      >
        CLASSIFICATION
      </div>
    </div>
  )
}
