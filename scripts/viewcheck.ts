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

import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'
import { chromium, type Page } from 'playwright'
import { tinyWad } from './wadfixture.ts'

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

// Asked of the page loaded without the flag, which is the one people play.
const doorShut = await page.evaluate(() => (window as unknown as { __probe?: unknown }).__probe === undefined)

check('the probe door is shut unless it is asked for', () => {
  // The check below is handed a way to finish a level. That is a cheat sitting
  // in the shipped bundle, and "it is behind a query flag" is a claim about
  // code rather than about the page, so the page is asked instead.
  assert(doorShut, 'the played page exposes __probe with no flag set')
})

// Finishing a level, which until now nothing had ever watched. The Node checks
// walk both maps to their exits, so the route is not in question; what had
// never been seen is the summary being drawn, and the pause behind it, both of
// which live in the page. The page opens a door under `?probe` that puts the
// body in the exit sector and lets the ordinary rule do the finishing.
const ending = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const finish = await ending.newPage()
finish.on('pageerror', (error) => problems.push(`summary: ${error.message}`))
await finish.goto(`${base}?probe=1`, { waitUntil: 'domcontentloaded' })
await finish.waitForTimeout(900)

function readEnding(page: Page) {
  return page.evaluate(() => {
    const probe = (window as unknown as { __doom?: Record<string, unknown> }).__doom ?? {}
    return {
      text: document.getElementById('screen')?.textContent ?? '',
      complete: probe.complete === true,
      levelIndex: (probe.levelIndex as number) ?? -1,
      frames: (probe.frames as number) ?? 0,
      x: (probe.x as number) ?? 0,
      y: (probe.y as number) ?? 0,
    }
  })
}

const arrived = await finish.evaluate(
  () => (window as unknown as { __probe?: { toExit(): boolean } }).__probe?.toExit() ?? false,
)
await finish.waitForTimeout(300)
const ended = await readEnding(finish)
// Long enough to prove the pause is a pause and not a frame, short enough to
// still be inside it. Nothing slow goes between these two reads: a screenshot
// costs a few hundred milliseconds and spends them out of the pause being
// measured.
await finish.waitForTimeout(1500)
const during = await readEnding(finish)
await finish.screenshot({ path: join(SHOTS, 'summary.png') })
// Past 3.5s from arrival, with room for the frames either side of it.
await finish.waitForTimeout(2900)
const handedOver = await readEnding(finish)

check('finishing a level draws a summary you can read', () => {
  assert(arrived, 'the page did not open its probe door, so the exit was never reached')
  assert(ended.complete, 'walking into the exit did not finish the level')
  for (const line of ['LEVEL COMPLETE', 'time', 'creatures', 'supplies']) {
    assert(ended.text.includes(line), `the summary is missing "${line}"`)
  }
})

check('the summary holds the level still, then hands over', () => {
  // Frozen, not stopped: frames keep being drawn over the room you finished in,
  // and nothing in it moves. Both halves matter -- a page that had crashed
  // would also fail to move the player.
  assert(during.complete, 'the summary was gone 1.5s in, so there is no pause to speak of')
  assert(during.frames > ended.frames, 'no frames were drawn while the summary was up')
  assert(
    during.x === ended.x && during.y === ended.y,
    `the player drifted ${Math.hypot(during.x - ended.x, during.y - ended.y).toFixed(2)} during the summary`,
  )
  assert(
    handedOver.levelIndex === 1,
    `after the pause the game was on level ${handedOver.levelIndex}, not the second one`,
  )
  assert(!handedOver.complete, 'the second level started already finished')
})

// Dying, which until this round the game could not do. Health reaching zero
// stopped you firing and did nothing else: you walked on, unarmed, forever.
const grave = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const corpse = await grave.newPage()
corpse.on('pageerror', (error) => problems.push(`death: ${error.message}`))
await corpse.goto(`${base}?probe=1`, { waitUntil: 'domcontentloaded' })
await corpse.waitForTimeout(900)

function readDeath(page: Page) {
  return page.evaluate(() => {
    const probe = (window as unknown as { __doom?: Record<string, unknown> }).__doom ?? {}
    return {
      text: document.getElementById('screen')?.textContent ?? '',
      dead: probe.dead === true,
      deadFor: (probe.deadFor as number) ?? 0,
      reviveDelay: (probe.reviveDelay as number) ?? 0,
      health: (probe.health as number) ?? -1,
      levelIndex: (probe.levelIndex as number) ?? -1,
      frames: (probe.frames as number) ?? 0,
      x: (probe.x as number) ?? 0,
      y: (probe.y as number) ?? 0,
    }
  })
}

const killed = await corpse.evaluate(
  () => (window as unknown as { __probe?: { kill(): boolean } }).__probe?.kill() ?? false,
)
// Wall clock from the moment of death, because the page's own `deadFor` cannot
// answer this: restarting resets it to zero, so a read that landed late and a
// read that landed on a game which restarted far too early look identical from
// inside the page.
const killedAt = Date.now()
await corpse.waitForTimeout(300)
const died = await readDeath(corpse)
// Held down from before the delay is up, so this also asks that a trigger held
// through your own death does not skip the panel.
//
// Nothing slow may happen between here and the read below. A screenshot used to
// sit above this line, and the few hundred milliseconds it costs were spent out
// of the very delay being measured -- which showed up as this check failing in
// a run that had only removed the panel, something that cannot affect timing.
await corpse.keyboard.down(' ')
await corpse.waitForTimeout(400)
const tooSoon = await readDeath(corpse)
const tooSoonAfter = (Date.now() - killedAt) / 1000
await corpse.waitForTimeout(1500)
const revived = await readDeath(corpse)
await corpse.keyboard.up(' ')

// Killed again, with nothing else going on, purely to be looked at.
await corpse.evaluate(() => (window as unknown as { __probe?: { kill(): boolean } }).__probe?.kill())
await corpse.waitForTimeout(300)
await corpse.screenshot({ path: join(SHOTS, 'death.png') })

