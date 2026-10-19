import { api } from '../common/api'

async function start(): Promise<void> {
  const { filePath, url } = await api.playerInit()
  const name = filePath.split(/[\\/]/).pop() ?? filePath
  document.title = name
  document.getElementById('name')!.textContent = name
  ;(document.getElementById('video') as HTMLVideoElement).src = url
  document.getElementById('reveal')!.addEventListener('click', () => void api.revealFile(filePath))
  document.getElementById('save')!.addEventListener('click', () => void api.saveVideoAs(filePath))
}

void start()
