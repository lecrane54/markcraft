import {
  app,
  desktopCapturer,
  dialog,
  ipcMain,
  screen,
  shell,
  systemPreferences,
  type BrowserWindow,
  type DesktopCapturerSource,
  type Display,
  type NativeImage
} from 'electron'
import type { OverlayInit, Rect, SelectMode } from '../shared/types'
import { createWindow, floatingOptions, pinOnTop } from './windows'

export interface DisplayShot {
  display: Display
  /** Full-resolution frozen image of the display, in device pixels. */
  image: NativeImage
  source: DesktopCapturerSource
}

export interface Selection {
  shot: DisplayShot
  /** CSS pixels relative to the display's top-left corner. */
  rect: Rect
}

const devicePixels = (d: Display) => ({
  width: Math.round(d.bounds.width * d.scaleFactor),
  height: Math.round(d.bounds.height * d.scaleFactor)
})

/** Grab a frozen image of every display at native resolution. */
export async function snapshotDisplays(): Promise<DisplayShot[]> {
  const displays = screen.getAllDisplays()
  const sizes = displays.map(devicePixels)
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.max(...sizes.map((s) => s.width)),
      height: Math.max(...sizes.map((s) => s.height))
    }
  })
  return displays.flatMap((display, i) => {
    const source =
      sources.find((s) => s.display_id === String(display.id)) ??
      (displays.length === 1 ? sources[0] : undefined)
    if (!source || source.thumbnail.isEmpty()) return []
    let image = source.thumbnail
    const got = image.getSize()
    if (got.width !== sizes[i].width || got.height !== sizes[i].height) {
      image = image.resize({ ...sizes[i], quality: 'best' })
    }
    return [{ display, image, source }]
  })
}

export async function captureFullScreen(): Promise<NativeImage | null> {
  const shots = await requireShots()
  if (!shots) return null
  const target = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  return (shots.find((s) => s.display.id === target.id) ?? shots[0]).image
}

export function cropSelection({ shot, rect }: Selection): NativeImage {
  const sf = shot.display.scaleFactor
  const size = shot.image.getSize()
  const x = clamp(Math.round(rect.x * sf), 0, size.width - 1)
  const y = clamp(Math.round(rect.y * sf), 0, size.height - 1)
  return shot.image.crop({
    x,
    y,
    width: clamp(Math.round(rect.width * sf), 1, size.width - x),
    height: clamp(Math.round(rect.height * sf), 1, size.height - y)
  })
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

async function requireShots(): Promise<DisplayShot[] | null> {
  if (!screenAccessGranted()) {
    // Without access, getSources() waits on the system prompt instead of failing.
    // Fire one request so macOS lists the app in Settings, and explain what to do.
    void desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).catch(() => undefined)
    await showScreenPermissionHelp()
    return null
  }
  const shots = await snapshotDisplays()
  if (shots.length) return shots
  await showScreenPermissionHelp()
  return null
}

export async function showScreenPermissionHelp(): Promise<void> {
  const mac = process.platform === 'darwin'
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    message: 'Markcraft can’t see your screen',
    detail: mac
      ? 'Allow Markcraft (or Electron, when running in development) under System Settings → Privacy & Security → Screen & System Audio Recording, then try again. You may need to restart the app.'
      : 'Screen capture is unavailable. Check your system’s screen sharing permissions.',
    buttons: mac ? ['Open Settings', 'Cancel'] : ['OK']
  })
  if (mac && response === 0) {
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    )
  }
}

export function screenAccessGranted(): boolean {
  return process.platform !== 'darwin' || systemPreferences.getMediaAccessStatus('screen') === 'granted'
}

// ---- Region selection overlays ------------------------------------------------
//
// One hidden, preloaded overlay window per display. Showing a window that is
// already loaded is much faster than creating one per capture, which is what
// makes the capture hotkey feel instant.

const pool = new Map<number, BrowserWindow>() // display id → overlay