check('running out of health ends it rather than being ignored', () => {
  assert(killed, 'the probe door would not take the health away')
  assert(died.dead, `health was ${died.health} and the game did not consider that dead`)
  for (const line of ['YOU DIED', 'fire to try again']) {
    assert(died.text.includes(line), `the death panel is missing "${line}"`)
  }
  assert(tooSoon.frames > died.frames, 'no frames were drawn while the panel was up')
  assert(
    tooSoon.x === died.x && tooSoon.y === died.y,
    `the body drifted ${Math.hypot(tooSoon.x - died.x, tooSoon.y - died.y).toFixed(2)} after dying`,
  )
})

check('a fresh press starts the level over, not the campaign', () => {
  // The trigger goes down before the delay is up and is still down after it.
  // Too soon is the half that matters: the shot that killed you would
  // otherwise restart the level before the panel has been read.
  // The premise first. A read that landed past the delay says nothing about
  // holding a trigger, and calling that a broken game would be a lie told about
  // a slow browser -- so it fails in those words instead.
  assert(
    tooSoonAfter < tooSoon.reviveDelay,
    `looked ${tooSoonAfter.toFixed(2)}s after dying, past the ${tooSoon.reviveDelay}s delay: this measured nothing`,
  )
  assert(tooSoon.dead, 'the level restarted before the panel had been up a second')
  assert(!revived.dead, 'the level never restarted, so death is a dead end')
  assert(revived.health === 100, `came back with ${revived.health} health`)
  assert(revived.levelIndex === 0, `came back on level ${revived.levelIndex} instead of the one that killed us`)
})

// The automap, whose whole claim is visual and whose data comes from the frame
// that was drawn rather than from a second pass over the level.
const cartography = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const mapper = await cartography.newPage()
mapper.on('pageerror', (error) => problems.push(`automap: ${error.message}`))
await mapper.goto(base, { waitUntil: 'domcontentloaded' })
await mapper.waitForTimeout(900)

function readMap(page: Page) {
  return page.evaluate(() => {
    const probe = (window as unknown as { __doom?: Record<string, unknown> }).__doom ?? {}
    return {
      text: document.getElementById('screen')?.textContent ?? '',
      mapOpen: probe.mapOpen === true,
      seen: (probe.seen as number) ?? 0,
      lines: (probe.lines as number) ?? 0,
    }
  })
}

const atSpawn = await readMap(mapper)
await mapper.keyboard.down('w')
await mapper.waitForTimeout(1400)
await mapper.keyboard.up('w')
await mapper.waitForTimeout(200)
const walked = await readMap(mapper)

// Held for a moment rather than pressed. `press` sends the key down and up with
// no dwell between them, and the map toggles on a rising edge read inside a
// simulation step that runs sixty times a second -- so both events can land
// between two steps and no step ever sees the key at all. That is why this one
// line differs from every other key in this file, and why it failed once with
// "Tab did not open the map" and then passed twice unchanged.
await mapper.keyboard.down('Tab')
await mapper.waitForTimeout(100)
await mapper.keyboard.up('Tab')
await mapper.waitForTimeout(300)
const opened = await readMap(mapper)
await mapper.screenshot({ path: join(SHOTS, 'map.png') })

// Sampled through the hold rather than once at the end: a single reading cannot
// tell a map that flipped once from one flipping sixty times a second that
// happened to be caught on an even frame.
await mapper.keyboard.down('Tab')
const whileHeld: boolean[] = []
for (let i = 0; i < 6; i++) {
  await mapper.waitForTimeout(120)
  whileHeld.push((await readMap(mapper)).mapOpen)
}
await mapper.keyboard.up('Tab')
await mapper.waitForTimeout(200)
const afterHold = await readMap(mapper)

check('the map knows what has been looked at, and only that', () => {
  assert(atSpawn.lines > 0, 'the level reports no lines at all')
  assert(atSpawn.seen > 0, 'standing in a lit room taught the map nothing')
  assert(
    atSpawn.seen < atSpawn.lines,
    `the whole level was known from the spawn (${atSpawn.seen}/${atSpawn.lines}), so nothing is hidden`,
  )
  assert(walked.seen > atSpawn.seen, `walking taught the map nothing new (${walked.seen}/${walked.lines})`)
})

check('the map opens on a press and holds still while the key is held', () => {
  assert(opened.mapOpen, 'Tab did not open the map')

  // The view is not drawn while the map is up, so the player marker is the only
  // thing on screen that can be one of these. In the game they are ordinary
  // scenery -- the ceiling ramp ends in a caret -- which is why this is asked
  // here and not of a frame with a world in it.
  const markers = [...opened.text].filter((glyph) => '><^v'.includes(glyph)).length
  assert(markers === 1, `${markers} player markers on an open map`)
  assert(opened.text !== walked.text, 'opening the map changed nothing on screen')

  const first = whileHeld[0]
  assert(first !== undefined, 'the hold was never sampled')
  assert(
    whileHeld.every((value) => value === first),
    `the map flickered while held: ${whileHeld.map((value) => (value ? '1' : '0')).join('')}`,
  )
  assert(first !== opened.mapOpen, 'pressing the key a second time did not register as a press')
  assert(afterHold.mapOpen === first, 'letting go of the key changed the map')
})

// Installable, and playable with the network off. The service worker is the
// one file here that neither tsc nor a Node check can see, so this section is
// the whole of what holds it up.
const installed = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const app = await installed.newPage()
await app.goto(base, { waitUntil: 'domcontentloaded' })

const workerState = await app.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return 'unsupported'
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
  ])
  if (!registration) return 'never became ready'

  // Waited for rather than read once. `ready` resolves as soon as there is an
  // active registration, and that worker can still be inside its own activate
  // handler at the time -- `clients.claim()` has not finished. Sampling at that
  // instant is a race, and it is one this check quietly won until the bundle
  // grew enough for installing to take a moment longer, at which point it
  // reported the game broken because the worker was one tick behind.
  //
  // Nothing is weakened by waiting: a worker that is genuinely stuck returns
  // the state it settled on, and "activating" after eight seconds still fails.
  const state = () => (registration.active ? registration.active.state : 'ready with no active worker')
  const deadline = Date.now() + 8000
  while (state() !== 'activated' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return state()
})

const manifestResponse = await app.request.get(new URL('manifest.webmanifest', base).href)
const manifestStatus = manifestResponse.status()
const manifest = manifestStatus === 200 ? ((await manifestResponse.json()) as Record<string, unknown>) : null

