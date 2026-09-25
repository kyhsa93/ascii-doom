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
import { DEFAULT_FOV_Y, renderView, type View } from '../src/columns/render.ts'
import { drawBillboards } from '../src/columns/sprite.ts'
import { LEVEL_1, SPAWN } from '../src/game/level1.ts'
import { LEVEL_1_THINGS } from '../src/game/things.ts'
import { eyeHeight, movePlayer, spawnPlayer } from '../src/game/player.ts'

const screen = document.getElementById('screen')!
const hint = document.getElementById('hint')!
const surface = new PreSurface(screen)

const player = spawnPlayer(LEVEL_1, SPAWN.x, SPAWN.y, SPAWN.angle)

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
  if (length > 0) movePlayer(LEVEL_1, player, (dx / length) * speed, (dy / length) * speed)
}

let previous = performance.now()
let accumulator = 0
let framesThisSecond = 0
let totalFrames = 0
let fpsAt = previous
let fps = 0

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
  // After the world, so the depth it wrote decides what is hidden; before
  // `resolve`, though it makes no difference to sprites — they write their own
  // glyphs and `resolve` only fills cells still on auto.
  drawBillboards(fb, view, surface.cellAspect, LEVEL_1_THINGS, { horizonShift })

  fb.resolve(RAMPS.short)

  // After `resolve`, because text writes glyphs directly and anything that
  // fills glyphs afterwards would overwrite them.
  const sector = LEVEL_1.sectors[player.sector]
  drawText(fb, 1, fb.height - 1, `${sector?.tag ?? '?'}`, { color: vec3(0.9, 0.8, 0.5) })
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
  }

  requestAnimationFrame(frame)
}

hint.textContent = 'W A S D move · ← → turn · ↑ ↓ look · Shift run'
requestAnimationFrame(frame)
