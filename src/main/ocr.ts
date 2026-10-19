import { app, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createWorker, type Worker } from 'tesseract.js'

/** Free the OCR engine (~100 MB) after this long without use. */
const IDLE_MS = 5 * 60 * 1000

let worker: Promise<Worker> | null = null
let idleTimer: NodeJS.Timeout | null = null

/** English data ships with the app, so OCR works offline with no first-use download. */
function langPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'tessdata')
    : join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int')
}

function getWorker(): Promise<Worker> {
  if (!worker) {
    const dir = langPath()
    // tesseract.js throws a missing data file as an uncaught exception (an error
    // dialog in Electron's main process) rather than rejecting, so check first.
    worker = existsSync(join(dir, 'eng.traineddata.gz'))
      ? createWorker('eng', undefined, { langPath: dir, cacheMethod: 'none' })
      : Promise.reject(new Error(`OCR language data is missing from ${dir}`))
    worker.catch(() => (worker = null))
  }
  scheduleIdleShutdown()
  return worker
}

function scheduleIdleShutdown(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => void shutdownOcr(), IDLE_MS)
}

/** Start the engine in the background so the first Grab Text is quick. */
export function warmOcr(): void {
  void getWorker().catch(() => undefined)
}

export async function recognizeText(dataUrl: string): Promise<string> {
  const image = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
  const { data } = await (await getWorker()).recognize(image)
  scheduleIdleShutdown()
  return data.text.trim()
}

export async function shutdownOcr(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  const w = worker
  worker = null
  if (w) await (await w).terminate().catch(() => undefined)
}

ipcMain.handle('ocr:recognize', (_e, dataUrl: string) => recognizeText(dataUrl))