const iconStatus: Record<string, number> = {}
for (const name of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
  iconStatus[name] = (await app.request.get(new URL(name, base).href)).status()
}

// The claim worth making: one visit, then the network goes away.
await installed.setOffline(true)
let offline: { cols: number; frames: number } | null = null
let offlineFailure = ''
try {
  await app.reload({ waitUntil: 'domcontentloaded' })
  await app.waitForTimeout(1200)
  offline = await app.evaluate(() => {
    const probe = (window as unknown as { __doom?: Record<string, unknown> }).__doom ?? {}
    return { cols: (probe.cols as number) ?? 0, frames: (probe.frames as number) ?? 0 }
  })
} catch (error) {
  offlineFailure = (error as Error).message
}
await installed.setOffline(false)

check('the game is installable', () => {
  assert(manifestStatus === 200, `the manifest answered ${manifestStatus}`)
  assert(manifest !== null, 'the manifest did not parse as JSON')
  // Both have to carry the repository prefix. Without it the app installs and
  // then opens on a 404, which is the failure this whole arrangement invites.
  assert(manifest.start_url === BASE_PATH, `start_url is ${String(manifest.start_url)}, not ${BASE_PATH}`)
  assert(manifest.scope === BASE_PATH, `scope is ${String(manifest.scope)}, not ${BASE_PATH}`)
  assert(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'the manifest offers no icons')
  for (const [name, status] of Object.entries(iconStatus)) {
    assert(status === 200, `${name} answered ${status}`)
  }
})

check('one visit is enough to play with the network off', () => {
  assert(workerState === 'activated', `the service worker is "${workerState}"`)
  assert(offline !== null, `the page would not load offline: ${offlineFailure}`)
  assert(offline.cols > 20, `offline the grid came back ${offline.cols} columns wide`)
  assert(offline.frames > 0, 'the page loaded offline but never drew a frame')
})

// Ground that hurts, in the running game rather than in a fixture. The channel
// is in the second level, so this finishes the first one to get there.
const wading = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const waded = await wading.newPage()
waded.on('pageerror', (error) => problems.push(`hazard: ${error.message}`))
await waded.goto(`${base}?probe=1`, { waitUntil: 'domcontentloaded' })
await waded.waitForTimeout(900)

function readGround(page: Page) {
  return page.evaluate(() => {
    const probe = (window as unknown as { __doom?: Record<string, unknown> }).__doom ?? {}
    return {
      health: (probe.health as number) ?? -1,
      hurt: (probe.hurt as number) ?? -1,
      levelIndex: (probe.levelIndex as number) ?? -1,
    }
  })
}

await waded.evaluate(() => (window as unknown as { __probe?: { toExit(): boolean } }).__probe?.toExit())
// Past the summary and its pause, which puts us in the cistern.
await waded.waitForTimeout(4400)

const steppedIn = await waded.evaluate(
  () => (window as unknown as { __probe?: { toTag(tag: string): boolean } }).__probe?.toTag('channel') ?? false,
)
await waded.waitForTimeout(200)
const enteredChannel = await readGround(waded)
await waded.waitForTimeout(1500)
const stoodInIt = await readGround(waded)

// Out, to the room you arrive in: the hub has a creature in it and "the damage
// stopped" is not a claim you can make while something is shooting at you.
const steppedOut = await waded.evaluate(
  () => (window as unknown as { __probe?: { toTag(tag: string): boolean } }).__probe?.toTag('entry') ?? false,
)
// Long enough for anything already in the air to land before the first reading.
await waded.waitForTimeout(400)
const onDryGround = await readGround(waded)
await waded.waitForTimeout(1200)
const stillDry = await readGround(waded)

check('standing in the channel costs health, and leaving it stops', () => {
  assert(enteredChannel.levelIndex === 1, `the probe never reached the cistern (level ${enteredChannel.levelIndex})`)
  assert(steppedIn, 'the shipped level has no sector tagged "channel" to stand in')
  assert(enteredChannel.hurt > 0, 'the channel reports no damage for standing in it')
  assert(
    stoodInIt.health < enteredChannel.health,
    `a second and a half in it cost nothing (${enteredChannel.health} to ${stoodInIt.health})`,
  )

  assert(steppedOut, 'there is no sector tagged "entry" to step out onto')
  assert(onDryGround.hurt === 0, 'the room you arrive in is dangerous ground')
  assert(
    stillDry.health === onDryGround.health,
    `health kept falling on dry ground (${onDryGround.health} to ${stillDry.health})`,
  )
})

// A map from a file, in the running page. The bytes are the fixture the parser
// checks are held to, so this cannot pass against a map the Node side never saw.
const opener = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const wadPage = await opener.newPage()
wadPage.on('pageerror', (error) => problems.push(`wad: ${error.message}`))
await wadPage.goto(`${base}?probe=1`, { waitUntil: 'domcontentloaded' })
await wadPage.waitForTimeout(900)

function readOpened(page: Page) {
  return page.evaluate(() => {
    const probe = (window as unknown as { __doom?: Record<string, unknown> }).__doom ?? {}
    return {
      level: (probe.level as string) ?? '',
      levelIndex: (probe.levelIndex as number) ?? -99,
      lines: (probe.lines as number) ?? -1,
      seen: (probe.seen as number) ?? -1,
      cols: (probe.cols as number) ?? 0,
      frames: (probe.frames as number) ?? 0,
      health: (probe.health as number) ?? -1,
      dead: probe.dead === true,
      alive: (probe.alive as number) ?? -1,
      awake: (probe.awake as number) ?? -1,
      pickupsLeft: (probe.pickupsLeft as number) ?? -1,
      doorState: (probe.doorState as string | null) ?? null,
      liftFloor: (probe.liftFloor as number | null) ?? null,
      complete: probe.complete === true,
    }
  })
}

// Walked first, so the automap has learned something about the outpost that
// would still be there if opening a map failed to clear it.
await wadPage.keyboard.down('w')
await wadPage.waitForTimeout(1200)
await wadPage.keyboard.up('w')
await wadPage.waitForTimeout(200)
const onOutpost = await readOpened(wadPage)

