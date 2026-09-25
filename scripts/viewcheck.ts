/**
 * The built page, in a real browser, looked at.
 *
 *   npm run viewcheck
 *
 * Two things only a browser can answer. The cell aspect is measured off the
 * real font, and everything about the projection depends on it. And a page
 * that throws on boot fails no check written in Node -- every assertion here
 * would pass against a module that never runs.
 *
 * The server deliberately serves the site under `/ascii-doom/` rather than at
 * the root, because that is what GitHub Pages does and `base` in the Vite
 * config has to match it. A page that works at the root and 404s on Pages is
 * the failure this arrangement is here to catch.
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize, resolve } from 'node:path'
import { chromium, type Page } from 'playwright'

const DIST = resolve(process.cwd(), 'dist')
const SHOTS = resolve(process.cwd(), 'shots')
const BASE_PATH = '/ascii-doom/'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

let failed = 0

function check(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`  ok    ${name}`)
  } catch (error) {
    failed++
    console.log(`  FAIL  ${name}`)
    console.log(`        ${(error as Error).message}`)
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

interface Probe {
  cols: number
  rows: number
  cellAspect: number
  frames: number
  /** Non-space cells, which is the only evidence anything was drawn. */
  glyphs: number
  /** The distinct characters on screen, for a readable failure message. */
  sample: string
  overflow: boolean
}

function readScreen(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const probe = (window as unknown as { __doom?: Record<string, number> }).__doom ?? {}
    const text = document.getElementById('screen')?.textContent ?? ''
    const distinct = new Set<string>()
    let glyphs = 0
    for (const ch of text) {
      if (ch === '\n' || ch === ' ') continue
      glyphs++
      distinct.add(ch)
    }
    const root = document.documentElement
    return {
      cols: probe.cols ?? 0,
      rows: probe.rows ?? 0,
      cellAspect: probe.cellAspect ?? 0,
      frames: probe.frames ?? 0,
      glyphs,
      sample: [...distinct].sort().join(''),
      overflow: root.scrollWidth > root.clientWidth,
    }
  })
}

const server = createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0]!
  if (!url.startsWith(BASE_PATH)) {
    // Exactly what Pages does for a path outside the project: nothing here.
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end(`not under ${BASE_PATH}`)
    return
  }
  const rest = url.slice(BASE_PATH.length)
  const candidate = join(DIST, normalize(rest).replace(/^(\.\.[/\\])+/, ''))
  const file = existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(DIST, 'index.html')
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
})

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`no build at ${DIST} -- run "npm run build" first`)
  process.exit(1)
}
mkdirSync(SHOTS, { recursive: true })

await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${BASE_PATH}`

const browser = await chromium.launch()
const context = await browser.newContext()
const page = await context.newPage()

const problems: string[] = []
page.on('pageerror', (error) => problems.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(message.text())
})
// A missing asset is a 200 from a dev server and a 404 from Pages, so watch
// the status rather than trusting that the page looked fine.
const missing: string[] = []
page.on('response', (response) => {
  if (response.status() >= 400) missing.push(`${response.status()} ${response.url()}`)
})

await page.setViewportSize({ width: 1280, height: 720 })
await page.goto(base, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)

const first = await readScreen(page)
await page.waitForTimeout(500)
const second = await readScreen(page)

check('the page boots without throwing', () => {
  assert(problems.length === 0, problems.join(' | '))
})

check('every asset the page asks for is served under the Pages base path', () => {
  assert(missing.length === 0, missing.join(' | '))
})

check('the screen is filled with a grid, not left empty', () => {
  assert(first.cols > 20 && first.rows > 10, `grid is ${first.cols}x${first.rows}`)
  assert(first.glyphs > 100, `only ${first.glyphs} glyphs drawn: "${first.sample}"`)
})

check('the cell aspect is measured, and plausible for a monospace font', () => {
  // Nothing in Node can see this number, and the whole projection rides on it.
  assert(
    first.cellAspect > 0.35 && first.cellAspect < 0.85,
    `cell aspect ${first.cellAspect} is not a plausible character cell`,
  )
})

check('frames keep being drawn', () => {
  assert(second.frames > first.frames, `frame counter stuck at ${first.frames}`)
})

await page.screenshot({ path: join(SHOTS, 'desktop.png') })

const phone = await context.newPage()
await phone.setViewportSize({ width: 390, height: 844 })
await phone.goto(base, { waitUntil: 'domcontentloaded' })
await phone.waitForTimeout(900)
const small = await readScreen(phone)

check('a phone-width viewport neither overflows nor collapses', () => {
  assert(!small.overflow, 'the page scrolls sideways at 390px')
  assert(small.cols > 20 && small.rows > 20, `grid collapsed to ${small.cols}x${small.rows}`)
  assert(small.glyphs > 50, `nothing was drawn at phone width: ${small.glyphs} glyphs`)
})

await phone.screenshot({ path: join(SHOTS, 'phone.png') })

console.log(
  `  grid ${first.cols}x${first.rows} cells, cell aspect ${first.cellAspect.toFixed(3)}, ` +
    `phone ${small.cols}x${small.rows}`,
)

await browser.close()
server.close()

console.log(failed === 0 ? 'all browser checks passed' : `${failed} browser check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
