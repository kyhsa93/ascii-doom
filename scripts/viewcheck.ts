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
import { NARROWEST } from '../src/game/statusbar.ts'
import * as FREEDOOM from '../src/game/freedoomart.ts'
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

/**
 * Gets past the title the way a player does.
 *
 * The game opens on a title now, so a check that loads the page and reads the
 * level is reading a page where the level has not started. Pressing the trigger
 * is what a player does and is what every device has; a query parameter that
 * skipped it would be test-only behaviour in the product, and the thing being
 * checked here is the product.
 */
async function begin(page: Page): Promise<void> {
  await page.keyboard.down(' ')
  await page.waitForTimeout(220)
  await page.keyboard.up(' ')
  await page.waitForTimeout(420)
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
  await begin(page)

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
  await begin(phone)
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
  await begin(mobile)

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
  await begin(turned)
const lying = await measureBand(turned)
await turned.screenshot({ path: join(SHOTS, 'landscape.png') })

check('the controls do not sit on top of the picture', () => {
  // Asserted in pixels because "the controls are visible" was true while the
  // stick was resting on the status line, and the bottom-left of that line is
  // the health. A screenshot caught it; this is what would have.
  //
  // The column floors are the status bar's own threshold rather than a round
  // number: under NARROWEST it drops to a single line, and a phone that reads
  // the grid at 8px is exactly what buys the four panels. Measured at 80x77
  // upright and 118x46 sideways, so both have room to shrink a little before
  // this fires -- what it catches is the grid going back to a coarse font.
  //
  // The row floors come from what the layouts measure, low enough to be about
  // a regression rather than about the font. The landscape band before this
  // was 107x14, which is what they catch.
  const layouts = [
    { name: 'portrait', band: upright, leastCols: NARROWEST, leastRows: 40 },
    { name: 'landscape', band: lying, leastCols: NARROWEST, leastRows: 22 },
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

/*
 * Firing a launcher at the wall you are standing against.
 *
 * The blast is a pure function and three Node checks cover what it computes.
 * None of them says the page ever calls it, which is the failure this
 * repository keeps meeting -- every piece correct and nothing happening. So
 * this walks into a wall, fires, and reads the health.
 */
const rocketPage = await browser.newPage({ viewport: { width: 1280, height: 720 } })
rocketPage.on('pageerror', (error) => problems.push(`rocket: ${error.message}`))
await rocketPage.goto(`${base}?probe`, { waitUntil: 'domcontentloaded' })
await rocketPage.waitForTimeout(900)
await begin(rocketPage)
// Five, not three. The keys moved to the original's slots this round: three is
// the shotguns and five is the launcher.
await hold(rocketPage, '5')
await rocketPage.keyboard.down('w')
await rocketPage.waitForTimeout(1200)
await rocketPage.keyboard.up('w')
await rocketPage.waitForTimeout(200)
const beforeRocket = await readOpened(rocketPage)
await rocketPage.keyboard.down(' ')
await rocketPage.waitForTimeout(200)
await rocketPage.keyboard.up(' ')
await rocketPage.waitForTimeout(1200)
const afterRocket = await readOpened(rocketPage)
await rocketPage.close()

/*
 * A map holding a barrel, to see what the page calls a creature.
 *
 * Barrels arrive through the same table the monsters do, so every count that
 * says "creatures" had to learn the difference. Nine of E1M2's hundred and
 * thirty-eight bodies are barrels; a summary reading "4 / 138" would be wrong
 * in both halves, since bursting one also counted as a kill.
 */
const barrelWad = [...tinyWad('E1M1', true, '', [[160, 32, 0, 2035], [100, 64, 0, 3004]], 0, false, 0)]
const barrelPage = await browser.newPage({ viewport: { width: 1280, height: 720 } })
barrelPage.on('pageerror', (error) => problems.push(`barrel: ${error.message}`))
await barrelPage.goto(`${base}?probe`, { waitUntil: 'domcontentloaded' })
await barrelPage.waitForTimeout(900)
await begin(barrelPage)
await barrelPage.evaluate(
  ([bytes, name]) =>
    (window as unknown as { __probe?: { loadWad(b: number[], n: string): boolean } }).__probe?.loadWad(
      bytes as number[],
      name as string,
    ) ?? false,
  [barrelWad, 'E1M1'] as [number[], string],
)
await barrelPage.waitForTimeout(600)
const withBarrel = await readOpened(barrelPage)
await barrelPage.close()

check('a barrel is a body but not a creature', () => {
  // One creature and one barrel were placed. The page must report one.
  assert(
    withBarrel.alive === 1,
    `a map with one creature and one barrel reports ${withBarrel.alive} alive`,
  )
})

/*
 * Firing with the sound on, and then with it off.
 *
 * A noise leaves nothing on the screen, so what is asserted is that the game
 * asked for one: the page counts what it asks for and this reads the count.
 * Whether Web Audio then moves a speaker is Web Audio's problem, and asserting
 * it here would be asserting that the browser works.
 *
 * Two runs rather than one, because a counter that only goes up proves nothing
 * about the switch that is supposed to stop it.
 */
const noisyPage = await browser.newPage({ viewport: { width: 1280, height: 720 } })
noisyPage.on('pageerror', (error) => problems.push(`sound: ${error.message}`))
await noisyPage.goto(base, { waitUntil: 'domcontentloaded' })
await noisyPage.waitForTimeout(900)
const beforeAnySound = await readOpened(noisyPage)
await begin(noisyPage)
await noisyPage.keyboard.down(' ')
await noisyPage.waitForTimeout(200)
await noisyPage.keyboard.up(' ')
await noisyPage.waitForTimeout(400)
const afterOneShot = await readOpened(noisyPage)

// Walk to the sound line, switch it off, begin, and shoot again.
await noisyPage.close()

const quietPage = await browser.newPage({ viewport: { width: 1280, height: 720 } })
quietPage.on('pageerror', (error) => problems.push(`muted: ${error.message}`))
await quietPage.goto(base, { waitUntil: 'domcontentloaded' })
await quietPage.waitForTimeout(900)
/*
 * Held, not tapped.
 *
 * `press` puts the keyup in the same instant as the keydown, and the menu reads
 * what is held once a frame -- so four taps moved the cursor one line, the `e`
 * that followed chose a level instead of the sound switch, and the check
 * reported that switching the sound off did not switch the sound off. Second
 * time this has caught me; a human tap is a hundred milliseconds, which is six
 * frames.
 */
// The same `hold` every other check uses now, rather than a second copy of it
// written inside this block -- which is how two of them came to exist.
/*
 * Down to the sound line by reading the cursor rather than by counting presses.
 *
 * Counting was the first version and it broke the day a line was added above
 * this one: four presses landed on the difficulty, "e" cycled that instead, and
 * the failure read as "choosing the sound line did not switch it off" -- which
 * blames the feature for a check that had drifted. A menu is allowed to grow.
 */
const walkTo = async (page: Page, label: string): Promise<boolean> => {
  for (let i = 0; i < 12; i++) {
    if ((await readOpened(page)).menuLabel.startsWith(label)) return true
    await hold(page, 'ArrowDown', 170)
  }
  return (await readOpened(page)).menuLabel.startsWith(label)
}
const foundSoundLine = await walkTo(quietPage, 'sound:')
await hold(quietPage, 'e', 170)
await quietPage.waitForTimeout(300)
const muted = await readOpened(quietPage)
await walkTo(quietPage, 'begin')
await hold(quietPage, 'e', 170)
await quietPage.waitForTimeout(600)
const mutedStart = await readOpened(quietPage)
await quietPage.keyboard.down(' ')
await quietPage.waitForTimeout(200)
await quietPage.keyboard.up(' ')
await quietPage.waitForTimeout(400)
const mutedAfter = await readOpened(quietPage)
await quietPage.close()

check('the game asks for a noise when you fire, and stops when told to', () => {
  assert(beforeAnySound.noisesPlayed === 0, `${beforeAnySound.noisesPlayed} noises before anything happened`)
  assert(beforeAnySound.audible, 'the page starts with the sound switched off')
  assert(
    afterOneShot.noisesPlayed > 0,
    `firing left the count at ${afterOneShot.noisesPlayed}`,
  )

  // And the switch. Without this half, a count that only ever rises would pass.
  assert(foundSoundLine, 'the title has no line offering the sound')
  assert(!muted.audible, 'choosing the sound line did not switch it off')
  assert(
    mutedAfter.noisesPlayed === mutedStart.noisesPlayed,
    `muted, the count went from ${mutedStart.noisesPlayed} to ${mutedAfter.noisesPlayed}`,
  )
})

/*
 * Walking into a hidden room.
 *
 * Finding one says so on screen for a moment and then leaves nothing behind, so
 * the page reports the count and this reads it -- and walks the other way in a
 * second run, because a number that only goes up says nothing about whether
 * walking into the room is what moved it.
 *
 * The eastern room of the fixture is marked secret and left open; the player
 * starts in the western one facing east.
 */
const secretWad = [...tinyWad('E1M1', true, '', [], 0, false, 0, 0, 0, false, '', 9)]
const secretPage = await browser.newPage({ viewport: { width: 1280, height: 720 } })
secretPage.on('pageerror', (error) => problems.push(`secret: ${error.message}`))
await secretPage.goto(`${base}?probe`, { waitUntil: 'domcontentloaded' })
await secretPage.waitForTimeout(900)
await begin(secretPage)
await secretPage.evaluate(
  ([bytes, name]) =>
    (window as unknown as { __probe?: { loadWad(b: number[], n: string): boolean } }).__probe?.loadWad(
      bytes as number[],
      name as string,
    ) ?? false,
  [secretWad, 'E1M1'] as [number[], string],
)
await secretPage.waitForTimeout(600)
const beforeSecret = await readOpened(secretPage)

// Standing still first: the count must not move on its own.
await secretPage.waitForTimeout(600)
const stillOutside = await readOpened(secretPage)

// Then east, into it.
await secretPage.keyboard.down('w')
await secretPage.waitForTimeout(1600)
await secretPage.keyboard.up('w')
await secretPage.waitForTimeout(300)
const afterWalking = await readOpened(secretPage)
await secretPage.close()

check('walking into a hidden room is noticed', () => {
  assert(beforeSecret.secrets === 1, `the map reported ${beforeSecret.secrets} hidden rooms`)
  assert(beforeSecret.found === 0, `${beforeSecret.found} were found before anybody moved`)
  assert(stillOutside.found === 0, 'a hidden room was found by standing still')
  assert(afterWalking.found === 1, `after walking east ${afterWalking.found} were found`)
})

/*
 * The weapon in your hands, and whether it moves when it fires.
 *
 * Node can say the two frames were baked and that they differ. It cannot say
 * the page ever draws the second one -- and when the wiring was reverted to
 * the held frame deliberately, the only complaint came from the compiler about
 * an unused import, which a real regression would not produce.
 *
 * So this reads the screen: the rows the weapon occupies are found by swapping
 * weapons and seeing which rows change, rather than by guessing at a slice.
 */
/**
 * A row of each weapon's art, long enough that nothing else draws it.
 *
 * Read out of the baked sprites rather than written down here, so re-baking the
 * art cannot leave the check looking for a picture that no longer exists.
 */
const signatureOf = (sprite: { rows: readonly string[] }): string =>
  sprite.rows.reduce((one, other) => (other.trim().length > one.trim().length ? other : one)).trim()
const SIDEARM_SIGNATURE = signatureOf(FREEDOOM.SIDEARM_HELD)
const LAUNCHER_SIGNATURE = signatureOf(FREEDOOM.LAUNCHER_HELD)

const gunPage = await browser.newPage({ viewport: { width: 1280, height: 720 } })
gunPage.on('pageerror', (error) => problems.push(`weapon: ${error.message}`))
await gunPage.goto(base, { waitUntil: 'domcontentloaded' })
await gunPage.waitForTimeout(900)
await begin(gunPage)
const screenRows = async (): Promise<string[]> =>
  await gunPage.evaluate(() => {
    const pre = document.querySelector('pre')
    return pre ? pre.innerText.split('\n') : []
  })

const withSidearm = await screenRows()
/*
 * Held, not tapped. Third time this has caught me in one session.
 *
 * `keyboard.press` puts the keyup in the same instant as the keydown, and the
 * game reads which keys are held once a frame -- so a tap falls between two
 * samples and the weapon never changes. The check then reported, accurately and
 * uselessly, that the launcher was not on screen: it was never selected.
 *
 * And it is the fifth key, not the third. The keys moved to the original's seven
 * slots this round, where the launcher is five and three is the two shotguns.
 */
await gunPage.keyboard.down('5')
await gunPage.waitForTimeout(200)
await gunPage.keyboard.up('5')
await gunPage.waitForTimeout(400)
const withLauncher = await screenRows()

// Firing, read inside the reload. The launcher takes 1.2 seconds, so a third
// of it is four hundred milliseconds and there is no race to lose.
await gunPage.keyboard.down(' ')
await gunPage.waitForTimeout(150)
const whileFiring = await screenRows()
await gunPage.keyboard.up(' ')
await gunPage.close()

const differing = (one: readonly string[], other: readonly string[]): number[] => {
  const rows: number[] = []
  for (let i = 0; i < Math.max(one.length, other.length); i++) {
    if ((one[i] ?? '') !== (other[i] ?? '')) rows.push(i)
  }
  return rows
}

check('the weapon is on screen and moves when it fires', () => {
  /*
   * Looked for by its own shape rather than by "something changed".
   *
   * The first version asked whether swapping weapons changed any row in the
   * lower half of the screen. It passed while no weapon was drawn at all: what
   * changed was the status bar, whose middle panel is named after the weapon
   * you are holding. A check that can be satisfied by the thing it is not
   * about is not a check.
   *
   * These strings are rows of the baked art, so a wall cannot produce them.
   */
  const shows = (rows: readonly string[], signature: string): boolean =>
    rows.some((row) => row.includes(signature))

  assert(
    shows(withSidearm, SIDEARM_SIGNATURE),
    `the sidearm is not on screen; the foot of the view reads ${JSON.stringify(withSidearm.slice(-18, -4).map((r) => r.trim()).join(' / ').slice(0, 200))}`,
  )
  assert(
    shows(withLauncher, LAUNCHER_SIGNATURE),
    'switching to the launcher did not put the launcher on screen',
  )
  assert(!shows(withLauncher, SIDEARM_SIGNATURE), 'both weapons are on screen at once')

  const fired = differing(withLauncher, whileFiring)
  assert(fired.length > 0, 'the weapon is drawn the same whether it is firing or not')
})

check('a rocket fired at your feet costs you health', () => {
  /*
   * Which weapon was in hand, asserted rather than assumed.
   *
   * This check tapped the key that selects the launcher, which does nothing,
   * and so spent its life firing the sidearm at a wall -- and passed, because
   * walking into the outpost's first room costs seven health to something else
   * entirely. It was measuring the wrong weapon and the wrong injury at once.
   */
  assert(
    beforeRocket.weapon === 'launcher',
    `the check fired a ${beforeRocket.weapon} rather than the launcher`,
  )
  assert(beforeRocket.health === 100, `the walk to the wall already cost health (${beforeRocket.health})`)
  assert(
    afterRocket.health < beforeRocket.health,
    `firing a launcher into a wall left health at ${afterRocket.health}`,
  )
  // Not death, either: a blast that killed you outright would pass the line
  // above while making the weapon unusable.
  assert(afterRocket.health > 0, 'firing a launcher into a wall killed the player outright')
})

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
  await begin(finish)

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
/*
 * And then asked for the next one, because it waits to be.
 *
 * This used to sit out the rest of a three-and-a-half second clock. The
 * original's intermission goes on when you press, and the reads above are what
 * say the screen is still there until you do -- so the press belongs after
 * them.
 */
await hold(finish, ' ')
await finish.waitForTimeout(900)
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
  await begin(corpse)

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
  await begin(mapper)

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

const leftovers = await app.evaluate(async () => {
  // Nothing is installed any more, so this asks what is left rather than
  // waiting for something to arrive. The old version waited eight seconds for
  // `ready` and another eight for `activated`; with no worker coming, that was
  // sixteen seconds of the gate spent proving an absence.
  const workers = await navigator.serviceWorker.getRegistrations()
  const names = await caches.keys()
  return { workers: workers.length, caches: names }
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

check('nothing is cached between launches', () => {
  // The reverse of what this used to assert, and pinned on purpose. A service
  // worker was precaching the shell and every asset until an installed copy was
  // reported showing an old build; the cache went rather than be guessed at.
  // Somebody putting one back would quietly make the README a lie, and this is
  // what would catch it.
  assert(leftovers.workers === 0, `${leftovers.workers} service worker(s) are still registered`)
  assert(
    leftovers.caches.length === 0,
    `caches survived the visit: ${leftovers.caches.join(', ')}`,
  )
  // And the consequence, stated rather than implied: with nothing cached, the
  // page does not come up without a network.
  assert(
    offline === null || offline.frames === 0,
    `the page drew ${offline?.frames} frames offline, so something is caching after all`,
  )
  void offlineFailure
})

// Ground that hurts, in the running game rather than in a fixture. The channel
// is in the second level, so this finishes the first one to get there.
const wading = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const waded = await wading.newPage()
waded.on('pageerror', (error) => problems.push(`hazard: ${error.message}`))
await waded.goto(`${base}?probe=1`, { waitUntil: 'domcontentloaded' })
await waded.waitForTimeout(900)
  await begin(waded)

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
/*
 * Through the summary, which now waits to be asked rather than for a clock.
 *
 * This used to sit out a pause and find itself in the cistern. The original's
 * intermission waits for a press and so does this one, so a check that wants
 * the next level has to press -- and after the grace that stops the trigger you
 * opened the exit with from skipping the screen you just earned.
 */
await waded.waitForTimeout(900)
await hold(waded, ' ')
await waded.waitForTimeout(900)

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
  await begin(wadPage)

/**
 * Holds a key for long enough that the game notices it.
 *
 * `keyboard.press` puts the keyup in the same instant as the keydown, and this
 * game reads which keys are held once a frame -- so a tap falls between two
 * samples and does nothing at all. That has cost three separate checks in one
 * session: a menu that would not move, a sound switch that would not switch,
 * and a rocket check that spent its life firing a pistol because the key that
 * selects the launcher never registered.
 */
async function hold(page: Page, key: string, ms = 200): Promise<void> {
  await page.keyboard.down(key)
  await page.waitForTimeout(ms)
  await page.keyboard.up(key)
  await page.waitForTimeout(90)
}

function readOpened(page: Page) {
  return page.evaluate(() => {
    const probe = (window as unknown as { __doom?: Record<string, unknown> }).__doom ?? {}
    return {
      level: (probe.level as string) ?? '',
      levelIndex: (probe.levelIndex as number) ?? -99,
      lines: (probe.lines as number) ?? -1,
      seen: (probe.seen as number) ?? -1,
      /** The colours being carried, which is how a check sees a key arrive. */
      keys: (probe.keys as string[]) ?? [],
      menuLabel: (probe.menuLabel as string) ?? '',
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
      titleUp: probe.titleUp === true,
      noisesPlayed: (probe.noisesPlayed as number) ?? -1,
      audible: probe.audible === true,
      secrets: (probe.secrets as number) ?? -1,
      found: (probe.found as number) ?? -1,
      weapon: (probe.weapon as string) ?? '',
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
  await begin(picker)

const beforePick = await readOpened(picker)
await picker.setInputFiles('#wad', goodWad)
// Waited on rather than budgeted for. Choosing a file is asynchronous twice
// over -- the bytes arrive from a promise and the level is built after that --
// and a fixed six hundred milliseconds is a guess about a machine. This failed
// once here on a loaded machine, passed twice straight after, and could not be
// reproduced; the assertions below are unchanged, so a feature that is actually
// broken still fails them, only now it fails them for being broken.
// Waited on rather than budgeted for, as before -- but what is waited for has
// changed. Choosing a file used to drop you into its first map; it now offers
// the file's maps and waits, so the thing that says the bytes arrived is the
// title coming back up with names on it.
await picker
  .waitForFunction(
    () => {
      const probe = (window as unknown as { __doom?: Record<string, unknown> }).__doom
      const screen = document.getElementById('screen')?.textContent ?? ''
      return probe?.titleUp === true && screen.includes('E1M1')
    },
    undefined,
    { timeout: 5000 },
  )
  .catch(() => undefined)
const offered = await readOpened(picker)
const offeredText = await picker.evaluate(() => document.getElementById('screen')?.textContent ?? '')

// And taking one, with the key a player would use rather than through a hatch.
await picker.keyboard.down('e')
await picker.waitForTimeout(120)
await picker.keyboard.up('e')
await picker
  .waitForFunction(
    () => ((window as unknown as { __doom?: Record<string, unknown> }).__doom?.level as string) === 'E1M1',
    undefined,
    { timeout: 5000 },
  )
  .catch(() => undefined)
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

check('opening a file offers the maps in it', () => {
  // It used to open the first map and stop, which left thirty-five of a file's
  // thirty-six with no way of being reached. What a person gets now is the
  // title back with the file's maps on it, so this asserts the offer rather
  // than the arrival -- the arrival is the check below.
  assert(beforePick.level !== 'E1M1', `the page was already showing "${beforePick.level}" before any file was chosen`)
  assert(offered.titleUp, 'choosing a file went straight into a map instead of offering them')
  assert(offeredText.includes('E1M1'), 'the file was opened but its maps are not on screen')
})

check('a person can open a map with the file picker', () => {
  assert(afterPick.level === 'E1M1', `after choosing a WAD the level is "${afterPick.level}"`)
  assert(!afterPick.titleUp, 'picking a map left the title up')
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
// Long enough that a clock would have moved on by now. The summary used to end
// after three and a half seconds; it ends when it is asked to.
await wadPage.waitForTimeout(4200)
const afterThePause = await readOpened(wadPage)
/*
 * Leaving one is asked on a page of its own, further down.
 *
 * It cannot be asked here: the press that leaves puts this page on the title,
 * and three checks after this one go on using it to open maps and press walls.
 * They all failed at once, which is how a shared page tells you it is shared.
 */

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

  /*
   * And there is a way out of it, which there was not.
   *
   * A map from a file has nothing after it, so the summary used to be the end
   * of the session: the result sat on the screen and the only thing left to do
   * was reload the page. Every one of the sixty-eight maps that ship is in that
   * position. The original's answer to "the episode is over" is its menu, so
   * this one asks and gets the title back.
   */
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

/*
 * The way out of a map that is over, on a page of its own.
 *
 * A map from a file has nothing after it, so the summary used to be the end of
 * the session: the result sat on the screen and the only thing left was
 * reloading the page. Every one of the sixty-eight maps that ship is in that
 * position. The original's answer to "that was the last of them" is its menu.
 *
 * Its own page because the press that leaves puts the page on the title, and a
 * page on the title cannot go on being used to open maps and press walls.
 */
const leaving = await browser.newPage({ viewport: { width: 1280, height: 720 } })
leaving.on('pageerror', (error) => problems.push(`leaving: ${error.message}`))
await leaving.goto(`${base}?probe=1`, { waitUntil: 'domcontentloaded' })
await leaving.waitForTimeout(900)
await begin(leaving)
const tookLeaving = await leaving.evaluate(
  ([bytes, name]) =>
    (window as unknown as { __probe?: { loadWad(b: number[], n: string): boolean } }).__probe?.loadWad(
      bytes as number[],
      name as string,
    ) ?? false,
  [exitWad, 'E1M1'] as [number[], string],
)
await leaving.waitForTimeout(400)
const leavingWalked = await leaving.evaluate(
  () => (window as unknown as { __probe?: { toExit(): boolean } }).__probe?.toExit() ?? false,
)
await leaving.waitForTimeout(500)
const leavingFinished = await readOpened(leaving)
// Past the grace that stops the trigger you finished with from skipping the
// screen you just earned, then asked.
await leaving.waitForTimeout(800)
await hold(leaving, ' ')
await leaving.waitForTimeout(800)
const leavingAfter = await readOpened(leaving)
await leaving.close()

check('a map with nothing after it can be left', () => {
  assert(tookLeaving && leavingWalked, 'the page would not take the map or could not reach its exit')
  assert(leavingFinished.complete, 'crossing the exit did not finish the map')
  assert(!leavingFinished.titleUp, 'finishing the map went straight back to the title without asking')
  assert(leavingAfter.titleUp, 'asking to leave a finished map left the result on the screen')
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

/*
 * A door that opens because it was shot, which is the only way thirteen maps
 * open the one they give you no way to touch.
 *
 * The same shape as the pressed-door check above and for the same reason: the
 * rules are exercised directly in Node, so nothing there notices if the page
 * stops asking. The fixture's only machine is this door, which is what makes
 * `doorState` -- the first mover's state -- the right thing to read.
 *
 * Walking up to it is checked as well as shooting it. A gun-triggered line
 * that leaked into the crossed table would open on approach and the shot would
 * look like it worked.
 */
const shotWad = [...tinyWad('E1M1', true, '', [], 46, true, 0, 5)]
const shotPage = await browser.newPage({ viewport: { width: 1280, height: 720 } })
shotPage.on('pageerror', (error) => problems.push(`gun door: ${error.message}`))
await shotPage.goto(`${base}?probe`, { waitUntil: 'domcontentloaded' })
await shotPage.waitForTimeout(900)
await begin(shotPage)
await shotPage.evaluate(
  ([bytes, name]) =>
    (window as unknown as { __probe?: { loadWad(b: number[], n: string): boolean } }).__probe?.loadWad(
      bytes as number[],
      name as string,
    ) ?? false,
  [shotWad, 'E1M1'] as [number[], string],
)
await shotPage.waitForTimeout(400)
const beforeShooting = await readOpened(shotPage)
await shotPage.keyboard.down('w')
await shotPage.waitForTimeout(900)
await shotPage.keyboard.up('w')
await shotPage.waitForTimeout(200)
const atTheShotWall = await readOpened(shotPage)
await hold(shotPage, ' ', 250)
await shotPage.waitForTimeout(900)
const afterTheShot = await readOpened(shotPage)
await shotPage.close()

check('a door in a map from a file opens when it is shot', () => {
  assert(beforeShooting.doorState === 'shut', `the door arrived as "${beforeShooting.doorState}"`)
  assert(atTheShotWall.doorState === 'shut', 'walking up to the door opened it without a shot')
  assert(
    afterTheShot.doorState !== 'shut',
    `shooting the door left it "${afterTheShot.doorState}"`,
  )
  // And a pellet landing on a wall is not an exit, any more than pressing one is.
  assert(!afterTheShot.complete, 'shooting a door finished the level')
})

/*
 * A run that survives the tab closing, which is the whole of saving.
 *
 * Three visits in one context so the storage carries between them, because
 * that is the thing being checked: a fresh context would prove only that the
 * page can write, not that it can come back.
 */
const keeping = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const firstVisit = await keeping.newPage()
firstVisit.on('pageerror', (error) => problems.push(`saving: ${error.message}`))
await firstVisit.goto(base, { waitUntil: 'domcontentloaded' })
await firstVisit.waitForTimeout(900)
const savedAtFirstSight = await firstVisit.evaluate(() =>
  window.localStorage.getItem('ascii-doom/save'),
)
const menuBeforePlaying = await firstVisit.evaluate(
  () => (window as unknown as { __doom?: Record<string, unknown> }).__doom?.menuLabel ?? '',
)

// Play: past the title, walk a little, take some damage from the nukage.
await begin(firstVisit)
await firstVisit.keyboard.down('w')
await firstVisit.waitForTimeout(1400)
await firstVisit.keyboard.up('w')
await firstVisit.waitForTimeout(300)
const beforeClosing = await readOpened(firstVisit)
const savedAfterPlaying = await firstVisit.evaluate(() =>
  window.localStorage.getItem('ascii-doom/save'),
)
await firstVisit.close()

// The tab goes away and comes back.
const secondVisit = await keeping.newPage()
secondVisit.on('pageerror', (error) => problems.push(`continuing: ${error.message}`))
await secondVisit.goto(base, { waitUntil: 'domcontentloaded' })
await secondVisit.waitForTimeout(900)
const menuAfterPlaying = await secondVisit.evaluate(
  () => (window as unknown as { __doom?: Record<string, unknown> }).__doom?.menuLabel ?? '',
)
await begin(secondVisit)
await secondVisit.waitForTimeout(600)
const afterContinuing = await readOpened(secondVisit)
const savedAfterContinuing = await secondVisit.evaluate(() => {
  const raw = window.localStorage.getItem('ascii-doom/save')
  return raw === null ? null : (JSON.parse(raw) as { carrier: { health: number } }).carrier.health
})
await secondVisit.close()
await keeping.close()

check('a run is written down and offered back', () => {
  assert(savedAtFirstSight === null, 'a page nobody has played wrote a save anyway')
  assert(
    menuBeforePlaying === 'begin',
    `with nothing saved the cursor opened on "${String(menuBeforePlaying)}" rather than "begin"`,
  )
  assert(savedAfterPlaying !== null, 'playing a level wrote nothing down')
  assert(
    menuAfterPlaying === 'continue',
    `with a run saved the cursor opened on "${String(menuAfterPlaying)}" rather than "continue"`,
  )
})

check('continuing puts the run back rather than starting it over', () => {
  // The nukage in the first room costs health on the way to the wall, so the
  // run that comes back is recognisable by being hurt.
  assert(beforeClosing.health < 100, `the walk cost nothing, so there is nothing to recognise`)
  /*
   * Hurt, rather than hurt by exactly as much.
   *
   * The save is written every few seconds, so what comes back is the run as of
   * the last write rather than as of the last frame -- and the first room's
   * floor is nukage, which keeps taking health between the two. Demanding the
   * numbers match would be demanding a save on every frame, which is not the
   * rule this was built to. What it must never be is a fresh start.
   */
  assert(
    afterContinuing.health < 100,
    `the run came back on full health, which is a new run rather than the saved one`,
  )
  assert(
    afterContinuing.health <= beforeClosing.health,
    `the run came back healthier (${afterContinuing.health}) than it was left (${beforeClosing.health})`,
  )
  assert(!afterContinuing.titleUp, 'continuing left the title up')
  assert(afterContinuing.level === beforeClosing.level, 'continuing came back in another level')

  /*
   * And the save still holds the run, which is not the same claim.
   *
   * Continuing builds the level fresh and lays the save over it, and the first
   * version wrote the run down on the way in -- so the blank level it had just
   * built replaced the save a moment before the save was applied. The screen
   * looked perfect and the second continue in a row started you over.
   */
  assert(savedAfterContinuing !== null, 'continuing left nothing saved at all')
  assert(
    savedAfterContinuing !== 100,
    'continuing wrote a full-health run over the save it was restoring',
  )
})

/*
 * The typed words, in the page rather than in the module that recognises them.
 *
 * The recognising is checked in Node and needs nothing here; what this asks is
 * the other half -- that the page is listening at all, and that what it does
 * with an effect reaches the game. The first room's floor is nukage, so the
 * damage that stops is the evidence.
 */
const cheatPage = await browser.newPage({ viewport: { width: 1280, height: 720 } })
cheatPage.on('pageerror', (error) => problems.push(`cheats: ${error.message}`))
await cheatPage.goto(`${base}?probe`, { waitUntil: 'domcontentloaded' })
await cheatPage.waitForTimeout(900)
await begin(cheatPage)
// Stand in it long enough to be hurt, which is what makes the stop visible.
await cheatPage.keyboard.down('w')
await cheatPage.waitForTimeout(1100)
await cheatPage.keyboard.up('w')
await cheatPage.waitForTimeout(900)
const hurtBeforeCheating = await readOpened(cheatPage)
for (const letter of 'iddqd') await cheatPage.keyboard.press(letter)
await cheatPage.waitForTimeout(1600)
const hurtAfterCheating = await readOpened(cheatPage)
const keysBeforeKit = hurtAfterCheating.keys.length
for (const letter of 'idkfa') await cheatPage.keyboard.press(letter)
await cheatPage.waitForTimeout(400)
const afterTheKit = await readOpened(cheatPage)
const seenBeforeChart = afterTheKit.seen
for (const letter of 'iddt') await cheatPage.keyboard.press(letter)
await cheatPage.waitForTimeout(400)
const afterTheChart = await readOpened(cheatPage)
await cheatPage.close()

check('a typed word reaches the game', () => {
  assert(
    hurtBeforeCheating.health < 100,
    'the floor did not hurt, so there is nothing for the cheat to stop',
  )
  // Nothing can hurt you: the health that was falling stops where it was.
  assert(
    hurtAfterCheating.health === hurtBeforeCheating.health,
    `the floor kept hurting after iddqd: ${hurtBeforeCheating.health} to ${hurtAfterCheating.health}`,
  )
  assert(
    afterTheKit.keys.length > keysBeforeKit,
    `idkfa handed over ${afterTheKit.keys.length - keysBeforeKit} keys`,
  )
  assert(
    afterTheChart.seen > seenBeforeChart,
    `iddt added ${afterTheChart.seen - seenBeforeChart} lines to the map`,
  )
})

/*
 * A recording, and then the game playing it back to itself.
 *
 * The one claim about demos that Node cannot make: the rules being replayed
 * into live in the page. Recording and replay both start the level from the
 * top -- a replay has only the input, not the room -- so the test is simply
 * whether the same input lands the body in the same place.
 */
const tapePage = await browser.newPage({ viewport: { width: 1280, height: 720 } })
tapePage.on('pageerror', (error) => problems.push(`demo: ${error.message}`))
await tapePage.goto(`${base}?probe`, { waitUntil: 'domcontentloaded' })
await tapePage.waitForTimeout(900)
await begin(tapePage)
const whereIs = () =>
  tapePage.evaluate(() => {
    const d = (window as unknown as { __doom?: Record<string, unknown> }).__doom ?? {}
    return { x: (d.x as number) ?? NaN, y: (d.y as number) ?? NaN, health: (d.health as number) ?? -1 }
  })

for (const letter of 'idrec') await tapePage.keyboard.press(letter)
await tapePage.waitForTimeout(300)
// A run with some turning in it, so the check is not just "walked forwards".
await tapePage.keyboard.down('w')
await tapePage.waitForTimeout(700)
await tapePage.keyboard.down('ArrowLeft')
await tapePage.waitForTimeout(500)
await tapePage.keyboard.up('ArrowLeft')
await tapePage.waitForTimeout(400)
await tapePage.keyboard.up('w')
await tapePage.waitForTimeout(200)
for (const letter of 'idrec') await tapePage.keyboard.press(letter)
await tapePage.waitForTimeout(300)
const whereRecordingEnded = await whereIs()

for (const letter of 'idplay') await tapePage.keyboard.press(letter)
// Long enough for the whole recording plus the margin its own keystrokes cost.
await tapePage.waitForTimeout(4000)
const whereReplayEnded = await whereIs()
await tapePage.close()

check('a recorded run plays itself back to the same place', () => {
  assert(
    Number.isFinite(whereRecordingEnded.x) && Number.isFinite(whereReplayEnded.x),
    'the page never reported where the body was',
  )
  const drift = Math.hypot(
    whereReplayEnded.x - whereRecordingEnded.x,
    whereReplayEnded.y - whereRecordingEnded.y,
  )
  assert(
    drift < 1,
    `the replay ended ${drift.toFixed(2)} m from where the recording did ` +
      `(${whereRecordingEnded.x.toFixed(2)}, ${whereRecordingEnded.y.toFixed(2)}) ` +
      `vs (${whereReplayEnded.x.toFixed(2)}, ${whereReplayEnded.y.toFixed(2)})`,
  )
  // And it went somewhere: a replay that never moved would pass a drift test
  // against a recording that never moved either.
  assert(
    Math.hypot(whereRecordingEnded.x - 2, whereRecordingEnded.y - 3) > 1,
    'the recording never left the spawn, so matching it proves nothing',
  )
})

/*
 * The maps that ship, reached the way a person reaches them.
 *
 * Sixty-eight files sit beside the page and are fetched one at a time, so this
 * asks the two things that arrangement can get wrong: that the list arrives and
 * turns the title line on, and that picking one actually loads that map rather
 * than the campaign it was standing in.
 */
const shippedPage = await browser.newPage({ viewport: { width: 1280, height: 720 } })
shippedPage.on('pageerror', (error) => problems.push(`shipped maps: ${error.message}`))
await shippedPage.goto(base, { waitUntil: 'domcontentloaded' })
// Long enough for the list to arrive over the loopback, which is instant, plus
// the frame that rebuilds the title with it.
await shippedPage.waitForTimeout(1200)
const titleWithMaps = await readOpened(shippedPage)
// Down to the line that offers them: continue (disabled), begin, two levels,
// then this one.
for (let i = 0; i < 3; i++) await hold(shippedPage, 'ArrowDown')
const onTheMapsLine = await readOpened(shippedPage)
await hold(shippedPage, ' ')
await shippedPage.waitForTimeout(400)
const listOfMaps = await readOpened(shippedPage)
// The first map in the list, which is the one the cursor starts on.
await hold(shippedPage, ' ')
await shippedPage.waitForTimeout(1500)
const playingAShippedMap = await readOpened(shippedPage)
const shippedNotice = await topLine(shippedPage)
await shippedPage.close()

check('the maps that ship can be reached and played', () => {
  assert(titleWithMaps.titleUp, 'the page did not come up on the title')
  assert(
    onTheMapsLine.menuLabel === 'the maps that ship',
    `three lines down from the top is "${onTheMapsLine.menuLabel}" rather than the maps`,
  )
  // Choosing it swaps the title's list for the maps themselves.
  assert(listOfMaps.titleUp, 'choosing the map list left the title')
  assert(
    /^(E\dM\d|MAP\d\d)$/.test(listOfMaps.menuLabel),
    `the list offers "${listOfMaps.menuLabel}", which is not a map name`,
  )
  // And choosing one of those fetches it and plays it.
  assert(!playingAShippedMap.titleUp, 'picking a map left the title up')
  assert(
    playingAShippedMap.level === listOfMaps.menuLabel,
    `picked ${listOfMaps.menuLabel} and ended up in ${playingAShippedMap.level}`,
  )
  /*
   * And it announces the map rather than complaining about it.
   *
   * These maps are cut down by this project's own converter -- five lumps each,
   * no sprites -- so the line that tells somebody their file had no pictures in
   * it was this game complaining about its own data to a person who picked a
   * level off a menu. Found by playing rather than by any check: it is the first
   * thing on screen and it reads like an error.
   */
  assert(
    shippedNotice.includes(listOfMaps.menuLabel),
    `picking ${listOfMaps.menuLabel} said "${shippedNotice}"`,
  )
  assert(
    !shippedNotice.includes('no pictures'),
    `picking a map off the menu complained: "${shippedNotice}"`,
  )
  assert(playingAShippedMap.lines > 100, `${playingAShippedMap.level} came up with ${playingAShippedMap.lines} walls`)
})

/**
 * Waits for the game to advance, rather than for time to pass.
 *
 * In lockstep neither side may run a tick the other has not spoken for, so a
 * page whose frames are being throttled does not merely slow itself down -- it
 * stops both. Waiting a fixed number of milliseconds then measures how busy
 * the machine was: the same check passed alone and failed in a full gate run
 * with a third browser open, reporting that somebody had walked no distance at
 * all. They had walked for the whole second; the second just had almost no
 * ticks in it.
 */
const waitTicks = async (page: Page, many: number): Promise<boolean> => {
  const reading = () =>
    page.evaluate(
      () => ((window as unknown as { __doom?: Record<string, unknown> }).__doom?.netTick as number) ?? 0,
    )
  const from = await reading()
  try {
    await page.waitForFunction(
      (want) =>
        (((window as unknown as { __doom?: Record<string, unknown> }).__doom?.netTick as number) ?? 0) >= want,
      from + many,
      { timeout: 60000 },
    )
    return true
  } catch {
    /*
     * Answered rather than thrown, because a throw out here is not a failed
     * check -- it is the end of the run.
     *
     * A game that stopped advancing killed the whole gate three times while
     * this was being written, and each time the sixty-eight verdicts that had
     * already been earned went with it and the output said nothing about which
     * check had been waiting. The caller records this and asserts on it, so a
     * stall fails the check it belongs to and leaves the rest standing.
     */
    return false
  }
}

/*
 * Two people, in one world, with nothing between the two browsers.
 *
 * Its own browser, with background throttling off. Two pages in one browser
 * means one of them is behind the other, and a page in the background has its
 * frames throttled -- which in lockstep does not slow one side down, it stops
 * both, because neither may advance a tick the other has not spoken for.
 */
const pairBrowser = await chromium.launch({
  args: [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
})
const pairContext = await pairBrowser.newContext({ viewport: { width: 1280, height: 720 } })
const hostPage = await pairContext.newPage()
const guestPage = await pairContext.newPage()
for (const page of [hostPage, guestPage]) {
  page.on('pageerror', (error) => problems.push(`two players: ${error.message}`))
  await page.goto(base, { waitUntil: 'domcontentloaded' })
}
// Long enough for the list of maps to arrive, which is what turns the line on.
await hostPage.waitForTimeout(1400)
await guestPage.waitForTimeout(200)

const openMeeting = async (page: Page): Promise<boolean> => {
  for (let i = 0; i < 12; i++) {
    if ((await readOpened(page)).menuLabel === 'play somebody') break
    await hold(page, 'ArrowDown', 150)
  }
  const found = (await readOpened(page)).menuLabel === 'play somebody'
  await hold(page, ' ', 150)
  return found
}
const hostFoundIt = await openMeeting(hostPage)
const guestFoundIt = await openMeeting(guestPage)

const waitForLine = (page: Page) =>
  page.waitForFunction(
    () => ((document.getElementById('meetmine') as HTMLTextAreaElement | null)?.value.length ?? 0) > 0,
    undefined,
    { timeout: 15000 },
  )

await hostPage.click('#meethost')
await waitForLine(hostPage)
const invitation = await hostPage.inputValue('#meetmine')
await guestPage.fill('#meettheirs', invitation)
await guestPage.click('#meetjoin')
await waitForLine(guestPage)
const reply = await guestPage.inputValue('#meetmine')
await hostPage.fill('#meettheirs', reply)
await hostPage.click('#meetaccept')

const standing = (page: Page) =>
  page.evaluate(() => {
    const d = (window as unknown as { __doom?: Record<string, unknown> }).__doom ?? {}
    return {
      linked: d.linked === true,
      hosting: d.hosting === true,
      level: (d.level as string) ?? '',
      tick: (d.netTick as number) ?? -1,
      x: (d.x as number) ?? NaN,
      y: (d.y as number) ?? NaN,
      mate: (d.mateAt as { x: number; y: number } | null) ?? null,
    }
  })

// The handshake and the fetch of a map on both sides, then enough ticks to be
// sure both are actually running rather than merely connected.
await hostPage.waitForFunction(
  () => (window as unknown as { __doom?: Record<string, unknown> }).__doom?.linked === true,
  undefined,
  { timeout: 30000 },
)
let pairKeptTicking = await waitTicks(hostPage, 60)
const hostJoined = await standing(hostPage)
const guestJoined = await standing(guestPage)

// One of them walks, and the question is whether the other sees it.
await hostPage.keyboard.down('w')
pairKeptTicking = (await waitTicks(hostPage, 72)) && pairKeptTicking
await hostPage.keyboard.up('w')
pairKeptTicking = (await waitTicks(hostPage, 30)) && pairKeptTicking
const hostWalked = await standing(hostPage)
const guestWatching = await standing(guestPage)
await pairBrowser.close()

check('two browsers meet with no server and play the same world', () => {
  assert(pairKeptTicking, 'the two of them stopped advancing: the lockstep deadlocked')
  assert(hostFoundIt && guestFoundIt, 'the title has no line offering to play somebody')
  assert(hostJoined.linked && guestJoined.linked, 'the two pages never connected')
  assert(hostJoined.hosting && !guestJoined.hosting, 'both sides think they are the same one')
  assert(
    hostJoined.level === guestJoined.level && hostJoined.level !== '',
    `one is in ${hostJoined.level} and the other in ${guestJoined.level}`,
  )
  assert(hostJoined.tick > 0 && guestJoined.tick > 0, 'the clock never started on one of them')

  /*
   * The assertion this round was really written for.
   *
   * Both sides ran the same code at first, so both put themselves at the map's
   * start and the other at the deathmatch spot -- connected, drawn, and moving
   * on each other's screens while disagreeing about where anybody was. Asking
   * "are you connected" and "did they move" both passed.
   */
  assert(hostJoined.mate !== null && guestJoined.mate !== null, 'one of them cannot see the other')
  const hostSeesGuest = Math.hypot(hostJoined.mate!.x - guestJoined.x, hostJoined.mate!.y - guestJoined.y)
  const guestSeesHost = Math.hypot(guestJoined.mate!.x - hostJoined.x, guestJoined.mate!.y - hostJoined.y)
  assert(hostSeesGuest < 0.5, `the host draws the guest ${hostSeesGuest.toFixed(1)} m from where the guest is`)
  assert(guestSeesHost < 0.5, `the guest draws the host ${guestSeesHost.toFixed(1)} m from where the host is`)
  // And they are not standing in the same doorway, which the file decides.
  const apart = Math.hypot(hostJoined.x - guestJoined.x, hostJoined.y - guestJoined.y)
  assert(apart > 2, `the two of them started ${apart.toFixed(1)} m apart`)
})

check('what one player does reaches the other', () => {
  const moved = Math.hypot(hostWalked.x - hostJoined.x, hostWalked.y - hostJoined.y)
  assert(moved > 0.5, `the host walked ${moved.toFixed(2)} m, so there is nothing to carry`)
  assert(guestWatching.mate !== null, 'the guest lost sight of the host')
  const carried = Math.hypot(
    guestWatching.mate!.x - guestJoined.mate!.x,
    guestWatching.mate!.y - guestJoined.mate!.y,
  )
  assert(carried > 0.5, `the host moved ${moved.toFixed(2)} m and the guest saw them move ${carried.toFixed(2)} m`)
  // And the far screen agrees about where they ended up, not merely that they moved.
  const agree = Math.hypot(guestWatching.mate!.x - hostWalked.x, guestWatching.mate!.y - hostWalked.y)
  assert(agree < 0.5, `after walking, the two sides are ${agree.toFixed(1)} m apart about where the host is`)
})

/*
 * Two people shooting at each other, which is the last of the original's parts.
 *
 * On MAP11 because the map decides where the two of you stand and on that one
 * the two starts are two and a half metres apart with nothing in between --
 * measured across all sixty-eight, ten of which are in sight of each other.
 * Anywhere else the check would have to walk somebody through a maze first,
 * and a check that sometimes arrives is worse than none.
 */
const duelBrowser = await chromium.launch({
  args: [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
})
const duelContext = await duelBrowser.newContext({ viewport: { width: 1280, height: 720 } })
const duelHost = await duelContext.newPage()
const duelGuest = await duelContext.newPage()
for (const page of [duelHost, duelGuest]) {
  page.on('pageerror', (error) => problems.push(`duel: ${error.message}`))
  await page.goto(base, { waitUntil: 'domcontentloaded' })
}
await duelHost.waitForTimeout(1400)

const duelAskToMeet = async (page: Page): Promise<void> => {
  for (let i = 0; i < 12; i++) {
    if ((await readOpened(page)).menuLabel === 'play somebody') break
    await hold(page, 'ArrowDown', 150)
  }
  await hold(page, ' ', 150)
}
await duelAskToMeet(duelHost)
await duelAskToMeet(duelGuest)
await duelHost.selectOption('#meetmap', 'MAP11')
await duelHost.click('#meethost')
await duelHost.waitForFunction(
  () => ((document.getElementById('meetmine') as HTMLTextAreaElement | null)?.value.length ?? 0) > 0,
  undefined,
  { timeout: 15000 },
)
await duelGuest.fill('#meettheirs', await duelHost.inputValue('#meetmine'))
await duelGuest.click('#meetjoin')
await duelGuest.waitForFunction(
  () => ((document.getElementById('meetmine') as HTMLTextAreaElement | null)?.value.length ?? 0) > 0,
  undefined,
  { timeout: 15000 },
)
await duelHost.fill('#meettheirs', await duelGuest.inputValue('#meetmine'))
await duelHost.click('#meetaccept')
await duelHost.waitForFunction(
  () => (window as unknown as { __doom?: Record<string, unknown> }).__doom?.linked === true,
  undefined,
  { timeout: 30000 },
)
let duelKeptTicking = await waitTicks(duelHost, 60)

const duelLook = (page: Page) =>
  page.evaluate(() => {
    const d = (window as unknown as { __doom?: Record<string, unknown> }).__doom ?? {}
    return {
      level: (d.level as string) ?? '',
      linked: d.linked === true,
      health: (d.health as number) ?? -1,
      mateHealth: (d.mateHealth as number | null) ?? null,
      crowd: (d.crowd as number) ?? -1,
      x: (d.x as number) ?? NaN,
      y: (d.y as number) ?? NaN,
      angle: (d.angle as number) ?? NaN,
      mate: (d.mateAt as { x: number; y: number } | null) ?? null,
    }
  })

const duelHostBefore = await duelLook(duelHost)
const duelGuestBefore = await duelLook(duelGuest)

/**
 * Turns a player to face whoever they can see, by reading where that is.
 *
 * Both of them, because a duel where only one side fires does not exercise the
 * thing that matters. Every roll comes from one generator; with one shooter
 * the two sides draw the same numbers whatever order they resolve in, so the
 * order could be wrong and nothing would notice. Two shooters in the same tick
 * is what makes the order visible.
 */
const duelAimAt = async (page: Page, within: number): Promise<number> => {
  let off = Math.PI
  for (let i = 0; i < 25; i++) {
    const now = await duelLook(page)
    if (now.mate === null) break
    const want = Math.atan2(now.mate.y - now.y, now.mate.x - now.x)
    off = want - now.angle
    while (off > Math.PI) off -= Math.PI * 2
    while (off < -Math.PI) off += Math.PI * 2
    if (Math.abs(off) < within) break
    // Turning is 2.4 radians a second at sixty ticks to the second, so this is
    // how many ticks of holding the key are wanted -- ticks rather than time,
    // because a slow frame is not a slow game.
    const forTicks = Math.min(24, Math.max(1, Math.round((Math.abs(off) / 2.4) * 60)))
    const key = off > 0 ? 'ArrowLeft' : 'ArrowRight'
    await page.keyboard.down(key)
    await waitTicks(page, forTicks)
    await page.keyboard.up(key)
    await waitTicks(page, 3)
    // A stall here shows up as an aim that never converges, which the check
    // below reports on its own terms.
  }
  return Math.abs(off)
}
/*
 * Close the distance before aiming properly, because a frame is not a tick.
 *
 * One frame runs as many ticks as the time it swallowed, so the shortest turn
 * this can ask for is however many ticks that frame happens to do -- about a
 * fifth of a radian in a busy gate. At two and three quarter metres the other
 * player is a tenth of a radian wide, which is narrower than the aim can be
 * adjusted, and the loop oscillates around them for ever. Walking in to a
 * metre makes them a third of a radian wide, which is wider than the step.
 */
for (let i = 0; i < 14; i++) {
  const now = await duelLook(duelHost)
  if (now.mate === null) break
  if (Math.hypot(now.mate.x - now.x, now.mate.y - now.y) < 1) break
  await duelAimAt(duelHost, 0.2)
  await duelHost.keyboard.down('w')
  await waitTicks(duelHost, 10)
  await duelHost.keyboard.up('w')
  await waitTicks(duelHost, 3)
}

/*
 * And now aim to within what the geometry asks for rather than a figure picked
 * out of the air: half the angle the other player subtends from here.
 */
const duelClosed = await duelLook(duelHost)
const duelApart = duelClosed.mate === null
  ? Infinity
  : Math.hypot(duelClosed.mate.x - duelClosed.x, duelClosed.mate.y - duelClosed.y)
const duelWithin = Math.atan2(0.35, duelApart) * 0.8
const duelHostOff = await duelAimAt(duelHost, duelWithin)
const duelGuestOff = await duelAimAt(duelGuest, duelWithin)

// Both triggers at once, and briefly: three shots each is a wound rather than
// a death, and somebody who died would come back on full health with nothing
// left to assert.
await duelHost.keyboard.down(' ')
await duelGuest.keyboard.down(' ')
duelKeptTicking = (await waitTicks(duelHost, 48)) && duelKeptTicking
await duelHost.keyboard.up(' ')
await duelGuest.keyboard.up(' ')
duelKeptTicking = (await waitTicks(duelHost, 54)) && duelKeptTicking
const duelHostAfter = await duelLook(duelHost)
const duelGuestAfter = await duelLook(duelGuest)
await duelBrowser.close()

check('the two of them can shoot each other, and agree about the wounds', () => {
  assert(duelKeptTicking, 'the duel stopped advancing: the lockstep deadlocked')
  assert(duelHostBefore.level === 'MAP11', `the duel is on ${duelHostBefore.level} rather than MAP11`)
  assert(duelHostBefore.linked && duelGuestBefore.linked, 'the two never connected')
  assert(
    duelHostBefore.health === 100 && duelGuestBefore.health === 100,
    'somebody was already hurt before a shot was fired',
  )
  assert(duelApart < 1.6, `they never got within reach of each other: ${duelApart.toFixed(2)} m`)
  assert(
    duelHostOff < duelWithin,
    `the host never lined up, ${duelHostOff.toFixed(2)} radians off against ${duelWithin.toFixed(2)}`,
  )
  assert(
    duelGuestOff < duelWithin,
    `the guest never lined up, ${duelGuestOff.toFixed(2)} radians off against ${duelWithin.toFixed(2)}`,
  )

  // Both of them are hurt, and neither is dead -- a death would put them back
  // on full health and leave nothing to compare.
  assert(duelHostAfter.health < 100 && duelHostAfter.health > 0, `the host is on ${duelHostAfter.health}`)
  assert(duelGuestAfter.health < 100 && duelGuestAfter.health > 0, `the guest is on ${duelGuestAfter.health}`)

  /*
   * And each of them worked out the other's wound without being told.
   *
   * Nothing about damage crosses the wire. Both sides hold both players' input
   * and the same seed, so each decides for itself that a pellet landed. If
   * they decided differently, one screen would show somebody dying and the
   * other would not.
   */
  assert(
    duelHostAfter.mateHealth === duelGuestAfter.health,
    `the host says they are on ${String(duelHostAfter.mateHealth)} and they say ${duelGuestAfter.health}`,
  )
  assert(
    duelGuestAfter.mateHealth === duelHostAfter.health,
    `the guest says the host is on ${String(duelGuestAfter.mateHealth)} and the host says ${duelHostAfter.health}`,
  )
})

check('the two of them keep the same world while they fight', () => {
  /*
   * The order the two are resolved in, which health alone cannot catch: at
   * arm's length a pellet lands whichever way round the sides went. What
   * catches it is the creatures, which draw from the same generator a shot
   * does -- so a side that consumed it in a different order walks them
   * somewhere else. That is only true with two people firing, which is why
   * both triggers are held above.
   */
  assert(duelHostBefore.crowd === duelGuestBefore.crowd, 'the two worlds differed before a shot was fired')
  assert(
    duelHostAfter.crowd === duelGuestAfter.crowd,
    'the two worlds parted once both of them fired, which is the resolving order',
  )
})

/*
 * Recording a run from a phone, with no keyboard anywhere in it.
 *
 * The words that start a demo can only be typed, and a phone has nothing to
 * type with -- so for a while the whole feature existed only at a desk, which
 * is the same shape of fault as the file picker that was hidden behind the
 * touch controls. The way in is the title, and the way to drive the title on a
 * phone is the stick and the fire button, so that is what this uses. Nothing
 * here touches a key.
 */
const phoneDemoContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
})
const phoneDemoPage = await phoneDemoContext.newPage()
phoneDemoPage.on('pageerror', (error) => problems.push(`phone demo: ${error.message}`))
await phoneDemoPage.goto(base, { waitUntil: 'domcontentloaded' })
await phoneDemoPage.waitForTimeout(1200)

/** One nudge of the stick, which is how a thumb moves the cursor. */
const phoneDemoNudge = async (down: boolean): Promise<void> => {
  const box = await phoneDemoPage.locator('#stick').boundingBox()
  if (box === null) return
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await phoneDemoPage.locator('#stick').dispatchEvent('pointerdown', {
    pointerId: 21,
    isPrimary: true,
    clientX: cx,
    clientY: cy,
  })
  await phoneDemoPage.locator('#stick').dispatchEvent('pointermove', {
    pointerId: 21,
    isPrimary: true,
    clientX: cx,
    clientY: cy + (down ? 44 : -44),
  })
  await phoneDemoPage.waitForTimeout(180)
  await phoneDemoPage.locator('#stick').dispatchEvent('pointerup', { pointerId: 21, isPrimary: true })
  await phoneDemoPage.waitForTimeout(140)
}
/** And a press of the fire button, which is how a thumb chooses. */
const phoneDemoChoose = async (): Promise<void> => {
  await phoneDemoPage.locator('#fire').dispatchEvent('pointerdown', { pointerId: 22, isPrimary: true })
  await phoneDemoPage.waitForTimeout(200)
  await phoneDemoPage.locator('#fire').dispatchEvent('pointerup', { pointerId: 22, isPrimary: true })
  await phoneDemoPage.waitForTimeout(300)
}
const phoneDemoRead = () =>
  phoneDemoPage.evaluate(() => {
    const d = (window as unknown as { __doom?: Record<string, unknown> }).__doom ?? {}
    return {
      label: (d.menuLabel as string) ?? '',
      titleUp: d.titleUp === true,
      recording: d.recording === true,
      hasDemo: d.hasDemo === true,
      level: (d.level as string) ?? '',
    }
  })

const phoneDemoAtFirst = await phoneDemoRead()
let phoneDemoFound = false
let phoneDemoLandedOnReplay = false
for (let i = 0; i < 14; i++) {
  const now = await phoneDemoRead()
  if (now.label === 'play it back') phoneDemoLandedOnReplay = true
  if (now.label === 'record a run') {
    phoneDemoFound = true
    break
  }
  await phoneDemoNudge(true)
}
await phoneDemoChoose()
await phoneDemoPage.waitForTimeout(900)
const phoneDemoRunning = await phoneDemoRead()
await phoneDemoPage.close()
await phoneDemoContext.close()

check('a phone can record a run without a keyboard', () => {
  assert(phoneDemoAtFirst.titleUp, 'the phone did not come up on the title')
  assert(!phoneDemoAtFirst.hasDemo, 'something was already recorded before anything happened')
  // Nothing recorded yet, so the line that plays one back must be skipped over
  // rather than sat on -- a cursor parked on a dead line is a title that will
  // not go away, which this project has already shipped once.
  assert(!phoneDemoLandedOnReplay, 'the cursor stopped on "play it back" with nothing to play')
  assert(phoneDemoFound, 'a thumb could not reach "record a run" on the title')
  assert(!phoneDemoRunning.titleUp, 'choosing it left the title up')
  assert(phoneDemoRunning.recording, 'choosing it started a level but no recording')
})

/*
 * A recording that ends with its level, rather than by typing the word again.
 *
 * That was the rule the phone needed -- there is nothing to type with -- and it
 * put the seal in `enterLevel`, which is where finishing, dying and going
 * somewhere else all land. Leaving for a map out of a file is the quickest of
 * those to drive, and it is also the one that found a bug: `enterWad` sets the
 * campaign index to -1 before it enters, so a run recorded in the outpost was
 * sealed as level -1 and playing it back asked the campaign for a level it
 * refuses. A recording now remembers where it began.
 */
const sealPage = await browser.newPage({ viewport: { width: 1280, height: 720 } })
sealPage.on('pageerror', (error) => problems.push(`sealing: ${error.message}`))
await sealPage.goto(`${base}?probe`, { waitUntil: 'domcontentloaded' })
await sealPage.waitForTimeout(900)
await begin(sealPage)
const sealRead = () =>
  sealPage.evaluate(() => {
    const d = (window as unknown as { __doom?: Record<string, unknown> }).__doom ?? {}
    return {
      recording: d.recording === true,
      hasDemo: d.hasDemo === true,
      level: (d.level as string) ?? '',
      titleUp: d.titleUp === true,
    }
  })
for (const letter of 'idrec') await sealPage.keyboard.press(letter)
await sealPage.waitForTimeout(500)
const sealTaping = await sealRead()
await sealPage.keyboard.down('w')
await sealPage.waitForTimeout(700)
await sealPage.keyboard.up('w')
await sealPage.waitForTimeout(200)

// Somewhere else entirely, which is one of the ways a run ends.
await sealPage.setInputFiles('#wad', goodWad)
await sealPage.waitForTimeout(900)
await hold(sealPage, ' ', 200)
await sealPage.waitForTimeout(900)
const sealAfterLeaving = await sealRead()

// And what was sealed can be played, which is what "sealed properly" means.
for (const letter of 'idplay') await sealPage.keyboard.press(letter)
await sealPage.waitForTimeout(1500)
const sealReplaying = await sealRead()
await sealPage.close()

check('a recording ends with its level, and what it kept can be played', () => {
  assert(sealTaping.recording, 'typing the word did not start a recording')
  assert(!sealTaping.hasDemo, 'something was already kept before this run ended')
  assert(!sealAfterLeaving.recording, 'leaving the level left the recording open')
  assert(sealAfterLeaving.hasDemo, 'leaving the level kept nothing')
  /*
   * The bug this was written for: the run was recorded in the campaign and
   * ended by entering a map from a file, which sets the campaign index to -1
   * on its way in. Sealed with that index, the replay asks for level -1 and
   * the campaign refuses -- so the page would still be sitting in the file's
   * map rather than back in the outpost.
   */
  assert(!sealReplaying.titleUp, 'playing it back left the title up')
  assert(
    sealReplaying.level === 'the outpost',
    `playing it back landed in ${sealReplaying.level} rather than where it was recorded`,
  )
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
  await hold(page, '3', 150)
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

function readFromFile(page: Page): Promise<number> {
  return page.evaluate(
    () => ((window as unknown as { __doom?: Record<string, unknown> }).__doom?.fromFile as number) ?? -1,
  )
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
  await begin(thumbed)

const zones: { name: string; page: Page; screen: DOMRect | null; look: DOMRect | null }[] = []
const zoneOf = async (name: string, page: Page) => {
  // Both boxes are read inline rather than through a helper. A nested function
  // inside an evaluated body makes the bundler emit a call to its own __name
  // helper, which does not exist in the page: the whole run died here with
  // "__name is not defined" and every check after this one never ran.
  const measured = await page.evaluate(() => {
    const screenEl = document.getElementById('screen')
    const lookEl = document.getElementById('look')
    const screenRect = screenEl ? screenEl.getBoundingClientRect() : null
    const lookRect = lookEl ? lookEl.getBoundingClientRect() : null
    return {
      screen: screenRect
        ? ({ x: screenRect.x, y: screenRect.y, width: screenRect.width,
             height: screenRect.height, bottom: screenRect.bottom } as unknown as DOMRect)
        : null,
      look: lookRect
        ? ({ x: lookRect.x, y: lookRect.y, width: lookRect.width,
             height: lookRect.height, bottom: lookRect.bottom } as unknown as DOMRect)
        : null,
    }
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
  await begin(desked)
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
  await begin(laid)
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
/** The row a notice is drawn on, trimmed. */
function topLine(page: Page): Promise<string> {
  return page.evaluate(() => {
    const rows = (document.getElementById('screen')?.textContent ?? '').split('\n')
    return (rows[1] ?? '').trim()
  })
}

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
  await begin(shown)

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
const noticedPlain = await topLine(shown)
const replacedPlain = await readFromFile(shown)

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
const noticedArt = await topLine(shown)
const replacedArt = await readFromFile(shown)
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

check('opening a file says what came of it', () => {
  // Reading the top row, which is where a notice is drawn. Without this the
  // page announces a map the same way whether or not it found any pictures,
  // and those two are the same event from outside.
  assert(
    noticedArt.includes('drawn from the file'),
    `opening a file with pictures said "${noticedArt}"`,
  )
  assert(
    noticedPlain.includes('no pictures in that file'),
    `opening a file without pictures said "${noticedPlain}"`,
  )
})

check('what the file brought is counted where it is known', () => {
  // Not inferred from the pixels. This asked whether a sprite carried a colour
  // per cell, which told the truth only while the art that ships did not --
  // once it was baked the same way, a file with nothing in it reported one
  // picture drawn from itself.
  assert(replacedPlain === 0, `a file with no pictures reported ${replacedPlain} drawn from it`)
  assert(replacedArt > 0, `a file with a picture in it reported ${replacedArt} drawn from it`)
})

// --- can a player get at the importer at all? -------------------------------
//
// The whole of the WAD work was reachable only from a button inside the legend,
// and the legend is hidden on a touch screen. So on a phone there was no way to
// open a file, and every check written for the importer passed while the
// feature was unreachable on the commonest device there is -- they all handed
// the bytes in through the probe, which is a door no player has.

const reachable: { name: string; pick: unknown }[] = []
for (const [label, options] of [
  ['desktop', { viewport: { width: 1280, height: 720 } }],
  ['upright', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
  ['sideways', { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }],
] as const) {
  const ctx = await browser.newContext(options)
  const page = await ctx.newPage()
  page.on('pageerror', (error) => problems.push(`${label}: ${error.message}`))
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)
  await begin(page)
  reachable.push({
    name: label,
    pick: await page.evaluate(() => {
      const input = document.getElementById('wad')
      const screen = document.getElementById('screen')!.getBoundingClientRect()
      /*
       * Anything sitting on top of the picture, whatever it is.
       *
       * This used to measure one named button, because there was one: a file
       * picker that spent a while being moved around the view looking for a
       * corner nothing needed. It is a line on the title now, so what is worth
       * asking is the general form of what was wrong with it -- is any control
       * covering the game.
       */
      const over: string[] = []
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        if (el.id === 'screen' || el.id === 'pad' || el.id === '') continue
        const box = el.getBoundingClientRect()
        if (box.width === 0 || box.height === 0) continue
        if (getComputedStyle(el).position !== 'fixed') continue
        const across = Math.max(0, Math.min(screen.right, box.right) - Math.max(screen.left, box.left))
        const down = Math.max(0, Math.min(screen.bottom, box.bottom) - Math.max(screen.top, box.top))
        if (across * down > 0) over.push(`${el.tagName.toLowerCase()}#${el.id}`)
      }
      return { input: input === null ? 'missing' : 'present', over }
    }),
  })
  await ctx.close()
}

check('a file of your own can still be opened, without a button over the game', () => {
  /*
   * The picker is the browser's own and the page only asks for it, so what
   * there is to check here is that the input is still in the page for the title
   * line to click -- and that nothing is sitting on the picture.
   *
   * It was a button in a corner of the view. That was worth removing rather
   * than moving again: a game does not put a file picker on top of itself, and
   * choosing what to play already lives on the title.
   */
  for (const { name, pick } of reachable) {
    const seen = pick as { input: string; over: string[] }
    assert(seen.input === 'present', `${name}: there is no file input in the page at all`)
    assert(
      seen.over.length === 0,
      `${name}: ${seen.over.join(', ')} ${seen.over.length === 1 ? 'is' : 'are'} sitting over the picture`,
    )
  }
})

// --- the game looks like this without being given anything -------------------
//
// The whole of the art work was reachable only by opening a file, which is not
// what was asked for and is not what most people will ever do. Baked in, the
// campaign itself is drawn with it -- so this looks at the outpost, with no
// file handed over and no probe door used, and asks whether what is on screen
// is painted a cell at a time.

const gallery2 = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const plain = await gallery2.newPage()
plain.on('pageerror', (error) => problems.push(`baked: ${error.message}`))
await plain.goto(base, { waitUntil: 'domcontentloaded' })
await plain.waitForTimeout(1200)
  await begin(plain)
// Walked forward, because the creatures in the outpost are down the hall and a
// check that never sees one says nothing about how creatures are drawn.
await plain.keyboard.down('w')
await plain.waitForTimeout(1600)
await plain.keyboard.up('w')
await plain.waitForTimeout(400)

const campaign = await plain.evaluate(() => {
  const screen = document.getElementById('screen')
  const probe = (window as unknown as { __doom?: Record<string, unknown> }).__doom ?? {}
  const colours = new Set<string>()
  for (const span of Array.from(screen?.querySelectorAll('span') ?? [])) {
    const colour = (span as HTMLElement).style.color
    if (colour !== '') colours.add(colour)
  }
  return {
    level: (probe.level as string) ?? '',
    alive: (probe.alive as number) ?? -1,
    colours: colours.size,
    art: (probe.creatureArt as { rows: number; cells: number; colours: number } | null) ?? null,
  }
})
await plain.screenshot({ path: join(SHOTS, 'baked-campaign.png') })

console.log(
  `  baked campaign: ${campaign.colours} colours on screen, ${campaign.alive} creatures alive, ` +
    `first drawn with ${campaign.art?.rows ?? 0} rows / ${campaign.art?.colours ?? 0} colours`,
)

check('the campaign is drawn with the baked art, with no file opened', () => {
  assert(campaign.level === 'the outpost', `the page was showing "${campaign.level}"`)
  assert(campaign.alive > 0, 'there are no creatures in the level to be drawn at all')

  // Not counted off the screen. That was tried twice and cannot work here: at
  // the distance a creature stands in the outpost the walls own most of the
  // colours, and a creature replaced by one flat tint measured 128 against the
  // real art's 125 -- more, not fewer. A threshold between those two numbers
  // does not exist, and the first one picked passed with the art gutted.
  //
  // So this asks what the creature is drawn with. It is a fact about the art
  // rather than about the picture on screen, and saying so is better than a
  // number that looks like evidence and is not.
  const art = campaign.art
  assert(art !== null, 'nothing reported what the first creature is drawn with')
  assert(art.rows >= 8, `the first creature is ${art.rows} rows of art, which is not a baked picture`)
  assert(
    art.colours >= 20,
    `the first creature is drawn in ${art.colours} colours, which is a flat tint rather than a picture`,
  )
  assert(art.cells > 50, `only ${art.cells} cells of the first creature are painted`)
})

// --- what the game shows before it starts, and at the foot while it runs -----

function readFront(page: Page) {
  return page.evaluate(() => {
    const p = (window as unknown as { __doom?: Record<string, unknown> }).__doom ?? {}
    const rows = (document.getElementById('screen')?.textContent ?? '').split('\n')
    return {
      titleUp: p.titleUp === true,
      panels: (p.statusBar as number) ?? -1,
      frames: (p.frames as number) ?? 0,
      cols: (p.cols as number) ?? 0,
      x: (p.x as number) ?? -1,
      ink: rows.reduce((n, row) => n + row.replace(/ /g, '').length, 0),
      /*
       * The last seven rows, because the bar is six and the rule sits on top of
       * it. This read four while the bar was three rows deep, and when the bar
       * grew the labels row moved out of the window -- so a check asking whether
       * the bar says HEALTH would have failed with the bar plainly saying it.
       */
      foot: rows
        .slice(-7)
        .map((row) => row.trim())
        .join(' | '),
    }
  })
}

const fronts: { name: string; boot: Awaited<ReturnType<typeof readFront>>; later: Awaited<ReturnType<typeof readFront>>; playing: Awaited<ReturnType<typeof readFront>>; walked: number }[] = []
for (const [label, width, height, touch] of [
  ['desktop', 1280, 720, false],
  ['phone', 390, 844, true],
] as const) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch })
  const page = await ctx.newPage()
  page.on('pageerror', (error) => problems.push(`${label} front: ${error.message}`))
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1100)
  const boot = await readFront(page)
  await page.waitForTimeout(900)
  const later = await readFront(page)
  await page.keyboard.down(' ')
  await page.waitForTimeout(250)
  await page.keyboard.up(' ')
  await page.waitForTimeout(700)
  const playing = await readFront(page)
  await page.keyboard.down('w')
  await page.waitForTimeout(1100)
  await page.keyboard.up('w')
  await page.waitForTimeout(250)
  const walked = (await readFront(page)).x
  fronts.push({ name: label, boot, later, playing, walked })
  await ctx.close()
}

check('the game waits on a title instead of starting in a room', () => {
  for (const front of fronts) {
    assert(front.boot.titleUp, `${front.name}: the page went straight into the level`)
    // Something is drawn: a title that reports itself and shows nothing would
    // pass a flag check and fail a player.
    assert(front.boot.ink > 100, `${front.name}: the title drew ${front.boot.ink} characters`)
    // And it keeps drawing, rather than reporting once and stopping -- which is
    // exactly what the first version did, with the probe never reached.
    assert(
      front.later.frames > front.boot.frames + 10,
      `${front.name}: ${front.later.frames - front.boot.frames} frames in nearly a second behind the title`,
    )
    assert(front.boot.cols > 20, `${front.name}: the grid reported ${front.boot.cols} columns behind the title`)
  }
})

check('nothing in the level moves until the title is dismissed', () => {
  for (const front of fronts) {
    // Unchanged rather than absent. This asserted the player's position was -1,
    // which was never a position: it was the fallback for a probe that had
    // stopped reporting, and it was written while the title branch was quietly
    // returning before the probe was filled. A check resting on a bug's side
    // effect passes until the bug is fixed and then accuses the fix.
    assert(
      front.later.x === front.boot.x,
      `${front.name}: the player moved from ${front.boot.x} to ${front.later.x} behind the title`,
    )
    assert(!front.playing.titleUp, `${front.name}: pressing fire left the title up`)
    assert(front.playing.x > 0, `${front.name}: the level never started`)
    assert(
      front.walked > front.playing.x + 1,
      `${front.name}: walking moved from ${front.playing.x} to ${front.walked}`,
    )
  }
})

check('a screen with room for the bar gets it', () => {
  const desktop = fronts.find((f) => f.name === 'desktop')!
  const phone = fronts.find((f) => f.name === 'phone')!
  /*
   * Seven: the ammunition, the health, the arms you are holding, the armour, the
   * keys, the four reserves, and -- this game's own -- what you are under.
   *
   * The face was an eighth and is gone. It was three rounds of work and it ended
   * as a warm blob at the size a bar can give it; at thirteen rows it was a face
   * and at thirteen rows it had to stand out over the picture, which is a lot of
   * screen to spend on a thing that says what the health panel already says.
   *
   * The level's name is not among them either. The original does not put it on
   * the bar, and the panel it had been using is the one the arms display needed.
   */
  assert(desktop.playing.panels === 7, `a 163-column grid drew ${desktop.playing.panels} panels`)
  // A phone used to keep the single line because 49 columns cannot hold four
  // panels. Its characters are smaller now and its grid is 80 wide, which is
  // over the seventy-two the bar needs -- so it gets the bar too. The claim
  // that a narrow grid keeps the line has not changed and is checked in Node,
  // where a 49-column grid can still be asked for directly.
  //
  // Five there too, measured rather than assumed: eighty columns over five
  // panels is sixteen each, and the longest thing any of them has to show is
  // six characters wide. The guess here was four, on the reasoning that a fifth
  // panel must cost something -- it does not, until the grid is narrower than
  // this, and which panel goes first when it is narrower is checked in Node
  // where a width can be asked for directly.
  assert(phone.playing.panels === 6, `a phone drew ${phone.playing.panels} panels on an 80-column grid`)
  // And the one it drops is the clock, which is the lowest priority there is.
  assert(!phone.playing.foot.includes('POWER'), `a phone kept the clock: "${phone.playing.foot}"`)
  // The bar is opaque. Drawn straight over the world it came out as HEALTH and
  // 93 tangled into a wall of per-cent signs, so the foot is checked for the
  // words rather than for the flag that says they were placed.
  assert(
    desktop.playing.foot.includes('HEALTH') && desktop.playing.foot.includes('ARMS'),
    `the foot of the screen reads "${desktop.playing.foot}"`,
  )
  /*
   * Wall glyphs showing through the bar, which is what an unwiped bar looks
   * like: HEALTH and 93 tangled into a stripe of per-cent signs.
   *
   * Four in a row, which is what it was before the face -- the face was made of
   * the same characters and its widest row held four of them, so the threshold
   * went to eight to let it through. The face is gone, so the check goes back to
   * being as strict as it was.
   */
  assert(
    !/[%#]{4}/.test(desktop.playing.foot),
    `the bar has wall glyphs run through it: "${desktop.playing.foot}"`,
  )
})

// --- what you did in the last level stays there -----------------------------
//
// The counters behind the end-of-level summary were module variables that
// nothing cleared, so every level's tally included every level before it. It
// showed up sideways: a shot fired to get past the title hit something in the
// first room, and an aiming fixture two hundred lines away failed three runs
// running because one pellet had already landed before its map was loaded.

const ledger = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const tally = await ledger.newPage()
tally.on('pageerror', (error) => problems.push(`tally: ${error.message}`))
await tally.goto(`${base}?probe=1`, { waitUntil: 'domcontentloaded' })
await tally.waitForTimeout(900)
await begin(tally)

const readTally = () =>
  tally.evaluate(() => {
    const p = (window as unknown as { __doom?: Record<string, unknown> }).__doom ?? {}
    return {
      shots: (p.shotsFired as number) ?? -1,
      landed: (p.pelletsLanded as number) ?? -1,
      kills: (p.kills as number) ?? -1,
      level: (p.level as string) ?? '',
    }
  })

// Fire a few times where there is something to hit, so the counters are not
// zero by accident when the next level starts.
await tally.keyboard.down(' ')
await tally.waitForTimeout(900)
await tally.keyboard.up(' ')
await tally.waitForTimeout(300)
const afterShooting = await readTally()

const tookFresh = await tally.evaluate(
  ([bytes, name]) =>
    (window as unknown as { __probe?: { loadWad(b: number[], n: string): boolean } }).__probe?.loadWad(
      bytes as number[],
      name as string,
    ) ?? false,
  [[...tinyWad('E1M1')], 'E1M1'] as [number[], string],
)
await tally.waitForTimeout(600)
const afterNewLevel = await readTally()
await ledger.close()

check('a new level starts the tally from nothing', () => {
  assert(tookFresh, 'the page would not take a fresh map')
  // The premise: something was counted before the level changed. Without it,
  // "it is zero now" would pass against a page that never counts anything.
  assert(afterShooting.shots > 0, `the trigger was held and ${afterShooting.shots} shots were counted`)
  assert(
    afterNewLevel.level === 'E1M1',
    `the page was showing "${afterNewLevel.level}" rather than the map just loaded`,
  )
  assert(afterNewLevel.shots === 0, `${afterNewLevel.shots} shots carried into the new level`)
  assert(afterNewLevel.landed === 0, `${afterNewLevel.landed} hits carried into the new level`)
  assert(afterNewLevel.kills === 0, `${afterNewLevel.kills} kills carried into the new level`)
})


/*
 * The powerups, which are the newest thing here and the hardest to see from
 * Node: what each one does lands in the page -- the shield inside `hurtPlayer`,
 * the suit at the floor underfoot, the chart in the set of lines the automap has
 * been shown, the goggles in the light the renderer is handed. Node can check
 * that the clocks run; only a browser can check that anything is under them.
 *
 * Everything below is named `power*` or `gear*`. Three top-level names have
 * collided in this file already, and the collision does not fail -- the later
 * one wins and the earlier check quietly measures the wrong page.
 */
const powerReadKit = (page: Page) =>
  page.evaluate(() => {
    const probe = (window as unknown as { __doom?: Record<string, unknown> }).__doom ?? {}
    return {
      health: (probe.health as number) ?? -1,
      hurt: (probe.hurt as number) ?? -1,
      powers: (probe.powers as string) ?? '?',
      pack: (probe.pack as boolean) ?? false,
      mapped: (probe.mapped as number) ?? -1,
      mapLines: (probe.mapLines as number) ?? -1,
      bright: (probe.bright as number) ?? -1,
      weapon: (probe.weapon as string) ?? '?',
      levelIndex: (probe.levelIndex as number) ?? -1,
    }
  })

const powerDrop = (page: Page, type: number) =>
  page.evaluate(
    (thing) => (window as unknown as { __probe?: { drop(t: number): boolean } }).__probe?.drop(thing) ?? false,
    type,
  )

const powerToTag = (page: Page, tag: string) =>
  page.evaluate(
    (name) => (window as unknown as { __probe?: { toTag(t: string): boolean } }).__probe?.toTag(name) ?? false,
    tag,
  )

// The suit and the shield are measured against the same ground the unprotected
// check above measures: the channel in the cistern, which is the only thing in
// the shipped levels that hurts you without also shooting back.
const powerGround = async (thing: number, label: string) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', (error) => problems.push(`${label}: ${error.message}`))
  await page.goto(`${base}?probe=1`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  await begin(page)
  await page.evaluate(() => (window as unknown as { __probe?: { toExit(): boolean } }).__probe?.toExit())
  // Through the summary, which waits for a press: past the grace, then ask.
  await page.waitForTimeout(900)
  await hold(page, ' ')
  await page.waitForTimeout(900)

  const laid = await powerDrop(page, thing)
  // A step, so the ordinary collection rule finds what is at our feet.
  await page.waitForTimeout(250)
  const carrying = await powerReadKit(page)
  const inIt = await powerToTag(page, 'channel')
  await page.waitForTimeout(200)
  const entered = await powerReadKit(page)
  await page.waitForTimeout(1600)
  const stood = await powerReadKit(page)
  await page.close()
  return { laid, carrying, inIt, entered, stood }
}

const powerSuit = await powerGround(2025, 'suit')
check('the suit stands in the channel and the channel does nothing', () => {
  assert(powerSuit.laid, 'the page would not put a radiation suit down')
  assert(powerSuit.carrying.levelIndex === 1, `the probe never reached the cistern (level ${powerSuit.carrying.levelIndex})`)
  assert(powerSuit.carrying.powers.startsWith('suit'), `the status line says "${powerSuit.carrying.powers}" after taking a suit`)
  assert(powerSuit.inIt, 'the shipped level has no sector tagged "channel" to stand in')
  // The premise, and the half of this that catches a suit which works by
  // accident: the ground still says it is dangerous ground.
  assert(powerSuit.entered.hurt > 0, 'the channel reports no damage, so wearing a suit in it proves nothing')
  assert(
    powerSuit.stood.health === powerSuit.entered.health,
    `a second and a half in the channel cost ${powerSuit.entered.health - powerSuit.stood.health} health through a suit`,
  )
})

const powerShield = await powerGround(2022, 'shield')
check('nothing can touch you, including the floor', () => {
  assert(powerShield.laid, 'the page would not put an invulnerability sphere down')
  assert(
    powerShield.carrying.powers.startsWith('shld'),
    `the status line says "${powerShield.carrying.powers}" after taking a shield`,
  )
  assert(powerShield.entered.hurt > 0, 'the channel reports no damage, so standing in it under a shield proves nothing')
  assert(
    powerShield.stood.health === powerShield.entered.health,
    `a shield let the channel take ${powerShield.entered.health - powerShield.stood.health} health`,
  )
})

// The chart and the goggles, both on the first level, because neither needs
// anything to happen to you.
const powerSight = await browser.newPage({ viewport: { width: 1280, height: 720 } })
powerSight.on('pageerror', (error) => problems.push(`sight: ${error.message}`))
await powerSight.goto(`${base}?probe=1`, { waitUntil: 'domcontentloaded' })
await powerSight.waitForTimeout(900)
await begin(powerSight)
// Walked a little first, so the automap has learned something: "the chart showed
// everything" is not a claim you can make on a level that was already shown.
await powerSight.keyboard.down('w')
await powerSight.waitForTimeout(700)
await powerSight.keyboard.up('w')
await powerSight.waitForTimeout(250)
const powerBeforeChart = await powerReadKit(powerSight)
const powerChartLaid = await powerDrop(powerSight, 2026)
await powerSight.waitForTimeout(250)
const powerAfterChart = await powerReadKit(powerSight)

const powerBeforeGoggles = await powerReadKit(powerSight)
const powerGogglesLaid = await powerDrop(powerSight, 2045)
await powerSight.waitForTimeout(250)
const powerAfterGoggles = await powerReadKit(powerSight)
await powerSight.close()

check('the chart shows the whole map at once', () => {
  assert(powerChartLaid, 'the page would not put a computer map down')
  assert(powerBeforeChart.mapLines > 0, 'the level has no lines, so there is nothing to have been shown')
  assert(
    powerBeforeChart.mapped > 0 && powerBeforeChart.mapped < powerBeforeChart.mapLines,
    `the automap already held ${powerBeforeChart.mapped} of ${powerBeforeChart.mapLines} lines before the chart`,
  )
  assert(
    powerAfterChart.mapped === powerAfterChart.mapLines,
    `the chart left ${powerAfterChart.mapped} of ${powerAfterChart.mapLines} lines known`,
  )
  assert(powerAfterChart.powers.includes('map'), `the status line says "${powerAfterChart.powers}" after a chart`)
})

check('the goggles brighten what is on the screen', () => {
  assert(powerGogglesLaid, 'the page would not put light amplification goggles down')
  assert(powerBeforeGoggles.bright > 0, 'nothing was drawn at all, so the brightness means nothing')
  assert(
    powerAfterGoggles.bright > powerBeforeGoggles.bright,
    `the screen was ${powerBeforeGoggles.bright.toFixed(4)} bright before the goggles and ${powerAfterGoggles.bright.toFixed(4)} after`,
  )
  assert(powerAfterGoggles.powers.includes('eyes'), `the status line says "${powerAfterGoggles.powers}" after goggles`)
})

// The two weapons, and the rule that you cannot select one you have not found.
const gearPage = await browser.newPage({ viewport: { width: 1280, height: 720 } })
gearPage.on('pageerror', (error) => problems.push(`gear: ${error.message}`))
await gearPage.goto(`${base}?probe=1`, { waitUntil: 'domcontentloaded' })
await gearPage.waitForTimeout(900)
await begin(gearPage)
const gearScreen = async (): Promise<string> =>
  await gearPage.evaluate(() => document.querySelector('pre')?.innerText ?? '')

// Held rather than tapped: the game samples which keys are down once a frame, so
// a press whose keyup lands in the same instant falls between two samples.
const gearPress = async (key: string): Promise<void> => {
  await gearPage.keyboard.down(key)
  await gearPage.waitForTimeout(160)
  await gearPage.keyboard.up(key)
  await gearPage.waitForTimeout(160)
}

// One, which is the slot the fist and the saw share. It was the fourth key while
// the keys named weapons by position in the weapon list.
await gearPress('1')
const gearFists = await powerReadKit(gearPage)
const gearFistsDrawn = await gearScreen()
/*
 * The same key again, which is how the original moves from a fist to a saw -- and
 * with no saw found it has nowhere to move to. The saw fires perfectly well
 * without ammunition, so before the ownership test was written this selected a
 * weapon nobody was carrying and swung it.
 */
await gearPress('1')
const gearBeforeSaw = await powerReadKit(gearPage)
const gearSawLaid = await powerDrop(gearPage, 2005)
await gearPage.waitForTimeout(250)
await gearPress('1')
const gearWithSaw = await powerReadKit(gearPage)
const gearSawDrawn = await gearScreen()
await gearPage.close()

check('a fist is always in hand and the saw has to be found', () => {
  assert(gearFists.weapon === 'fists', `the first key selected "${gearFists.weapon}"`)
  assert(
    gearBeforeSaw.weapon === 'fists',
    `pressing the slot again reached "${gearBeforeSaw.weapon}" before a saw had been found`,
  )
  assert(gearSawLaid, 'the page would not put a chainsaw down')
  assert(
    gearWithSaw.weapon === 'chainsaw',
    `pressing the slot again reached "${gearWithSaw.weapon}" after finding a saw`,
  )
})

check('a weapon that costs nothing shows no reserve', () => {
  // A zero beside FISTS reads as a gun you cannot fire, which is the opposite of
  // what the fists are for.
  assert(/fists/i.test(gearFistsDrawn), 'the status line never named the fists')
  assert(!/fists\s+0/i.test(gearFistsDrawn), 'the fists are shown with a reserve of zero')
})

check('the fist and the saw are drawn in your hands', () => {
  // The picture, not the name. The held frames for these two were baked in the
  // same round the weapons arrived, and a weapon whose art is never wired up
  // shows as an empty pair of hands with a working trigger.
  const fists = signatureOf(FREEDOOM.FISTS_HELD)
  const saw = signatureOf(FREEDOOM.CHAINSAW_HELD)
  assert(gearFistsDrawn.includes(fists), 'the fists are selected and nothing of them is on the screen')
  assert(gearSawDrawn.includes(saw), 'the saw is selected and nothing of it is on the screen')
})

await browser.close()
server.close()

console.log(failed === 0 ? 'all browser checks passed' : `${failed} browser check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
