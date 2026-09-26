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
import { bite, hurtOf, makeHazard } from '../src/game/hazard.ts'
import { insideSector, lineInFront, type Line, type Sector } from '../src/columns/level.ts'
import { columnOfCamX, DEFAULT_FOV_Y, projectionOf, renderView, type View } from '../src/columns/render.ts'
import { crossings } from '../src/columns/crossing.ts'
import { SILENCE, speakerFor, type Noise, type Speaker } from '../src/game/sound.ts'
import { drawBillboards, drawSprite, squeezed, type Billboard } from '../src/columns/sprite.ts'
import {
  billboardOf,
  damageActor,
  isAlive,
  normalizeAngle,
  provoke,
  updateActors,
  type Actor,
} from '../src/game/ai.ts'
import {
  LEVELS,
  freshCarrier,
  isDead,
  nextLevel,
  refillCarrier,
  restartLevel,
  startLevel as beginLevel,
} from '../src/game/campaign.ts'
import { deathLines, finishNow, reachExit, summaryLayout, summaryLines } from '../src/game/exit.ts'
import { layoutHud } from '../src/game/hud.ts'
import { LOGO } from '../src/game/freedoomart.ts'
import { BAR_ROWS, centreOf, layoutBar } from '../src/game/statusbar.ts'
import { chosen, menuLayout, moveCursor, openMenu, type Menu } from '../src/game/menu.ts'
import { keyboardIntent, mergeIntents, touchIntent, type TouchState } from '../src/game/input.ts'
import { loadLevel, type LevelState } from '../src/game/levels.ts'
import { mapNames } from '../src/columns/wad.ts'
import { wadLevelState, type Skill } from '../src/game/wadlevel.ts'
import { aimAt, type AimTarget } from '../src/game/autoaim.ts'
import { activate, moverInFront, updateMovers, type Mover } from '../src/game/movers.ts'
import { collect, takeDamage, type Carrier } from '../src/game/pickups.ts'
import { blast, sweep, updateProjectiles, type Projectile } from '../src/game/projectiles.ts'
import { EYE_HEIGHT, PLAYER_RADIUS, eyeHeight, moveBody } from '../src/game/player.ts'
import { WEAPONS, fire } from '../src/game/weapons.ts'

const screen = document.getElementById('screen')!
// Declared here rather than beside its listener: the menu opens it too, and a
// `const` reached before its declaration is a mistake this project has made.
const wadInput = document.getElementById('wad') as HTMLInputElement | null
const keys = document.getElementById('keys')!
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
 * Teleport lines that have been used up.
 *
 * Special 39 works once and 97 repeats, and the difference has to be kept
 * somewhere. Here rather than on the line, because the line belongs to a level
 * that may be played again -- and cleared in `enterLevel` with everything else
 * of this shape, which is the lesson the kill counters taught.
 */
let usedTeleports = new Set<Line>()
/**
 * The lines the view has reached, which is what the automap may draw.
 *
 * Per level, and emptied with it: the set holds the level's own line objects,
 * and a reloaded level builds new ones, so a kept set would be a set of lines
 * belonging to a map that no longer exists.
 */
let seen = new Set<Line>()
let mapOpen = false

/**
 * Whether the title is still up.
 *
 * The game used to begin in the first room with no warning, which is fine for a
 * thing you are building and wrong for a thing you hand someone: there was
 * nowhere for it to say what it is. It waits for the trigger rather than for a
 * timer, because the trigger is the one control every device has.
 */
let titleUp = true

/**
 * The menu under the logo.
 *
 * Built once at boot rather than each frame: the cursor lives in it, so a menu
 * rebuilt every frame would forget where you were.
 */
/**
 * Which skill a map from a file is built for.
 *
 * Everything was arriving at once -- twelve thousand two hundred and ninety-two
 * bodies across the two files, more than the hardest setting the original
 * offers. Normal to begin with, because that is what the original starts you
 * on, and it is a setting rather than a destination so the menu cycles it.
 */
let skill: Skill = 'normal'
const SKILLS: readonly Skill[] = ['easy', 'normal', 'hard']

/**
 * The speaker, whether anybody wants it, and how many noises it was asked for.
 *
 * Declared here rather than beside the function that uses it, because the title
 * menu is built during module initialisation and its label reads `audible` --
 * declared below, the page threw "cannot access before initialization" and drew
 * nothing at all. That is the second time in two rounds: the difficulty did it
 * first. Anything the menu's labels read belongs above the menu.
 */
let speaker: Speaker = SILENCE
let noisesPlayed = 0
let audible = true

/**
 * The title's own menu, rebuilt when the difficulty changes.
 *
 * Rebuilt rather than mutated because the label carries the setting -- there is
 * no room on this screen for a row of three -- and a label is part of the item.
 */
