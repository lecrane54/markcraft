/**
 * Stitches successive frames of a scrolling area into one tall image.
 *
 * Each frame is reduced to a per-row signature (mean grey level in vertical
 * bands). A downward scroll by `dy` rows means the new frame's rows line up
 * with the previous frame's rows shifted by `dy`; we find the shift with the
 * smallest signature difference and append only the newly revealed rows.
 * Rows that never move (sticky headers/footers) are detected on the first
 * scroll and excluded from matching, then kept once at the top and bottom.
 */

export interface Frame {
  width: number
  height: number
  data: Uint8ClampedArray // RGBA
}

export type AddResult = 'first' | 'unchanged' | 'appended' | 'no-match' | 'full'

const BANDS = 24
/** Mean per-band grey difference (0–255) below which rows count as identical. */
const SAME = 1.5
/** Acceptable mean difference for a scroll match. */
const MATCH = 6
const MAX_FIXED_FRACTION = 0.4

export class Stitcher {
  readonly width: number
  readonly height: number
  private prev: { frame: Frame; sig: Float32Array } | null = null
  private first: Frame | null = null
  private header = 0
  private footer = 0
  private fixedKnown = false
  /** Newly revealed row blocks, in order, from the moving region. */
  private strips: { frame: Frame; from: number; to: number }[] = []
  private last: Frame | null = null
  /** Chromium canvases cap out a little above 32k pixels per side. */
  private readonly maxHeight: number

  constructor(width: number, height: number, maxHeight = 30000) {
    this.width = width
    this.height = height
    this.maxHeight = maxHeight
  }

  get totalHeight(): number {
    if (!this.first) return 0
    const moving = this.strips.reduce((n, s) => n + (s.to - s.from), 0)
    return moving + this.footer
  }

  add(frame: Frame): AddResult {
    if (frame.width !== this.width || frame.height !== this.height) throw new Error('Frame size changed')
    const sig = signature(frame)
    if (!this.prev) {
      this.prev = { frame, sig }
      this.first = frame
      this.last = frame
      // Until the fixed rows are known, the first frame contributes everything.
      this.strips = [{ frame, from: 0, to: frame.height }]
      return 'first'
    }
    if (rowRangeDiff(sig, this.prev.sig, 0, 0, this.height) < SAME) return 'unchanged'
    if (this.totalHeight >= this.maxHeight) return 'full'

    if (!this.fixedKnown) this.detectFixedRows(sig, this.prev.sig)

    const dy = this.findShift(sig, this.prev.sig)
    if (dy === null) return 'no-match'

    const end = this.height - this.footer
    this.strips.push({ frame, from: end - dy, to: end })
    this.prev = { frame, sig }
    this.last = frame
    return 'appended'
  }

  private detectFixedRows(a: Float32Array, b: Float32Array): void {
    let top = 0
    while (top < this.height && rowRangeDiff(a, b, top, top, 1) < SAME) top++
    let bottom = 0
    while (bottom < this.height - top && rowRangeDiff(a, b, this.height - 1 - bottom, this.height - 1 - bottom, 1) < SAME)
      bottom++
    if (top + bottom > this.height * MAX_FIXED_FRACTION) {
      // Too much looks static to be a header/footer; treat everything as moving.
      top = 0
      bottom = 0
    }
    this.header = top
    this.footer = bottom
    this.fixedKnown = true
    // The first frame's footer is replaced by the last frame's at the end.
    this.strips[0] = { frame: this.first!, from: 0, to: this.height - bottom }
  }

  /** Best downward shift of `cur` against `prev`, or null when nothing matches. */
  private findShift(cur: Float32Array, prev: Float32Array): number | null {
    const start = this.header
    const end = this.height - this.footer
    const moving = end - start
    const minOverlap = Math.max(8, Math.floor(moving * 0.15))
    let best: number | null = null
    let bestErr = Infinity
    for (let dy = 1; dy <= moving - minOverlap; dy++) {
      // cur rows [start, end - dy) should equal prev rows [start + dy, end)
      const err = rowRangeDiff(cur, prev, start, start + dy, moving - dy, 2)
      // Prefer the smallest shift on ties (e.g. blank areas match anywhere).
      if (err < bestErr - 0.05) {
        bestErr = err
        best = dy
      }
    }
    return bestErr <= MATCH ? best : null
  }

  /** Compose the final image: first frame, revealed strips, then the last frame's footer. */
  compose(): Frame {
    const height = this.totalHeight
    const out = new Uint8ClampedArray(this.width * height * 4)
    const rowBytes = this.width * 4
    let y = 0
    for (const s of this.strips) {
      out.set(s.frame.data.subarray(s.from * rowBytes, s.to * rowBytes), y * rowBytes)
      y += s.to - s.from
    }
    if (this.footer && this.last) {
      const from = this.height - this.footer
      out.set(this.last.data.subarray(from * rowBytes), y * rowBytes)
    }
    return { width: this.width, height, data: out }
  }
}

export function signature(frame: Frame): Float32Array {
  const { width, height, data } = frame
  const sig = new Float32Array(height * BANDS)
  const bandWidth = width / BANDS
  for (let y = 0; y < height; y++) {
    const row = y * width * 4
    for (let b = 0; b < BANDS; b++) {
      const x0 = Math.floor(b * bandWidth)
      const x1 = Math.max(x0 + 1, Math.floor((b + 1) * bandWidth))
      let sum = 0
      let n = 0
      for (let x = x0; x < x1; x += 2) {
        const i = row + x * 4
        sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
        n++
      }
      sig[y * BANDS + b] = sum / n
    }
  }
  return sig
}

/** Mean absolute band difference between `rows` rows of a (from ra) and b (from rb). */
function rowRangeDiff(a: Float32Array, b: Float32Array, ra: number, rb: number, rows: number, step = 1): number {
  let sum = 0
  let n = 0
  for (let r = 0; r < rows; r += step) {
    const ia = (ra + r) * BANDS
    const ib = (rb + r) * BANDS
    for (let k = 0; k < BANDS; k++) sum += Math.abs(a[ia + k] - b[ib + k])
    n += BANDS
  }
  return n ? sum / n : Infinity
}
