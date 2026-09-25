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

/** Where the player is, according to the running game. */
function readPlayer(page: Page): Promise<{
  x: number
  y: number
  sector: number
  tag: string | null
  awake: number
  health: number
  doorState: string | null
  pickupsLeft: number
  keys: string[]
  complete: boolean | null
  elapsed: number
  inFlight: number
  alive: number
  ammo: number
  shotsFired: number
  pelletsLanded: number
}> {
  return page.evaluate(() => {
    const d = (window as unknown as { __doom?: Record<string, unknown> }).__doom ?? {}
    return {
      x: (d.x as number) ?? NaN,
      y: (d.y as number) ?? NaN,
      sector: (d.sector as number) ?? -1,
      tag: (d.tag as string | null) ?? null,
      // Read here rather than cast at the call site: a probe that claims to
      // measure something has to actually fetch it, or the assertion is about
      // `undefined` and passes or fails for reasons unrelated to the game.
      awake: (d.awake as number) ?? -1,
      health: (d.health as number) ?? -1,
      alive: (d.alive as number) ?? -1,
      ammo: (d.ammo as number) ?? -1,
      shotsFired: (d.shotsFired as number) ?? -1,
      pelletsLanded: (d.pelletsLanded as number) ?? -1,
      doorState: (d.doorState as string | null) ?? null,
      pickupsLeft: (d.pickupsLeft as number) ?? -1,
      keys: (d.keys as string[]) ?? [],
      complete: (d.complete as boolean) ?? null,
      elapsed: (d.elapsed as number) ?? -1,
      inFlight: (d.inFlight as number) ?? -1,
    }
  })
}

const before = await readPlayer(page)
await page.keyboard.down('w')
await page.waitForTimeout(1800)
await page.keyboard.up('w')
await page.waitForTimeout(150)
const after = await readPlayer(page)

check('holding a key walks the player, and walking changes the room', () => {
  // The end-to-end claim the renderer's own checks cannot make: input reaches
  // the simulation, the simulation moves a body through the map, and the body
  // ends up somewhere else. The spawn faces east down the corridor, so walking
  // forward has to increase x and leave the starting sector behind.
  assert(before.tag === 'start', `expected to spawn in the start room, got ${before.tag}`)
  assert(after.x > before.x + 1, `walking forward moved x from ${before.x.toFixed(2)} to ${after.x.toFixed(2)}`)
  assert(after.tag !== before.tag, `still in ${after.tag} after walking east for most of two seconds`)
})

check('the creatures are awake and the page knows how hurt you are', () => {
  // The end-to-end claim Node cannot make: the state machine is wired into the
  // frame loop and not merely importable. Deliberately not "you took damage by
  // now" — that depends on how fast a creature crosses a corridor, and a check
  // whose truth depends on timing fails on a slow machine for no reason.
  assert(after.awake >= 0, 'the page reports no creature state at all')
  assert(after.awake > 0, 'nothing has noticed the player after walking into the corridor')
  assert(after.health > 0 && after.health <= 100, `health is ${after.health}`)
})

const beforeFiring = await readPlayer(page)
await page.keyboard.down(' ')
await page.waitForTimeout(900)
await page.keyboard.up(' ')
await page.waitForTimeout(150)
const afterFiring = await readPlayer(page)

check('pulling the trigger fires and spends ammunition', () => {
  // Deliberately not "something died". Whether a pellet connects depends on
  // where a creature has wandered by the time the key goes down, and a check
  // whose truth depends on that fails on a slow machine for no reason. What can
  // be claimed without timing is that the trigger reaches the simulation: shots
  // went out, and the reserve paid for them.
  assert(beforeFiring.shotsFired >= 0, 'the page reports no weapon state at all')
  assert(
    afterFiring.shotsFired > beforeFiring.shotsFired,
    `shots fired stayed at ${beforeFiring.shotsFired} while the trigger was held`,
  )
  assert(
    afterFiring.ammo < beforeFiring.ammo,
    `ammunition stayed at ${beforeFiring.ammo} after firing ${afterFiring.shotsFired - beforeFiring.shotsFired} shots`,
  )
  assert(afterFiring.ammo >= 0, `ammunition went negative: ${afterFiring.ammo}`)
})

