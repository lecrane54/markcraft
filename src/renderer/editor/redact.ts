/**
 * Pixelation that holds up against unpixelation tools.
 *
 * Tools like Depix recover pixelated text by rendering candidate characters,
 * pixelating them the same way, and matching block colours. Two things defeat
 * that: blocks that span whole characters (so many strings map to the same
 * colours), and random per-block noise (so colours never match exactly).
 */

export interface Pixels {
  width: number
  height: number
  data: Uint8ClampedArray // RGBA
}

/** Brightness noise added to each block's average, in 0–255 units. */
export const NOISE = 14

/**
 * Block size for a region: about half the region's short side, so a line of
 * text becomes at most a couple of rows of blocks. Clamped so tiny regions
 * still get chunky blocks and large ones don't turn into a single colour.
 */
export function blockSize(width: number, height: number): number {
  return Math.min(64, Math.max(12, Math.round(Math.min(width, height) / 2)))
}

/** Replace every block with its exact average colour plus random noise. */
export function pixelate(src: Pixels, block: number, random: () => number = Math.random): Pixels {
  const { width, height, data } = src
  const out = new Uint8ClampedArray(data.length)
  for (let by = 0; by < height; by += block) {
    for (let bx = 0; bx < width; bx += block) {
      const x1 = Math.min(width, bx + block)
      const y1 = Math.min(height, by + block)
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let y = by; y < y1; y++) {
        for (let x = bx; x < x1; x++) {
          const i = (y * width + x) * 4
          r += data[i]
          g += data[i + 1]
          b += data[i + 2]
          n++
        }
      }
      // One brightness offset per block: as effective against matching as
      // per-channel noise, without tinting the blocks random colours.
      const jitter = (random() * 2 - 1) * NOISE
      const fill = [r / n + jitter, g / n + jitter, b / n + jitter, 255]
      for (let y = by; y < y1; y++) {
        for (let x = bx; x < x1; x++) out.set(fill, (y * width + x) * 4)
      }
    }
  }
  return { width, height, data: out }
}
