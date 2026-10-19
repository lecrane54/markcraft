import { app, type NativeImage } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getSettings } from './settings'

export const capturesDir = () => join(app.getPath('pictures'), 'Markcraft')
export const recordingsDir = () => join(app.getPath('videos'), 'Markcraft')

export function timestampName(prefix: string): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${prefix} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} at ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`
}

/** Keep an original copy of a capture when auto-save is on. Returns the file path, if saved. */
export function autoSaveCapture(image: NativeImage, name: string): string | undefined {
  if (!getSettings().autoSave) return undefined
  const dir = capturesDir()
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${name}.png`)
  writeFileSync(file, image.toPNG())
  return file
}