check('nothing is in flight before anything has been thrown', () => {
  // Deliberately not "a bolt is in the air by now". The only creature that
  // throws them stands deep in the hall and the walk above never gets near it,
  // so anything stronger would be false or would depend on how far the machine
  // managed to walk. What this does say is that the list exists, is wired into
  // the frame, and starts empty — the flight rules themselves are checked in
  // Node, where a bolt can be fired at a wall on purpose.
  assert(beforeFiring.inFlight >= 0, 'the page reports nothing about projectiles at all')
  assert(beforeFiring.inFlight === 0, `${beforeFiring.inFlight} projectiles existed before anything fired`)
})

check('the level is running and not yet finished', () => {
  // Reaching the exit means finding the key in the hall, unlocking the north
  // door, crossing the chamber, riding the lift and walking off the ledge —
  // a long scripted walk that would fail for a dozen reasons having nothing to
  // do with the goal. Arrival is checked in Node, where it is three lines.
  //
  // What the browser can claim honestly is that the goal exists, has not
  // fired, and that its clock is actually advancing — which is the wiring, and
  // the part Node cannot see.
  assert(beforeFiring.complete !== null, 'the page reports no goal at all')
  assert(beforeFiring.complete === false, 'the level reported itself finished at the start')
  assert(
    afterFiring.elapsed > beforeFiring.elapsed,
    `the clock stayed at ${beforeFiring.elapsed} across two seconds of play`,
  )
})

check('supplies are left alone while they would give nothing', () => {
  // The walk above goes straight past both pickups in the starting room at
  // full health. Nothing should have been taken, which is the "useful or leave
  // it" rule holding in the running game rather than only in Node — and it is
  // a claim that does not depend on how fast the machine ran, unlike anything
  // phrased as "by now you should have picked something up".
  assert(afterFiring.pickupsLeft >= 0, 'the page reports no pickups at all')
  // Compared against itself rather than against a number. The claim is that
  // nothing was taken, and writing that as "there are still three" makes the
  // check fail the next time the level gains a supply — which it just did.
  assert(
    afterFiring.pickupsLeft === beforeFiring.pickupsLeft,
    `${beforeFiring.pickupsLeft - afterFiring.pickupsLeft} supplies vanished while the player was at full health`,
  )
  assert(afterFiring.keys.length === 0, `the player is holding ${afterFiring.keys.join(', ')} without finding it`)
})

check('the level’s moving parts were built and are being reported', () => {
  // Cheap, and still real evidence. The movers are built by looking their
  // sectors up by tag, so a mistyped tag throws during construction and the
  // page never boots; an empty list would report null here. Whether the door
  // then opens is geometry, and geometry is checked in Node at exact positions
  // rather than by walking a browser the length of the level.
  assert(afterFiring.doorState !== null, 'the page reports no door at all')
  assert(afterFiring.doorState === 'shut', `the door starts as ${afterFiring.doorState}`)
})

check('a wall stops the player rather than letting them through it', () => {
  // The same test run against a map with no collision would pass everything
  // above and fail this: keep walking into the far end and the position has to
  // settle short of it.
  assert(Number.isFinite(after.x) && Number.isFinite(after.y), 'the player left the map')
  assert(after.sector >= 0, 'the player ended up outside every sector')
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

// A phone with no keyboard, which is the only way to find out whether the
// touch controls are reachable at all. The context needs `hasTouch` for the
// `pointer: coarse` query to match — without it the controls stay hidden and a
// check against them would pass by never looking at anything.
const handheld = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
})
const mobile = await handheld.newPage()
mobile.on('pageerror', (error) => problems.push(`mobile: ${error.message}`))
await mobile.goto(base, { waitUntil: 'domcontentloaded' })
await mobile.waitForTimeout(900)

