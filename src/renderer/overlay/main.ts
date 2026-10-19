import type { Rect } from '../../shared/types'
import { api } from '../common/api'

const canvas = document.getElementById('stage') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const hint = document.getElementById('hint')!

const ACCENT = '#ff7a2f'
const MAG_ZOOM = 8
const MAG_CELLS = 15 // pixels shown across the magnifier

let image: HTMLImageElement | null = null
let sf = 1 // image pixels per CSS pixel
let cursor = { x: -1, y: -1 }
let anchor: { x: number; y: number } | null = null
let selection: Rect | null = null

const HINTS = {
  region: '<b>Capture</b> · Drag to select an area · Click for the whole screen · Esc to cancel',
  record: '<b>Record</b> · Drag to select the area to record · Click for the whole screen · Esc to cancel',
  scroll: '<b>Scrolling capture</b> · Select the area that scrolls · Esc to cancel'
}

// This page stays loaded between captures: main sends a fresh screenshot each time.
api.onOverlayStart(async (data) => {
  sf = data.scaleFactor
  const next = new Image()
  next.src = data.imageDataUrl
  await next.decode()
  image = next
  hint.innerHTML = HINTS[data.mode]
  hint.hidden = false
  resize()
  api.overlayReady()
})

api.onOverlayReset(() => {
  image = null
  anchor = null
  selection = null
  cursor = { x: -1, y: -1 }
  hint.hidden = true
  ctx.clearRect(0, 0, canvas.width, canvas.height)
})

function resize(): void {
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(innerWidth * dpr)
  canvas.height = Math.round(innerHeight * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  draw()
}

function normalized(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  }
}

function drawImageRect(r: Rect): void {
  ctx.drawImage(image!, r.x * sf, r.y * sf, r.width * sf, r.height * sf, r.x, r.y, r.width, r.height)
}

function draw(): void {
  if (!image) return
  const w = innerWidth
  const h = innerHeight
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(image, 0, 0, w, h)
  ctx.fillStyle = 'rgb(0 0 0 / 0.38)'
  ctx.fillRect(0, 0, w, h)

  if (selection && selection.width > 0 && selection.height > 0) {
    drawImageRect(selection)
    ctx.strokeStyle = ACCENT
    ctx.lineWidth = 2
    ctx.strokeRect(selection.x - 1, selection.y - 1, selection.width + 2, selection.height + 2)
    drawSizeLabel(selection)
  } else if (cursor.x >= 0) {
    // full-length guides through the cursor
    ctx.strokeStyle = 'rgb(255 255 255 / 0.55)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(0, cursor.y + 0.5)
    ctx.lineTo(w, cursor.y + 0.5)
    ctx.moveTo(cursor.x + 0.5, 0)
    ctx.lineTo(cursor.x + 0.5, h)
    ctx.stroke()
    ctx.setLineDash([])
  }
  if (cursor.x >= 0) drawMagnifier()
}

function drawSizeLabel(r: Rect): void {
  const text = `${Math.round(r.width * sf)} × ${Math.round(r.height * sf)}`
  ctx.font = '600 12px -apple-system, system-ui, sans-serif'
  const tw = ctx.measureText(text).width + 14
  let y = r.y - 26
  if (y < 4) y = r.y + 6
  const x = Math.min(Math.max(r.x, 4), innerWidth - tw - 4)
  ctx.fillStyle = 'rgb(20 20 24 / 0.85)'
  roundRect(x, y, tw, 20, 5)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.fillText(text, x + 7, y + 14)
}

function drawMagnifier(): void {
  const size = MAG_CELLS * MAG_ZOOM
  let mx = cursor.x + 24
  let my = cursor.y + 24
  if (mx + size > innerWidth - 8) mx = cursor.x - 24 - size
  if (my + size + 22 > innerHeight - 8) my = cursor.y - 24 - size - 22
  const half = Math.floor(MAG_CELLS / 2)
  const px = Math.round(cursor.x * sf)
  const py = Math.round(cursor.y * sf)

  ctx.save()
  roundRect(mx, my, size, size, 8)
  ctx.clip()
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#000'
  ctx.fillRect(mx, my, size, size)
  ctx.drawImage(image!, px - half, py - half, MAG_CELLS, MAG_CELLS, mx, my, size, size)
  // centre pixel marker
  ctx.strokeStyle = ACCENT
  ctx.lineWidth = 2
  ctx.strokeRect(mx + half * MAG_ZOOM, my + half * MAG_ZOOM, MAG_ZOOM, MAG_ZOOM)
  ctx.restore()
  ctx.strokeStyle = 'rgb(255 255 255 / 0.9)'
  ctx.lineWidth = 2
  roundRect(mx, my, size, size, 8)
  ctx.stroke()

  ctx.font = '600 11px -apple-system, system-ui, sans-serif'
  ctx.fillStyle = 'rgb(20 20 24 / 0.85)'
  roundRect(mx, my + size + 4, size, 18, 5)
  ctx.fill()
  ctx.fillStyle = '#fff'
  const label = `${px}, ${py}`
  ctx.fillText(label, mx + (size - ctx.measureText(label).width) / 2, my + size + 17)
}

function roundRect(x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

const point = (e: MouseEvent) => ({ x: e.clientX, y: e.clientY })

window.addEventListener('mousemove', (e) => {
  cursor = point(e)
  if (anchor) selection = normalized(anchor, cursor)
  requestAnimationFrame(draw)
})

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  anchor = point(e)
  selection = null
  hint.hidden = true
})

window.addEventListener('mouseup', (e) => {
  if (!anchor || e.button !== 0) return
  const r = normalized(anchor, point(e))
  anchor = null
  // A click (no real drag) selects the whole display.
  api.overlayDone(
    r.width < 4 || r.height < 4 ? { x: 0, y: 0, width: innerWidth, height: innerHeight } : r
  )
})

window.addEventListener('mouseleave', () => {
  cursor = { x: -1, y: -1 }
  requestAnimationFrame(draw)
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.overlayDone(null)
  if (e.key === 'Enter') api.overlayDone(selection ?? { x: 0, y: 0, width: innerWidth, height: innerHeight })
})

window.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  api.overlayDone(null)
})

window.addEventListener('resize', resize)