// With monsters in it. The page had only ever been handed an empty map, so
// nothing said it could carry a level with creatures standing in it -- and a
// level from a file is the only kind whose creatures the page did not build.
// Creatures, a supply, and a door on the wall between the rooms -- special 1,
// the commonest manual door in the set. The page had never been handed a level
// carrying any of the three.
const wadBytes = [
  ...tinyWad(
    'E1M1',
    true,
    '',
    [
      [160, 32, 180, 3001],
      [200, 96, 180, 3002],
      [180, 64, 0, 2012],
    ],
    1,
  ),
]
const tookIt = await wadPage.evaluate(
  ([bytes, name]) =>
    (window as unknown as { __probe?: { loadWad(b: number[], n: string): boolean } }).__probe?.loadWad(
      bytes as number[],
      name as string,
    ) ?? false,
  [wadBytes, 'E1M1'] as [number[], string],
)
await wadPage.waitForTimeout(400)
const onWad = await readOpened(wadPage)
await wadPage.waitForTimeout(400)
const stillRunning = await readOpened(wadPage)

check('the page can open a map from a file and keep running', () => {
  assert(tookIt, 'the page would not take the bytes')
  assert(onWad.level === 'E1M1', `the level calls itself "${onWad.level}"`)
  // Outside the campaign, and saying so: everything that reads this index is
  // about progressing through levels written here, and a file has no place in
  // that order.
  assert(onWad.levelIndex === -1, `a map from a file reports campaign index ${onWad.levelIndex}`)
  assert(onWad.lines === 7, `the page built ${onWad.lines} lines from a seven-line map`)
  assert(onWad.cols > 20, `the grid came back ${onWad.cols} columns wide`)
  assert(stillRunning.frames > onWad.frames, 'the page stopped drawing once the map changed')
  // The creatures the file placed are standing in it, and the page is stepping
  // them: Node can say the array was built, but only a running page can say
  // the simulation took it up without falling over.
  assert(onWad.alive === 2, `the map placed two creatures and the page reports ${onWad.alive} alive`)
  assert(
    onWad.pickupsLeft === 1,
    `the map left one supply and the page reports ${onWad.pickupsLeft} still lying there`,
  )
  // A door came with it, shut. Node can say the mover was built; only a running
  // page can say the step loop took it up without falling over.
  assert(
    onWad.doorState === 'shut',
    `the map's door reached the page as "${onWad.doorState}" rather than shut`,
  )
})

check('opening a map forgets the one before it', () => {
  // The automap holds the level's own line objects, and a new level builds new
  // ones -- a set kept across the change would draw a place that no longer
  // exists. Nothing in Node can see this: the set lives in the page.
  assert(onOutpost.seen > 7, `the outpost taught the map only ${onOutpost.seen} lines, so this proves nothing`)
  assert(
    onWad.seen <= onWad.lines,
    `a seven-line map came back knowing ${onWad.seen} lines, which can only be the last map's`,
  )
})

// Dying inside a map that came from a file.
//
// I expected the hazard here to be that restarting by campaign index would
// quietly swap the map you opened for the outpost. It is not: the index is -1
// while a file is open, and the campaign refuses that outright. Taking the
// branch away fails this check with "the panel never cleared, so nothing
// restarted" -- you are stuck dead, looking at a panel, while the step throws
// once a frame. Louder than a silent swap, and still worth a check, but not the
// failure the comment claimed before I made it fail on purpose and read what
// came back.
await wadPage.evaluate(() => (window as unknown as { __probe?: { kill(): boolean } }).__probe?.kill())
await wadPage.waitForTimeout(300)
const killedInWad = await readOpened(wadPage)
// Held rather than tapped, and held past the pause before a press is taken as
// "again". The death branch reads the trigger once per simulation step, so a
// tap can fall between two steps and never be seen -- which is exactly how the
// automap key failed earlier today.
await wadPage.waitForTimeout(1400)
await wadPage.keyboard.down(' ')
await wadPage.waitForTimeout(200)
await wadPage.keyboard.up(' ')
await wadPage.waitForTimeout(400)
const revivedInWad = await readOpened(wadPage)

check('dying in a map from a file puts you back in that map', () => {
  assert(killedInWad.dead, `health went to ${killedInWad.health} and the game did not call that dead`)
  assert(!revivedInWad.dead, 'the panel never cleared, so nothing restarted')
  // The whole point. Restarting by campaign index would load the outpost here,
  // and the picture would look perfectly fine while being the wrong game.
  assert(revivedInWad.level === 'E1M1', `came back in "${revivedInWad.level}" instead of the map that was open`)
  assert(revivedInWad.levelIndex === -1, `came back on campaign index ${revivedInWad.levelIndex}`)
  assert(revivedInWad.lines === 7, `came back with ${revivedInWad.lines} lines, so it is a different map`)
  assert(revivedInWad.health === 100, `came back with ${revivedInWad.health} health`)
})

// The way a person opens a map: the file input, on a page with no probe door in
// it at all. Everything above went through a hatch that only exists under a
// flag, so none of it says the feature works in the page people are handed.
const goodWad = join(tmpdir(), 'ascii-doom-fixture.wad')
const notAWad = join(tmpdir(), 'ascii-doom-not.wad')
writeFileSync(goodWad, tinyWad('E1M1'))
writeFileSync(notAWad, Buffer.from('this is not a WAD, it is a sentence'))

const chooser = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const picker = await chooser.newPage()
picker.on('pageerror', (error) => problems.push(`picker: ${error.message}`))
await picker.goto(base, { waitUntil: 'domcontentloaded' })
await picker.waitForTimeout(900)

const beforePick = await readOpened(picker)
await picker.setInputFiles('#wad', goodWad)
await picker.waitForTimeout(600)
const afterPick = await readOpened(picker)
await picker.waitForTimeout(400)
const stillDrawing = await readOpened(picker)

// And a file that is not one. Handing the game the wrong thing is an ordinary
// mistake, and carrying on with the level already loaded is the right answer.
await picker.setInputFiles('#wad', notAWad)
await picker.waitForTimeout(600)
const afterJunk = await picker.evaluate(() => ({
  text: document.getElementById('screen')?.textContent ?? '',
  level: ((window as unknown as { __doom?: Record<string, unknown> }).__doom?.level as string) ?? '',
}))