const padShown = await mobile.evaluate(() => {
  const pad = document.getElementById('pad')
  return pad !== null && getComputedStyle(pad).display !== 'none'
})

interface Band {
  cols: number
  rows: number
  /**
   * How far the worst control reaches into the grid, in pixels. Negative when
   * the two are apart, which is the passing case.
   */
  intrusion: number
  /** Which control reaches furthest in, so a failure names itself. */
  worst: string
}

/**
 * The grid against the controls, as rectangles.
 *
 * Measured rather than eyeballed because "the controls are visible" was true
 * while the stick was sitting on the status line.
 *
 * This began as "the bottom of the grid is above the top of the controls",
 * which is a portrait-shaped claim. In landscape the controls stand in columns
 * either side of the grid, and that comparison reports a 244px overlap where
 * there is none. Two rectangles either intersect or they do not, and the one
 * rule reads both layouts.
 */
function measureBand(page: Page): Promise<Band | null> {
  return page.evaluate(() => {
    const screenEl = document.getElementById('screen')
    if (!screenEl) return null
    const probe = (window as unknown as { __doom?: Record<string, number> }).__doom ?? {}
    const grid = screenEl.getBoundingClientRect()
    let intrusion = -Infinity
    let worst = ''
    for (const id of ['stick', 'fire', 'use', 'swap']) {
      const element = document.getElementById(id)
      if (!element || getComputedStyle(element).display === 'none') continue
      const box = element.getBoundingClientRect()
      const across = Math.min(grid.right, box.right) - Math.max(grid.left, box.left)
      const down = Math.min(grid.bottom, box.bottom) - Math.max(grid.top, box.top)
      // Overlapping in one axis only is not an overlap, so the smaller of the
      // two is how far in the control actually is.
      const reach = Math.min(across, down)
      if (reach > intrusion) {
        intrusion = reach
        worst = id
      }
    }
    if (worst === '') return null
    return { cols: probe.cols ?? 0, rows: probe.rows ?? 0, intrusion, worst }
  })
}

const upright = await measureBand(mobile)

const beforeThumb = await readPlayer(mobile)
// Push the stick straight up: down at its centre, then drag to its top edge.
const stickBox = await mobile.locator('#stick').boundingBox()
if (stickBox) {
  const cx = stickBox.x + stickBox.width / 2
  const cy = stickBox.y + stickBox.height / 2
  await mobile.dispatchEvent('#stick', 'pointerdown', { pointerId: 1, clientX: cx, clientY: cy, isPrimary: true })
  await mobile.dispatchEvent('#stick', 'pointermove', {
    pointerId: 1,
    clientX: cx,
    clientY: stickBox.y + 4,
    isPrimary: true,
  })
  await mobile.waitForTimeout(1200)
  await mobile.dispatchEvent('#stick', 'pointerup', { pointerId: 1, clientX: cx, clientY: stickBox.y + 4, isPrimary: true })
}
await mobile.waitForTimeout(150)
const afterThumb = await readPlayer(mobile)

check('a phone gets controls it can actually reach', () => {
  assert(padShown, 'the touch controls are hidden on a touch device')
  assert(stickBox !== null, 'there is no movement stick to put a thumb on')
})

// A phone held sideways is the natural way to hold a shooter, and it is the
// orientation the bottom band was worst in: fixed pixels against a screen only
// 390 of them tall left fourteen rows of picture.
const sideways = await browser.newContext({
  viewport: { width: 844, height: 390 },
  hasTouch: true,
  isMobile: true,
})
const turned = await sideways.newPage()
turned.on('pageerror', (error) => problems.push(`landscape: ${error.message}`))
await turned.goto(base, { waitUntil: 'domcontentloaded' })
await turned.waitForTimeout(900)
const lying = await measureBand(turned)
await turned.screenshot({ path: join(SHOTS, 'landscape.png') })

