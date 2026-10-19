import {
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
  net,
  protocol,
  shell,
  systemPreferences,
  type DesktopCapturerSource
} from 'electron'
import { copyFileSync, createWriteStream, mkdirSync, rmSync, type WriteStream } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { RecorderInit, StreamTarget, WindowSource } from '../shared/types'
import { screenAccessGranted, selectRegion, showScreenPermissionHelp } from './capture'
import { openCapture } from './editor'
import { recordingsDir, timestampName } from './library'
import { getSettings } from './settings'
import {
  absoluteRect,
  createControlBar,
  createRegionFrame,
  setPendingSource,
  streamTarget
} from './streaming'
import { createWindow } from './windows'

/** The one streaming session allowed at a time; its windows close together. */
let busy = false

function endSession(windows: BrowserWindow[]): void {
  for (const w of windows) if (!w.isDestroyed()) w.destroy()
  setPendingSource(null)
  busy = false
}

// ---- Screen recording ----------------------------------------------------------

interface Recording {
  init: RecorderInit
  bar: BrowserWindow
  frame: BrowserWindow
  out: WriteStream | null
  filePath: string | null
}

let recording: Recording | null = null

export async function startRecording(): Promise<void> {
  if (busy) return
  busy = true
  const sel = await selectRegion('record')
  if (!sel) {
    busy = false
    return
  }
  const { mic, webcam } = getSettings()
  if (process.platform === 'darwin') {
    if (mic) await systemPreferences.askForMediaAccess('microphone')
    if (webcam) await systemPreferences.askForMediaAccess('camera')
  }
  setPendingSource(sel.shot.source)
  const area = absoluteRect(sel.shot.display, sel.rect)
  const frame = createRegionFrame(area)
  const bar = createControlBar('recorder', area, { width: 380, height: 64 })
  recording = { init: { ...streamTarget(sel), mic, webcam }, bar, frame, out: null, filePath: null }
  bar.on('closed', () => cancelRecording())
}

function cancelRecording(): void {
  if (!recording) return
  const { out, filePath, bar, frame } = recording
  recording = null
  out?.destroy()
  if (filePath) rmSync(filePath, { force: true })
  endSession([bar, frame])
}

ipcMain.handle('recorder:init', () => {
  if (!recording) throw new Error('No recording session')
  return recording.init
})

ipcMain.handle('recorder:begin', (_e, mimeType: string) => {
  if (!recording) throw new Error('No recording session')
  const dir = recordingsDir()
  mkdirSync(dir, { recursive: true })
  const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'
  recording.filePath = join(dir, `${timestampName('Recording')}.${ext}`)
  recording.out = createWriteStream(recording.filePath)
})

ipcMain.handle('recorder:chunk', (_e, chunk: ArrayBuffer) => {
  const out = recording?.out
  if (!out) return
  return new Promise<void>((resolve, reject) =>
    out.write(Buffer.from(chunk), (err) => (err ? reject(err) : resolve()))
  )
})

ipcMain.handle('recorder:finish', async () => {
  if (!recording?.out || !recording.filePath) return
  const { out, filePath, bar, frame } = recording
  recording = null
  await new Promise<void>((resolve) => out.end(resolve))
  endSession([bar, frame])
  openPlayer(filePath)
})

ipcMain.on('recorder:cancel', () => cancelRecording())

// ---- Video player ----------------------------------------------------------------

const MEDIA_SCHEME = 'markcraft-media'
const playable = new Set<string>()
const players = new Map<number, string>()

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
  ])
}

export function handleMediaScheme(): void {
  protocol.handle(MEDIA_SCHEME, (req) => {
    const filePath = new URL(req.url).searchParams.get('path') ?? ''
    // Only recordings this app produced are served.
    if (!playable.has(filePath)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(filePath).toString(), { headers: req.headers })
  })
}