check('a person can open a map with the file picker', () => {
  assert(beforePick.level !== 'E1M1', `the page was already showing "${beforePick.level}" before any file was chosen`)
  assert(afterPick.level === 'E1M1', `after choosing a WAD the level is "${afterPick.level}"`)
  assert(afterPick.lines === 7, `the page built ${afterPick.lines} lines from a seven-line map`)
  assert(afterPick.levelIndex === -1, `a map from a file reports campaign index ${afterPick.levelIndex}`)
  assert(afterPick.cols > 20, `the grid came back ${afterPick.cols} columns wide`)
  assert(stillDrawing.frames > afterPick.frames, 'the page stopped drawing after the map was opened')
})

check('the wrong file is said out loud, not thrown', () => {
  assert(afterJunk.text.includes('not a WAD'), 'nothing on screen said what was wrong with the file')
  assert(afterJunk.level === 'E1M1', `the bad file replaced the level with "${afterJunk.level}"`)
})

// Finishing a map that came from a file. The fixture's one two-sided wall can
// carry one special, and the one above is a door, so this is a second file
// handed to the same page -- an exit line with the room beyond it left open.
const exitWad = [...tinyWad('E1M1', true, '', [], 52, false)]
const openedExit = await wadPage.evaluate(
  ([bytes, name]) =>
    (window as unknown as { __probe?: { loadWad(b: number[], n: string): boolean } }).__probe?.loadWad(
      bytes as number[],
      name as string,
    ) ?? false,
  [exitWad, 'E1M1'] as [number[], string],
)
await wadPage.waitForTimeout(300)
const beforeExit = await readOpened(wadPage)
const walkedOut = await wadPage.evaluate(
  () => (window as unknown as { __probe?: { toExit(): boolean } }).__probe?.toExit() ?? false,
)
await wadPage.waitForTimeout(400)
const justFinished = await readOpened(wadPage)
// Past the pause that hands you the next level in the campaign.
await wadPage.waitForTimeout(4200)
const afterThePause = await readOpened(wadPage)

check('a map from a file can be finished, and finishing it stays there', () => {
  assert(openedExit, 'the page would not take a second file')
  assert(beforeExit.level === 'E1M1', `the second file came up as "${beforeExit.level}"`)
  assert(walkedOut, 'the probe could not reach an exit, so the map has none the page can see')
  assert(justFinished.complete, 'crossing the exit did not finish the map')

  // The part that matters. `nextLevel` answers 0 for a campaign index of -1,
  // so without the guard the pause would end and hand you the outpost --
  // someone else's map replaced by one of mine, quietly, as a reward for
  // finishing theirs.
  assert(
    afterThePause.level === 'E1M1',
    `after the pause the page was showing "${afterThePause.level}" instead of the map that was open`,
  )
  assert(
    afterThePause.levelIndex === -1,
    `after the pause the page reports campaign index ${afterThePause.levelIndex}`,
  )
})

// Ending a map by pressing a switch, which is the half of them a room cannot
// describe. This one goes through the `use` key on a page, because that is the
// only place the press exists at all.
// Facing east, towards the wall the switch is on, and with that wall shut.
//
// Both of those were wrong to begin with, and neither fault was in the game.
// The fixture normally starts you looking north, so the first version walked
// away from the switch. The second version faced it but left the way through
// open, so the body walked clean past the line and stood beyond it looking at
// the far wall. A switch is a wall you press: thirty-two of the thirty-five in
// these files have nothing behind them at all, and shutting this one is what
// makes the fixture resemble the thing it stands for.
const switchWad = [...tinyWad('E1M1', true, '', [], 11, true, 0)]
const openedSwitch = await wadPage.evaluate(
  ([bytes, name]) =>
    (window as unknown as { __probe?: { loadWad(b: number[], n: string): boolean } }).__probe?.loadWad(
      bytes as number[],
      name as string,
    ) ?? false,
  [switchWad, 'E1M1'] as [number[], string],
)
await wadPage.waitForTimeout(300)
const beforePress = await readOpened(wadPage)

// Walk up to the wall between the rooms, then press it. Held rather than
// tapped: `use` is read once per simulation step, so a tap can fall between two
// steps and never be seen -- the same trap the map key fell into earlier.
await wadPage.keyboard.down('w')
await wadPage.waitForTimeout(1200)
await wadPage.keyboard.up('w')
await wadPage.waitForTimeout(200)
const atTheWall = await readOpened(wadPage)
await wadPage.keyboard.down('e')
await wadPage.waitForTimeout(300)
await wadPage.keyboard.up('e')
await wadPage.waitForTimeout(400)
const afterPress = await readOpened(wadPage)
await wadPage.waitForTimeout(4200)
const wellAfter = await readOpened(wadPage)

check('a map that ends on a switch can be ended by pressing it', () => {
  assert(openedSwitch, 'the page would not take the switch map')
  assert(beforePress.level === 'E1M1', `the switch map came up as "${beforePress.level}"`)
  assert(!beforePress.complete, 'the map arrived already finished')
  assert(!atTheWall.complete, 'walking towards the switch finished the map without pressing it')
  assert(afterPress.complete, 'pressing the switch did not finish the map')
  // And it stays where it is, the same as the walk-over kind.
  assert(
    wellAfter.level === 'E1M1',
    `after the pause the page was showing "${wellAfter.level}" instead of the map that was open`,
  )
})

// A lift from a file, which is the other thing a wall can be. The platform
// stands sixty-four map units up against the western room's thirty-two: a step
// that tall cannot be walked, so the body stops in front of the wall rather
// than strolling through the gap above it -- which is precisely how the switch
// check above failed the first two times it was written.
//
// Both directions are read on purpose. A platform that only goes down is a hole
// in the floor, and a check that watched it fall and looked no further would
// call that a working lift.
const liftWad = [...tinyWad('E1M1', true, '', [], 62, false, 0, 5, 64)]
const openedLift = await wadPage.evaluate(
  ([bytes, name]) =>
    (window as unknown as { __probe?: { loadWad(b: number[], n: string): boolean } }).__probe?.loadWad(
      bytes as number[],
      name as string,
    ) ?? false,
  [liftWad, 'E1M1'] as [number[], string],
)
await wadPage.waitForTimeout(300)
const beforeCalling = await readOpened(wadPage)

