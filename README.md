# Markcraft

A menu-bar screen capture tool: region, window and full-screen screenshots, an
annotation editor, scrolling capture, text grabbing (OCR) and screen recording.
Built with Electron + TypeScript.

## Run it

```sh
npm install
npx install-electron   # npm blocks install scripts by default; this fetches the Electron binary
npm run dev            # hot-reloading development build
```

Markcraft lives in the menu bar (the viewfinder icon). On macOS, the first capture
asks for **Screen & System Audio Recording** permission. In development the
permission belongs to **Electron**, not Markcraft. Grant it in System Settings →
Privacy & Security, then restart the app.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| ⌃⇧1 | Capture region: drag a rectangle, click for the whole screen, Esc to cancel |
| ⌃⇧2 | Capture window: pick from a grid of open windows |
| ⌃⇧3 | Capture the screen under the pointer |
| ⌃⇧4 | Scrolling capture: select the scrolling area, click **Start**, scroll slowly, then **Done** |
| ⌃⇧5 | Record screen: select an area, toggle mic/webcam, then **Record** |

(⌘⇧3/4/5 are left alone because macOS uses them for its own screenshots.)

### Editor

| Key | Tool |
| --- | --- |
| V | Select / move |
| A | Arrow |
| L | Line |
| R | Rectangle |
| E | Ellipse |
| T | Text |
| N | Step number (auto-increments) |
| H | Highlighter |
| P | Pen |
| B | Pixelate (redact) |
| C | Crop (drag, then Enter) |

⌘Z / ⇧⌘Z undo/redo, ⌘C or ⇧⌘C copies the annotated image, ⇧⌘T grabs text,
⌘S / ⇧⌘S save. Save as **PNG/JPEG** to flatten, or as **.markcraft** to keep the
annotations editable. Every capture's original is also auto-saved to
`~/Pictures/Markcraft` (turn this off in the tray menu). Recordings go to
`~/Movies/Markcraft`.

## How it works

| Feature | Implementation |
| --- | --- |
| Capture | `desktopCapturer` thumbnails at native resolution freeze each display; a full-screen overlay per display handles selection, and the main process crops from the lossless image. |
| Window capture | `getDisplayMedia` on the chosen window (answered by `setDisplayMediaRequestHandler`), keeping one full-resolution frame. |
| Editor | Fabric.js canvas. The capture is a locked background image, and annotations are objects in image-pixel coordinates. Undo is snapshot-based. |
| Scrolling capture | Samples the region every 100 ms and matches row signatures to find the scroll offset. Sticky headers/footers are detected and kept once (`src/renderer/scroll/stitcher.ts`). |
| OCR | `tesseract.js` in the main process, with English data bundled so it works offline. The engine warms up when an editor opens and shuts down after 5 idle minutes. |
| Recording | The display stream is cropped onto a canvas, with an optional mirrored circular webcam and mic audio, then `MediaRecorder` (MP4/H.264 when supported, otherwise WebM). Chunks stream to disk. |

## Scripts

- `npm test`: stitcher unit tests (Node's built-in test runner)
- `npm run typecheck`
- `npm run build && npx electron test/smoke.cjs out.png`: opens a generated image in the editor, draws with every shape tool, checks undo and redo by comparing canvas pixels, and screenshots the window
- `npm run dist`: package with electron-builder

## Packaging

electron-builder turns the same code into each platform's installer. Output goes to `dist/`.

| Command | Produces |
| --- | --- |
| `npm run pack` | Unpacked app for this machine (quick test) |
| `npm run dist:mac:unsigned` | `.dmg` for Apple Silicon and Intel, ad-hoc signed |
| `npm run dist:mac` | Same, signed and notarized (needs a Developer ID, see below) |
| `npm run dist:win` | NSIS installer `.exe`, one each for x64 and arm64 |
| `npm run dist:linux` | `.AppImage` (x64, arm64) |

All of them can be built from a Mac. `.github/workflows/build.yml` builds each one on
its own OS on every push and attaches them to a draft GitHub release when you push
a `v*` tag.

The app icon is generated from `build/icon.svg`. Run `npm run icon` after editing it.

To keep downloads small, builds ship only English Electron UI strings
(`electronLanguages`) and only the three tesseract engine variants Node actually
loads. The `files` excludes in `package.json` list exactly what's dropped.

### Signing

Unsigned apps still work, but users will see warnings:

- **macOS:** without a Developer ID, the app is ad-hoc signed. Other people's Macs
  will block it until they right-click → Open (or allow it in Privacy & Security).
  Screen-recording permission also resets with each new build. To sign and notarize, join the
  Apple Developer Program, then set the `MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD`,
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` repo secrets.
- **Windows:** unsigned installers show a SmartScreen "unknown publisher" warning.
  Add a code-signing certificate as `WIN_CERT_PFX_BASE64` / `WIN_CERT_PASSWORD`, or
  use Azure Trusted Signing.
- **Linux:** no signing needed.

### Platform notes

- **Windows:** everything works, including the global shortcuts.
- **Linux:** works on X11. On Wayland, apps can't take screenshots or register
  global shortcuts directly. Capture goes through the desktop's screen-sharing
  prompt, and you'll need to bind the shortcuts in your desktop settings. Some
  desktops need an AppIndicator extension for the tray icon.

## Not yet built

- Auto-scrolling for scrolling capture (needs a native input module); scrolling
  is manual and downward-only for now
- Video trimming; the player only plays, saves and reveals the file
- System-audio recording
- Hover-to-highlight windows in the region overlay (use ⌃⇧2 for windows)