export function openPlayer(filePath: string): void {
  playable.add(filePath)
  const win = createWindow('player', {
    width: 960,
    height: 640,
    minWidth: 480,
    minHeight: 320,
    title: basename(filePath),
    backgroundColor: '#1e1f22'
  })
  const id = win.webContents.id
  players.set(id, filePath)
  win.on('closed', () => players.delete(id))
  win.once('ready-to-show', () => win.show())
}

ipcMain.handle('player:init', (e) => {
  const filePath = players.get(e.sender.id)
  if (!filePath) throw new Error('No video')
  return { filePath, url: `${MEDIA_SCHEME}://video/?path=${encodeURIComponent(filePath)}` }
})

ipcMain.handle('file:reveal', (_e, filePath: string) => {
  if (playable.has(filePath)) shell.showItemInFolder(filePath)
})

ipcMain.handle('file:save-video', async (e, filePath: string) => {
  if (!playable.has(filePath)) return null
  const win = BrowserWindow.fromWebContents(e.sender)
  const ext = extname(filePath).slice(1)
  const options = { defaultPath: basename(filePath), filters: [{ name: 'Video', extensions: [ext] }] }
  const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (res.canceled || !res.filePath) return null
  copyFileSync(filePath, res.filePath)
  return res.filePath
})

// ---- Scrolling capture -------------------------------------------------------------

let scrolling: { target: StreamTarget; windows: BrowserWindow[] } | null = null

export async function startScrollingCapture(): Promise<void> {
  if (busy) return
  busy = true
  const sel = await selectRegion('scroll')
  if (!sel) {
    busy = false
    return
  }
  setPendingSource(sel.shot.source)
  const area = absoluteRect(sel.shot.display, sel.rect)
  const frame = createRegionFrame(area)
  const bar = createControlBar('scroll', area, { width: 460, height: 64 })
  const session = { target: streamTarget(sel), windows: [bar, frame] }
  scrolling = session
  bar.on('closed', () => finishScrolling(session, null))
}

function finishScrolling(session: NonNullable<typeof scrolling>, dataUrl: string | null): void {
  if (scrolling !== session) return
  scrolling = null
  endSession(session.windows)
  if (dataUrl) openCapture(nativeImage.createFromDataURL(dataUrl), 'Scrolling Capture')
}

ipcMain.handle('scroll:init', () => {
  if (!scrolling) throw new Error('No scrolling capture session')
  return scrolling.target
})

ipcMain.on('scroll:done', (_e, dataUrl: string | null) => {
  if (scrolling) finishScrolling(scrolling, dataUrl)
})

// ---- Window capture picker -----------------------------------------------------------

let picker: { win: BrowserWindow; sources: DesktopCapturerSource[] } | null = null

export function openWindowPicker(): void {
  if (busy) return
  if (!screenAccessGranted()) {
    void desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1, height: 1 } }).catch(() => undefined)
    void showScreenPermissionHelp()
    return
  }
  busy = true
  const win = createWindow('picker', {
    width: 900,
    height: 620,
    title: 'Capture a Window',
    backgroundColor: '#1e1f22'
  })
  picker = { win, sources: [] }
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    picker = null
    endSession([])
  })
}

ipcMain.handle('picker:sources', async (): Promise<WindowSource[]> => {
  if (!picker) return []
  const ownWindows = new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId()))
  const sources = (
    await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 400, height: 260 },
      fetchWindowIcons: true
    })
  ).filter((s) => !ownWindows.has(s.id) && !s.thumbnail.isEmpty())
  picker.sources = sources
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL(),
    appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null
  }))
})

ipcMain.handle('picker:choose', (_e, id: string) => {
  const source = picker?.sources.find((s) => s.id === id)
  setPendingSource(source ?? null)
  return Boolean(source)
})

ipcMain.on('picker:done', (_e, dataUrl: string | null) => {
  const win = picker?.win
  if (win && !win.isDestroyed()) win.close()
  if (dataUrl) openCapture(nativeImage.createFromDataURL(dataUrl), 'Window Capture')
})