await wadPage.keyboard.down('w')
await wadPage.waitForTimeout(1200)
await wadPage.keyboard.up('w')
await wadPage.waitForTimeout(200)
const atThePlatform = await readOpened(wadPage)

// A drop of about 1.23 metres at 1.4 a second is nine tenths of a second, and
// it rests three seconds at the bottom, so this reads it well inside that rest.
await wadPage.keyboard.down('e')
await wadPage.waitForTimeout(300)
await wadPage.keyboard.up('e')
await wadPage.waitForTimeout(1200)
const calledDown = await readOpened(wadPage)
// Then the rest runs out and it climbs back.
await wadPage.waitForTimeout(4500)
const climbedBack = await readOpened(wadPage)

check('a platform in a map from a file comes down when its wall is pressed', () => {
  assert(openedLift, 'the page would not take the lift map')
  assert(beforeCalling.level === 'E1M1', `the lift map came up as "${beforeCalling.level}"`)
  assert(beforeCalling.liftFloor !== null, 'the map arrived with no platform in it at all')
  const resting = beforeCalling.liftFloor!
  assert(resting > 2.4, `the platform started at ${resting.toFixed(2)} rather than up at about 2.46`)
  assert(
    atThePlatform.liftFloor === resting,
    `walking up to the platform moved it to ${atThePlatform.liftFloor?.toFixed(2)}`,
  )
  assert(
    calledDown.liftFloor !== null && calledDown.liftFloor < resting - 0.5,
    `pressing the wall left the platform at ${calledDown.liftFloor?.toFixed(2)}`,
  )
  assert(
    climbedBack.liftFloor !== null && climbedBack.liftFloor > resting - 0.1,
    `the platform stayed down at ${climbedBack.liftFloor?.toFixed(2)} instead of climbing back`,
  )
})

// Opening a door through the page, which turns out to be a path nothing
// watched. Taking `moverInFront` out of the use branch broke no check at all --
// the door checks in Node call the rules directly and never come through here,
// so the page could have stopped opening doors and the suite would have
// shrugged.
const doorWad = [...tinyWad('E1M1', true, '', [], 1, true, 0)]
await wadPage.evaluate(
  ([bytes, name]) =>
    (window as unknown as { __probe?: { loadWad(b: number[], n: string): boolean } }).__probe?.loadWad(
      bytes as number[],
      name as string,
    ) ?? false,
  [doorWad, 'E1M1'] as [number[], string],
)
await wadPage.waitForTimeout(300)
const beforeOpening = await readOpened(wadPage)
// East, into the shut room, then press. Held rather than tapped: `use` is read
// once a step, and a tap can fall between two of them.
await wadPage.keyboard.down('w')
await wadPage.waitForTimeout(1200)
await wadPage.keyboard.up('w')
await wadPage.waitForTimeout(150)
const atTheDoor = await readOpened(wadPage)
await wadPage.keyboard.down('e')
await wadPage.waitForTimeout(300)
await wadPage.keyboard.up('e')
await wadPage.waitForTimeout(500)
const afterPressing = await readOpened(wadPage)

check('a door in a map from a file opens when the page is told to open it', () => {
  assert(beforeOpening.doorState === 'shut', `the door arrived as "${beforeOpening.doorState}"`)
  assert(atTheDoor.doorState === 'shut', 'walking up to the door opened it without being asked')
  assert(
    afterPressing.doorState !== 'shut',
    `pressing the door left it "${afterPressing.doorState}"`,
  )
  // And the map did not end: a door is not an exit, and the branch that looks
  // for a switch must not fire when a door was found.
  assert(!afterPressing.complete, 'opening a door finished the level')
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


// --- aiming with a thumb ----------------------------------------------------
//
// Two claims a browser is the only place to make. The half of the screen you
// drag has to be exactly as tall as the picture, which is a question about a
// stylesheet; and the shot has to be aimed on a touch device and not on a
// keyboard, which is a question about a media query reaching the simulation.

function crosshairAt(page: Page): Promise<{ col: number; centre: number }> {
  return page.evaluate(() => {
    const text = document.getElementById('screen')?.textContent ?? ''
    const rows = text.split('\n')
    const cols = rows[0]?.length ?? 0
    const drawn = rows.filter((row) => row.length > 0).length
    // Only the horizon row, which is where the mark lives. Scanning the whole
    // grid would find whatever a ramp happens to put somewhere else.
    const row = rows[Math.floor(drawn / 2)] ?? ''
    return { col: row.indexOf('+'), centre: Math.floor(cols / 2) }
  })
}

function readAim(page: Page) {
  return page.evaluate(() => {
    const probe = (window as unknown as { __doom?: Record<string, unknown> }).__doom ?? {}
    return {
      aimed: (probe.aimed as number) ?? -99,
      alive: (probe.alive as number) ?? -1,
      shots: (probe.shotsFired as number) ?? -1,
      landed: (probe.pelletsLanded as number) ?? -1,
      level: (probe.level as string) ?? '',
    }
  })
}

// Seventeen degrees off the way the body points, and two and a half metres out.
// Both numbers are chosen against the geometry rather than by eye: the picture
// reaches about twenty-two degrees either side, so this is inside it with room
// to spare, and the creature sits seven tenths of a metre off the line of a
// straight shot against a body half a metre wide -- so a gun pointed where the
// player is pointing misses it, and one that has been aimed does not.
//
// Facing east, and the creature facing east too: a sleeping creature notices
// nothing behind it, and one that woke up and charged would move between the
// two readings.
const AIMED_AT = [...tinyWad('E1M1', true, '', [[123, 82, 0, 3004]], 0, false, 0)]
const NOBODY = [...tinyWad('E1M1', true, '', [], 0, false, 0)]

const handing = async (page: Page, bytes: number[]) =>
  page.evaluate(
    ([data, name]) =>
      (window as unknown as { __probe?: { loadWad(b: number[], n: string): boolean } }).__probe?.loadWad(
        data as number[],
        name as string,
      ) ?? false,
    [bytes, 'E1M1'] as [number[], string],
  )

const thumbs = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
})
const thumbed = await thumbs.newPage()
thumbed.on('pageerror', (error) => problems.push(`aiming: ${error.message}`))
await thumbed.goto(`${base}?probe=1`, { waitUntil: 'domcontentloaded' })
await thumbed.waitForTimeout(900)

