/** Canvas rows run top-down; the existing atlas shader expects a flipped texture. */
export function copyAtlasTile(target: Uint8Array, rgba: Uint8ClampedArray, x: number, y: number, size: number, width: number, height: number) {
  for (let row = 0; row < size; row++) target.set(rgba.subarray(row * size * 4, (row + 1) * size * 4), ((height - 1 - y - row) * width + x) * 4);
}
