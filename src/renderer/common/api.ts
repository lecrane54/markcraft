import type { MarkcraftApi } from '../../preload'

declare global {
  interface Window {
    markcraft: MarkcraftApi
  }
}

export const api = window.markcraft
