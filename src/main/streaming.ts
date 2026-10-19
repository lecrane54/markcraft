import {
  BrowserWindow,
  screen,
  session,
  type DesktopCapturerSource,
  type Display,
  type Rectangle
} from 'electron'
import type { Rect, StreamTarget } from '../shared/types'
import type { Selection } from './capture'
import { createWindow, floatingOptions, pinOnTop, type Page } from './windows'

/**
 * getDisplayMedia() in our renderers is answered with this source. Only one
 * streaming session (recorder, scroll capture or window grab) runs at a time.
 */
let pendingSource: DesktopCapturerSource | null = null

export function setPendingSource(source: DesktopCapturerSource | null): void {
  pendingSource = source
}

export function installDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    if (pendingSource) callback({ video: pendingSource })
    // An empty response rejects the renderer's getDisplayMedia() call.
    else callback({})
  })
}

export function streamTarget({ shot, rect }: Selection): StreamTarget {
  const { bounds, scaleFactor } = shot.display
  return { rect, displaySize: { width: bounds.width, height: bounds.height }, scaleFactor }
}

export function absoluteRect(display: Display, rect: Rect): Rectangle {
  return {
    x: Math.round(display.bounds.x + rect.x),
    y: Math.round(display.bounds.y + rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  }
}

const FRAME_INSET = 3

/** Click-through border drawn just outside the captured area. */
export function createRegionFrame(area: Rectangle): BrowserWindow {
  const win = createWindow('frame', {
    ...floatingOptions(),
    x: area.x - FRAME_INSET,
    y: area.y - FRAME_INSET,
    width: area.width + FRAME_INSET * 2,
    height: area.height + FRAME_INSET * 2,
    transparent: true,
    focusable: false,
    roundedCorners: false
  })
  win.setIgnoreMouseEvents(true)
  win.setContentProtection(true)
  pinOnTop(win)
  win.once('ready-to-show', () => win.showInactive())
  return win
}

/** Small control bar placed below the area, or above it, or inside it as a last resort. */
export function createControlBar(page: Page, area: Rectangle, size: { width: number; height: number }): BrowserWindow {
  const work = screen.getDisplayMatching(area).workArea
  const gap = 12
  const x = clampTo(area.x + (area.width - size.width) / 2, work.x, work.x + work.width - size.width)
  let y = area.y + area.height + gap
  if (y + size.height > work.y + work.height) y = area.y - gap - size.height
  if (y < work.y) y = area.y + area.height - size.height - gap
  const win = createWindow(page, {
    ...floatingOptions(),
    movable: true,
    x: Math.round(x),
    y: Math.round(y),
    ...size,
    transparent: true,
    webPreferences: { backgroundThrottling: false }
  })
  win.setContentProtection(true)
  pinOnTop(win)
  win.once('ready-to-show', () => win.show())
  return win
}

const clampTo = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))
