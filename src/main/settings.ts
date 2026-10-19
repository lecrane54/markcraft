import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Settings {
  /** Record microphone audio with screen recordings. */
  mic: boolean
  /** Composite the webcam into screen recordings. */
  webcam: boolean
  /** Keep a copy of every capture in ~/Pictures/Markcraft and ~/Movies/Markcraft. */
  autoSave: boolean
}

const defaults: Settings = { mic: true, webcam: false, autoSave: true }

const file = () => join(app.getPath('userData'), 'settings.json')

let current: Settings | null = null

export function getSettings(): Settings {
  if (!current) {
    try {
      current = { ...defaults, ...JSON.parse(readFileSync(file(), 'utf8')) }
    } catch {
      current = { ...defaults }
    }
  }
  return current!
}

export function updateSettings(patch: Partial<Settings>): Settings {
  current = { ...getSettings(), ...patch }
  writeFileSync(file(), JSON.stringify(current, null, 2))
  return current
}
