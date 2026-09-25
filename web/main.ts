/**
 * The page: input, a fixed-step simulation, and a frame.
 *
 * Two devices, one simulation. A keyboard and a thumb both produce an intent
 * and the step consumes one, rather than the step reading keys and touch being
 * bolted on beside it — which is what kept the parts with right answers, like
 * a diagonal not being faster than a straight line, somewhere Node can check.
 */

import type { Framebuffer } from '../vendor/ascii-engine/src/core/framebuffer.ts'
import { drawText } from '../vendor/ascii-engine/src/core/overlay.ts'
import { RAMPS } from '../vendor/ascii-engine/src/core/ramp.ts'
import { vec3 } from '../vendor/ascii-engine/src/core/vec3.ts'
import { PreSurface } from '../vendor/ascii-engine/src/web/pre.ts'
import { drawAutomap } from '../src/columns/automap.ts'
import { insideSector, type Line, type Sector } from '../src/columns/level.ts'
import { DEFAULT_FOV_Y, renderView, type View } from '../src/columns/render.ts'
import { drawBillboards, type Billboard } from '../src/columns/sprite.ts'
import { billboardOf, damageActor, isAlive, provoke, updateActors } from '../src/game/ai.ts'
import {
  LEVELS,
  freshCarrier,
  isDead,
  nextLevel,
  restartLevel,
  startLevel as beginLevel,
} from '../src/game/campaign.ts'
import { deathLines, reachExit, summaryLayout, summaryLines } from '../src/game/exit.ts'
import { layoutHud } from '../src/game/hud.ts'
import { keyboardIntent, mergeIntents, touchIntent, type TouchState } from '../src/game/input.ts'
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
 * meant to.
 */
const carrier: Carrier = freshCarrier()

let levelIndex = 0
let state: LevelState = loadLevel(LEVELS[0]!)
/** Everything in flight, emptied whenever a level is. */
let projectiles: Projectile[] = []
/**
 * The lines the view has reached, which is what the automap may draw.
 *
 * Per level, and emptied with it: the set holds the level's own line objects,
 * and a reloaded level builds new ones, so a kept set would be a set of lines
 * belonging to a map that no longer exists.
 */
let seen = new Set<Line>()
let mapOpen = false
/** The map key as it was last frame, so holding it does not strobe the map. */
let mapAsked = false
/** Map units to a grid row. Close enough in to read a room, wide enough to place it. */
const MAP_SCALE = 0.55
/** Seconds left on the summary before the next level starts. */
let advanceIn = 0
/**
 * Seconds spent dead.
 *
 * The trigger you were holding is usually what killed you, so a press is only
 * taken as "again" once the panel has been up long enough to have been read.
 */
let deadFor = 0
const REVIVE_DELAY = 1.2

function startLevel(index: number): void {
  // What carries and what does not is decided in `campaign.ts`, where a check
  // can ask about it. What is left here is what only the page owns: the things
  // in flight and the pause before the next map.
  levelIndex = index
  state = beginLevel(index, carrier)
  projectiles = []
  advanceIn = 0
  deadFor = 0
  seen = new Set<Line>()
  mapOpen = false
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
  // Tab would otherwise walk the focus ring out of the game.
  if (event.key.startsWith('Arrow') || event.key === ' ' || event.key === 'Tab') event.preventDefault()
  held.add(event.key.length === 1 ? event.key.toLowerCase() : event.key)
}
const up = (event: KeyboardEvent) => {
  held.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key)
}
window.addEventListener('keydown', down)
window.addEventListener('keyup', up)
// A window that loses focus mid-stride would otherwise keep walking forever.
window.addEventListener('blur', () => held.clear())

// --- touch -----------------------------------------------------------------

const stickEl = document.getElementById('stick')
const knobEl = document.getElementById('knob')
const lookEl = document.getElementById('look')

