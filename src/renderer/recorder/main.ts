import type { RecorderInit } from '../../shared/types'
import { api } from '../common/api'
import { coversWholeFrame, openDisplayVideo, sourceRect, stopStream } from '../common/stream'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

const status = $('status')
const dot = $('dot')
const canvas = $<HTMLCanvasElement>('compositor')
const ctx = canvas.getContext('2d', { alpha: false })!

const FPS = 30
// Preferred containers, best first. Chromium records MP4 (H.264) on recent versions.
const MIME_TYPES = [
  'video/mp4;codecs=avc1,opus',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm'
]

let init: RecorderInit
let screenStream: MediaStream | null = null
let micStream: MediaStream | null = null
let camStream: MediaStream | null = null
let recorder: MediaRecorder | null = null
let camVideo: HTMLVideoElement | null = null
let writes: Promise<void> = Promise.resolve()
let elapsedBefore = 0
let resumedAt = 0
let timer = 0

async function start(): Promise<void> {
  init = await api.recorderInit()
  $<HTMLInputElement>('mic').checked = init.mic
  $<HTMLInputElement>('cam').checked = init.webcam
}

function setStatus(html: string, state: 'idle' | 'live' | 'paused' = 'idle'): void {
  status.innerHTML = html
  dot.className = `dot ${state === 'idle' ? '' : state}`
}

/** Pick an even-sized output so H.264 encoders accept it. */
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

async function record(): Promise<void> {
  $<HTMLButtonElement>('record').disabled = true
  try {
    const { stream, video } = await openDisplayVideo()
    screenStream = stream
    const src = sourceRect(video, init)
    canvas.width = even(src.width)
    canvas.height = even(src.height)

    if ($<HTMLInputElement>('mic').checked) {
      micStream = await navigator.mediaDevices
        .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        .catch(() => null)
      if (!micStream) setStatus('Microphone unavailable — recording without audio')
    }
    if ($<HTMLInputElement>('cam').checked) {
      camStream = await navigator.mediaDevices
        .getUserMedia({ video: { width: 640, height: 480 } })
        .catch(() => null)
      if (camStream) {
        camVideo = document.createElement('video')
        camVideo.muted = true
        camVideo.srcObject = camStream
        await camVideo.play()
      }
    }

    // A whole display with no webcam needs no compositing: hand the screen track
    // straight to the encoder instead of redrawing every frame through a canvas.
    const direct = !camVideo && coversWholeFrame(src, video.videoWidth, video.videoHeight)
    let out: MediaStream
    if (direct) {
      out = new MediaStream(stream.getVideoTracks())
    } else {
      const draw = () => {
        if (!screenStream) return
        ctx.drawImage(video, src.x, src.y, src.width, src.height, 0, 0, canvas.width, canvas.height)
        if (camVideo) drawWebcam(camVideo)
        video.requestVideoFrameCallback(draw)
      }
      video.requestVideoFrameCallback(draw)
      out = canvas.captureStream(FPS)
    }

    await countdown()

    micStream?.getAudioTracks().forEach((t) => out.addTrack(t))
    const pixels = direct ? video.videoWidth * video.videoHeight : canvas.width * canvas.height
    const mimeType = MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
    recorder = new MediaRecorder(out, {
      mimeType,
      videoBitsPerSecond: Math.min(16e6, pixels * FPS * 0.12)
    })
    await api.recordingBegin(recorder.mimeType || mimeType)
    recorder.ondataavailable = (e) => {
      if (!e.data.size) return
      // Keep chunks in order: each write waits for the previous one.
      writes = writes.then(async () => api.recordingChunk(await e.data.arrayBuffer()))
    }
    recorder.onstop = async () => {
      await writes
      cleanup()
      await api.recordingFinish()
    }
    recorder.start(1000)
    resumedAt = performance.now()
    timer = window.setInterval(tick, 250)
    tick()
    $('record').hidden = true
    $('mic-toggle').hidden = true
    $('cam-toggle').hidden = true
    $('pause').hidden = false
    $('stop').hidden = false
  } catch (err) {
    cleanup()
    setStatus(`Couldn’t start recording: ${(err as Error).message}`)
    $<HTMLButtonElement>('record').disabled = false
  }
}

function drawWebcam(cam: HTMLVideoElement): void {
  const d = Math.round(Math.min(canvas.width, canvas.height) * 0.28)
  const margin = Math.round(d * 0.12)
  const x = canvas.width - d - margin
  const y = canvas.height - d - margin
  const vw = cam.videoWidth
  const vh = cam.videoHeight
  const side = Math.min(vw, vh)
  ctx.save()
  ctx.beginPath()
  ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2)
  ctx.clip()
  // mirror, like a video call preview
  ctx.translate(x + d, y)
  ctx.scale(-1, 1)
  ctx.drawImage(cam, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, d, d)
  ctx.restore()
  ctx.lineWidth = Math.max(2, d / 40)
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.beginPath()
  ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2)
  ctx.stroke()
}

async function countdown(): Promise<void> {
  for (let n = 3; n > 0; n--) {
    setStatus(`Recording in <strong>${n}</strong>…`)
    await new Promise((r) => setTimeout(r, 1000))
  }
}

function elapsed(): number {
  return elapsedBefore + (recorder?.state === 'recording' ? performance.now() - resumedAt : 0)
}

function tick(): void {
  const s = Math.floor(elapsed() / 1000)
  const time = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  if (recorder?.state === 'paused') setStatus(`Paused <strong>${time}</strong>`, 'paused')
  else setStatus(`Recording <strong>${time}</strong>`, 'live')
}

function togglePause(): void {
  if (!recorder) return
  if (recorder.state === 'recording') {
    elapsedBefore = elapsed()
    recorder.pause()
    $('pause').textContent = 'Resume'
  } else if (recorder.state === 'paused') {
    resumedAt = performance.now()
    recorder.resume()
    $('pause').textContent = 'Pause'
  }
  tick()
}

function stop(): void {
  if (!recorder || recorder.state === 'inactive') return
  clearInterval(timer)
  setStatus('Saving…')
  $<HTMLButtonElement>('stop').disabled = true
  $<HTMLButtonElement>('pause').disabled = true
  recorder.stop()
}

function cleanup(): void {
  clearInterval(timer)
  ;[screenStream, micStream, camStream].forEach(stopStream)
  screenStream = micStream = camStream = null
  camVideo = null
}

$('record').addEventListener('click', () => void record())
$('pause').addEventListener('click', togglePause)
$('stop').addEventListener('click', stop)
$('cancel').addEventListener('click', () => {
  if (recorder && recorder.state !== 'inactive') {
    recorder.onstop = null
    recorder.stop()
  }
  cleanup()
  api.recordingCancel()
})

void start()
