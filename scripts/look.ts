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

// Worked out here, where the level can be built without a browser: which piece
// of furniture to walk up to, and where it is.
const built = wadLevelState(new Uint8Array(readFileSync(`web/public/maps/${map}.wad`)), map, 3)
const spawn = built.player
const ranked = built.decor
  .map((d) => ({ d, dist: Math.hypot(d.x - spawn.x, d.y - spawn.y) }))
  .filter((n) => n.dist > 1.5 && n.dist < 30)
  .sort((a, b) => (want === 'tallest' ? b.d.sprite.height - a.d.sprite.height : a.dist - b.dist))
const target = ranked[0]
if (target === undefined) { console.log(`${map}: nothing within reach`); process.exit(0) }
const bearing = Math.atan2(target.d.y - spawn.y, target.d.x - spawn.x)
console.log(
  `${map}: ${built.decor.length} pieces. walking to one ${target.d.sprite.height.toFixed(2)}m tall, ` +
    `${target.dist.toFixed(1)}m away, radius ${target.d.radius.toFixed(2)}, standing at z ${target.d.z.toFixed(2)}`,
)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 680 } })
page.on('pageerror', (e) => console.error('page error:', e.message))
await page.goto(`${base}?probe`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
await page.keyboard.down(' '); await page.waitForTimeout(220); await page.keyboard.up(' ')
await page.waitForTimeout(600)
const raw = [...new Uint8Array(readFileSync(`web/public/maps/${map}.wad`))]
await page.evaluate(
  ([bytes, name]) =>
    (window as unknown as { __probe?: { loadWad(b: number[], n: string): boolean } }).__probe?.loadWad(
      bytes as number[], name as string),
  [raw, map] as [number[], string],
)
await page.waitForTimeout(1200)

const where = () => page.evaluate(() => {
  const d = (window as unknown as { __doom?: Record<string, number> }).__doom ?? {}
  return { x: d.x ?? 0, y: d.y ?? 0, angle: d.angle ?? 0 }
})

// Turned by watching the angle rather than by guessing at a duration.
for (let tries = 0; tries < 40; tries++) {
  const now = await where()
  let off = bearing - now.angle
  while (off > Math.PI) off -= Math.PI * 2
  while (off < -Math.PI) off += Math.PI * 2
  if (Math.abs(off) < 0.04) break
  const key = off > 0 ? 'ArrowLeft' : 'ArrowRight'
  const ms = Math.min(220, Math.max(24, Math.round(Math.abs(off) * 150)))
  await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key)
  await page.waitForTimeout(60)
}
await page.waitForTimeout(200)
await page.screenshot({ path: join(SHOTS, `${map}-facing.png`) })
console.log('facing it:', JSON.stringify(await where()))

// And closer, stopping when the thing itself stops us.
for (let step = 0; step < 60; step++) {
  await page.keyboard.down('w'); await page.waitForTimeout(150); await page.keyboard.up('w')
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
await page.screenshot({ path: join(SHOTS, `${map}-close.png`) })
await browser.close()
server.close()
