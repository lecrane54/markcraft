import type { Rect, StreamTarget } from '../../shared/types'

/** Start the display stream the main process selected for this window. */
export async function openDisplayVideo(): Promise<{ stream: MediaStream; video: HTMLVideoElement }> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 30 } },
    audio: false
  })
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  await video.play()
  await nextFrame(video)
  return { stream, video }
}

export function nextFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => video.requestVideoFrameCallback(() => resolve()))
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop())
}

/** Map the CSS-pixel selection onto the video's pixel grid. */
export function sourceRect(video: HTMLVideoElement, target: StreamTarget): Rect {
  const sx = video.videoWidth / target.displaySize.width
  const sy = video.videoHeight / target.displaySize.height
  const x = Math.max(0, Math.round(target.rect.x * sx))
  const y = Math.max(0, Math.round(target.rect.y * sy))
  return {
    x,
    y,
    width: Math.min(video.videoWidth - x, Math.round(target.rect.width * sx)),
    height: Math.min(video.videoHeight - y, Math.round(target.rect.height * sy))
  }
}

/**
 * True when `src` is the whole video frame (within a pixel or two of rounding),
 * so the stream can be recorded as-is with no cropping canvas.
 */
export function coversWholeFrame(src: Rect, videoWidth: number, videoHeight: number): boolean {
  const slack = 2
  return (
    src.x <= slack &&
    src.y <= slack &&
    src.width >= videoWidth - slack &&
    src.height >= videoHeight - slack
  )
}
