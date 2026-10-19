import type { StreamTarget } from '../../shared/types'
import { api } from '../common/api'
import { openDisplayVideo, sourceRect, stopStream } from '../common/stream'
import { Stitcher, type Frame } from './stitcher'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const status = $('status')

const SAMPLE_MS = 100

let target: StreamTarget
let stream: MediaStream | null = null
let stitcher: Stitcher | null = null
let sampling = 0
let busy = false

async function init(): Promise<void> {
  target = await api.scrollInit()
}

function setStatus(html: string): void {
  status.innerHTML = html
}

async function start(): Promise<void> {
  $<HTMLButtonElement>('start').disabled = true
  try {
    const opened = await openDisplayVideo()
    stream = opened.stream
    const { video } = opened
    const src = sourceRect(video, target)
    const grab = document.createElement('canvas')
    grab.width = src.width
    grab.height = src.height
    const ctx = grab.getContext('2d', { willReadFrequently: true })!
    stitcher = new Stitcher(src.width, src.height)

    const sample = () => {
      if (busy || !stitcher) return
      busy = true
      ctx.drawImage(video, src.x, src.y, src.width, src.height, 0, 0, src.width, src.height)
      const img = ctx.getImageData(0, 0, src.width, src.height)
      const result = stitcher.add({ width: img.width, height: img.height, data: img.data })
      const h = stitcher.totalHeight.toLocaleString()
      if (result === 'no-match') setStatus(`Lost track — scroll back up a little, then slower · <strong>${h}px</strong>`)
      else if (result === 'full') {
        setStatus(`Maximum height reached · <strong>${h}px</strong>`)
        void finish()
      } else setStatus(`Scroll down slowly · captured <strong>${h}px</strong>`)
      busy = false
    }
    sample()
    sampling = window.setInterval(sample, SAMPLE_MS)
    $('start').hidden = true
    $('done').hidden = false
  } catch (err) {
    setStatus(`Couldn’t start: ${(err as Error).message}`)
    $<HTMLButtonElement>('start').disabled = false
  }
}

function toDataUrl(frame: Frame): string {
  const c = document.createElement('canvas')
  c.width = frame.width
  c.height = frame.height
  c.getContext('2d')!.putImageData(new ImageData(frame.data as Uint8ClampedArray<ArrayBuffer>, frame.width, frame.height), 0, 0)
  return c.toDataURL('image/png')
}

async function finish(): Promise<void> {
  clearInterval(sampling)
  stopStream(stream)
  stream = null
  const s = stitcher
  stitcher = null
  if (!s) return api.scrollDone(null)
  setStatus('Stitching…')
  await new Promise((r) => setTimeout(r, 0))
  api.scrollDone(toDataUrl(s.compose()))
}

$('start').addEventListener('click', () => void start())
$('done').addEventListener('click', () => void finish())
$('cancel').addEventListener('click', () => {
  clearInterval(sampling)
  stopStream(stream)
  api.scrollDone(null)
})
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('cancel').click()
  if (e.key === 'Enter' && stitcher) void finish()
})

void init()