/**
 * The right-hand area is a second stick rather than a drag.
 *
 * A drag has to be turned into a rate by dividing an accumulated delta by the
 * frame time, which stutters whenever a frame is long. Measuring how far the
 * thumb has moved from where it first touched gives a rate directly, matches
 * what `Intent.turn` already means, and keeps turning while the thumb is held
 * out — which is what you want when spinning to face something behind you.
 */
const LOOK_RADIUS = 90
const STICK_RADIUS = 60

const touch: {
  stick: { x: number; y: number } | null
  turn: number
  look: number
  fire: boolean
  use: boolean
  weapon: number
  map: boolean
} = { stick: null, turn: 0, look: 0, fire: false, use: false, weapon: -1, map: false }

let stickPointer: number | null = null
let lookPointer: number | null = null
let lookOrigin = { x: 0, y: 0 }

function moveKnob(x: number, y: number): void {
  if (knobEl) knobEl.style.transform = `translate(${x * STICK_RADIUS}px, ${y * STICK_RADIUS}px)`
}

if (stickEl) {
  const place = (event: PointerEvent) => {
    const box = stickEl.getBoundingClientRect()
    const dx = (event.clientX - (box.left + box.width / 2)) / (box.width / 2)
    const dy = (event.clientY - (box.top + box.height / 2)) / (box.height / 2)
    const magnitude = Math.hypot(dx, dy)
    const scale = magnitude > 1 ? 1 / magnitude : 1
    touch.stick = { x: dx * scale, y: dy * scale }
    moveKnob(dx * scale, dy * scale)
  }
  stickEl.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    stickPointer = event.pointerId
    stickEl.setPointerCapture(event.pointerId)
    place(event)
  })
  stickEl.addEventListener('pointermove', (event) => {
    if (event.pointerId !== stickPointer) return
    place(event)
  })
  const release = (event: PointerEvent) => {
    if (event.pointerId !== stickPointer) return
    stickPointer = null
    touch.stick = null
    moveKnob(0, 0)
  }
  stickEl.addEventListener('pointerup', release)
  stickEl.addEventListener('pointercancel', release)
}

if (lookEl) {
  lookEl.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    lookPointer = event.pointerId
    lookOrigin = { x: event.clientX, y: event.clientY }
    lookEl.setPointerCapture(event.pointerId)
  })
  lookEl.addEventListener('pointermove', (event) => {
    if (event.pointerId !== lookPointer) return
    // Dragging right turns right, and `turn` is positive to the left.
    touch.turn = -(event.clientX - lookOrigin.x) / LOOK_RADIUS
    touch.look = -(event.clientY - lookOrigin.y) / LOOK_RADIUS
  })
  const release = (event: PointerEvent) => {
    if (event.pointerId !== lookPointer) return
    lookPointer = null
    touch.turn = 0
    touch.look = 0
  }
  lookEl.addEventListener('pointerup', release)
  lookEl.addEventListener('pointercancel', release)
}

function button(id: string, press: () => void, release: () => void): void {
  const element = document.getElementById(id)
  if (!element) return
  element.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    press()
  })
  for (const name of ['pointerup', 'pointercancel', 'pointerleave']) {
    element.addEventListener(name, () => release())
  }
}

button(
  'fire',
  () => {
    touch.fire = true
  },
  () => {
    touch.fire = false
  },
)
button(
  'use',
  () => {
    touch.use = true
  },
  () => {
    touch.use = false
  },
)
// One button cycling forward, because three weapon buttons would cost more of
// a small screen than they are worth.
button(
  'swap',
  () => {
    touch.weapon = (weaponIndex + 1) % WEAPONS.length
  },
  () => {},
)
button(
  'map',
  () => {
    touch.map = true
  },
  () => {
    touch.map = false
  },
)

/** One simulation step. Fixed, so movement does not depend on frame rate. */
const STEP = 1 / 60

