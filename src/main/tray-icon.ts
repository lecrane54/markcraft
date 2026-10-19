import { nativeImage, type NativeImage } from 'electron'

/**
 * Draw the menu-bar/tray icon in code (a viewfinder with a centre dot) so the
 * project needs no binary assets. Rendered at 2x for high-DPI displays.
 */
export function createTrayIcon(): NativeImage {
  const mac = process.platform === 'darwin'
  // macOS recolours black template images for light/dark menu bars. Windows and
  // Linux trays don't, so use the brand orange, which reads on both.
  const [red, green, blue] = mac ? [0, 0, 0] : [0xe8, 0x59, 0x0c]
  const scale = 2
  const size = 16 * scale
  const buf = Buffer.alloc(size * size * 4)
  const set = (x: number, y: number, a: number) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    // BGRA, premultiplied alpha
    const alpha = Math.max(buf[i + 3], Math.round(a * 255))
    buf[i] = Math.round((blue * alpha) / 255)
    buf[i + 1] = Math.round((green * alpha) / 255)
    buf[i + 2] = Math.round((red * alpha) / 255)
    buf[i + 3] = alpha
  }
  const stroke = 2 * scale - 1
  const arm = 5 * scale
  const lo = 1 * scale
  const hi = size - 1 * scale - 1
  for (let t = 0; t < arm; t++) {
    for (let w = 0; w < stroke; w++) {
      // four corner brackets
      for (const [cx, cy, dx, dy] of [
        [lo, lo, 1, 1],
        [hi, lo, -1, 1],
        [lo, hi, 1, -1],
        [hi, hi, -1, -1]
      ]) {
        set(cx + dx * t, cy + dy * w, 1)
        set(cx + dx * w, cy + dy * t, 1)
      }
    }
  }
  // centre dot, anti-aliased
  const c = (size - 1) / 2
  const r = 3 * scale
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c)
      if (d < r + 1) set(x, y, Math.min(1, r + 1 - d))
    }
  }
  const image = nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: scale })
  if (mac) image.setTemplateImage(true)
  return image
}
