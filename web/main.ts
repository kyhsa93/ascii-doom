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
import { drawBillboards, type Billboard } from '../src/columns/sprite.ts'
import {
  billboardOf,
  damageActor,
  isAlive,
  provoke,
  updateActors,
} from '../src/game/ai.ts'
import { LEVELS } from '../src/game/campaign.ts'
import { reachExit, summaryLayout, summaryLines } from '../src/game/exit.ts'
import { layoutHud } from '../src/game/hud.ts'
import { loadLevel, type LevelState } from '../src/game/levels.ts'
import { activate, moverInFront, updateMovers } from '../src/game/movers.ts'
import { collect, type Carrier } from '../src/game/pickups.ts'
import { sweep, updateProjectiles, type Projectile } from '../src/game/projectiles.ts'
import { EYE_HEIGHT, PLAYER_RADIUS, eyeHeight, moveBody } from '../src/game/player.ts'
import { WEAPONS, fire } from '../src/game/weapons.ts'

const screen = document.getElementById('screen')!
const hint = document.getElementById('hint')!
const surface = new PreSurface(screen)

/**
 * What the player keeps between levels.
 *
 * Health and ammunition carry; keys do not. Each level locks its own doors and
 * hides its own key, so a key brought forward would open a door it was never
 * meant to — and the check that every lock has a key in the same level is
 * written on the assumption that it does not.
 */
const carrier: Carrier = {
  health: 100,
  maxHealth: 100,
  ammo: [60, 24, 8],
  ammoMax: [120, 48, 24],
  keys: new Set<string>(),
}

let levelIndex = 0
let state: LevelState = loadLevel(LEVELS[0]!)
/** Everything in flight, emptied whenever a level is. */
let projectiles: Projectile[] = []
/** Seconds left on the summary before the next level starts. */
let advanceIn = 0

function startLevel(index: number): void {
  levelIndex = index
  state = loadLevel(LEVELS[index]!)
  projectiles = []
  advanceIn = 0
  carrier.keys.clear()
  say(state.def.name)
}

let weaponIndex = 0
let cooldown = 0
let shotsFired = 0
let pelletsLanded = 0
let kills = 0
/** Seconds of muzzle flash left, purely so a shot is visible on a still frame. */
let flash = 0
/** A line shown briefly when something has just happened. */
let notice = ''
let noticeTime = 0

const WALK_SPEED = 3.4
const RUN_SPEED = 5.8
const TURN_SPEED = 2.4
const LOOK_SPEED = 26
/** Rows the horizon may be sheared by, up or down. */
const LOOK_LIMIT = 14
const FOV_Y = DEFAULT_FOV_Y

let horizonShift = 0

