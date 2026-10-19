import assert from 'node:assert/strict'
import { test } from 'node:test'
import { coversWholeFrame } from '../src/renderer/common/stream.ts'

test('whole-display selections skip compositing', () => {
  // overlay click selects the full display; CSS→video scaling can round by a pixel
  assert.equal(coversWholeFrame({ x: 0, y: 0, width: 3456, height: 2234 }, 3456, 2234), true)
  assert.equal(coversWholeFrame({ x: 1, y: 0, width: 3455, height: 2233 }, 3456, 2234), true)
})

test('partial selections are cropped through the canvas', () => {
  assert.equal(coversWholeFrame({ x: 0, y: 0, width: 1920, height: 1080 }, 3456, 2234), false)
  assert.equal(coversWholeFrame({ x: 200, y: 0, width: 3256, height: 2234 }, 3456, 2234), false)
})
