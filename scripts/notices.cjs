// Writes THIRD_PARTY_NOTICES.txt: the license text of every third-party
// package that ships inside Markcraft. MIT, BSD and Apache-2.0 all require
// their notices to travel with redistributed copies.
// Usage: npm run notices (CI fails if the committed file is out of date)
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
// Runtime dependencies (packaged into the app) plus fabric, which Vite compiles
// into the editor's JavaScript so its own LICENSE file doesn't ship.
const ENTRY_POINTS = ['tesseract.js', 'fabric']

function readPackage(name) {
  const dir = path.join(ROOT, 'node_modules', name)
  return { dir, pkg: JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) }
}

function licenseText(dir) {
  const file = fs.readdirSync(dir).find((f) => /^licen[cs]e/i.test(f))
  return file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : null
}

const seen = new Map()
function collect(name) {
  if (seen.has(name)) return
  const { dir, pkg } = readPackage(name)
  seen.set(name, { version: pkg.version, license: pkg.license, homepage: pkg.homepage, text: licenseText(dir) })
  for (const dep of Object.keys(pkg.dependencies ?? {})) collect(dep)
}
ENTRY_POINTS.forEach(collect)

const missing = [...seen].filter(([, p]) => !p.text).map(([n]) => n)
if (missing.length) {
  console.error(`No license file found for: ${missing.join(', ')}. Add the text to this script.`)
  process.exit(1)
}

const rule = '='.repeat(78)
const sections = [...seen]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, p]) =>
    [`${name} ${p.version} (${p.license})`, p.homepage ? p.homepage : null, '', p.text].filter((l) => l !== null).join('\n')
  )

// tesseract.js-core is the Tesseract engine compiled to WebAssembly together with
// these libraries (its third_party/ submodules, at the commits it pins). Their
// license texts are vendored in scripts/licenses/ since the package omits them.
const COMPILED_IN = [
  { name: 'tesseract', source: 'https://github.com/tesseract-ocr/tesseract (via Balearica/tesseract)', commit: '2a9c1c49c360462733c386d2a44fcd22c4e21411' },
  { name: 'leptonica', source: 'https://github.com/DanBloomberg/leptonica', commit: '4af068b56a9674da915debea4ed7e1b9885b17e8' },
  { name: 'libjpeg', source: 'https://github.com/LuaDist/libjpeg (IJG libjpeg)', commit: '6c0fcb8ddee365e7abc4d332662b06900612e923' },
  { name: 'libpng', source: 'https://github.com/glennrp/libpng', commit: 'a37d4836519517bdce6cb9d956092321eca3e73b' },
  { name: 'libtiff', source: 'https://gitlab.com/libtiff/libtiff', commit: 'b51bb157123264e26d34c09cc673d213aea61fc7' },
  { name: 'libwebp', source: 'https://github.com/webmproject/libwebp', commit: '20ef03ee351d4ff03fc5ff3ec4804a879d1b9d5c' },
  { name: 'giflib', source: 'https://github.com/mirrorer/giflib', commit: 'fa37672085ce4b3d62c51627ab3c8cf2dda8009a' },
  { name: 'zlib', source: 'https://github.com/madler/zlib', commit: '21767c654d31d2dccdde4330529775c6c5fd5389' },
  { name: 'openlibm', source: 'https://github.com/JuliaMath/openlibm', commit: 'ae2d91698508701c83cab83714d42a1146dccf85' }
]
for (const lib of COMPILED_IN) {
  const text = fs.readFileSync(path.join(__dirname, 'licenses', `${lib.name}.txt`), 'utf8').trim()
  sections.push(
    [`${lib.name} (compiled into tesseract.js-core)`, `${lib.source} @ ${lib.commit}`, '', text].join('\n')
  )
}

// The English OCR model ships as a plain data file, outside node_modules.
const tessdata = readPackage('@tesseract.js-data/eng').pkg
sections.push(
  [
    `eng.traineddata (from @tesseract.js-data/eng ${tessdata.version})`,
    'https://github.com/tesseract-ocr/tessdata_best',
    '',
    'English language data for the Tesseract OCR engine, created by the Tesseract',
    'OCR project and licensed under the Apache License, Version 2.0 (full text in',
    'the tesseract.js section above). Repackaged for npm by the tesseract.js',
    `project (${tessdata.homepage}), whose package declares the ${tessdata.license} license.`
  ].join('\n')
)

const out = [
  'THIRD-PARTY SOFTWARE NOTICES',
  '',
  'Markcraft is MIT-licensed (see LICENSE.txt). It includes the third-party software',
  'below, each under its own license. The licenses of Electron and Chromium (and',
  'the projects Chromium includes) are in LICENSE.electron.txt and',
  'LICENSES.chromium.html, which are installed with the app.',
  '',
  ...sections.flatMap((s) => [rule, s, ''])
].join('\n')

fs.writeFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.txt'), out)
console.log(`THIRD_PARTY_NOTICES.txt: ${seen.size + COMPILED_IN.length + 1} components`)
