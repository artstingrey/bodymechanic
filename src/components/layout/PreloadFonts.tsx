'use client';

import { preload } from 'react-dom';

export function PreloadFonts({ landing = false }: { landing?: boolean }) {
  const fonts = landing ? ['Manrope-400', 'Manrope-600', 'Manrope-700', 'Manrope-800'] : ['Manrope'];
  for (const font of fonts) {
    preload(`/fonts/v1/${font}.woff2`, {
      as: 'font',
      type: 'font/woff2',
      crossOrigin: 'anonymous',
      fetchPriority: landing ? 'low' : 'auto',
    });
  }
  return null;
}
