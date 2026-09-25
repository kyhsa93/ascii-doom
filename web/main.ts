/**
 * The page: input, a fixed-step simulation, and a frame.
 *
 * The browser is the target rather than the terminal for one concrete reason.
 * A terminal delivers key presses and never key releases, so "hold W to walk"
 * cannot be expressed there — only auto-repeat, which arrives a third of a
 * second late and stutters. Everything the renderer does works in either
 * place; the controls do not.
 */

import type { Framebuffer } from '../vendor/ascii-engine/src/core/framebuffer.ts'
import { drawText } from '../vendor/ascii-engine/src/core/overlay.ts'
import { RAMPS } from '../vendor/ascii-engine/src/core/ramp.ts'
import { vec3 } from '../vendor/ascii-engine/src/core/vec3.ts'
import { PreSurface } from '../vendor/ascii-engine/src/web/pre.ts'
import { sectorAt } from '../src/columns/level.ts'
import { DEFAULT_FOV_Y, renderView, type View } from '../src/columns/render.ts'
import { drawBillboards, type Billboard } from '../src/columns/sprite.ts'
import { billboardOf, spawnActor, updateActors, type Actor } from '../src/game/ai.ts'
import { LEVEL_1, SPAWN } from '../src/game/level1.ts'
import { EYE_HEIGHT, eyeHeight, moveBody, spawnPlayer } from '../src/game/player.ts'
import { LEVEL_1_ACTORS, LEVEL_1_PICKUPS } from '../src/game/things.ts'

const screen = document.getElementById('screen')!
const hint = document.getElementById('hint')!
const surface = new PreSurface(screen)

const player = spawnPlayer(LEVEL_1, SPAWN.x, SPAWN.y, SPAWN.angle)

const actors: Actor[] = LEVEL_1_ACTORS.map((placement) => {
  const sector = sectorAt(LEVEL_1, placement.x, placement.y)
  if (sector < 0) throw new Error(`${placement.kind.name} at (${placement.x}, ${placement.y}) is outside the map`)
  const actor = spawnActor(placement.kind, placement.x, placement.y, sector, LEVEL_1.sectors[sector]!.floor)
  actor.angle = placement.angle
  return actor
})

const MAX_HEALTH = 100
let health = MAX_HEALTH

const WALK_SPEED = 3.4
const RUN_SPEED = 5.8
const TURN_SPEED = 2.4
const LOOK_SPEED = 26
/** Rows the horizon may be sheared by, up or down. */
const LOOK_LIMIT = 14
const FOV_Y = DEFAULT_FOV_Y

let horizonShift = 0

const held = new Set<string>()
const down = (event: KeyboardEvent) => {
  // Arrows and space scroll the page otherwise, which fights the game for the
  // same keys.
  if (event.key.startsWith('Arrow') || event.key === ' ') event.preventDefault()
  held.add(event.key.length === 1 ? event.key.toLowerCase() : event.key)
}
const up = (event: KeyboardEvent) => {
  held.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key)
}
window.addEventListener('keydown', down)
window.addEventListener('keyup', up)
// A window that loses focus mid-stride would otherwise keep walking forever.
window.addEventListener('blur', () => held.clear())

const pressed = (...keys: string[]): boolean => keys.some((key) => held.has(key))

/** One simulation step. Fixed, so movement does not depend on frame rate. */
const STEP = 1 / 60