const zones: { name: string; page: Page; screen: DOMRect | null; look: DOMRect | null }[] = []
const zoneOf = async (name: string, page: Page) => {
  const measured = await page.evaluate(() => {
    const box = (id: string) => {
      const element = document.getElementById(id)
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom } as unknown as DOMRect
    }
    return { screen: box('screen'), look: box('look') }
  })
  zones.push({ name, page, ...measured })
}
await zoneOf('upright', thumbed)

const tookEmpty = await handing(thumbed, NOBODY)
await thumbed.waitForTimeout(500)
const withNobody = await readAim(thumbed)
const markAlone = await crosshairAt(thumbed)

const tookAimed = await handing(thumbed, AIMED_AT)
await thumbed.waitForTimeout(500)
const withSomebody = await readAim(thumbed)
const markOnIt = await crosshairAt(thumbed)
await thumbed.screenshot({ path: join(SHOTS, 'aimed.png') })

await thumbed.locator('#fire').dispatchEvent('pointerdown', { pointerId: 11, isPrimary: true })
await thumbed.waitForTimeout(700)
await thumbed.locator('#fire').dispatchEvent('pointerup', { pointerId: 11, isPrimary: true })
await thumbed.waitForTimeout(300)
const thumbFired = await readAim(thumbed)

// The same map, the same standing place, and a keyboard.
const desks = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const desked = await desks.newPage()
desked.on('pageerror', (error) => problems.push(`aiming desktop: ${error.message}`))
await desked.goto(`${base}?probe=1`, { waitUntil: 'domcontentloaded' })
await desked.waitForTimeout(900)
const tookOnDesk = await handing(desked, AIMED_AT)
await desked.waitForTimeout(500)
const deskBefore = await readAim(desked)
await desked.keyboard.down(' ')
await desked.waitForTimeout(700)
await desked.keyboard.up(' ')
await desked.waitForTimeout(300)
const deskFired = await readAim(desked)

const lyingDown = await browser.newContext({
  viewport: { width: 844, height: 390 },
  hasTouch: true,
  isMobile: true,
})
const laid = await lyingDown.newPage()
laid.on('pageerror', (error) => problems.push(`aiming sideways: ${error.message}`))
await laid.goto(base, { waitUntil: 'domcontentloaded' })
await laid.waitForTimeout(900)
await zoneOf('sideways', laid)

check('the half you drag is exactly as tall as the picture', () => {
  for (const zone of zones) {
    assert(zone.screen !== null, `${zone.name}: there is no picture`)
    assert(zone.look !== null, `${zone.name}: there is nothing to drag on`)
    const shortBy = zone.screen!.bottom - zone.look!.bottom
    assert(
      Math.abs(shortBy) <= 1,
      `${zone.name}: the dragging area ends ${shortBy.toFixed(0)}px from the bottom of the picture ` +
        `(picture ends at ${zone.screen!.bottom.toFixed(0)}, drag area at ${zone.look!.bottom.toFixed(0)})`,
    )
  }
})

// Read out of the parsed stylesheet rather than out of the source file. An
// invalid unit is discarded when the sheet is parsed, so a misspelt `dvh` would
// leave the percentage above it as what remains -- which is exactly the bug,
// and exactly what a grep of the source would have missed.
const sizing = await thumbed.evaluate(() => {
  const found: Record<string, string> = {}
  // Indexed rather than iterated: these two collections are old enough to
  // predate the iteration protocol, and the types here say so.
  const sheets = document.styleSheets
  for (let s = 0; s < sheets.length; s++) {
    let rules: CSSRuleList
    try {
      rules = sheets[s]!.cssRules
    } catch {
      continue
    }
    for (let r = 0; r < rules.length; r++) {
      const rule = rules[r]
      if (!(rule instanceof CSSStyleRule)) continue
      if (rule.style.height !== '') found[rule.selectorText] = rule.style.height
    }
  }
  return found
})

check('the page is sized to the viewport you can actually see', () => {
  // What this cannot say is whether it works, because the browser the unit is
  // for is the one that will not run on this machine: iOS Safari is where a
  // percentage of the layout viewport is taller than the visible window, and
  // Chromium has no address bar to hide anything behind. So this holds the
  // declaration to account and says plainly that it is not the behaviour.
  for (const [selector, wanted] of [
    ['html, body', '100dvh'],
    ['#pad', '100dvh'],
  ] as const) {
    const height = sizing[selector]
    assert(height !== undefined, `nothing in the stylesheet gives "${selector}" a height at all`)
    assert(
      height === wanted,
      `"${selector}" comes out as ${height} rather than ${wanted} -- on a phone that puts the ` +
        'foot of the controls behind the address bar',
    )
  }
})

check('a thumb is told what the gun has hold of', () => {
  assert(tookEmpty && tookAimed, 'the page would not take the aiming maps')
  assert(withNobody.aimed === -1, `something was aimed at in an empty room: ${withNobody.aimed}`)
  assert(
    markAlone.col === markAlone.centre,
    `with nothing to aim at the mark sat at column ${markAlone.col} rather than the middle (${markAlone.centre})`,
  )

  assert(withSomebody.alive === 1, `the aiming map arrived with ${withSomebody.alive} creatures`)
  assert(withSomebody.aimed === 0, `nothing was aimed at with a creature in sight: ${withSomebody.aimed}`)
  assert(
    markOnIt.col !== markOnIt.centre && markOnIt.col >= 0,
    `the mark stayed at column ${markOnIt.col} instead of moving onto the creature`,
  )
})

check('a shot from a thumb lands where a shot from a key would not', () => {
  assert(thumbFired.shots > 0, 'the fire button fired nothing, so landing nothing proves nothing')
  assert(thumbFired.landed > 0, `${thumbFired.shots} shots from a thumb and none of them landed`)

  assert(tookOnDesk, 'the desktop page would not take the aiming map')
  assert(deskBefore.aimed === -1, 'a keyboard was given aiming help it did not ask for')
  assert(deskFired.shots > 0, 'the space bar fired nothing, so landing nothing proves nothing')
  assert(
    deskFired.landed === 0,
    `${deskFired.shots} unaimed shots landed ${deskFired.landed} times at a creature ` +
      'seven tenths of a metre off the line -- the fixture is not testing what it says',
  )
})

