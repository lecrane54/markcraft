import { api } from '../common/api'
import { openDisplayVideo, stopStream } from '../common/stream'

const grid = document.getElementById('grid')!
const empty = document.getElementById('empty')!

async function load(): Promise<void> {
  grid.replaceChildren()
  empty.hidden = true
  const sources = await api.pickerSources()
  if (!sources.length) {
    empty.textContent =
      'No windows found. Make sure Markcraft has Screen Recording permission, then click Refresh.'
    empty.hidden = false
    return
  }
  for (const s of sources) {
    const card = document.createElement('button')
    card.className = 'card'
    card.title = s.name
    const thumb = document.createElement('div')
    thumb.className = 'thumb'
    const img = document.createElement('img')
    img.src = s.thumbnail
    img.alt = ''
    thumb.append(img)
    const name = document.createElement('div')
    name.className = 'name'
    if (s.appIcon) {
      const icon = document.createElement('img')
      icon.src = s.appIcon
      icon.alt = ''
      name.append(icon)
    }
    const label = document.createElement('span')
    label.textContent = s.name
    name.append(label)
    card.append(thumb, name)
    card.addEventListener('click', () => void capture(s.id))
    grid.append(card)
  }
}

/** Stream the chosen window briefly and keep one full-resolution frame. */
async function capture(id: string): Promise<void> {
  if (!(await api.pickerChoose(id))) return load()
  document.body.style.opacity = '0.5'
  try {
    const { stream, video } = await openDisplayVideo()
    const c = document.createElement('canvas')
    c.width = video.videoWidth
    c.height = video.videoHeight
    c.getContext('2d')!.drawImage(video, 0, 0)
    stopStream(stream)
    api.pickerDone(c.toDataURL('image/png'))
  } catch (err) {
    document.body.style.opacity = ''
    empty.textContent = `Couldn’t capture that window: ${(err as Error).message}`
    empty.hidden = false
  }
}

document.getElementById('refresh')!.addEventListener('click', () => void load())
document.getElementById('cancel')!.addEventListener('click', () => api.pickerDone(null))
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.pickerDone(null)
})

void load()
