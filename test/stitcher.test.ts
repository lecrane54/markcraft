import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Stitcher, type Frame } from '../src/renderer/scroll/stitcher.ts'

const W = 96

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

/** Rows of textured content, like a page of text and images. */
function makeRows(count: number, seed: number): Uint8ClampedArray[] {
  const rand = rng(seed)
  return Array.from({ length: count }, () => {
    const row = new Uint8ClampedArray(W * 4)
    for (let x = 0; x < W; x++) {
      const v = Math.floor(rand() * 256)
      row.set([v, (v * 7) % 256, (v * 13) % 256, 255], x * 4)
    }
    return row
  })
}

function frameOf(rows: Uint8ClampedArray[]): Frame {
  const data = new Uint8ClampedArray(W * rows.length * 4)
  rows.forEach((r, i) => data.set(r, i * W * 4))
  return { width: W, height: rows.length, data }
}

const content = makeRows(1000, 1)
const header = makeRows(30, 2)
const footer = makeRows(20, 3)
const VIEW = 150

const viewport = (offset: number) =>
  frameOf([...header, ...content.slice(offset, offset + VIEW), ...footer])

test('reassembles a scrolled page with sticky header and footer', () => {
  const s = new Stitcher(W, header.length + VIEW + footer.length)
  const offsets = [0, 40, 100, 100, 180, 260, 340, 430, 520, 610, 700, 790, 850]
  const results = offsets.map((o) => s.add(viewport(o)))
  assert.deepEqual(results, [
    'first',
    'appended',
    'appended',
    'unchanged',
    ...Array(9).fill('appended')
  ])
  const out = s.compose()
  const expected = frameOf([...header, ...content, ...footer])
  assert.equal(out.height, expected.height)
  assert.ok(Buffer.from(out.data).equals(Buffer.from(expected.data)), 'pixels match')
})

test('ignores a jump larger than the visible area', () => {
  const s = new Stitcher(W, header.length + VIEW + footer.length)
  s.add(viewport(0))
  assert.equal(s.add(viewport(400)), 'no-match')
  // Scrolling back into overlapping range continues normally.
  assert.equal(s.add(viewport(60)), 'appended')
  assert.equal(s.compose().height, header.length + 60 + VIEW + footer.length)
})
