/**
 * Draws the app icons.
 *
 *   npm run icon
 *
 * Run by hand, not by the build: the PNGs are committed, so installing the game
 * does not need a browser present at build time.
 *
 * The mark is the game's own characters in the game's own colours. It is a
 * logotype rather than a picture — nothing is drawn, everything is typed — and
 * it is rendered rather than hand-authored so that changing a colour means
 * changing one line and running this again.
 *
 * The art is wider than it is tall on purpose. A monospace cell is about 0.6 as
 * wide as it is high, so eleven rows of eleven characters is a tall rectangle,
 * not a square — which is exactly what the first version of this file produced.
 * The same correction the renderer makes for the view, and the automap for the
 * map, applies to a picture made of text.
 */

import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, type Browser } from 'playwright'

const OUT = resolve(process.cwd(), 'web/public')

/** The page background, which is also the manifest's background and theme. */
const GROUND = '#05050a'
const INK = '#e8c36a'
const FACE = 'ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace'

/**
 * A doorway seen head on: a bright outer wall, a dim inner one, and an opening.
 *
 * Eighteen columns to eleven rows, which is square once the cell shape is taken
 * into account. Kept coarse deliberately — at 192 pixels a glyph is about ten
 * across, so anything finer than a run of four turns to mud.
 */
const ART = [
  '@@@@@@@@@@@@@@@@@@',
  '@################@',
  '@#::::::::::::::#@',
  '@#:            :#@',
  '@#:    ####    :#@',
  '@#:    #@@#    :#@',
  '@#:    ####    :#@',
  '@#:            :#@',
  '@#::::::::::::::#@',
  '@################@',
  '@@@@@@@@@@@@@@@@@@',
]

/**
 * How wide a character cell is against its height, in this browser's monospace
 * face.
 *
 * Measured rather than assumed. The first version of this file carried the
 * number as a guess in the middle of a formula, and the formula was wrong in a
 * way the guess hid.
 */
async function cellAspect(browser: Browser): Promise<number> {
  const tab = await browser.newPage({ viewport: { width: 512, height: 512 } })
  await tab.setContent(
    `<style>pre{margin:0;display:inline-block;font-family:${FACE};font-size:100px;line-height:1;white-space:pre}</style>` +
      `<pre id="p">##########\n##########</pre>`,
  )
  const box = await tab.evaluate(() => {
    const element = document.getElementById('p')
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  })
  await tab.close()
  if (!box) throw new Error('could not measure a character cell')
  // Ten columns, two rows, at a font size of 100.
  return box.width / 10 / (box.height / 2)
}

function page(size: number, inset: number, aspect: number): string {
  const box = size * (1 - inset * 2)
  const columns = Math.max(...ART.map((row) => row.length))
  // Fit both ways round. Taking the smaller of the two is the whole of it, and
  // taking it against the wrong pair of terms is what made a tall rectangle.
  const fontSize = Math.min(box / ART.length, box / (columns * aspect))
  return `<!doctype html>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; width: ${size}px; height: ${size}px; background: ${GROUND}; }
  body { display: grid; place-items: center; }
  pre {
    margin: 0;
    font-family: ${FACE};
    font-size: ${fontSize}px;
    line-height: 1;
    color: ${INK};
    white-space: pre;
  }
</style>
<pre id="mark">${ART.join('\n')}</pre>`
}

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch()
const aspect = await cellAspect(browser)
console.log(`  cell aspect ${aspect.toFixed(4)}, art ${ART[0]!.length}x${ART.length}`)

for (const [name, size, inset] of [
  ['icon-192.png', 192, 0.08],
  ['icon-512.png', 512, 0.08],
  // A maskable icon is cropped to whatever shape the platform likes, inside a
  // safe zone of the middle 80%. Platforms crop well within that, so the mark
  // is kept smaller again.
  ['icon-maskable-512.png', 512, 0.22],
] as const) {
  const tab = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await tab.setContent(page(size, inset, aspect), { waitUntil: 'load' })

  // Printed so that a shape going wrong shows up as a number here before it
  // shows up as a picture nobody looked at.
  const drawn = await tab.evaluate(() => {
    const element = document.getElementById('mark')
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return { width: Math.round(rect.width), height: Math.round(rect.height) }
  })
  await tab.screenshot({ path: resolve(OUT, name) })
  await tab.close()
  console.log(`  wrote ${name} (${size}x${size}), mark ${drawn?.width}x${drawn?.height}`)
}

await browser.close()
