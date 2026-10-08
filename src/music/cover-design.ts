export const coverFrame = { width: 4.76, height: 3.46, centerY: 1.85, depth: .12 };
export type CoverColor = [number, number, number];
export const placeholderColor: CoverColor = [216 / 255, 208 / 255, 196 / 255];

/** Quantized dominant region, rather than averaging unrelated foreground colors. */
export function dominantCoverColor(pixels: ArrayLike<number>): CoverColor {
  const bins = new Map<number, { weight: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255; if (alpha < .1) continue;
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(1, r, g, b);
    const weight = alpha * (.75 + .25 * saturation);
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
    const bin = bins.get(key) ?? { weight: 0, r: 0, g: 0, b: 0 };
    bin.weight += weight; bin.r += r * weight; bin.g += g * weight; bin.b += b * weight;
    bins.set(key, bin);
  }
  let winner: ReturnType<typeof bins.get>;
  for (const bin of bins.values()) if (!winner || bin.weight > winner.weight) winner = bin;
  return winner ? [winner.r / winner.weight / 255, winner.g / winner.weight / 255, winner.b / winner.weight / 255] : [...placeholderColor];
}

export function coverCrop(width: number, height: number) {
  const ratio = coverFrame.width / coverFrame.height;
  const cropWidth = Math.min(width, height * ratio), cropHeight = cropWidth / ratio;
  return { x: (width - cropWidth) / 2, y: (height - cropHeight) / 2, width: cropWidth, height: cropHeight };
}
