// Shared 1990s TV on-screen-display styling.
// Blocky "VCR OSD" look built from system monospace: heavy weight, hard black
// outline (no soft shadows), no anti-aliased subtlety.

import type React from 'react'

export const OSD_FONT_FAMILY = '"VCR OSD Mono", "Px437 IBM VGA8", "Courier New", "Lucida Console", monospace'

export const OSD_GREEN = '#33ff33'
export const OSD_WHITE = '#f2f2f2'

// Hard 4-direction outline — reads as bitmap text on any background.
export function osdOutline(px = 2, colour = '#000'): string {
  return [
    `${px}px 0 0 ${colour}`,
    `-${px}px 0 0 ${colour}`,
    `0 ${px}px 0 ${colour}`,
    `0 -${px}px 0 ${colour}`,
    `${px}px ${px}px 0 ${colour}`,
    `-${px}px ${px}px 0 ${colour}`,
    `${px}px -${px}px 0 ${colour}`,
    `-${px}px -${px}px 0 ${colour}`,
  ].join(', ')
}

export const osdTextStyle: React.CSSProperties = {
  fontFamily: OSD_FONT_FAMILY,
  fontWeight: 700,
  color: OSD_GREEN,
  textShadow: osdOutline(2),
  letterSpacing: '0.08em',
  lineHeight: 1,
  userSelect: 'none',
}
