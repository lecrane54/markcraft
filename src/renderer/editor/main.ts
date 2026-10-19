import type { MenuCommand } from '../../shared/types'
import { api } from '../common/api'
import { EditorDoc } from './doc'
import { History } from './history'
import { icons } from './icons'
import { Tools, type Style, type ToolName } from './tools'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

const TOOLS: { name: ToolName; label: string; key: string }[] = [
  { name: 'select', label: 'Select', key: 'v' },
  { name: 'arrow', label: 'Arrow', key: 'a' },
  { name: 'line', label: 'Line', key: 'l' },
  { name: 'rect', label: 'Rectangle', key: 'r' },
  { name: 'ellipse', label: 'Ellipse', key: 'e' },
  { name: 'text', label: 'Text', key: 't' },
  { name: 'step', label: 'Step number', key: 'n' },
  { name: 'highlight', label: 'Highlight', key: 'h' },
  { name: 'pen', label: 'Pen', key: 'p' },
  { name: 'redact', label: 'Pixelate', key: 'b' },
  { name: 'block', label: 'Redact (solid box)', key: 'x' },
  { name: 'crop', label: 'Crop', key: 'c' }
]

const COLORS = ['#e8590c', '#e03131', '#f2c94c', '#2f9e44', '#1c7ed6', '#7048e8', '#111111', '#ffffff']

const style: Style = { color: COLORS[0], width: 5, fontSize: 36 }
let filePath: string | null = null
let title = 'Markcraft'

const doc = new EditorDoc($<HTMLCanvasElement>('canvas'))
const history = new History(doc)
const tools = new Tools(doc, () => style)

// ---- toolbar ---------------------------------------------------------------------

const toolButtons = new Map<ToolName, HTMLButtonElement>()
for (const t of TOOLS) {
  const b = document.createElement('button')
  b.className = 'tool'
  b.innerHTML = icons[t.name]
  b.title = `${t.label} (${t.key.toUpperCase()})`
  b.setAttribute('aria-label', t.label)
  b.addEventListener('click', () => selectTool(t.name))
  $('tools').append(b)
  toolButtons.set(t.name, b)
}

function selectTool(name: ToolName): void {
  tools.setTool(name)
  for (const [n, b] of toolButtons) b.setAttribute('aria-pressed', String(n === name))
}

const swatches: HTMLButtonElement[] = []
for (const c of COLORS) {
  const b = document.createElement('button')
  b.className = 'swatch'
  b.style.background = c
  b.title = c
  b.addEventListener('click', () => setColor(c))
  $('swatches').append(b)
  swatches.push(b)
}
const custom = document.createElement('input')
custom.type = 'color'
custom.id = 'custom-color'
custom.title = 'Custom colour'
custom.addEventListener('input', () => setColor(custom.value))
$('swatches').append(custom)

function setColor(c: string): void {
  style.color = c
  custom.value = c
  swatches.forEach((b, i) => b.setAttribute('aria-pressed', String(COLORS[i] === c)))
  tools.applyStyle()
}

$<HTMLInputElement>('width').addEventListener('input', (e) => {
  style.width = Number((e.target as HTMLInputElement).value)
  tools.applyStyle()
})
$<HTMLInputElement>('font-size').addEventListener('input', (e) => {
  style.fontSize = Number((e.target as HTMLInputElement).value)
  tools.applyStyle()
})

const actionButtons: Record<string, HTMLButtonElement> = {}
for (const [id, label, icon, run] of [
  ['undo', 'Undo (⌘Z)', icons.undo, () => history.undo()],
  ['redo', 'Redo (⇧⌘Z)', icons.redo, () => history.redo()],
  ['ocr', 'Grab text (⇧⌘T)', icons.ocr, grabText],
  ['copy', 'Copy image (⇧⌘C)', icons.copy, copyImage],
  ['save', 'Save As… (⇧⌘S)', icons.save, saveAs]
] as const) {
  const b = document.createElement('button')
  b.className = 'tool'
  b.innerHTML = icon
  b.title = label
  b.setAttribute('aria-label', label)
  b.addEventListener('click', () => void run())
  $('actions').append(b)
  actionButtons[id] = b
}

history.onChange = () => {
  actionButtons.undo.disabled = !history.canUndo
  actionButtons.redo.disabled = !history.canRedo
}

tools.onCommit = () => {
  history.commit()
  markDirty()
}
doc.canvas.on('object:modified', tools.onCommit)

tools.onCropChange = (active) => {
  $('crop-bar').hidden = !active
}
$('crop-apply').addEventListener('click', () => tools.applyCrop())
$('crop-cancel').addEventListener('click', () => tools.cancelCrop())

// ---- zoom & layout --------------------------------------------------------------

const stage = $('stage')

/** True until the user picks a zoom level; then window resizes stop refitting. */
let autoFit = true

function fit(): void {
  autoFit = true
  doc.applyZoom(doc.fitZoom(stage.clientWidth - 48, stage.clientHeight - 48))
}

function zoomTo(z: number): void {
  autoFit = false
  doc.applyZoom(z)
}

