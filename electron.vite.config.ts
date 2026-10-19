import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

const page = (name: string) => resolve(__dirname, `src/renderer/${name}.html`)

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    build: {
      rollupOptions: {
        input: {
          overlay: page('overlay'),
          editor: page('editor'),
          recorder: page('recorder'),
          scroll: page('scroll'),
          picker: page('picker'),
          player: page('player'),
          frame: page('frame')
        }
      }
    }
  }
})
