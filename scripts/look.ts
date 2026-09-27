/**
 * Plays the game and takes pictures of it, for a person to look at.
 *
 *   node scripts/look.ts MAP03        -- walk up to the tallest thing in a map
 *   node scripts/look.ts MAP03 near   -- walk up to the nearest one instead
 *
 * Not a check, and deliberately not one: nothing here asserts anything. It
 * exists for the question `viewcheck.ts` cannot ask -- whether the thing on
 * screen looks like what it is meant to look like -- and the answer to that is
 * a person looking at the shots it leaves in `shots/`.
 *
 * What it does that a person at a keyboard cannot: it works out where to stand
 * before the browser is open. The level is built here, in node, so it knows
 * where the furniture is; then it turns by watching the angle the page reports
 * rather than by guessing at how long to hold a key, which is the difference
 * between facing a pillar and facing the wall behind it. Two rounds of pictures
 * were taken of walls before it did that.
 */
import { createReadStream, existsSync, mkdirSync, statSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize, resolve } from 'node:path'
import { chromium } from 'playwright'
import { wadLevelState } from '../src/game/wadlevel.ts'
import { sectorAt } from '../src/columns/level.ts'

const DIST = resolve(process.cwd(), 'dist')
const SHOTS = resolve(process.cwd(), 'shots')
const BASE_PATH = '/ascii-doom/'
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wad': 'application/octet-stream', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.webp': 'image/webp', '.svg': 'image/svg+xml',
}
const server = createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0]!
  if (!url.startsWith(BASE_PATH)) { res.writeHead(404).end('nope'); return }
  const rest = url.slice(BASE_PATH.length)
  const candidate = join(DIST, normalize(rest).replace(/^(\.\.[/\\])+/, ''))
  const file = existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(DIST, 'index.html')
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
})
mkdirSync(SHOTS, { recursive: true })
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${BASE_PATH}`

const map = process.argv[2] ?? 'MAP03'
const want = process.argv[3] ?? 'tallest'
/** A phone, when asked for one: the shots are of the thing most people hold. */
const onPhone = process.argv[4] === 'phone'
const size = onPhone ? { width: 390, height: 844 } : { width: 1000, height: 680 }

// Worked out here, where the level can be built without a browser: which piece
// of furniture to walk up to, and where it is.
const built = wadLevelState(new Uint8Array(readFileSync(`web/public/maps/${map}.wad`)), map, 3)
const spawn = built.player
/**
 * The rooms with an open sky over them, biggest first.
 *
 * By index, because that is what the page can be asked to stand in: a map from
 * a file has no tags to speak of. Biggest first because a large courtyard is
 * where the sky is worth photographing -- a light well two metres across fills
 * none of the frame.
 */
function skySectors(): number[] {
  return built.level.sectors
    .map((sector, index) => ({ index, sector }))
    .filter(({ sector }) => sector.sky)
    .sort(
      (a, b) =>
        (b.sector.maxX - b.sector.minX) * (b.sector.maxY - b.sector.minY) -
        (a.sector.maxX - a.sector.minX) * (a.sector.maxY - a.sector.minY),
    )
    .map(({ index }) => index)
}

/**
 * Somewhere under an open sky, when asked for one.
 *
 * Found from the lines that touch a sky sector rather than from its shape: a
 * sector's polygon is empty for most of what a file brings, which is how an
 * earlier attempt at this put the camera nowhere and measured nothing.
 */
function underTheSky(): { x: number; y: number; sprite: { height: number }; radius: number; z: number } | null {
  for (const line of built.level.lines) {
    for (const side of [line.front, line.back]) {
      if (side === null || side < 0 || !built.level.sectors[side]?.sky) continue
      const mx = (line.ax + line.bx) / 2
      const my = (line.ay + line.by) / 2
      const ex = line.bx - line.ax
      const ey = line.by - line.ay
      const len = Math.hypot(ex, ey) || 1
      for (const push of [0.8, 1.6, 3, -0.8, -1.6, -3]) {
        const x = mx + (-ey / len) * push
        const y = my + (ex / len) * push
        if (sectorAt(built.level, x, y) === side) return { x, y, sprite: { height: 0 }, radius: 0, z: 0 }
      }
    }
  }
  return null
}

const ranked = built.decor
  .map((d) => ({ d, dist: Math.hypot(d.x - spawn.x, d.y - spawn.y) }))
  .filter((n) => n.dist > 1.5 && n.dist < 30)
  .sort((a, b) => (want === 'tallest' ? b.d.sprite.height - a.d.sprite.height : a.dist - b.dist))
const rooms = want === 'sky' ? skySectors() : []
const sky = want === 'sky' ? underTheSky() : null
const target =
  sky === null
    ? ranked[0]
    : { d: sky as unknown as (typeof built.decor)[number], dist: Math.hypot(sky.x - spawn.x, sky.y - spawn.y) }
if (target === undefined) {
  console.log(`${map}: nothing within reach`)
  process.exit(0)
}
const bearing = Math.atan2(target.d.y - spawn.y, target.d.x - spawn.x)
console.log(
  `${map}: ${built.decor.length} pieces, ${rooms.length} rooms under an open sky. ` +
    (want === 'sky'
      ? `standing in the largest of them`
      : `walking to one ${target.d.sprite.height.toFixed(2)}m tall, ${target.dist.toFixed(1)}m away`),
)

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: size,
  ...(onPhone ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}),
})
page.on('pageerror', (e) => console.error('page error:', e.message))
await page.goto(`${base}?probe`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
await page.keyboard.down(' ')
await page.waitForTimeout(220)
await page.keyboard.up(' ')
await page.waitForTimeout(600)
const raw = [...new Uint8Array(readFileSync(`web/public/maps/${map}.wad`))]
await page.evaluate(
  ([bytes, name]) =>
    (window as unknown as { __probe?: { loadWad(b: number[], n: string): boolean } }).__probe?.loadWad(
      bytes as number[],
      name as string,
    ),
  [raw, map] as [number[], string],
)
await page.waitForTimeout(1200)

const where = () =>
  page.evaluate(() => {
    const d = (window as unknown as { __doom?: Record<string, number> }).__doom ?? {}
    return { x: d.x ?? 0, y: d.y ?? 0, angle: d.angle ?? 0 }
  })

if (want === 'sky') {
  /*
   * Stood in the room rather than walked to it.
   *
   * Two rounds of this script walked toward an outdoor sector and ended at a
   * wall both times -- it walks in a straight line and a map is not a straight
   * line. Standing there is the same door the browser checks use to reach an
   * exit: a way to arrive rather than a way to skip, because what is being
   * looked at is the frame and not the journey.
   */
  let stood = -1
  for (const index of rooms) {
    const ok = await page.evaluate(
      (n) => (window as unknown as { __probe?: { toSector(i: number): boolean } }).__probe?.toSector(n) ?? false,
      index,
    )
    if (ok) {
      stood = index
      break
    }
  }
  console.log(stood < 0 ? 'could not stand in any of them' : `standing in room ${stood}`)
  await page.waitForTimeout(400)
  // A full turn on the spot: the sky is over one part of a courtyard and a roof
  // over the rest, so one look would say nothing either way.
  for (let step = 0; step < 8; step++) {
    await page.screenshot({ path: join(SHOTS, `${map}-sky-${step}.png`) })
    await page.keyboard.down('ArrowRight')
    await page.waitForTimeout(330)
    await page.keyboard.up('ArrowRight')
    await page.waitForTimeout(220)
  }
  await browser.close()
  server.close()
} else {
  for (let tries = 0; tries < 40; tries++) {
    const now = await where()
    let off = bearing - now.angle
    while (off > Math.PI) off -= Math.PI * 2
    while (off < -Math.PI) off += Math.PI * 2
    if (Math.abs(off) < 0.04) break
    const key = off > 0 ? 'ArrowLeft' : 'ArrowRight'
    const ms = Math.min(220, Math.max(24, Math.round(Math.abs(off) * 150)))
    await page.keyboard.down(key)
    await page.waitForTimeout(ms)
    await page.keyboard.up(key)
    await page.waitForTimeout(60)
  }
  await page.waitForTimeout(200)
  await page.screenshot({ path: join(SHOTS, `${map}${onPhone ? '-phone' : ''}-facing.png`) })
  console.log('facing it:', JSON.stringify(await where()))

  for (let step = 0; step < 120; step++) {
    await page.keyboard.down('w')
    await page.waitForTimeout(150)
    await page.keyboard.up('w')
    await page.waitForTimeout(60)
    const now = await where()
    if (Math.hypot(target.d.x - now.x, target.d.y - now.y) < target.d.radius + 0.6) break
  }
  await page.waitForTimeout(300)
  const ended = await where()
  console.log(
    `ended ${Math.hypot(target.d.x - ended.x, target.d.y - ended.y).toFixed(2)}m from it ` +
      `(its radius is ${target.d.radius.toFixed(2)}, yours 0.35)`,
  )
  await page.screenshot({ path: join(SHOTS, `${map}${onPhone ? '-phone' : ''}-close.png`) })
  await browser.close()
  server.close()
}