function step(): void {
  const running = pressed('Shift')
  const speed = (running ? RUN_SPEED : WALK_SPEED) * STEP

  if (pressed('ArrowLeft')) player.angle += TURN_SPEED * STEP
  if (pressed('ArrowRight')) player.angle -= TURN_SPEED * STEP
  if (pressed('ArrowUp')) horizonShift = Math.min(LOOK_LIMIT, horizonShift + LOOK_SPEED * STEP)
  if (pressed('ArrowDown')) horizonShift = Math.max(-LOOK_LIMIT, horizonShift - LOOK_SPEED * STEP)

  const fx = Math.cos(player.angle)
  const fy = Math.sin(player.angle)
  // Strafing is forward turned a quarter turn clockwise, the same vector the
  // renderer calls screen-right.
  const sx = fy
  const sy = -fx

  let dx = 0
  let dy = 0
  if (pressed('w')) {
    dx += fx
    dy += fy
  }
  if (pressed('s')) {
    dx -= fx
    dy -= fy
  }
  if (pressed('d')) {
    dx += sx
    dy += sy
  }
  if (pressed('a')) {
    dx -= sx
    dy -= sy
  }

  const length = Math.hypot(dx, dy)
  if (length > 0) moveBody(LEVEL_1, player, (dx / length) * speed, (dy / length) * speed)

  const outcome = updateActors(LEVEL_1, actors, player, EYE_HEIGHT, STEP)
  if (outcome.damage > 0) health = Math.max(0, health - outcome.damage)
}

let previous = performance.now()
let accumulator = 0
let framesThisSecond = 0
let totalFrames = 0
let fpsAt = previous
let fps = 0

/** Rebuilt each frame: the pickups, plus every creature where it now stands. */
const visible: Billboard[] = []

function frame(now: number): void {
  totalFrames++
  const elapsed = Math.min(0.25, (now - previous) / 1000)
  previous = now
  accumulator += elapsed
  // Clamped above, so a backgrounded tab returning after a minute takes a few
  // steps rather than several thousand.
  while (accumulator >= STEP) {
    step()
    accumulator -= STEP
  }

  surface.measure()
  const fb: Framebuffer = surface.framebuffer()
  // Glyph 0 means "auto", and `resolve` fills only those. Clearing to the
  // default of 32 decides every cell in advance and the ramp never runs.
  fb.clear(0, 0, 0, 0)

  const view: View = {
    x: player.x,
    y: player.y,
    z: eyeHeight(player),
    angle: player.angle,
    sector: player.sector,
    fovY: FOV_Y,
  }
  renderView(fb, LEVEL_1, view, surface.cellAspect, { horizonShift })

  visible.length = 0
  for (const pickup of LEVEL_1_PICKUPS) visible.push(pickup)
  for (const actor of actors) {
    // Lit by the sector it stands in, the way the original lights a thing.
    visible.push(billboardOf(actor, LEVEL_1.sectors[actor.sector]?.light ?? 0.5))
  }
  // After the world, so the depth it wrote decides what is hidden.
  drawBillboards(fb, view, surface.cellAspect, visible, { horizonShift })

  fb.resolve(RAMPS.short)

  // After `resolve`, because text writes glyphs directly and anything that
  // fills glyphs afterwards would overwrite them.
  const sector = LEVEL_1.sectors[player.sector]
  drawText(fb, 1, fb.height - 1, `${health}`, {
    color: health > 40 ? vec3(0.95, 0.85, 0.5) : vec3(1, 0.4, 0.35),
  })
  drawText(fb, 7, fb.height - 1, `${sector?.tag ?? '?'}`, { color: vec3(0.5, 0.5, 0.55) })
  drawText(fb, fb.width - 2, fb.height - 1, `${fps.toFixed(0)} fps`, {
    color: vec3(0.45, 0.45, 0.5),
    align: 'right',
  })

  surface.present(fb)

  framesThisSecond++
  if (now - fpsAt > 500) {
    fps = (framesThisSecond * 1000) / (now - fpsAt)
    framesThisSecond = 0
    fpsAt = now
  }

  ;(window as unknown as { __doom: Record<string, unknown> }).__doom = {
    cols: fb.width,
    rows: fb.height,
    cellAspect: surface.cellAspect,
    frames: totalFrames,
    fps,
    x: player.x,
    y: player.y,
    angle: player.angle,
    sector: player.sector,
    tag: sector?.tag ?? null,
    health,
    awake: actors.filter((actor) => actor.awake).length,
  }

  requestAnimationFrame(frame)
}

hint.textContent = 'W A S D move · ← → turn · ↑ ↓ look · Shift run'
requestAnimationFrame(frame)
