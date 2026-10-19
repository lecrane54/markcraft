// Smoke test: open a generated image in the editor, draw with synthetic
// pointer input, and save a screenshot of the window.
// Usage: npm run build && npx electron test/smoke.cjs <out.png>
const { app, nativeImage } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const out = path.resolve(process.argv.pop() || 'smoke.png')
fs.rmSync(out, { force: true })
const W = 1200
const H = 700
const buf = Buffer.alloc(W * H * 4)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    const stripe = Math.floor(y / 40) % 2 ? 235 : 250
    buf[i] = stripe - (x % 120 < 2 ? 80 : 0) // B
    buf[i + 1] = stripe - 10 // G
    buf[i + 2] = stripe // R
    buf[i + 3] = 255
  }
}
const sample = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'markcraft-')), 'sample.png')
fs.writeFileSync(sample, nativeImage.createFromBitmap(buf, { width: W, height: H }).toPNG())
process.argv.push(sample)

const drawScript = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  await wait(800)
  const upper = document.querySelector('.upper-canvas')
  const box = upper.getBoundingClientRect()
  const scale = box.width / ${W}
  const at = (x, y) => ({ clientX: box.left + x * scale, clientY: box.top + y * scale })
  const fire = (type, x, y) =>
    (type === 'mousedown' ? upper : document).dispatchEvent(new MouseEvent(type, {
      bubbles: true, button: 0, buttons: type === 'mouseup' ? 0 : 1, ...at(x, y)
    }))
  const drag = async (x1, y1, x2, y2) => {
    fire('mousedown', x1, y1)
    for (let t = 1; t <= 8; t++) { fire('mousemove', x1 + (x2 - x1) * t / 8, y1 + (y2 - y1) * t / 8); await wait(10) }
    fire('mouseup', x2, y2)
    await wait(50)
  }
  const tool = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key }))
  tool('a'); await drag(150, 550, 420, 300)
  tool('r'); await drag(500, 120, 800, 300)
  tool('e'); await drag(860, 380, 1100, 560)
  tool('h'); await drag(120, 80, 420, 125)
  tool('b'); await drag(500, 420, 760, 520)
  tool('n'); await drag(560, 180, 560, 180); await drag(700, 240, 700, 240)
  tool('v')
  return document.title + ' | ' + document.getElementById('dims').textContent + ' | ' + document.getElementById('zoom-label').textContent
})()`

const canvasPixels = async (win) =>
  nativeImage.createFromDataURL(
    await win.webContents.executeJavaScript("document.querySelector('canvas.lower-canvas').toDataURL()")
  )

/**
 * Share of pixels that differ clearly between two renders. Restored shapes are
 * re-rasterised, so faint anti-aliasing and shadow edges differ by design
 * (~0.01%); one missing step badge alone changes ~0.1%.
 */
function changedShare(a, b, threshold = 48) {
  const pa = a.toBitmap()
  const pb = b.toBitmap()
  let changed = 0
  for (let i = 0; i < pa.length; i += 4) {
    const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]))
    if (d > threshold) changed++
  }
  return changed / (pa.length / 4)
}

app.on('browser-window-created', (_e, win) => {
  // Only the synthetic events below may reach the editor, never the real pointer.
  win.setIgnoreMouseEvents(true)
  win.webContents.on('console-message', (e) => console.log(`[renderer:${e.level}] ${e.message}`))
  win.webContents.once('did-finish-load', async () => {
    // Capture overlays are created hidden at startup; only drive the editor.
    if (!win.webContents.getURL().includes('editor.html')) return
    try {
      console.log('editor:', await win.webContents.executeJavaScript(drawScript))
      // Undo the last three actions (two steps and the pixelation), then redo them.
      const pause = () => new Promise((r) => setTimeout(r, 250))
      await pause()
      const drawn = await canvasPixels(win)
      for (let i = 0; i < 3; i++) {
        win.webContents.send('menu', 'undo')
        await pause()
      }
      const undone = await canvasPixels(win)
      for (let i = 0; i < 3; i++) {
        win.webContents.send('menu', 'redo')
        await pause()
      }
      const redone = await canvasPixels(win)
      const afterUndo = changedShare(drawn, undone)
      const afterRedo = changedShare(drawn, redone)
      console.log(`undo/redo: undo changed ${(afterUndo * 100).toFixed(2)}% of pixels, redo left ${(afterRedo * 100).toFixed(3)}% different`)
      if (afterUndo < 0.001) throw new Error('undo did not remove the last actions')
      if (afterRedo > 0.0005) throw new Error('redo did not restore the drawing')
      fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG())
      console.log('screenshot:', out)
    } catch (err) {
      console.error('smoke failed:', err)
      process.exitCode = 1
    }
    app.exit()
  })
})

require('../out/main/index.js')