function step(): void {
  const { level, player, actors, movers, pickups, goal } = state

  if (goal.reached) {
    // The level is over: nothing walks, nothing fires, nothing closes in behind
    // the summary. After a pause the next one starts, or the last one stays.
    //
    // Before the death branch deliberately: a bolt still in the air when you
    // stepped into the exit does not take the level back off you.
    const next = nextLevel(levelIndex)
    if (next !== null) {
      advanceIn -= STEP
      if (advanceIn <= 0) startLevel(next)
    }
    return
  }

  if (isDead(carrier)) {
    // Everything stops, including the creatures standing over you. The level is
    // still drawn behind the panel, so what killed you is still on screen.
    deadFor += STEP
    const asked = mergeIntents(keyboardIntent(held), touchIntent(touch as TouchState))
    if (deadFor >= REVIVE_DELAY && (asked.fire || asked.use)) {
      state = restartLevel(levelIndex, carrier)
      projectiles = []
      deadFor = 0
      seen = new Set<Line>()
      mapOpen = false
      say(state.def.name)
    }
    return
  }

  const intent = mergeIntents(keyboardIntent(held), touchIntent(touch as TouchState))
  // A weapon request is a one-shot: consumed here so holding the button does
  // not keep re-selecting, and cleared whether or not it changed anything.
  if (intent.weapon >= 0 && intent.weapon < WEAPONS.length) weaponIndex = intent.weapon
  touch.weapon = -1

  // The rising edge, not the state: a device says the map is being asked for,
  // and what a press means is this side's business. Holding the key would
  // otherwise flip the map sixty times a second.
  if (intent.map && !mapAsked) mapOpen = !mapOpen
  mapAsked = intent.map

  const speed = (intent.run ? RUN_SPEED : WALK_SPEED) * STEP

  player.angle += intent.turn * TURN_SPEED * STEP
  horizonShift = Math.max(-LOOK_LIMIT, Math.min(LOOK_LIMIT, horizonShift + intent.look * LOOK_SPEED * STEP))

  const fx = Math.cos(player.angle)
  const fy = Math.sin(player.angle)
  // Strafing is forward turned a quarter turn clockwise, the same vector the
  // renderer calls screen-right.
  const sx = fy
  const sy = -fx

  const dx = fx * intent.forward + sx * intent.strafe
  const dy = fy * intent.forward + sy * intent.strafe
  // Already unit length at most: the intent does that, so both devices agree.
  if (dx !== 0 || dy !== 0) moveBody(level, player, dx * speed, dy * speed)

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
  // No test for being alive: the step above has already returned if you are not.
  if (intent.fire && cooldown <= 0 && carrier.ammo[weaponIndex]! >= weapon.cost) {
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
  if (intent.use) {
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
    say(nextLevel(levelIndex) !== null ? 'level complete' : 'that was the last of them')
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
  // The map replaces the view rather than floating over it, which is what the
  // original does and what this resolution can afford. Nothing new is seen
  // while it is up, because seeing is a side effect of drawing the world.
  if (!mapOpen) renderView(fb, level, view, surface.cellAspect, { horizonShift, seen })

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
  if (!mapOpen) drawBillboards(fb, view, surface.cellAspect, visible, { horizonShift })

  fb.resolve(RAMPS.short)

  // After `resolve` for the same reason the text below is: the map writes
  // glyphs directly, and resolve fills only the cells nothing has claimed.
  if (mapOpen) {
    drawAutomap(fb, level, seen, { cx: player.x, cy: player.y, scale: MAP_SCALE }, player, surface.cellAspect)
  }

  // After `resolve`, because text writes glyphs directly and anything that
  // fills glyphs afterwards would overwrite them.
  const weapon = WEAPONS[weaponIndex]!
  const centre = Math.floor(fb.width / 2)
  const middle = Math.floor(fb.height / 2) + Math.round(horizonShift)
  if (!mapOpen) {
    drawText(fb, centre, middle, flash > 0 ? '*' : '+', {
      color: flash > 0 ? vec3(1, 0.95, 0.6) : vec3(0.55, 0.55, 0.6),
    })
  }

  if (noticeTime > 0 && notice !== '') {
    drawText(fb, centre, 1, notice, { color: vec3(0.95, 0.9, 0.7), align: 'center' })
  }

  if (isDead(carrier)) {
    // Laid out by the summary's rule, so the two panels cannot disagree about
    // where the middle of a narrow grid is.
    summaryLayout(fb.width, fb.height, deathLines()).forEach((piece, index) => {
      drawText(fb, piece.col, piece.row, piece.text, {
        color: index === 0 ? vec3(1.3, 0.4, 0.35) : vec3(0.8, 0.75, 0.7),
      })
    })
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
    mapOpen,
    seen: seen.size,
    lines: level.lines.length,
    dead: isDead(carrier),
    deadFor,
    // Reported rather than written down twice: a check that hardcodes the delay
    // is a check that disagrees with the game the moment the delay changes.
    reviveDelay: REVIVE_DELAY,
    elapsed: goal.elapsed,
    doorState: state.movers[0]?.state ?? null,
    liftHeight:
      state.liftSectors[0] === undefined ? null : (level.sectors[state.liftSectors[0]]?.floor ?? null),
  }

  requestAnimationFrame(frame)
}

/**
 * A point the sector actually contains.
 *
 * The average of the corners is the obvious answer and is outside a concave
 * room, so it is tested rather than trusted and the bounds are scanned when it
 * fails. `insideSector` is the same rule the player is placed by, which is the
 * point of asking it rather than inventing a second idea of "inside".
 */
function somewhereInside(sector: Sector): { x: number; y: number } | null {
  let sx = 0
  let sy = 0
  for (const [px, py] of sector.polygon) {
    sx += px
    sy += py
  }
  const middle = { x: sx / sector.polygon.length, y: sy / sector.polygon.length }
  if (insideSector(sector, middle.x, middle.y)) return middle

  const steps = 16
  for (let i = 1; i < steps; i++) {
    for (let j = 1; j < steps; j++) {
      const x = sector.minX + ((sector.maxX - sector.minX) * i) / steps
      const y = sector.minY + ((sector.maxY - sector.minY) * j) / steps
      if (insideSector(sector, x, y)) return { x, y }
    }
  }
  return null
}

/**
 * A door for the browser checks, opened only by `?probe`.
 *
 * The summary screen and the pause behind it were the last things here nobody
 * had looked at, because reaching an exit in a browser means a long scripted
 * walk that fails for reasons which have nothing to do with what the summary
 * claims. This hands a check a way to *arrive* rather than a way to skip: the
 * body is put inside the exit sector and the ordinary rule notices on the next
 * step, so `reachExit`, the pause and the drawing are all still on the path
 * being checked. Only the walking is skipped, and Node already walks it.
 *
 * Undefined without the flag, so the page people play has no cheat in it.
 */
if (new URLSearchParams(location.search).has('probe')) {
  ;(window as unknown as { __probe: Record<string, unknown> }).__probe = {
    kill(): boolean {
      // Through the health the game reads, not through a death flag: the rule
      // being checked is "nothing survives at zero", and setting a flag would
      // check that the flag works.
      carrier.health = 0
      return true
    },
    toExit(): boolean {
      const sector = state.level.sectors[state.goal.exitSector]
      if (!sector) return false
      const spot = somewhereInside(sector)
      if (!spot) return false
      state.player.x = spot.x
      state.player.y = spot.y
      state.player.sector = state.goal.exitSector
      state.player.floor = sector.floor
      return true
    },
  }
}

hint.textContent = 'W A S D move · ← → turn · ↑ ↓ look · Shift run · Space fire · 1 2 3 weapon · E use'
requestAnimationFrame(frame)