function say(text: string): void {
  notice = text
  noticeTime = 2.5
}

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
  const { level, player, actors, movers, pickups, goal } = state

  if (goal.reached) {
    // The level is over: nothing walks, nothing fires, nothing closes in behind
    // the summary. After a pause the next one starts, or the last one simply
    // stays on screen.
    if (levelIndex + 1 < LEVELS.length) {
      advanceIn -= STEP
      if (advanceIn <= 0) startLevel(levelIndex + 1)
    }
    return
  }

  const running = pressed('Shift')
  const speed = (running ? RUN_SPEED : WALK_SPEED) * STEP

  if (pressed('ArrowLeft')) player.angle += TURN_SPEED * STEP
  if (pressed('ArrowRight')) player.angle -= TURN_SPEED * STEP
  if (pressed('ArrowUp')) horizonShift = Math.min(LOOK_LIMIT, horizonShift + LOOK_SPEED * STEP)
  if (pressed('ArrowDown')) horizonShift = Math.max(-LOOK_LIMIT, horizonShift - LOOK_SPEED * STEP)

  if (pressed('1')) weaponIndex = 0
  if (pressed('2')) weaponIndex = 1
  if (pressed('3')) weaponIndex = 2

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
  if (length > 0) moveBody(level, player, (dx / length) * speed, (dy / length) * speed)

  // Walked over. Nothing is taken that would give nothing, so crossing a room
  // at full health leaves the kit there for when it is worth something.
  for (const taken of collect(pickups, player.x, player.y, PLAYER_RADIUS, carrier)) {
    const grant = taken.grant
    if (grant.kind === 'health') say(`+${grant.amount} health`)
    else if (grant.kind === 'ammo') say(`+${grant.amount} ${WEAPONS[grant.weapon]?.name ?? 'rounds'}`)
    else say(`${grant.key} key`)
  }

  cooldown = Math.max(0, cooldown - STEP)
  flash = Math.max(0, flash - STEP)
  noticeTime = Math.max(0, noticeTime - STEP)
  const weapon = WEAPONS[weaponIndex]!
  if (pressed(' ') && cooldown <= 0 && carrier.ammo[weaponIndex]! >= weapon.cost && carrier.health > 0) {
    carrier.ammo[weaponIndex] = carrier.ammo[weaponIndex]! - weapon.cost
    cooldown = weapon.interval
    flash = 0.06
    shotsFired++
    // The player's index in the body list the flight is resolved against, which
    // is `[...actors, player]` — so a slug cannot detonate on the person who
    // fired it, by the same rule that keeps a creature from shooting itself.
    const result = fire(level, player, weapon, actors, EYE_HEIGHT, actors.length)
    pelletsLanded += result.hits
    kills += result.kills
    for (const shot of result.shots) projectiles.push(shot)
  }

  // Use: opens whatever you are facing, if you are carrying what it asks for.
  // The lock is on the door rather than here, so this cannot forget to check.
  if (pressed('e')) {
    const target = moverInFront(level, movers, player.sector, player.x, player.y, player.angle)
    if (target && !activate(target, carrier.keys)) {
      say(`locked — needs the ${target.kind.requiresKey} key`)
    }
  }
  // A lift is called by standing on it. Nothing else needs a button, and a
  // platform that waits to be asked is a platform people stand on wondering
  // what to do.
  if (state.liftSectors.includes(player.sector)) {
    const lift = movers.find((mover) => mover.sector === player.sector)
    if (lift) activate(lift, carrier.keys)
  }

  // Bodies are the player and every creature, so a closing door reverses off
  // either. The rule is about height, not about what kind of thing is under it.
  updateMovers(level, movers, [player, ...actors], STEP)

  const outcome = updateActors(level, actors, player, EYE_HEIGHT, STEP)
  if (outcome.damage > 0) carrier.health = Math.max(0, carrier.health - outcome.damage)
  for (const shot of outcome.shots) projectiles.push(shot)

  const targets = [...actors, player]
  for (const impact of updateProjectiles(level, projectiles, targets, STEP, (index) => {
    const actor = actors[index]
    return actor === undefined || isAlive(actor)
  })) {
    if (impact.body === actors.length) {
      carrier.health = Math.max(0, carrier.health - impact.projectile.kind.damage)
    } else if (impact.body >= 0) {
      const struck = actors[impact.body]
      if (struck) {
        damageActor(struck, impact.projectile.kind.damage)
        // Whoever fired it just made an enemy. Only the impact knows both ends
        // of that, which is why the grudge is set here rather than inside the
        // creature rules.
        const owner = impact.projectile.owner
        if (owner >= 0 && owner < actors.length && owner !== impact.body) provoke(struck, owner)
      }
    }
  }
  sweep(projectiles)

  // Last, so that walking into the exit on this step counts on this step.
  if (reachExit(goal, player.sector, STEP)) {
    advanceIn = 3.5
    say(levelIndex + 1 < LEVELS.length ? 'level complete' : 'that was the last of them')
  }
}

let previous = performance.now()
let accumulator = 0
let framesThisSecond = 0
let totalFrames = 0
let fpsAt = previous
let fps = 0

