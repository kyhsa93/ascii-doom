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
import { billboardOf, isAlive, spawnActor, updateActors, type Actor } from '../src/game/ai.ts'
import { layoutHud } from '../src/game/hud.ts'
import { LEVEL_1, LEVEL_1_MOVERS, SPAWN, sectorIndexByTag } from '../src/game/level1.ts'
import { activate, makeMover, moverInFront, updateMovers, type Mover } from '../src/game/movers.ts'
import { EYE_HEIGHT, eyeHeight, moveBody, spawnPlayer } from '../src/game/player.ts'
import { LEVEL_1_ACTORS, LEVEL_1_PICKUPS } from '../src/game/things.ts'
import { WEAPONS, fire } from '../src/game/weapons.ts'

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

const movers: Mover[] = LEVEL_1_MOVERS.map((entry) => {
  const sector = sectorIndexByTag(LEVEL_1, entry.tag)
  if (sector < 0) throw new Error(`no sector tagged ${entry.tag}`)
  return makeMover(sector, entry.kind)
})
const liftSector = sectorIndexByTag(LEVEL_1, 'lift')

const MAX_HEALTH = 100
let health = MAX_HEALTH
let weaponIndex = 0
const ammo = [60, 24]
let cooldown = 0
let shotsFired = 0
let pelletsLanded = 0
let kills = 0
/** Seconds of muzzle flash left, purely so a shot is visible on a still frame. */
let flash = 0

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

  if (pressed('1')) weaponIndex = 0
  if (pressed('2')) weaponIndex = 1

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

  cooldown = Math.max(0, cooldown - STEP)
  flash = Math.max(0, flash - STEP)
  const weapon = WEAPONS[weaponIndex]!
  if (pressed(' ') && cooldown <= 0 && ammo[weaponIndex]! >= weapon.cost && health > 0) {
    ammo[weaponIndex] = ammo[weaponIndex]! - weapon.cost
    cooldown = weapon.interval
    flash = 0.06
    shotsFired++
    const result = fire(LEVEL_1, player, weapon, actors, EYE_HEIGHT)
    pelletsLanded += result.hits
    kills += result.kills
  }

  // Use: opens whatever you are facing. Held rather than tapped, because a
  // door that ignores you for holding the key too long is worse than one that
  // hears you twice -- reopening an open door only refreshes its wait.
  if (pressed('e')) {
    const target = moverInFront(LEVEL_1, movers, player.sector, player.x, player.y, player.angle)
    if (target) activate(target)
  }
  // A lift is called by standing on it. Nothing else in the level needs a
  // button, and a platform that waits to be asked is a platform people stand
  // on wondering what to do.
  if (player.sector === liftSector) {
    const lift = movers.find((mover) => mover.sector === liftSector)
    if (lift) activate(lift)
  }

  // Bodies are the player and every creature, so a closing door reverses off
  // either. The rule is about height, not about what kind of thing is under it.
  updateMovers(LEVEL_1, movers, [player, ...actors], STEP)

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
  const weapon = WEAPONS[weaponIndex]!
  const centre = Math.floor(fb.width / 2)
  const middle = Math.floor(fb.height / 2) + Math.round(horizonShift)
  // A crosshair, and a flash under it while a shot is in the air. The flash is
  // the only feedback a still frame carries that anything was fired.
  drawText(fb, centre, middle, flash > 0 ? '*' : '+', {
    color: flash > 0 ? vec3(1, 0.95, 0.6) : vec3(0.55, 0.55, 0.6),
  })

  const sector = LEVEL_1.sectors[player.sector]
  // Laid out rather than positioned by hand: at phone width the three pieces
  // ran into each other and the floor's own glyphs filled the space between,
  // so the whole row read as one string. What does not fit is dropped, weakest
  // first, and health never is.
  const colors: Record<string, [number, number, number]> = {
    health: health > 40 ? [0.95, 0.85, 0.5] : [1, 0.4, 0.35],
    weapon: [0.8, 0.78, 0.6],
    place: [0.45, 0.45, 0.5],
  }
  const line = layoutHud(fb.width, [
    { text: `${health}`, align: 'left', priority: 3 },
    { text: `${weapon.name} ${ammo[weaponIndex]}`, align: 'left', priority: 2 },
    { text: `${sector?.tag ?? '?'} · ${fps.toFixed(0)} fps`, align: 'right', priority: 1 },
  ])
  for (const piece of line) {
    const key = piece.align === 'right' ? 'place' : piece.text.includes(' ') ? 'weapon' : 'health'
    const [r, g, b] = colors[key]!
    drawText(fb, piece.col, fb.height - 1, piece.text, { color: vec3(r, g, b), align: piece.align })
  }

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
    alive: actors.filter((actor) => isAlive(actor)).length,
    weapon: weapon.name,
    ammo: ammo[weaponIndex],
    shotsFired,
    pelletsLanded,
    kills,
    doorState: movers[0]?.state ?? null,
    doorHeight: LEVEL_1.sectors[movers[0]?.sector ?? 0]?.ceiling ?? null,
    liftHeight: LEVEL_1.sectors[liftSector]?.floor ?? null,
  }

  requestAnimationFrame(frame)
}

hint.textContent = 'W A S D move · ← → turn · ↑ ↓ look · Shift run · Space fire · 1 2 weapon · E use'
requestAnimationFrame(frame)