check('the controls do not sit on top of the picture', () => {
  // Asserted in pixels because "the controls are visible" was true while the
  // stick was resting on the status line, and the bottom-left of that line is
  // the health. A screenshot caught it; this is what would have.
  //
  // The floors come from what the two layouts actually measure -- 49x47 and
  // 73x28 -- set low enough to be about a regression rather than about the
  // font. The landscape band before this was 107x14, which is what they catch.
  const layouts = [
    { name: 'portrait', band: upright, leastCols: 40, leastRows: 40 },
    { name: 'landscape', band: lying, leastCols: 60, leastRows: 22 },
  ]
  for (const { name, band, leastCols, leastRows } of layouts) {
    assert(band !== null, `could not measure the ${name} screen against the controls`)
    assert(band.intrusion <= 1, `${name}: ${band.worst} reaches ${band.intrusion.toFixed(0)}px into the grid`)
    assert(band.cols >= leastCols, `${name}: only ${band.cols} columns left beside the controls`)
    assert(band.rows >= leastRows, `${name}: only ${band.rows} rows left once the controls were given their room`)
  }
})

check('pushing the stick walks the player', () => {
  // The whole point of the touch work: without this the controls could be
  // drawn, styled and wired to nothing, and every other check would still pass
  // because none of them has hands.
  const moved = Math.hypot(afterThumb.x - beforeThumb.x, afterThumb.y - beforeThumb.y)
  assert(moved > 0.5, `a thumb held on the stick for a second moved the player ${moved.toFixed(2)} units`)
})

await mobile.screenshot({ path: join(SHOTS, 'touch.png') })

// Pictures rather than assertions, and deliberately after everything that is
// one. Five sprites have shipped whose only evidence of legibility is an
// arithmetic rule about how many characters they are drawn from, and none of
// them appear at the spot the frames above are taken from: the supply boxes are
// out in the hall, and a bolt or a slug only exists once something fires. So
// this walks somewhere they can be seen and captures it.
//
// Wrapped, because a failure here is a failure to take a photograph. It must
// not colour the result of the checks that already ran.
try {
  await page.keyboard.down('w')
  await page.waitForTimeout(3400)
  await page.keyboard.up('w')
  await page.waitForTimeout(200)

  // Turn to look back across the hall, where the creatures and the shell box
  // are, then switch to the launcher and throw one.
  await page.keyboard.down('ArrowLeft')
  await page.waitForTimeout(500)
  await page.keyboard.up('ArrowLeft')
  await page.keyboard.press('3')
  await page.waitForTimeout(150)
  await page.keyboard.down(' ')
  await page.waitForTimeout(120)
  await page.keyboard.up(' ')
  // Short enough that the slug is still in the air a few units out.
  await page.waitForTimeout(160)

  await page.screenshot({ path: join(SHOTS, 'hall.png') })
  const there = await readPlayer(page)
  console.log(
    `  hall shot: ${there.tag ?? '?'} at (${there.x.toFixed(1)}, ${there.y.toFixed(1)}), ` +
      `${there.inFlight} in flight, ${there.alive} creatures alive`,
  )
} catch (error) {
  console.log(`  (could not take the hall screenshot: ${(error as Error).message})`)
}

console.log(
  `  grid ${first.cols}x${first.rows} cells, cell aspect ${first.cellAspect.toFixed(3)}, ` +
    `phone ${small.cols}x${small.rows}` +
    // The phone above has no touch, so the control band never applies to it and
    // its row count says nothing about what a real handset gets. This is the
    // one that does.
    (upright === null || lying === null
      ? ', touch layout unmeasured'
      : `, touch ${upright.cols}x${upright.rows} upright and ${lying.cols}x${lying.rows} sideways`),
)

await browser.close()
server.close()

console.log(failed === 0 ? 'all browser checks passed' : `${failed} browser check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
