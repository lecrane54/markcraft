import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blockSize, NOISE, pixelate, type Pixels } from '../src/renderer/editor/redact.ts'

/** Black "text" strokes on white, like a line of an email address. */
function textLike(width: number, height: number): Pixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ink = y > height * 0.25 && y < height * 0.75 && x % 7 < 2
      data.set(ink ? [20, 20, 20, 255] : [250, 250, 250, 255], (y * width + x) * 4)
    }
  }
  return { width, height, data }
}

test('a line of text becomes at most two rows of large blocks', () => {
  // a 26px-high line (13px text on a 2x display)
  const block = blockSize(400, 26)
  assert.ok(block >= 12)
  assert.ok(Math.ceil(26 / block) <= 2)
  assert.equal(blockSize(4000, 3000), 64)
  assert.equal(blockSize(20, 10), 12)
})

test('every block is one solid colour near the average of what it covered', () => {
  const src = textLike(120, 40)
  const block = 20
  const out = pixelate(src, block)
  for (let by = 0; by < src.height; by += block) {
    for (let bx = 0; bx < src.width; bx += block) {
      const first = out.data.slice((by * src.width + bx) * 4, (by * src.width + bx) * 4 + 4)
      let sum = 0
      for (let y = by; y < by + block; y++) {
        for (let x = bx; x < bx + block; x++) {
          const i = (y * src.width + x) * 4
          assert.deepEqual([...out.data.slice(i, i + 4)], [...first], 'block is uniform')
          sum += src.data[i]
        }
      }
      const mean = sum / (block * block)
      assert.ok(Math.abs(first[0] - mean) <= NOISE + 1, 'colour stays near the block average')
    }
  }
})

test('noise makes identical content pixelate differently each time', () => {
  const src = textLike(120, 40)
  const a = pixelate(src, 20)
  const b = pixelate(src, 20)
  assert.notDeepEqual(a.data, b.data)
})