doc.onLayout = () => {
  $('zoom-label').textContent = `${Math.round(doc.zoom * 100)}%`
  $('dims').textContent = `${doc.width} × ${doc.height} px`
}

const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.5, 2, 3, 4, 6, 8]
function zoomStep(dir: 1 | -1): void {
  const z = doc.zoom
  const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z + 0.001) : [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001)
  zoomTo(next ?? z)
}

$('zoom-in').addEventListener('click', () => zoomStep(1))
$('zoom-out').addEventListener('click', () => zoomStep(-1))
$('zoom-label').addEventListener('click', fit)

// ---- actions ----------------------------------------------------------------------

let messageTimer = 0
function flash(text: string): void {
  $('message').textContent = text
  clearTimeout(messageTimer)
  messageTimer = window.setTimeout(() => ($('message').textContent = ''), 2500)
}

function markDirty(): void {
  document.title = `${title} — edited`
}

function markSaved(path: string): void {
  filePath = path
  title = path.split(/[\\/]/).pop() ?? title
  document.title = title
}

async function copyImage(): Promise<void> {
  await api.copyImage(doc.flatten())
  flash('Image copied to clipboard')
}

async function saveAs(): Promise<void> {
  const saved = await api.saveAs({ png: doc.flatten(), doc: doc.toSnapDoc(), defaultName: baseName() })
  if (!saved) return
  // Only an editable .markcraft becomes this window's file; exports leave it as-is.
  if (saved.toLowerCase().endsWith('.markcraft')) markSaved(saved)
  flash(`Saved ${saved.split(/[\\/]/).pop()}`)
}

async function save(): Promise<void> {
  if (filePath?.toLowerCase().endsWith('.markcraft')) {
    await api.saveDoc(filePath, doc.toSnapDoc())
    markSaved(filePath)
    flash('Saved')
  } else {
    await saveAs()
  }
}

function baseName(): string {
  return title.replace(/\.[^.]+$/, '')
}

async function grabText(): Promise<void> {
  $('ocr-panel').hidden = false
  const status = $('ocr-status')
  const area = $<HTMLTextAreaElement>('ocr-text')
  status.textContent = 'Recognising text…'
  area.value = ''
  try {
    const text = await api.ocr(doc.flatten())
    area.value = text
    status.textContent = text ? `${text.split(/\s+/).filter(Boolean).length} words` : 'No text found'
  } catch (err) {
    status.textContent = `Couldn’t read text: ${(err as Error).message}`
  }
  fit()
}

$('ocr-close').addEventListener('click', () => {
  $('ocr-panel').hidden = true
  fit()
})
$('ocr-copy').addEventListener('click', async () => {
  await api.copyText($<HTMLTextAreaElement>('ocr-text').value)
  flash('Text copied to clipboard')
})

function deleteSelection(): void {
  const c = doc.canvas
  const selected = c.getActiveObjects()
  if (!selected.length) return
  c.discardActiveObject()
  for (const o of selected) c.remove(o)
  c.requestRenderAll()
  tools.onCommit()
}

// ---- keyboard & menu --------------------------------------------------------------

const editingText = () => {
  const active = doc.canvas.getActiveObject() as { isEditing?: boolean } | undefined
  const el = document.activeElement
  return Boolean(active?.isEditing) || el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement
}

window.addEventListener('keydown', (e) => {
  if (editingText()) return
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const key = e.key.toLowerCase()
  if (key === 'backspace' || key === 'delete') {
    e.preventDefault()
    deleteSelection()
    return
  }
  if (key === 'enter' && tools.cropping) return tools.applyCrop()
  if (key === 'escape') {
    if (tools.cropping) return tools.cancelCrop()
    doc.canvas.discardActiveObject()
    doc.canvas.requestRenderAll()
    return
  }
  const tool = TOOLS.find((t) => t.key === key)
  if (tool) selectTool(tool.name)
})

// Edit ▸ Copy copies the whole annotated image unless text is being edited.
document.addEventListener('copy', (e) => {
  if (editingText()) return
  e.preventDefault()
  void copyImage()
})

const commands: Record<MenuCommand, () => unknown> = {
  save,
  saveAs,
  copyImage,
  undo: () => history.undo(),
  redo: () => history.redo(),
  zoomIn: () => zoomStep(1),
  zoomOut: () => zoomStep(-1),
  zoomFit: fit,
  zoomActual: () => zoomTo(1),
  ocr: grabText
}
api.onMenu((cmd) => void commands[cmd]?.())

// ---- startup ------------------------------------------------------------------------

async function start(): Promise<void> {
  const init = await api.editorInit()
  title = init.title
  document.title = title
  filePath = init.filePath ?? null
  if (init.kind === 'doc') await doc.loadDoc(init.doc)
  else await doc.loadImage(init.dataUrl)
  fit()
  history.commit()
  selectTool('arrow')
  setColor(style.color)
  new ResizeObserver(() => {
    // Refit on the next frame: resizing the canvas inside the callback would
    // trigger another observation in the same frame.
    if (autoFit) requestAnimationFrame(fit)
  }).observe(stage)
}

void start()