interface ActiveSelection {
  mode: SelectMode
  shots: Map<number, DisplayShot> // webContents id → shot
  finish: (result: Selection | null) => void
}

let active: ActiveSelection | null = null

function createOverlay(display: Display): BrowserWindow {
  const win = createWindow('overlay', {
    ...floatingOptions(),
    ...display.bounds,
    backgroundColor: '#000000',
    roundedCorners: false
  })
  pinOnTop(win)
  win.on('closed', () => {
    if (pool.get(display.id) === win) pool.delete(display.id)
    active?.finish(null)
  })
  return win
}

/**
 * Match the pool to the current displays. Call at startup and when displays are
 * added or removed (which cancels any selection in progress).
 */
export function warmOverlays(): void {
  active?.finish(null)
  const displays = screen.getAllDisplays()
  const ids = new Set(displays.map((d) => d.id))
  for (const [id, win] of pool) {
    if (ids.has(id)) continue
    pool.delete(id)
    if (!win.isDestroyed()) win.destroy()
  }
  for (const d of displays) {
    const win = pool.get(d.id)
    if (win && !win.isDestroyed()) win.setBounds(d.bounds)
    else pool.set(d.id, createOverlay(d))
  }
}

/** Follow resolution/arrangement changes. Fires for Dock and menu-bar changes too, so never cancels. */
export function updateOverlayBounds(): void {
  if (active) return
  for (const d of screen.getAllDisplays()) {
    const win = pool.get(d.id)
    if (win && !win.isDestroyed()) win.setBounds(d.bounds)
  }
}

/**
 * Freeze every display and let the user drag a rectangle on one of them.
 * Resolves to null when cancelled (Esc) or when screen access is missing.
 */
export async function selectRegion(mode: SelectMode): Promise<Selection | null> {
  if (active) return null
  const shots = await requireShots()
  if (!shots) return null
  if (shots.some((s) => !pool.get(s.display.id) || pool.get(s.display.id)!.isDestroyed())) warmOverlays()

  return new Promise((resolve) => {
    const used: BrowserWindow[] = []
    const selection: ActiveSelection = {
      mode,
      shots: new Map(),
      finish: (result) => {
        if (active !== selection) return
        active = null
        for (const w of used) {
          if (w.isDestroyed()) continue
          w.hide()
          w.webContents.send('overlay:reset')
        }
        resolve(result)
      }
    }
    active = selection

    for (const shot of shots) {
      const win = pool.get(shot.display.id)
      if (!win) continue
      used.push(win)
      selection.shots.set(win.webContents.id, shot)
      const init: OverlayInit = {
        mode,
        // JPEG keeps the preview fast; the crop is taken from the lossless original.
        imageDataUrl: `data:image/jpeg;base64,${shot.image.toJPEG(92).toString('base64')}`,
        scaleFactor: shot.display.scaleFactor
      }
      // Only on the very first capture can the page still be loading.
      const start = () => win.webContents.send('overlay:start', init)
      if (win.webContents.isLoading()) win.webContents.once('did-finish-load', start)
      else start()
    }
    if (!used.length) selection.finish(null)
  })
}

// The overlay has drawn the new screenshot; reveal it.
ipcMain.on('overlay:ready', (e) => {
  const shot = active?.shots.get(e.sender.id)
  const win = shot && pool.get(shot.display.id)
  if (!win || win.isDestroyed()) return
  // Re-assert bounds: macOS shrinks windows to avoid the menu bar.
  win.setBounds(shot.display.bounds)
  win.show()
  win.focus()
  if (process.platform === 'darwin') app.focus({ steal: true })
})

ipcMain.on('overlay:done', (e, rect: Rect | null) => {
  if (!active) return
  const shot = active.shots.get(e.sender.id)
  active.finish(rect && shot && rect.width >= 1 && rect.height >= 1 ? { shot, rect } : null)
})