// --- pictures out of the file the player opened -----------------------------
//
// The claim Node cannot make: that a picture decoded out of a file reaches the
// screen. Everything below is one page handed two maps that differ in nothing
// but whether the file carries art, so a difference in what is drawn can only
// have come from the art.

/**
 * What is drawn in the picture, and in how many colours.
 *
 * The first and last rows are left out, and that is not tidiness. The last one
 * is the status line, which carries a frame rate: its digits change between any
 * two readings, so a comparison of what is on screen came out different however
 * the game was drawn. That version of this check passed with the imported art
 * switched off, which is the only reason it was found.
 *
 * Colours as well as glyphs, because a colour per cell changes no glyph at all.
 * A check that only counted characters could not tell a creature painted from
 * its own picture from one painted in a single tint, and did not.
 */
function glyphsOnScreen(page: Page): Promise<{ distinct: string; painted: number; colours: number }> {
  return page.evaluate(() => {
    const screen = document.getElementById('screen')
    const rows = (screen?.textContent ?? '').split('\n').filter((row) => row.length > 0)
    const seen = new Set<string>()
    let painted = 0
    for (const row of rows.slice(1, -1)) {
      for (const ch of row) {
        if (ch === ' ') continue
        painted++
        seen.add(ch)
      }
    }
    const colours = new Set<string>()
    for (const span of Array.from(screen?.querySelectorAll('span') ?? [])) {
      const colour = (span as HTMLElement).style.color
      if (colour !== '') colours.add(colour)
    }
    return { distinct: [...seen].sort().join(''), painted, colours: colours.size }
  })
}

// A creature a couple of metres in front of the start, facing away so it stays
// asleep and stays put between the readings.
//
// Inside the western room rather than on the line between the two. At 128 it
// sat exactly on the wall, which put it in the room beyond at a floor thirty-two
// units lower, and it drew almost nothing: the first version of this check
// measured the same 7824 glyphs either way and one colour *fewer* from the file.
const CREATURE: [number, number, number, number][] = [[110, 64, 0, 3004]]
const PLAIN = [...tinyWad('E1M1', true, '', CREATURE, 0, false, 0)]
const PAINTED = [...tinyWad('E1M1', true, '', CREATURE, 0, false, 0, 0, 0, true)]

const gallery = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const shown = await gallery.newPage()
shown.on('pageerror', (error) => problems.push(`pictures: ${error.message}`))
await shown.goto(`${base}?probe=1`, { waitUntil: 'domcontentloaded' })
await shown.waitForTimeout(900)

const tookPlain = await shown.evaluate(
  ([bytes, name]) =>
    (window as unknown as { __probe?: { loadWad(b: number[], n: string): boolean } }).__probe?.loadWad(
      bytes as number[],
      name as string,
    ) ?? false,
  [PLAIN, 'E1M1'] as [number[], string],
)
await shown.waitForTimeout(600)
const drawnByHand = await glyphsOnScreen(shown)

// The same map again, to find out whether this measurement holds still. A
// comparison that drifts on its own says nothing about what changed it, and
// the first version of this section drifted: it read the status line, whose
// frame rate changes between any two readings.
await shown.evaluate(
  ([bytes, name]) =>
    (window as unknown as { __probe?: { loadWad(b: number[], n: string): boolean } }).__probe?.loadWad(
      bytes as number[],
      name as string,
    ) ?? false,
  [PLAIN, 'E1M1'] as [number[], string],
)
await shown.waitForTimeout(600)
const drawnAgain = await glyphsOnScreen(shown)

const tookPainted = await shown.evaluate(
  ([bytes, name]) =>
    (window as unknown as { __probe?: { loadWad(b: number[], n: string): boolean } }).__probe?.loadWad(
      bytes as number[],
      name as string,
    ) ?? false,
  [PAINTED, 'E1M1'] as [number[], string],
)
await shown.waitForTimeout(600)
const drawnFromFile = await glyphsOnScreen(shown)
await shown.screenshot({ path: join(SHOTS, 'imported-art.png') })

console.log(
  `  imported art: by hand ${drawnByHand.painted} glyphs / ${drawnByHand.colours} colours, ` +
    `again ${drawnAgain.painted}/${drawnAgain.colours}, from the file ` +
    `${drawnFromFile.painted}/${drawnFromFile.colours}`,
)

check('reading what is on screen gives the same answer twice', () => {
  assert(tookPlain, 'the page would not take the map')
  assert(drawnByHand.painted > 50, `the map drew ${drawnByHand.painted} glyphs`)
  // Everything below is one reading against another, so this is the premise
  // that makes any of it mean something.
  assert(
    drawnAgain.distinct === drawnByHand.distinct,
    `the same map drew "${drawnByHand.distinct}" and then "${drawnAgain.distinct}"`,
  )
  assert(
    drawnAgain.colours === drawnByHand.colours,
    `the same map drew ${drawnByHand.colours} colours and then ${drawnAgain.colours}`,
  )
})

check('a creature from a file is drawn with the file\u2019s own picture', () => {
  assert(tookPainted, 'the page would not take the map with art in it')
  assert(drawnFromFile.painted > 50, `the map with art drew ${drawnFromFile.painted} glyphs`)
  // The two maps differ in nothing but whether the file carries pictures, and
  // the reading above holds still, so a difference can only be the pictures.
  assert(
    drawnFromFile.distinct !== drawnByHand.distinct,
    `the same glyphs either way ("${drawnByHand.distinct}"), so nothing of the file reached the screen`,
  )
})

check('a creature from a file is drawn in more than one colour', () => {
  // Three colours in the picture against one tint for a whole hand-drawn
  // creature. Counted off the spans the presenter writes, which is the only
  // place a colour per cell can be seen from outside the page.
  assert(
    drawnFromFile.colours > drawnByHand.colours,
    `${drawnFromFile.colours} colours from the file against ${drawnByHand.colours} by hand -- ` +
      'a colour per cell is not reaching the screen',
  )
})

await browser.close()
server.close()

console.log(failed === 0 ? 'all browser checks passed' : `${failed} browser check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
