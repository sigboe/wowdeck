/**
 * QR codes made at runtime with `uqr`, because the URLs come from fetched
 * data (ADR-0005). The shared QrCode component (components/QrCode.tsx)
 * draws this; Support WoWDeck uses it, and so can any later screen that
 * hands the player a URL for their phone.
 */

import { encode } from "uqr";

export interface QrCodeShape {
  /** Width and height in modules, the border included. */
  size: number;
  /** SVG path data drawing every dark module, one unit per module. */
  path: string;
}

/**
 * The code for `text`. Medium error correction survives a phone camera
 * reading a screen at an angle; the one-module border is the quiet zone,
 * and the component pads it with a light background.
 */
export function qrCode(text: string): QrCodeShape {
  const { size, data } = encode(text, { ecc: "M", border: 1 });
  let path = "";
  data.forEach((row, y) => {
    let x = 0;
    while (x < size) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < size && row[x]) x += 1;
      // One rectangle per horizontal run of dark modules.
      path += `M${start} ${y}h${x - start}v1h-${x - start}z`;
    }
  });
  return { size, path };
}