function titleMenu(cursor = 0): Menu {
  const built = openMenu([
    { label: 'begin', action: { kind: 'begin' } },
    { label: 'the outpost', action: { kind: 'level', index: 0 } },
    { label: 'the cistern', action: { kind: 'level', index: 1 } },
    { label: `difficulty: ${skill}`, action: { kind: 'skill' } },
    { label: `sound: ${audible ? 'on' : 'off'}`, action: { kind: 'sound' } },
  ])
  return { ...built, cursor }
}

let menu: Menu = titleMenu()

/**
 * Whether the trigger and the stick were already held last step.
 *
 * A menu moves one line per press, and every input here is a level rather than
 * an edge: holding the stick up would run the cursor round the ring several
 * times a second, and holding fire would choose the first item the instant the
 * menu appeared. The automap key learned this the same way.
 */
let choosing = false
let leaning = 0
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
/** The clock on the ground underfoot, if the ground is the kind that hurts. */
let hazard = makeHazard()

/**
 * Takes up a level the page is about to run.
 *
 * Everything reset here belongs to the page rather than to the campaign: what
 * is in flight, what the automap has learned, the clock on the ground underfoot
 * and the panels that might be up. The automap set is the one that matters
 * most, because it holds the level's own line objects and a new level builds
 * new ones -- keeping it would leave the map drawing a place that no longer
 * exists.
 *
 * It lived in two places until now, once for starting a level and once for
 * restarting after dying, and the copies had already drifted: only one of them
 * cleared the pause. That difference cannot be reached today, because the
 * summary branch returns before the death branch can run, which is exactly the
 * kind of harmless-for-now that stops being harmless quietly.
 */
function enterLevel(next: LevelState): void {
  state = next
  /*
   * What you did in the last level did not happen in this one.
   *
   * These three were module counters that nothing ever cleared, so the summary
   * at the end of a level reported the kills of every level before it as well
   * -- and a map opened from a file inherited whatever the outpost had already
   * given you. It surfaced as a browser check failing the same way three runs
   * running: a shot fired to get past the title hit something in the first
   * room, and the count was still sitting there when a later fixture asserted
   * that an unaimed shot lands nothing.
   */
  shotsFired = 0
  pelletsLanded = 0
  kills = 0
  // An index into the creatures of a level that is over.
  locked = null
  // Split once here rather than filtered every time somebody presses use.
  doors = next.movers.filter((mover) => mover.kind.surface === 'ceiling')
  projectiles = []
  usedTeleports = new Set<Line>()
  advanceIn = 0
  deadFor = 0
  seen = new Set<Line>()
  mapOpen = false
  hazard = makeHazard()
  say(state.def.name)
}

/**
 * The movers a press can open by facing the room they are in.
 *
 * Doors, and only doors. A lift is a floor rather than a ceiling and answers to
 * the wall the map marked rather than to any face of the room it sits in, so
 * handing the whole list to `moverInFront` would let one be called from the
 * wrong side -- and, worse, would mean the lift table below never ran at all on
 * the four fifths of lift lines that do have their platform behind them.
 */
let doors: readonly Mover[] = []

/**
 * The file a map came from, while one is open, and null while the campaign runs.
 *
 * Kept because dying has to put you back in the same map. `levelIndex` means
 * nothing once a map arrives from a file, and restarting by index would quietly
 * swap a map you opened for the outpost. That path is reachable rather than
 * theoretical: a map read from a WAD has no creatures in it yet, but the
 * original's nukage arrives as this engine's hazard, so the floor can still
 * kill you.
 *
 * Declared above its first reader rather than below it. Nothing calls
 * `startLevel` before this line runs today, so the other order worked -- and
 * this project has twice had a `const` reached before its declaration and spent
 * a while reading the `undefined` as a result.
 */
let wadSource: { bytes: Uint8Array; mapName: string } | null = null

/**
 * The file somebody opened, kept for the menu that lists what is in it.
 *
 * Separate from `wadSource`, which is about the map being played and is what a
 * death restarts from. This is about the file: it outlives any one map, because
 * the point of listing them is going back for another.
 */
let opened: Uint8Array | null = null


function startLevel(index: number): void {
  // What carries between levels and what does not is decided in `campaign.ts`,
  // where a check can ask about it. What is left here is what only the page
  // owns, and that is now one function.
  wadSource = null
  levelIndex = index
  enterLevel(beginLevel(index, carrier))
}