/** Rebuilt each frame: what is still on the floor, plus every creature. */
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

  const { level, player, actors, pickups, goal } = state

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
  renderView(fb, level, view, surface.cellAspect, { horizonShift })

  visible.length = 0
  for (const pickup of pickups) {
    if (!pickup.taken) visible.push(pickup)
  }
  for (const actor of actors) {
    // Lit by the sector it stands in, the way the original lights a thing.
    visible.push(billboardOf(actor, level.sectors[actor.sector]?.light ?? 0.5))
  }
  for (const shot of projectiles) {
    if (!shot.alive) continue
    // Drawn at full brightness whatever room it is crossing: a bolt is its own
    // light, and one that dims with the sector reads as a smudge on the wall
    // behind it rather than as something coming at you.
    visible.push({
      x: shot.x,
      y: shot.y,
      z: shot.z - shot.kind.sprite.height / 2,
      light: 1,
      sprite: shot.kind.sprite,
    })
  }
  // After the world, so the depth it wrote decides what is hidden.
  drawBillboards(fb, view, surface.cellAspect, visible, { horizonShift })

  fb.resolve(RAMPS.short)

  // After `resolve`, because text writes glyphs directly and anything that
  // fills glyphs afterwards would overwrite them.
  const weapon = WEAPONS[weaponIndex]!
  const centre = Math.floor(fb.width / 2)
  const middle = Math.floor(fb.height / 2) + Math.round(horizonShift)
  drawText(fb, centre, middle, flash > 0 ? '*' : '+', {
    color: flash > 0 ? vec3(1, 0.95, 0.6) : vec3(0.55, 0.55, 0.6),
  })

  if (noticeTime > 0 && notice !== '') {
    drawText(fb, centre, 1, notice, { color: vec3(0.95, 0.9, 0.7), align: 'center' })
  }

  if (goal.reached) {
    // Drawn over the frozen frame rather than replacing it, so the room you
    // finished in is still behind the result.
    const lines = summaryLines({
      seconds: goal.elapsed,
      kills,
      creatures: actors.length,
      collected: pickups.filter((pickup) => pickup.taken).length,
      supplies: pickups.length,
    })
    summaryLayout(fb.width, fb.height, lines).forEach((piece, index) => {
      drawText(fb, piece.col, piece.row, piece.text, {
        color: index === 0 ? vec3(1.2, 1, 0.6) : vec3(0.85, 0.85, 0.8),
      })
    })
  }

  const sector = level.sectors[player.sector]
  const keys = [...carrier.keys].join(' ')
  const line = layoutHud(fb.width, [
    { text: `${carrier.health}`, align: 'left', priority: 4 },
    { text: `${weapon.name} ${carrier.ammo[weaponIndex]}`, align: 'left', priority: 3 },
    { text: keys === '' ? '' : `keys ${keys}`, align: 'left', priority: 2 },
    { text: `${state.def.name} · ${fps.toFixed(0)} fps`, align: 'right', priority: 1 },
  ])
  for (const piece of line) {
    if (piece.text === '') continue
    const color =
      piece.align === 'right'
        ? vec3(0.45, 0.45, 0.5)
        : piece.text.startsWith('keys')
          ? vec3(1.2, 0.95, 0.45)
          : piece.text.includes(' ')
            ? vec3(0.8, 0.78, 0.6)
            : carrier.health > 40
              ? vec3(0.95, 0.85, 0.5)
              : vec3(1, 0.4, 0.35)
    drawText(fb, piece.col, fb.height - 1, piece.text, { color, align: piece.align })
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
    level: state.def.name,
    levelIndex,
    levelCount: LEVELS.length,
    health: carrier.health,
    awake: actors.filter((actor) => actor.awake).length,
    alive: actors.filter((actor) => isAlive(actor)).length,
    weapon: weapon.name,
    ammo: carrier.ammo[weaponIndex],
    shotsFired,
    pelletsLanded,
    kills,
    keys: [...carrier.keys],
    pickupsLeft: pickups.filter((pickup) => !pickup.taken).length,
    inFlight: projectiles.length,
    complete: goal.reached,
    elapsed: goal.elapsed,
    doorState: state.movers[0]?.state ?? null,
    liftHeight: state.liftSectors[0] === undefined ? null : level.sectors[state.liftSectors[0]]?.floor ?? null,
  }

  requestAnimationFrame(frame)
}

hint.textContent = 'W A S D move · ← → turn · ↑ ↓ look · Shift run · Space fire · 1 2 3 weapon · E use'
requestAnimationFrame(frame)