/** Opens a map from a file, from the beginning, with the kit a run starts with. */
function enterWad(bytes: Uint8Array, mapName: string): void {
  // The measured cell aspect, because a picture out of the file is sampled
  // into characters and the number decides how many columns that is worth.
  // Wrong, it costs detail rather than shape -- but it is measured here and
  // nowhere else, so there is no reason to hand the importer a guess.
  const next = wadLevelState(bytes, mapName, surface.cellAspect, skill)
  wadSource = { bytes, mapName }
  // Said rather than left at whatever was running: everything that reads this
  // index is about progressing through levels written here, and there is no
  // progression through a file.
  levelIndex = -1
  refillCarrier(carrier)
  enterLevel(next)

  /*
   * Say what came of it, because otherwise nothing does.
   *
   * A file whose pictures this can read looks different and a file without any
   * looks exactly as it always did, and from the outside those two are the same
   * event: a map appeared. The first report of this feature was "I can't tell
   * what changed", which is a fair thing to say about a change that announces
   * itself by looking slightly different in a dark room.
   *
   * The count comes from the importer, which knows. Working it out here by
   * asking whether a sprite had a colour per cell worked only while baked art
   * did not exist, and then quietly said "one drawn from the file" about a file
   * with no pictures in it.
   */
  const drawn = next.fromFile
  say(drawn === 0 ? `${mapName} · no pictures in that file` : `${mapName} · ${drawn} drawn from the file`)
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

/**
 * Whether this is a device that gets help aiming.
 *
 * A coarse pointer, which is the same question the stylesheet asks to decide
 * whether to show the controls at all. A keyboard can put the body exactly
 * where it wants; a thumb holding a rate cannot, and the help exists for that
 * difference rather than for the screen size.
 */
const COARSE = window.matchMedia('(pointer: coarse)')

/**
 * What the aiming help has picked, or null.
 *
 * Worked out once a frame and read twice -- by the mark drawn on screen and by
 * the shot the next step fires -- so that what you are shown and what you hit
 * are one decision rather than two that nearly agree.
 */
let locked: AimTarget | null = null

/**
 * The speaker, and how many noises it has been asked for.
 *
 * Silent until somebody presses something, because every browser refuses to
 * make a sound before a gesture -- built on the first key or tap rather than at
 * boot, so the first shot is heard rather than swallowed.
 *
 * The count is the only way anything can check this. A noise leaves no mark on
 * the screen, so the page says how many it has played and a browser check reads
 * that; asserting on the audio graph itself would be asserting that Web Audio
 * works.
 */

function wakeSpeaker(): void {
  if (speaker !== SILENCE) return
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (Ctor === undefined) return
  speaker = speakerFor(new Ctor())
}

/** Makes a noise, if there is anything to make it with and anyone wants it. */
function noise(which: Noise, loudness = 1): void {
  if (!audible) return
  noisesPlayed++
  speaker.play(which, loudness)
}

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
window.addEventListener('keydown', wakeSpeaker, { once: true })
window.addEventListener('pointerdown', wakeSpeaker, { once: true })
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

/**
 * Kills a creature and sets off whatever it leaves behind.
 *
 * Every place that can hurt a creature goes through here. There are four of
 * them -- a traced pellet, a creature's gun, a projectile arriving, a blast
 * catching something -- and a barrel that only exploded when shot by one of
 * them would be a barrel that behaves differently depending on what killed it.
 *
 * Chains, because a blast that kills another barrel calls this again. The depth
 * is bounded by the barrels actually standing in the blast, and the dying flag
 * is set before the blast goes off, so a barrel cannot set itself off.
 */
/**
 * Whether a body is something you fought rather than something you burst.
 *
 * Barrels arrive through the creature table because a barrel is a body with
 * health, and that is the cheapest true thing to do -- but a level summary
 * reading "creatures 4 / 138" when nine of those are barrels is a summary that
 * lies, and bursting one counted as a kill. Counted in one place so the two
 * halves of that fraction cannot drift apart.
 */
function isCreature(actor: Actor): boolean {
  return actor.kind.explodes === undefined
}

/**
 * Hurts the player and says so out loud.
 *
 * Every place that can hurt you goes through `takeDamage`; this wraps it so the
 * noise cannot be forgotten at one of them -- the same argument the armour made
 * for putting the subtraction in one place, applied one layer out.
 */
function hurtPlayer(amount: number): void {
  if (amount <= 0) return
  const before = carrier.health
  takeDamage(carrier, amount)
  if (carrier.health <= 0 && before > 0) noise('die')
  else noise('hurt', Math.min(1, 0.4 + amount / 40))
}

function hurtActor(index: number, amount: number, by: number): void {
  const { level, actors, player } = state
  const actor = actors[index]
  if (actor === undefined || !isAlive(actor)) return

  const died = damageActor(actor, amount)
  if (by >= 0 && by < actors.length && by !== index) provoke(actor, by)
  // Quietly for a barrel: what a barrel has to say is the blast below.
  if (isCreature(actor)) noise(died ? 'creatureDie' : 'creatureHurt', 0.5)
  if (!died) return
  // Counted here rather than only where a pellet lands, or a creature killed by
  // a rocket -- or by a barrel it was standing beside -- would finish the level
  // uncounted.
  if (isCreature(actor)) kills++

  const goes = actor.kind.explodes
  if (goes === undefined) return
  for (const caught of blast(
    level,
    actor.x,
    actor.y,
    actor.floor + actor.kind.height / 2,
    goes.radius,
    goes.damage,
    [...actors, player],
  )) {
    if (caught.body === actors.length) {
      hurtPlayer(caught.damage)
      continue
    }
    // Recurses into the next barrel, which is the chain the maps are built on.
    hurtActor(caught.body, caught.damage, by)
  }
}

function step(): void {
  const { level, player, actors, movers, pickups, goal } = state

  if (titleUp) {
    // Nothing moves behind it. A creature that had been walking while the title
    // was up would be somewhere else by the time anybody saw the room.
    const asked = mergeIntents(keyboardIntent(held), touchIntent(touch as TouchState))

    // Up is up on both: the arrow keys give `look`, and on a phone the stick
    // that walks you forward is the one that moves the cursor.
    const lean = asked.look !== 0 ? Math.sign(asked.look) : Math.sign(asked.forward)
    if (lean !== 0 && lean !== leaning) menu = moveCursor(menu, -lean)
    leaning = lean

    const pressing = asked.fire || asked.use
    if (pressing && !choosing) {
      const action = chosen(menu)
      if (action?.kind === 'begin') {
        titleUp = false
        say(state.def.name)
      } else if (action?.kind === 'level') {
        titleUp = false
        startLevel(action.index)
      } else if (action?.kind === 'map' && opened !== null) {
        titleUp = false
        enterWad(opened, action.name)
      } else if (action?.kind === 'sound') {
        audible = !audible
        menu = titleMenu(menu.cursor)
        // After the flip, so turning it on says so and turning it off is quiet.
        noise('switch')
        say(`sound: ${audible ? 'on' : 'off'}`)
      } else if (action?.kind === 'skill') {
        // Cycles in place, cursor and all: stepping the difficulty must not
        // move you off the line you are standing on.
        skill = SKILLS[(SKILLS.indexOf(skill) + 1) % SKILLS.length] ?? 'normal'
        menu = titleMenu(menu.cursor)
        say(`difficulty: ${skill}`)
      }
    }
    choosing = pressing
    return
  }

  if (goal.reached) {
    // The level is over: nothing walks, nothing fires, nothing closes in behind
    // the summary. After a pause the next one starts, or the last one stays.
    //
    // Before the death branch deliberately: a bolt still in the air when you
    // stepped into the exit does not take the level back off you.
    // A map opened from a file has no place in the campaign's order, so there
    // is nothing after it. Without this `nextLevel(-1)` answers 0 and finishing
    // someone else's map would quietly hand you the outpost -- which was
    // unreachable only because a file had no exit to reach until now.
    const next = wadSource ? null : nextLevel(levelIndex)
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
      // Back into the map you died in, whichever kind it is. A file has no
      // campaign index to restart by, so it is rebuilt from the bytes it came
      // from -- which is also what makes its doors shut and its supplies
      // reappear, exactly as reloading a level definition does.
      //
      // Without this branch the campaign is asked for level -1 and refuses, so
      // the revive never happens and the death panel stays up while the step
      // throws every frame. Checked, and worth knowing it fails loudly rather
      // than by handing you the wrong map.
      if (wadSource) enterWad(wadSource.bytes, wadSource.mapName)
      else enterLevel(restartLevel(levelIndex, carrier))
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
  const wasX = player.x
  const wasY = player.y
  if (dx !== 0 || dy !== 0) moveBody(level, player, dx * speed, dy * speed)

  /*
   * Lines crossed by that step, which is how most of the original's map works.
   *
   * Asked of the step rather than of where the body ended up. The exit importer
   * had to approximate crossing with "did you arrive in the room beyond", which
   * is true of an exit because an exit happens once; it is not true of a
   * teleport, where the room beyond is the room you left behind a moment later.
   *
   * Only from the front, which is the original's rule and not a simplification:
   * a teleport crossed from the back is how you walk away from the pad you just
   * landed on without being sent straight back.
   */
  for (const crossed of crossings(level.lines, wasX, wasY, player.x, player.y)) {
    if (!crossed.fromFront) continue
    const where = state.teleportLines.get(crossed.line)
    if (where === undefined || usedTeleports.has(crossed.line)) continue
    if (where.once) usedTeleports.add(crossed.line)

    player.x = where.x
    player.y = where.y
    player.angle = where.angle
    player.sector = where.sector
    player.floor = level.sectors[where.sector]?.floor ?? player.floor
    say('teleported')
    noise('teleport')
    // One a step. A pad standing on another teleport line would otherwise send
    // you on again in the same frame, and arriving is not crossing.
    break
  }

  /*
   * And the machines a crossed line works, which is the other half of it.
   *
   * Every crossing rather than the first, because unlike a teleport these leave
   * you where you are: a step through a doorway that opens the room beyond and
   * drops the floor behind should do both. From either side, too -- the side
   * rule is the teleport's, not a rule about crossings, and a door you can only
   * open walking one way is a door you get locked behind.
   *
   * `activate` is the same call a press makes, locks and all.
   */
  for (const crossed of crossings(level.lines, wasX, wasY, player.x, player.y)) {
    for (const machine of state.crossedLines.get(crossed.line) ?? []) {
      activate(machine, carrier.keys)
    }
  }

  // The ground underfoot, after the move rather than before it: a step out of a
  // channel is a step out of it, and the clock starts again on the way back in.
  const burn = bite(level, player.sector, hazard, STEP)
  if (burn > 0) {
    hurtPlayer(burn)
    say('burning')
    noise('hurt', 0.5)
  }

  // Walked over. Nothing is taken that would give nothing, so crossing a room
  // at full health leaves the kit there for when it is worth something.
  for (const taken of collect(pickups, player.x, player.y, PLAYER_RADIUS, carrier)) {
    const grant = taken.grant
    noise(grant.kind === 'weapon' ? 'weaponUp' : 'pickup')
    if (grant.kind === 'health') say(`+${grant.amount} health`)
    else if (grant.kind === 'ammo') say(`+${grant.amount} ${WEAPONS[grant.weapon]?.name ?? 'rounds'}`)
    else if (grant.kind === 'armour') say(`armour ${carrier.armour}`)
    else if (grant.kind === 'weapon') say(`${WEAPONS[grant.weapon]?.name ?? 'a weapon'} — ${carrier.ammo[grant.weapon] ?? 0} rounds`)
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
    noise(weaponIndex === 0 ? 'sidearm' : weaponIndex === 1 ? 'scattergun' : 'launcher')
    const result = fire(level, player, weapon, actors, EYE_HEIGHT, actors.length, Math.random, locked?.angle)
    pelletsLanded += result.hits
    // Only the ones that were creatures. `fire` reports every body it killed,
    // and a barrel is a body.
    kills += result.killed.filter((index) => {
      const dead = actors[index]
      return dead !== undefined && isCreature(dead)
    }).length
    for (const shot of result.shots) projectiles.push(shot)
    /*
     * And anything a pellet killed sets off whatever it leaves behind.
     *
     * `fire` damages creatures itself -- it has to, since it traces the pellets
     * -- so the deaths it causes do not pass through `hurtActor`. Without this,
     * a barrel burst by a rocket exploded and the same barrel shot with a
     * pistol quietly fell over, which is the sort of inconsistency nobody
     * reports and everybody feels.
     */
    for (const index of result.killed) {
      const dead = actors[index]
      const goes = dead?.kind.explodes
      if (dead === undefined || goes === undefined) continue
      for (const caught of blast(
        level,
        dead.x,
        dead.y,
        dead.floor + dead.kind.height / 2,
        goes.radius,
        goes.damage,
        [...actors, player],
      )) {
        if (caught.body === actors.length) hurtPlayer(caught.damage)
        else hurtActor(caught.body, caught.damage, actors.length)
      }
    }
  }

  // Use: opens whatever you are facing, if you are carrying what it asks for.
  // The lock is on the door rather than here, so this cannot forget to check.
  if (intent.use) {
    const target = moverInFront(level, doors, player.sector, player.x, player.y, player.angle)
    if (target) {
      if (activate(target, carrier.keys)) noise('door')
      else {
        noise('noAmmo')
        say(`locked — needs the ${target.kind.requiresKey} key`)
      }
    } else {
      // One ray, then whatever that piece of wall turns out to be. A switch is
      // the wall itself rather than the room behind it -- most of them have
      // nothing behind them -- and a line carries one special, so this asks
      // what is being faced and dispatches on it rather than trying the two
      // kinds in an order it could not justify.
      const facing = lineInFront(level, player.x, player.y, player.angle)
      if (facing) {
        if (state.exitLines.has(facing) && finishNow(goal)) {
          advanceIn = 3.5
          noise('switch')
          say('that was the last of them')
        }
        // A wall may call more than one platform: eighty-three of the lift
        // lines in the files this was built against name several rooms.
        for (const platform of state.liftLines.get(facing) ?? []) {
          if (activate(platform, carrier.keys)) noise('switch')
        }
        // And a switch may open a door in another room entirely, which is how
        // forty-eight of the sixty-eight maps are built.
        for (const machine of state.switchLines.get(facing) ?? []) {
          if (activate(machine, carrier.keys)) noise('switch')
        }
      }
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
  if (outcome.damage > 0) hurtPlayer(outcome.damage)
  for (const shot of outcome.shots) projectiles.push(shot)

  const targets = [...actors, player]
  for (const impact of updateProjectiles(level, projectiles, targets, STEP, (index) => {
    const actor = actors[index]
    return actor === undefined || isAlive(actor)
  })) {
    const kind = impact.projectile.kind
    const owner = impact.projectile.owner
    if (impact.body === actors.length) {
      hurtPlayer(kind.damage)
    } else if (impact.body >= 0) {
      // Through the one function that knows what a death sets off, so a
      // barrel shot by a rocket and a barrel shot by a pistol behave the same.
      hurtActor(impact.body, kind.damage, owner)
    }

    /*
     * And the blast, if it was something that has one.
     *
     * After the direct hit and separately from it: whatever the rocket landed
     * on takes both, which is the original's arrangement and the reason a
     * direct hit is worth aiming for. The blast does not ask who fired it, so
     * the player is in the list and firing at a wall in front of you costs you
     * health -- which is most of what makes a launcher a decision.
     */
    if (kind.blastRadius !== undefined && kind.blastDamage !== undefined) {
      noise('blast')
      for (const caught of blast(
        level,
        impact.x,
        impact.y,
        impact.projectile.z,
        kind.blastRadius,
        kind.blastDamage,
        [...actors, player],
      )) {
        if (caught.body === actors.length) {
          hurtPlayer(caught.damage)
          continue
        }
        hurtActor(caught.body, caught.damage, owner)
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

  // Only as wide as the picture: being aimed at something off the screen is
  // indistinguishable from the gun firing somewhere at random.
  const { planeHalf } = projectionOf(fb.width, fb.height, surface.cellAspect, FOV_Y, horizonShift)
  locked =
    COARSE.matches && !mapOpen && !isDead(carrier) && !goal.reached
      ? aimAt(level, player, EYE_HEIGHT, actors, Math.atan(planeHalf))
      : null

  // The map replaces the view rather than floating over it, which is what the
  // original does and what this resolution can afford. Nothing new is seen
  // while it is up, because seeing is a side effect of drawing the world.
  if (!mapOpen && !titleUp) renderView(fb, level, view, surface.cellAspect, { horizonShift, seen })

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
  if (!mapOpen && !titleUp) drawBillboards(fb, view, surface.cellAspect, visible, { horizonShift })

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
    // On the thing that will be hit, when something has been picked, and in the
    // middle otherwise. Put in the middle regardless, the mark would be telling
    // a phone player the one thing that is not true of their next shot.
    const bearing = locked === null ? centre : columnOfCamX(Math.tan(normalizeAngle(locked.angle - player.angle)), planeHalf, fb.width)
    const column = Math.max(0, Math.min(fb.width - 1, Math.round(bearing)))
    drawText(fb, column, middle, flash > 0 ? '*' : '+', {
      color:
        flash > 0
          ? vec3(1, 0.95, 0.6)
          : locked === null
            ? vec3(0.55, 0.55, 0.6)
            : // Brighter when it has hold of something, because a mark that
              // moves without saying why reads as a fault.
              vec3(1.15, 0.7, 0.4),
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
      creatures: actors.filter(isCreature).length,
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

  /*
   * The bar the original has, where there is room for it, and the single line
   * otherwise.
   *
   * Built out of characters rather than converted from `STBAR`: that lump is
   * thirty-two rows of metal texture with every number composited onto it at
   * runtime, and averaged down to what fits here it is a stripe of `=` with
   * nothing legible on it. What is taken is the arrangement -- health, then
   * ammunition, then keys, then where you are -- which is the part you
   * recognise and the part a character grid can draw.
   */
  const bar = layoutBar(fb.width, fb.height, [
    { label: 'HEALTH', value: `${carrier.health}%`, priority: 4 },
    { label: weapon.name.toUpperCase(), value: `${carrier.ammo[weaponIndex]}`, priority: 3 },
    { label: 'KEYS', value: keys === '' ? '--' : keys, priority: 2 },
    { label: 'AREA', value: state.def.name, priority: 1 },
  ])
  if (bar !== null) {
    // Wiped first. The original's bar is an opaque panel; this one was drawn
    // straight over the world and came out as HEALTH and 93 tangled in a wall
    // of per-cent signs -- legible in a screenshot only if you already knew
    // what it said. Three rows of nothing, then the bar on top of that.
    for (let r = 0; r < BAR_ROWS; r++) {
      const row = bar.top + r
      if (row < 0 || row >= fb.height) continue
      for (let c = 0; c < fb.width; c++) {
        const index = row * fb.width + c
        fb.chars[index] = 32
        fb.color[index * 3] = 0
        fb.color[index * 3 + 1] = 0
        fb.color[index * 3 + 2] = 0
      }
    }
    const rule = '='.repeat(fb.width)
    drawText(fb, 0, bar.top, rule, { color: vec3(0.32, 0.3, 0.34) })
    for (const panel of bar.panels) {
      const middleOf = centreOf(panel)
      drawText(fb, middleOf, bar.top + 1, panel.label, { color: vec3(0.5, 0.48, 0.44), align: 'center' })
      drawText(fb, middleOf, bar.top + 2, panel.value, {
        color:
          panel.label === 'HEALTH'
            ? carrier.health > 40
              ? vec3(1.1, 0.95, 0.5)
              : vec3(1.2, 0.4, 0.35)
            : panel.label === 'KEYS' && keys !== ''
              ? vec3(1.2, 0.95, 0.45)
              : vec3(0.9, 0.86, 0.72),
        align: 'center',
      })
      // A rule between panels, which is what makes it a bar rather than four
      // labels in a row.
      if (panel.col > 0) {
        for (let r = 1; r < BAR_ROWS; r++) drawText(fb, panel.col, bar.top + r, '|', { color: vec3(0.3, 0.29, 0.33) })
      }
    }
  }

  const line = bar !== null ? [] : layoutHud(fb.width, [
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

  if (titleUp) {
    /*
     * Over the top of everything, on a wiped grid.
     *
     * Not an early return, which is how this was written first: the probe is
     * filled at the foot of this function and a return above it stopped the
     * page reporting anything at all. Twelve checks that read the level on boot
     * went with it, and they were right to -- the second copy of the probe I
     * put in the branch was a second version of the truth, and it disagreed
     * with the first within a day.
     *
     * The world is skipped rather than drawn and covered, so the automap does
     * not learn the first room before anybody has been in it. What is wiped
     * here is the handful of overlays that run either way.
     */
    for (let i = 0; i < fb.chars.length; i++) {
      fb.chars[i] = 32
      fb.color[i * 3] = 0
      fb.color[i * 3 + 1] = 0
      fb.color[i * 3 + 2] = 0
    }
    // The logo is the one piece of Freedoom's interface that survives becoming
    // characters: the title painting and the status bar are a fog of colons at
    // any size that fits, which is why neither is here.
    //
    // Squeezed to the grid rather than drawn at the size it was baked: at 94
    // characters across it does not fit a phone held upright, and centring it
    // there cut the first stroke of the D and the last of the M off the edges.
    const logo = squeezed(LOGO, fb.width)
    const left = Math.floor((fb.width - logo.rows[0]!.length) / 2)
    const topOf = Math.max(0, Math.floor((fb.height - logo.rows.length) / 2) - 2)
    drawSprite(fb, logo, left, topOf)
    for (const line of menuLayout(fb.width, fb.height, menu, topOf + logo.rows.length + 2)) {
      drawText(fb, line.col, line.row, line.text, {
        color: line.under ? vec3(1.15, 0.9, 0.5) : vec3(0.6, 0.58, 0.54),
      })
    }
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
    awake: actors.filter((actor) => actor.awake && isCreature(actor)).length,
    alive: actors.filter((actor) => isAlive(actor) && isCreature(actor)).length,
    weapon: weapon.name,
    ammo: carrier.ammo[weaponIndex],
    shotsFired,
    pelletsLanded,
    kills,
    /**
     * How many noises have been asked for, and whether they are wanted.
     *
     * A noise leaves no mark on the screen, so this is the only way a check can
     * say one happened. Counted where the game asks rather than inside the
     * speaker, because what is being checked is that the game asks -- whether
     * Web Audio then makes a sound is Web Audio's business.
     */
    noisesPlayed,
    audible,
    keys: [...carrier.keys],
    pickupsLeft: pickups.filter((pickup) => !pickup.taken).length,
    inFlight: projectiles.length,
    complete: goal.reached,
    mapOpen,
    hurt: hurtOf(level, player.sector),
    seen: seen.size,
    lines: level.lines.length,
    dead: isDead(carrier),
    deadFor,
    // Reported rather than written down twice: a check that hardcodes the delay
    // is a check that disagrees with the game the moment the delay changes.
    reviveDelay: REVIVE_DELAY,
    elapsed: goal.elapsed,
    doorState: state.movers[0]?.state ?? null,
    /**
     * How many things the opened file supplied pictures for, or zero.
     *
     * Reported rather than worked out from the screen: a check that counted
     * colours could tell baked art from a single tint, and cannot tell baked
     * art from a file's art, because both are a colour a cell.
     */
    fromFile: state.fromFile,
    titleUp,
    statusBar: bar === null ? 0 : bar.panels.length,
    /**
     * What the first creature in the level is actually drawn with.
     *
     * Its shape, not the screen's. Counting colours on screen was tried and
     * cannot answer this: at the distance a creature stands in the outpost, the
     * walls carry most of the colours and a creature painted in one flat tint
     * measured *more* of them than the real art did. So this reports the art
     * itself and says plainly that it is doing so.
     */
    creatureArt: ((): { rows: number; cells: number; colours: number } | null => {
      const drawnAs = actors[0]?.kind.sprite
      if (drawnAs === undefined) return null
      const seen = new Set<string>()
      let cells = 0
      for (const row of drawnAs.colors ?? []) {
        for (const hue of row) {
          if (hue[0] === 0 && hue[1] === 0 && hue[2] === 0) continue
          cells++
          seen.add(hue.map((value) => Math.round(value * 100)).join(','))
        }
      }
      return { rows: drawnAs.rows.length, cells, colours: seen.size }
    })(),
    /** Which creature the aiming help has hold of, or -1 for none and for a keyboard. */
    aimed: locked?.index ?? -1,
    aimDistance: locked?.distance ?? null,
    liftHeight:
      state.liftSectors[0] === undefined ? null : (level.sectors[state.liftSectors[0]]?.floor ?? null),
    // The first platform a marked wall can call, for a map from a file. Not the
    // line above: those are this game's own lifts, which are called by being
    // stood on and are not in `liftLines` at all.
    liftFloor: ((): number | null => {
      const platform = [...state.liftLines.values()][0]?.[0]
      return platform === undefined ? null : (level.sectors[platform.sector]?.floor ?? null)
    })(),
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
  // Over the edges rather than the outline, because a sector built from a file
  // has edges and no outline, and the average of the corners is the same number
  // either way for a closed ring.
  for (const [ax, ay] of sector.edges) {
    sx += ax
    sy += ay
  }
  const middle = { x: sx / sector.edges.length, y: sy / sector.edges.length }
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

/** Puts the body inside a sector by index, and says whether it could. */
function putIn(index: number): boolean {
  const sector = state.level.sectors[index]
  if (!sector) return false
  const spot = somewhereInside(sector)
  if (!spot) return false
  state.player.x = spot.x
  state.player.y = spot.y
  state.player.sector = index
  state.player.floor = sector.floor
  return true
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
      return putIn(state.goal.exitSector)
    },
    /** Stand in the sector carrying this tag, for checks about the ground. */
    toTag(tag: string): boolean {
      return putIn(state.level.sectors.findIndex((sector) => sector.tag === tag))
    },
    /**
     * Open a map from bytes, the way a file would.
     *
     * Takes a plain array rather than a `Uint8Array`: what crosses into a page
     * from a browser check is serialised, and a typed array does not survive
     * that intact.
     */
    loadWad(bytes: number[], mapName: string): boolean {
      try {
        enterWad(Uint8Array.from(bytes), mapName)
        return true
      } catch (error) {
        say((error as Error).message)
        return false
      }
    },
  }
}

/*
 * Installed, and playable with the network off.
 *
 * Only from a built bundle. The test is this module's own URL: the dev server
 * hands it over as `main.ts` and a build gives it a hashed `.js`, which is
 * exactly the question being asked — a service worker answering the dev
 * server's requests out of a cache is how you spend an afternoon editing a
 * file that never reloads.
 *
 * Note what this is not: "am I on localhost". The browser checks serve the
 * built page from 127.0.0.1, so a host test would switch the worker off in the
 * one place anything looks at it.
 */
/*
 * Nothing is kept between launches.
 *
 * This used to install a service worker that precached the shell and every
 * hashed asset, so one visit was enough to play with the network off. That is
 * gone on purpose: the report was that an installed copy kept showing an old
 * build, and a cache nobody can inspect from the outside is a bad place to be
 * wrong. Simulated here -- build A installed, the server swapped to build B,
 * reloaded -- Chromium picked up B immediately, so the worker was not the
 * culprit anywhere this machine can see. The one place it might have been is
 * iOS in standalone, which cannot run here at all.
 *
 * So rather than guess at a cache that cannot be observed, there is no cache.
 * Every launch fetches the page. What that costs is the offline play the README
 * used to promise, and the README says so now.
 *
 * Both of these clean up after the worker that used to be here, for copies
 * already installed on somebody's home screen. There is no reload: the page has
 * just been fetched, and reloading after clearing a cache the worker then
 * refills is how you write a loop.
 */
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker
    .getRegistrations()
    .then((workers) => Promise.all(workers.map((worker) => worker.unregister())))
    .catch(() => {
      // An old worker that will not go is a game that still runs, online.
    })
}
if ('caches' in globalThis) {
  void caches
    .keys()
    .then((names) => Promise.all(names.map((name) => caches.delete(name))))
    .catch(() => {})
}

/**
 * Opening a map from a file, which is the only way a person can.
 *
 * The first map in the file, because choosing between them wants a menu and
 * this wants to work. Failures are said on screen rather than thrown: handing
 * the game the wrong file is an ordinary thing to do, and the game carrying on
 * with the level it already had is the right answer to it.
 */
wadInput?.addEventListener('change', () => {
  const file = wadInput.files?.[0]
  if (!file) return
  void file
    .arrayBuffer()
    .then((buffer) => {
      const bytes = new Uint8Array(buffer)
      const names = mapNames(bytes)
      if (names.length === 0) throw new Error('that file has no maps in it')

      /*
       * The file's maps, offered rather than assumed.
       *
       * It used to open the first one and stop. A file holds thirty-six, so
       * thirty-five of them had no way of being reached -- the same shape of
       * fault as the picker that was hidden on a phone: everything worked and
       * most of it could not be got at.
       */
      opened = bytes
      titleUp = true
      menu = openMenu(names.map((name) => ({ label: name, action: { kind: 'map', name } })))
      say(`${names.length} maps — pick one`)
    })
    .catch((error: unknown) => say((error as Error).message))
})

keys.textContent = 'W A S D move · ← → turn · ↑ ↓ look · Shift run · Space fire · 1 2 3 weapon · E use'
requestAnimationFrame(frame)
