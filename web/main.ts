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
import { bite, hurtOf, makeHazard, type Hazard } from '../src/game/hazard.ts'
import { insideSector, lineInFront, sectorAt, type Line, type Sector } from '../src/columns/level.ts'
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
import {
  ARC_RIFLE_FIRING,
  ARC_RIFLE_HELD,
  AUTOGUN_FIRING,
  AUTOGUN_HELD,
  CANNON_FIRING,
  CANNON_HELD,
  CHAINSAW_FIRING,
  CHAINSAW_HELD,
  FISTS_FIRING,
  FISTS_HELD,
  LAUNCHER_FIRING,
  LAUNCHER_HELD,
  LOGO,
  SCATTERGUN_FIRING,
  SCATTERGUN_HELD,
  SIDEARM_FIRING,
  SIDEARM_HELD,
  TROOPER,
  TWINBORE_FIRING,
  TWINBORE_HELD,
} from '../src/game/freedoomart.ts'
import { BAR_ROWS, centreOf, layoutBar } from '../src/game/statusbar.ts'
import { chosen, menuLayout, moveCursor, openMenu, type Menu } from '../src/game/menu.ts'
import { fits, restore, snapshot, SAVE_VERSION, type Save } from '../src/game/save.ts'
import { effectOf, fresh as noLetters, typeLetter, type Cheat } from '../src/game/cheats.ts'
import { intentAt, record, remember, sealed, seeded, type Demo, type Tape } from '../src/game/demo.ts'
import {
  forget,
  hear,
  hostFirst,
  intentsAt,
  lockstep,
  ready as tickReady,
  speak,
  type Lockstep,
} from '../src/game/netplay.ts'
import { IDLE, keyboardIntent, mergeIntents, touchIntent, type Intent, type TouchState } from '../src/game/input.ts'
import { loadLevel, type LevelState } from '../src/game/levels.ts'
import { mapNames } from '../src/columns/wad.ts'
import { wadLevelState, type Skill } from '../src/game/wadlevel.ts'
import { aimAt, type AimTarget } from '../src/game/autoaim.ts'
import { activate, moverInFront, updateMovers, type Mover } from '../src/game/movers.ts'
import { capacityOf, collect, heldOf, takeDamage, type Carrier } from '../src/game/pickups.ts'
import { AMMO_KINDS, indexOfAmmo } from '../src/game/ammo.ts'
import { supplyFor } from '../src/game/waditems.ts'
import {
  BLUR_WOBBLE,
  SIGHT_FLOOR,
  holds,
  leftOn,
  tickPowers,
  type Power,
} from '../src/game/powers.ts'
import { blast, sweep, updateProjectiles, type Projectile } from '../src/game/projectiles.ts'
import { EYE_HEIGHT, PLAYER_HEIGHT, PLAYER_RADIUS, eyeHeight, moveBody, type Body } from '../src/game/player.ts'
import { SLOTS, WEAPONS, asSwung, fire, weaponInSlot } from '../src/game/weapons.ts'

const screen = document.getElementById('screen')!
// Declared here rather than beside its listener: the menu opens it too, and a
// `const` reached before its declaration is a mistake this project has made.
const wadInput = document.getElementById('wad') as HTMLInputElement | null
const keys = document.getElementById('keys')!
/*
 * The panel two people meet through, held here rather than beside the code
 * that uses it. That code runs inside the frame loop, and this file has three
 * times had a `const` read before its declaration and spent a while reading
 * the `undefined` as a result.
 */
const meetPanel = document.getElementById('meet')
const meetMine = document.getElementById('meetmine') as HTMLTextAreaElement | null
const meetTheirs = document.getElementById('meettheirs') as HTMLTextAreaElement | null
const meetSaid = document.getElementById('meetsaid')
/** Which of the maps that ship the two of you meet on. */
const meetMap = document.getElementById('meetmap') as HTMLSelectElement | null
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
 * Hidden rooms walked into so far, by sector.
 *
 * A set rather than a count, because walking back out and in again is not a
 * second discovery -- and cleared in `enterLevel` with everything else of this
 * shape, which is the lesson the kill counters taught.
 */
let foundSecrets = new Set<number>()
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
 * Lines whose light change has already been applied.
 *
 * Once each, because the brightness each one sets was measured against the map as
 * built: firing the same line again is harmless, but firing an "as bright as next
 * door" line after next door has changed would read the wrong room. Emptied with
 * the level, beside the teleports that only work once.
 */
let litLines = new Set<Line>()
/**
 * The teleport lines of the level being played, as a list.
 *
 * Kept rather than derived each tick because the creatures are checked against it
 * every tick: a hundred and fifty of them, each against every pad line, is the
 * one place in this loop where building the list would cost more than the test.
 */
let padLines: Line[] = []
/** Where each creature stood before this tick, so a crossing can be asked about. */
const wasAt: { x: number; y: number }[] = []
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
 * Where a run is kept between visits.
 *
 * One key holding one save. Slots would need a screen to choose between them
 * and this game's only screen is its title; a game of two levels that saves
 * whenever you enter or finish one does not need them either.
 *
 * Every read and write is wrapped, because storage is not always there --
 * private windows refuse it, and a browser out of quota throws on write rather
 * than returning false. A save that cannot be written is a run that behaves
 * exactly as it did before saving existed, which is a fine way to fail.
 */
const SAVE_KEY = 'ascii-doom/save'

function readSave(): Save | null {
  try {
    const text = window.localStorage.getItem(SAVE_KEY)
    if (text === null) return null
    const parsed = JSON.parse(text) as Save
    return parsed.version === SAVE_VERSION ? parsed : null
  } catch {
    return null
  }
}

function writeSave(save: Save): void {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(save))
  } catch {
    // Nothing to be done and nothing worth saying: the game carries on.
  }
}

function forgetSave(): void {
  try {
    window.localStorage.removeItem(SAVE_KEY)
  } catch {
    // As above.
  }
}

/**
 * Writes the run down, unless there is no run to write.
 *
 * A map opened from a file is skipped rather than saved badly. Putting one
 * back means holding its file, and these run to twenty-eight megabytes.
 */
function keepRun(): void {
  if (wadSource !== null || levelIndex < 0) return
  writeSave(snapshot(levelIndex, state, carrier, { seen, secrets: foundSecrets, kills, shotsFired }))
}

/**
 * Seconds of play between saves, and how long it has been.
 *
 * Five is short enough that nobody loses a fight's worth of progress and long
 * enough that the string is written a dozen times a minute rather than sixty
 * times a second.
 */
const SAVE_EVERY = 5
let sinceSaved = 0

/*
 * The maps that ship, listed once and fetched one at a time.
 *
 * Sixty-eight small WADs sit beside the page rather than inside it: all of
 * them together are thirty times the game, and any one of them is a fraction
 * of it. So the list arrives at startup -- a few hundred bytes -- and a map is
 * only fetched when somebody picks it.
 *
 * Addressed from the document rather than from a path written out, because
 * Pages serves this from a subdirectory and a URL that works locally and 404s
 * there is the oldest mistake in this repository. `document.baseURI` is the
 * page's own address, which is right under any prefix and needs nothing from
 * the build to be true.
 */
interface Shipped {
  readonly name: string
  readonly file: string
  readonly bytes: number
}
let shipped: readonly Shipped[] = []

void fetch(new URL('maps/maps.json', document.baseURI))
  .then((answer) => (answer.ok ? (answer.json() as Promise<Shipped[]>) : []))
  .then((listed) => {
    shipped = listed
    // The title may already be up and built, and it was built without these.
    if (titleUp) menu = titleMenu(menu.cursor)
    // And the arena chooser, which has nothing to offer until now.
    if (meetMap !== null) {
      meetMap.replaceChildren(
        ...listed.map((one) => {
          const choice = document.createElement('option')
          choice.value = one.name
          choice.textContent = one.name
          return choice
        }),
      )
    }
  })
  .catch(() => {
    // A list that will not load leaves the game exactly as it was before the
    // maps shipped, which is a playable game. Nothing is said: nobody asked
    // for them yet.
  })

/** The save on offer at the title, read once rather than on every frame. */
let offered: Save | null = readSave()

/*
 * The last recorded run, kept here rather than with the rest of the demo state.
 *
 * The title offers to play it back and greys the line when there is none, so
 * `titleMenu` reads this -- and `titleMenu` is called while the module is
 * still being evaluated. Declared below its reader, it was a `const` in its
 * dead zone and the page did not boot at all: "cannot access it before
 * initialization", the fourth time this file has taught that lesson.
 */
let kept: Demo | null = null
/*
 * Which level the recording in progress belongs to.
 *
 * Kept apart from `levelIndex`, which is where you are rather than where the
 * run started. The two part company exactly when a recording is sealed by
 * leaving for somewhere else: `enterWad` sets the index to -1 before it enters,
 * so a demo recorded in the outpost and ended by opening a file would have been
 * sealed as level -1 -- and playing it back asks the campaign for level -1,
 * which it refuses.
 */
let tapingLevel = 0

/**
 * The title's own menu, rebuilt when the difficulty changes.
 *
 * Rebuilt rather than mutated because the label carries the setting -- there is
 * no room on this screen for a row of three -- and a label is part of the item.
 */
function titleMenu(cursor?: number): Menu {
  const built = openMenu([
    // First, and disabled rather than hidden when there is nothing to continue:
    // a menu that changes length under the cursor is one you cannot learn.
    { label: 'continue', action: { kind: 'continue' }, enabled: offered !== null },
    { label: 'begin', action: { kind: 'begin' } },
    { label: 'the outpost', action: { kind: 'level', index: 0 } },
    { label: 'the cistern', action: { kind: 'level', index: 1 } },
    // One line rather than sixty-eight, and disabled until the list arrives.
    { label: 'the maps that ship', action: { kind: 'shipped' }, enabled: shipped.length > 0 },
    // Needs the maps for the same reason: both sides play one that ships.
    { label: 'play somebody', action: { kind: 'meet' }, enabled: shipped.length > 0 },
    /*
     * Demos, on the title because a phone has no keyboard.
     *
     * The words that start them can only be typed, and everything else the
     * typed words do is a cheat -- which the original also made you type, and
     * which a phone can do without. A recording is a feature, and one reachable
     * only at a desk is one most people do not have.
     */

    /*
     * Demos, on the title because a phone has no keyboard.
     *
     * The words that start them can only be typed, and everything else the
     * typed words do is a cheat -- which the original also made you type, and
     * which a phone can do without. A recording is a feature, and one reachable
     * only at a desk is one most people do not have.
     */

    { label: 'record a run', action: { kind: 'record' } },
    { label: 'play it back', action: { kind: 'replay' }, enabled: kept !== null },
    { label: `difficulty: ${skill}`, action: { kind: 'skill' } },
    { label: `sound: ${audible ? 'on' : 'off'}`, action: { kind: 'sound' } },
  ])
  /*
   * The cursor is kept only when somebody asks for it.
   *
   * `openMenu` puts it on the first item that can be chosen, and spreading a
   * default of zero over that put it straight back on the first item whether
   * or not it was choosable. That was harmless for as long as the first line
   * was always "begin"; the moment a disabled "continue" went above it, a
   * fresh visit opened on a dead line and one press of fire did nothing at
   * all -- the title simply would not go away.
   *
   * The two callers that do pass one are the sound and difficulty lines, which
   * rebuild the menu under the player's hand and must not move it.
   */
  return cursor === undefined ? built : { ...built, cursor }
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
function enterLevel(
  next: LevelState,
  /**
   * Whether to write the run down on the way in.
   *
   * True for every ordinary entry, and false for the one that is about to lay
   * a save over the level it just built. Saving there would write the empty
   * level -- full health, nothing found -- over the save being restored, so
   * continuing twice in a row started you over the second time. The screen was
   * right and the storage was wrong, which is the shape of fault that survives
   * a look.
   */
  keep = true,
): void {
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
  litLines = new Set<Line>()
  padLines = []
  foundSecrets = new Set<number>()
  advanceIn = 0
  deadFor = 0
  seen = new Set<Line>()
  mapOpen = false
  hazard = makeHazard()
  say(state.def.name)
  /*
   * And write the run down, which is every point worth saving.
   *
   * Entering a level is the only moment a campaign run changes shape: it is
   * where finishing one lands, where dying and restarting lands, and where
   * choosing a level from the title lands. Saving here rather than on a timer
   * means a save is always a level boundary, which is also the only place the
   * counts a save depends on are known to match the level.
   */
  /*
   * A recording ends with the level it was made in.
   *
   * It used to end by typing the word a second time, which a phone cannot do,
   * and this is the better rule anyway: a demo is a run, and a run is over
   * when the level is -- whether it was finished, restarted after dying, or
   * left for another one. Sealed before the menu is rebuilt below, so the
   * title comes back offering to play it.
   *
   * Before `taping` is set again by whoever is starting a fresh recording:
   * `applyCheat` starts the level first and takes the tape afterwards, so this
   * seals the previous run rather than the one just asked for.
   */
  if (taping !== null) {
    kept = sealed(taping, tapingLevel)
    taping = null
  }

  if (keep) {
    keepRun()
    // And the title's list is rebuilt, because the offer it was built from has
    // just changed. Reading the save without rebuilding left a first visit
    // showing yesterday's answer for the rest of the session.
    offered = readSave()
    menu = titleMenu()
  }
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

/*
 * And when the page is put away, because a level boundary can be half an hour
 * of play away.
 *
 * `visibilitychange` rather than `beforeunload`: a phone closing a tab often
 * never fires the latter, and hiding is the event that actually happens when
 * somebody switches away. Writing on every hide costs one small string and
 * means the worst a crash takes is the walk since you last looked elsewhere.
 */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && !titleUp) keepRun()
})

/*
 * What has been typed lately, and what the words have switched on.
 *
 * Both survive a level, the way the original's do: a cheat is a decision about
 * this run rather than about this room. Neither is saved -- a save is what the
 * level is, and being invulnerable is not something the level knows.
 */
let typed = noLetters()
let godly = false
let ghostly = false

/*
 * Recording and playing back.
 *
 * `rolls` is what every roll in the rules goes through, and it is reseeded
 * whenever a recording starts so that the run being written down is the run a
 * replay will reproduce. Outside a demo it is seeded from the clock, which is
 * as random as this game needs and keeps one code path rather than two.
 *
 * `tick` counts steps rather than frames: a frame can take several steps or
 * none, and a demo is indexed by the thing the rules actually advance on.
 */
/*
 * The other player, when there is one.
 *
 * A body like any other -- the same cylinder the player and every creature are
 * -- carrying the angle it faces so it can be drawn looking somewhere. Not a
 * creature: nothing shoots at it yet, because being shootable means being in
 * the list a shot is traced against and that list is creatures. Putting a
 * player in it would have every count in the game call them a monster.
 */
let mate: (Body & { angle: number }) | null = null
/*
 * Where the other side's input arrives, and whether the game is keeping step.
 *
 * Two things rather than one, and that was a deadlock. The mailbox used to be
 * the switch: input was only recorded while `net` existed, and `net` was made
 * at the end of joining -- after fetching the map. The host finishes joining
 * first and starts speaking immediately, so everything it said while the other
 * side was still fetching went in the bin, and the lead meant the guest needed
 * exactly those first packets. It stopped dead on tick three; the host ran on
 * the guest's opening packets to tick seven and stopped too. Frames kept being
 * drawn, so nothing looked broken.
 *
 * The mailbox is now made when the channel opens -- before anything can be
 * said -- and `inDuel` is what the frame loop asks about.
 */
let net: Lockstep | null = null
let inDuel = false
let wire: RTCPeerConnection | null = null
let channel: RTCDataChannel | null = null
/** The last tick this side put its own asking on the wire for. */
let spokenFor = -1
/** Which of the two this side is, which decides where each of you stands. */
let hosting = false
/*
 * Everything the other player owns, kept on this side as well as on theirs.
 *
 * Not a copy of what they tell us -- nothing tells us. Both sides run both
 * players through the same rules from the same input and the same seed, so
 * this side works out their ammunition, their wounds and their death for
 * itself and arrives at the same answers. That is what lockstep buys, and it
 * is why nothing about damage goes over the wire.
 */
let mateCarrier: Carrier = freshCarrier()
let mateWeapon = 0
let mateCooldown = 0
let mateHazard: Hazard = makeHazard()
let mateDeadFor = 0
/** Where each of the two goes back to, which the map decided when you joined. */
let myStart = { x: 0, y: 0, angle: 0, sector: 0 }
let theirStart = { x: 0, y: 0, angle: 0, sector: 0 }
/** What the loop decided this tick runs with, for `step` to pick up. */
let runMine: Intent | null = null
let runTheirs: Intent | null = null
/**
 * How many ticks ahead input is addressed.
 *
 * The same at both ends or the two games are not the same game. Three at a
 * sixtieth is fifty milliseconds of lead, which absorbs a connection between
 * two people in one country and is short enough that nobody feels it.
 */
const LEAD = 3

let rolls = seeded(Date.now() >>> 0)
let taping: Tape | null = null
let playing: Demo | null = null
let tick = 0

const held = new Set<string>()
const down = (event: KeyboardEvent) => {
  // Arrows and space scroll the page otherwise, which fights the game for the
  // same keys.
  // Tab would otherwise walk the focus ring out of the game.
  if (event.key.startsWith('Arrow') || event.key === ' ' || event.key === 'Tab') event.preventDefault()
  held.add(event.key.length === 1 ? event.key.toLowerCase() : event.key)
  // Typed rather than bound: the letters go into the buffer whatever else they
  // are doing, and a word takes effect on its last one. Not while the title is
  // up, where the same letters are walking a cursor.
  if (!titleUp) {
    typed = typeLetter(typed, event.key)
    const asked = effectOf(typed)
    if (asked !== null) applyCheat(asked)
  }
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
// One button cycling forward, because five weapon buttons would cost more of
// a small screen than they are worth.
button(
  'swap',
  () => {
    touch.weapon = nextHeld(weaponIndex)
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
/**
 * What a finished word does, which is the only place the page decides anything.
 *
 * Each is a switch rather than a gift where it can be: the original's god and
 * noclip are toggles, and a player who typed one by accident wants the way
 * back. The two that hand things over -- the kit and the chart -- cannot be
 * toggled, because there is no taking a key back off somebody.
 */
function applyCheat(asked: Cheat): void {
  typed = noLetters()
  if (asked === 'god') {
    godly = !godly
    say(`nothing can hurt you: ${godly ? 'on' : 'off'}`)
  } else if (asked === 'ghost') {
    ghostly = !ghostly
    say(`walls do not stop you: ${ghostly ? 'on' : 'off'}`)
  } else if (asked === 'kit') {
    carrier.health = carrier.maxHealth
    carrier.armour = 200
    carrier.armourShare = 1 / 2
    // The pack first, so "full" means the ceiling the pack raises rather than
    // the one it replaces -- the original's version of this word hands you
    // backpack-sized reserves and this is what that amounts to here.
    carrier.pack = true
    for (const kind of AMMO_KINDS) carrier.ammo[indexOfAmmo(kind)] = capacityOf(carrier, kind)
    for (let i = 0; i < WEAPONS.length; i++) carrier.weapons.add(i)
    for (const colour of ['cobalt', 'crimson', 'amber']) carrier.keys.add(colour)
    say('every key and a full kit')
  } else if (asked === 'record') {
    if (taping === null) {
      /*
       * From the top of the level, which is not a nicety.
       *
       * A replay starts the level fresh -- it has to, since it has only the
       * input and not the room -- so a recording that began wherever somebody
       * happened to be standing could never be reproduced. Typing the word
       * itself proves the point: "idrec" contains a "d", which strafes, so the
       * body has already moved by the time the word lands.
       *
       * A map opened from a file is refused rather than recorded badly: it has
       * no campaign index to start again from, and the file it came out of is
       * not something a demo can carry.
       */
      if (wadSource !== null || levelIndex < 0) {
        say('a map from a file cannot be recorded')
        noise('switch')
        return
      }
      const seed = Date.now() >>> 0
      rolls = seeded(seed)
      startLevel(levelIndex)
      taping = record(seed)
      tapingLevel = levelIndex
      tick = 0
      say('recording')
    } else {
      kept = sealed(taping, tapingLevel)
      taping = null
      say(`recorded ${kept.ticks} ticks`)
    }
  } else if (asked === 'replay') {
    if (kept === null) {
      say('nothing recorded to play back')
    } else {
      // From the top of the level it was recorded in, or the run would be
      // played into a room that has already been walked through.
      playing = kept
      taping = null
      rolls = seeded(kept.seed)
      tick = 0
      startLevel(kept.levelIndex)
      say('playing back')
    }
  } else {
    // The whole map at once, which is the set the renderer fills in as you go.
    for (const line of state.level.lines) seen.add(line)
    say('the whole map')
  }
  noise('switch')
}

/**
 * What each weapon sounds like, by the position the weapon list gives it.
 *
 * A table because the chain of conditionals it replaced ended in "or else the
 * launcher", which meant the two free weapons both went off with a rocket's
 * report the moment they existed.
 */
/**
 * What a ceiling coming down costs, per second under it.
 *
 * Enough to kill an unarmoured player in about three seconds, which is long
 * enough to get out from under and short enough that standing there is not a
 * plan. Per second rather than per blow because the ceiling is reported on every
 * tick it has you, and a per-blow figure would depend on the frame rate.
 */
const CRUSH_DAMAGE = 34

/**
 * Turns a light line on, once.
 *
 * Once because the brightness each one sets was measured against the map as
 * built: firing the same line again is harmless, but an "as bright as next door"
 * line fired after next door has changed would read the wrong room.
 */
function applyLight(line: Line): void {
  const change = state.lightLines.get(line)
  if (change === undefined || litLines.has(line)) return
  litLines.add(line)
  for (let at = 0; at < change.sectors.length; at++) {
    const room = state.level.sectors[change.sectors[at]!]
    if (room !== undefined) room.light = change.to[at]!
  }
  noise('switch')
}

const SHOT_NOISE: readonly Noise[] = [
  'sidearm',
  'scattergun',
  'launcher',
  'fists',
  'chainsaw',
  'twinbore',
  'autogun',
  'arc',
  'cannon',
]

/**
 * What each powerup says on the way in and on the way out.
 *
 * Words rather than the name of the effect, because "shield" is what the code
 * calls it and "nothing can touch you" is what it does. The ones that never run
 * out have no ending line and never ask for one -- `tickPowers` cannot return
 * them -- so the table is complete rather than partial on purpose: a `Record`
 * over the union is the thing that would fail to compile if a seventh powerup
 * arrived and nobody wrote its line.
 */
const POWER_SAID: Readonly<Record<Power, string>> = {
  shield: 'nothing can touch you',
  rage: 'your hands are heavy',
  blur: 'hard to see',
  suit: 'the floor cannot burn you',
  chart: 'the whole map',
  sight: 'you can see in the dark',
}

const POWER_ENDED: Readonly<Record<Power, string>> = {
  shield: 'the shield is gone',
  rage: 'the rage is gone',
  blur: 'you can be seen again',
  suit: 'the suit is gone',
  chart: 'the map is gone',
  sight: 'the dark is back',
}

/**
 * The two letters a running powerup shows in the status line, shortest clock
 * first.
 *
 * Six of them could take the whole line, so what is shown is the one about to
 * run out -- which is the one you would want to know about -- and a count of the
 * others. The two that never run out sort last for the same reason.
 */
function powerLine(powers: readonly number[]): string {
  const running = (['shield', 'blur', 'suit', 'sight', 'rage', 'chart'] as const)
    .filter((power) => holds(powers, power))
    .sort((a, b) => leftOn(powers, a) - leftOn(powers, b))
  const first = running[0]
  if (first === undefined) return ''
  const left = leftOn(powers, first)
  const clock = Number.isFinite(left) ? ` ${Math.ceil(left)}` : ''
  const rest = running.length > 1 ? ` +${running.length - 1}` : ''
  return `${POWER_SHORT[first]}${clock}${rest}`
}

/** Four letters each, which is what fits beside the health and the ammunition. */
const POWER_SHORT: Readonly<Record<Power, string>> = {
  shield: 'shld',
  rage: 'rage',
  blur: 'blur',
  suit: 'suit',
  chart: 'map',
  sight: 'eyes',
}

/**
 * The next weapon round from this one that is actually in hand.
 *
 * Only reachable weapons, or the one button on a phone would stop on the saw
 * nobody has found yet and firing would do nothing. Falls back to where it
 * started, which is what happens if somehow nothing is held: cycling then does
 * nothing rather than selecting a weapon that does not exist.
 */
function nextHeld(from: number): number {
  for (let step = 1; step <= WEAPONS.length; step++) {
    const at = (from + step) % WEAPONS.length
    if (carrier.weapons.has(at)) return at
  }
  return from
}

/**
 * Mean brightness of the world pass, sampled before anything is drawn over it.
 *
 * Kept outside the frame so the hook at the foot of it can report a number taken
 * halfway through.
 */
let worldBright = 0

/** Mean of the colour channels over the cells this frame drew on. */
function meanBrightness(fb: Framebuffer): number {
  let sum = 0
  let cells = 0
  for (let i = 0; i < fb.depth.length; i++) {
    if (fb.depth[i]! <= 0) continue
    sum += (fb.color[i * 3]! + fb.color[i * 3 + 1]! + fb.color[i * 3 + 2]!) / 3
    cells++
  }
  return cells === 0 ? 0 : sum / cells
}

function hurtPlayer(amount: number): void {
  if (amount <= 0) return
  // Nothing can hurt you, and nothing needs to know that but this. The shield
  // hangs here with the cheat rather than beside each thing that hurts, which is
  // the same reason `takeDamage` exists: the fourth place something hurts you is
  // the one that would have forgotten.
  if (godly || holds(carrier.powers, 'shield')) return
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

/**
 * One player pulling the trigger, whichever of the two it is.
 *
 * One function rather than the same twenty lines twice, because what a shot
 * does is not a property of who fired it: pellets are traced, walls are worked,
 * creatures are hurt and whatever they leave behind goes off. What differs is
 * only whose ammunition it spends and who feels it, and those are arguments.
 *
 * Returns the cooldown rather than writing it, because the two sides keep
 * theirs in different places and handing this a setter would be a larger lie
 * than handing back a number.
 */
function pullTrigger(
  shooter: Body & { angle: number },
  kit: Carrier,
  weaponAt: number,
  cooling: number,
  foe: (Body & { angle: number }) | null,
  foeKit: Carrier | null,
  aim: number | undefined,
  own: boolean,
  wants: boolean,
): number {
  const { level, actors, player } = state
  const held = WEAPONS[weaponAt]
  if (held === undefined) return cooling
  // The reserve the weapon spends, which two of them share with another weapon
  // and two of them do not have at all.
  if (!wants || cooling > 0) return cooling
  if (held.ammo !== undefined && heldOf(kit, held.ammo) < held.cost) return cooling
  /*
   * What rage does, applied here rather than inside `fire`.
   *
   * `fire` takes a weapon and resolves it; which weapon is being swung is the
   * caller's question, and the caller is the only place that knows whose
   * carrier is holding the powerup. It is also the only arrangement where the
   * other player's rage lands on this machine too, because their carrier is
   * passed in as `kit`.
   */
  const weapon = asSwung(held, holds(kit.powers, 'rage'))
  if (weapon.ammo !== undefined) {
    kit.ammo[indexOfAmmo(weapon.ammo)] = heldOf(kit, weapon.ammo) - weapon.cost
  }
  if (own) {
    flash = 0.06
    shotsFired++
  }
  noise(SHOT_NOISE[weaponAt] ?? 'sidearm')

  // The other player goes in the second list, which is traced with the
  // creatures and counted as none of them.
  const result = fire(
    level,
    shooter,
    weapon,
    actors,
    EYE_HEIGHT,
    actors.length,
    rolls,
    aim,
    foe === null ? [] : [foe],
  )
  if (own) {
    pelletsLanded += result.hits
    // Only the ones that were creatures. `fire` reports every body it killed,
    // and a barrel is a body.
    kills += result.killed.filter((index) => {
      const dead = actors[index]
      return dead !== undefined && isCreature(dead)
    }).length
  }
  for (const shot of result.shots) projectiles.push(shot)

  // What the pellets landed on, which on thirteen maps is how a door opens.
  for (const wall of result.walls) {
    for (const machine of state.shotLines.get(wall) ?? []) {
      if (activate(machine, kit.keys)) noise('switch')
    }
  }

  // And the other player, if a pellet found them. Every pellet on its own,
  // which is what makes a scattergun at arm's length what it is.
  if (foeKit !== null) {
    for (const hit of result.struck) {
      if (foeKit === carrier) hurtPlayer(hit.damage)
      else takeDamage(foeKit, hit.damage)
    }
  }

  /*
   * And anything a pellet killed sets off whatever it leaves behind.
   *
   * Both players are in the list the blast is resolved against, so a barrel
   * burst next to the other one catches them too -- the same rule that has
   * always caught you.
   */
  for (const index of result.killed) {
    const dead = actors[index]
    const goes = dead?.kind.explodes
    if (dead === undefined || goes === undefined) continue
    const caughtIn = mate === null ? [...actors, player] : [...actors, player, mate]
    for (const caught of blast(
      level,
      dead.x,
      dead.y,
      dead.floor + dead.kind.height / 2,
      goes.radius,
      goes.damage,
      caughtIn,
    )) {
      if (caught.body === actors.length) hurtPlayer(caught.damage)
      else if (caught.body === actors.length + 1) takeDamage(mateCarrier, caught.damage)
      else hurtActor(caught.body, caught.damage, actors.length)
    }
  }
  return weapon.interval
}

/**
 * Puts one of the two back where they started, with the kit a run begins with.
 *
 * Dying in a duel does not rebuild the level the way dying alone does. The
 * other player is still standing in it, and a level rebuilt underneath them
 * would shut every door they had opened. So only the body moves, and only
 * their own kit is handed back.
 */
function putBack(
  body: Body & { angle: number },
  kit: Carrier,
  where: { x: number; y: number; angle: number; sector: number },
): void {
  refillCarrier(kit)
  body.x = where.x
  body.y = where.y
  body.angle = where.angle
  body.sector = where.sector
  body.floor = state.level.sectors[where.sector]?.floor ?? body.floor
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
      if (action?.kind === 'continue' && offered !== null) {
        const save = offered
        titleUp = false
        // The level is built first and the save laid over it, which is the
        // order `restore` is written for: `enterLevel` clears everything the
        // page owns, so anything put back before it would be cleared again.
        wadSource = null
        levelIndex = save.levelIndex
        enterLevel(beginLevel(save.levelIndex, carrier), false)
        if (fits(save, state)) {
          const back = restore(save, state, carrier)
          seen = back.seen
          foundSecrets = back.secrets
          kills = back.kills
          shotsFired = back.shotsFired
          say(`${state.def.name} · continued`)
          // Written again now that the level is the one somebody left, so the
          // next visit continues from here rather than from the blank level
          // this branch built a moment ago.
          keepRun()
          offered = readSave()
        } else {
          // The level gained or lost something since: the save cannot be laid
          // on it without handing one creature another's health. Starting the
          // level over is the honest failure, and the stale save goes.
          forgetSave()
          offered = null
          say(`${state.def.name} · the save no longer fits`)
        }
      } else if (action?.kind === 'begin') {
        titleUp = false
        say(state.def.name)
        // The first level is already standing -- it was built at boot and
        // `begin` simply lifts the title off it -- so this is the one way into
        // a level that does not pass through `enterLevel`, and without this
        // line a run started the ordinary way was never written down at all.
        keepRun()
        offered = readSave()
      } else if (action?.kind === 'level') {
        titleUp = false
        startLevel(action.index)
      } else if (action?.kind === 'meet') {
        // The title stays up behind it: the panel is a step on the way into a
        // game rather than a game, and closing it should leave you where you
        // were rather than in a room on your own.
        meetPanel?.classList.add('up')
        say('one string each way')
      } else if (action?.kind === 'record' || action?.kind === 'replay') {
        // The same code the typed word runs. Two ways in, one thing done --
        // anything else is two behaviours that drift.
        titleUp = false
        applyCheat(action.kind)
      } else if (action?.kind === 'shipped') {
        // The same shape the file picker produces, so picking a map that ships
        // and picking one out of a file you opened look and behave alike.
        menu = openMenu(shipped.map((entry) => ({ label: entry.name, action: { kind: 'pick', name: entry.name } })))
        say(`${shipped.length} maps — pick one`)
      } else if (action?.kind === 'pick') {
        const wanted = shipped.find((entry) => entry.name === action.name)
        if (wanted === undefined) say(`there is no map called ${action.name}`)
        else {
          const asked = action.name
          say(`fetching ${asked}`)
          void fetch(new URL(`maps/${wanted.file}`, document.baseURI))
            .then(async (answer) => {
              if (!answer.ok) throw new Error(`${asked} answered ${answer.status}`)
              return new Uint8Array(await answer.arrayBuffer())
            })
            .then((bytes) => {
              titleUp = false
              enterWad(bytes, asked)
            })
            // Said rather than thrown, the way the file picker's failures are:
            // a map that will not load leaves you on the title with a reason.
            .catch((error: unknown) => say((error as Error).message))
        }
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

  /*
   * And a save every few seconds of actual play.
   *
   * Level boundaries alone are not enough: they can be half an hour apart, and
   * a run measured in level boundaries loses everything somebody did in the
   * one they were in. Here rather than higher up because the title has already
   * returned above, so this only ever counts time spent in a room.
   *
   * Not while dead. The save would be of a corpse, and coming back to a corpse
   * is worse than coming back to the start of the level -- dying already puts
   * the level back, and `enterLevel` writes that down when it does.
   */
  if (!isDead(carrier)) {
    sinceSaved += STEP
    if (sinceSaved >= SAVE_EVERY) {
      sinceSaved = 0
      keepRun()
    }
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

  if (isDead(carrier) && net === null) {
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

  /*
   * Dying in a duel stops you, not the room.
   *
   * Alone, death halts everything and a press rebuilds the level. Neither can
   * happen here: a side that stopped stepping would stop simulating the other
   * player and the two games would part, and a level rebuilt underneath
   * somebody still playing would shut every door they had opened. So the body
   * waits out the same pause and stands up again where it started, and both
   * sides work that out on the same tick from the same clock rather than being
   * told.
   */
  if (net !== null) {
    if (isDead(carrier)) {
      deadFor += STEP
      if (deadFor >= REVIVE_DELAY) {
        putBack(state.player, carrier, myStart)
        deadFor = 0
        say('again')
      }
    } else deadFor = 0
    if (mate !== null && isDead(mateCarrier)) {
      mateDeadFor += STEP
      if (mateDeadFor >= REVIVE_DELAY) {
        putBack(mate, mateCarrier, theirStart)
        mateDeadFor = 0
      }
    } else mateDeadFor = 0
  }

  /*
   * What is being asked for this step, from the devices or from a recording.
   *
   * A replay ignores the devices entirely rather than merging with them --
   * half a replay is not a replay -- and hands control back the moment the
   * recording runs out, which `intentAt` says by answering null rather than by
   * repeating its last frame forever.
   */
  let intent = runMine ?? mergeIntents(keyboardIntent(held), touchIntent(touch as TouchState))
  if (playing !== null) {
    const written = intentAt(playing, tick)
    if (written === null) {
      playing = null
      say('the recording ends')
    } else intent = written
  }
  if (taping !== null) remember(taping, intent)
  tick++
  // Recorded before it is blanked: what a dead player was pressing is still
  // what they pressed, and a replay has to see the same stream.
  if (isDead(carrier)) intent = IDLE
  /*
   * And what the other one is asking for, or nothing while they are down.
   *
   * Worked out once and used by both the walking below and the trigger further
   * on, so the two cannot disagree about whether they are able to act.
   */
  const theirAsk = mate !== null && runTheirs !== null && !isDead(mateCarrier) ? runTheirs : null
  // A weapon request is a one-shot: consumed here so holding the button does
  // not keep re-selecting, and cleared whether or not it changed anything.
  /*
   * And only one you are holding.
   *
   * This was a bounds check alone while every weapon was held from the start.
   * The saw is the first one that is found, and without this the key for it
   * selected a weapon that then fired perfectly well -- the trigger asks about
   * ammunition, not about ownership, and a saw needs none.
   */
  if (intent.weapon >= 0 && intent.weapon < WEAPONS.length && carrier.weapons.has(intent.weapon)) {
    weaponIndex = intent.weapon
  }
  /*
   * And a slot, which is what a key asks for.
   *
   * Resolved here because only the page knows what is held, and pressing the key
   * for the slot already in hand moves to the next weapon in it -- which is how
   * the original moves between a fist and a saw, or between one shotgun and the
   * other. A slot holding nothing you have found leaves the weapon alone.
   */
  if (intent.slot >= 0 && intent.slot < SLOTS.length) {
    const asked = weaponInSlot(intent.slot, weaponIndex, carrier.weapons)
    if (asked >= 0) weaponIndex = asked
  }
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
  if (dx !== 0 || dy !== 0) {
    if (ghostly) {
      /*
       * Straight there, and then ask which room that is.
       *
       * `moveBody` is the only thing that keeps a body inside the map, so
       * going round it means doing its last job by hand: the floor underfoot
       * comes from wherever you ended up. A step that lands outside the map
       * entirely is refused, because there is no floor out there to stand on
       * and the renderer would have nothing to draw.
       */
      const toX = player.x + dx * speed
      const toY = player.y + dy * speed
      const landed = sectorAt(level, toX, toY)
      if (landed >= 0) {
        player.x = toX
        player.y = toY
        player.sector = landed
        player.floor = level.sectors[landed]!.floor + (player.hover ?? 0)
      }
    } else moveBody(level, player, dx * speed, dy * speed, state.decor)
  }

  /*
   * And the other player, by what they asked for on this same tick.
   *
   * The same arithmetic and deliberately not the same code path: what follows
   * the player's own step is doors opening, teleports firing and secrets being
   * counted, and that is this machine's business rather than a remote body's.
   * Two people tripping one line is a door that opens and opens again.
   */
  if (mate !== null && theirAsk !== null) {
    const asked = theirAsk
    mate.angle += asked.turn * TURN_SPEED * STEP
    const theirSpeed = (asked.run ? RUN_SPEED : WALK_SPEED) * STEP
    const tfx = Math.cos(mate.angle)
    const tfy = Math.sin(mate.angle)
    const tsx = Math.cos(mate.angle + Math.PI / 2)
    const tsy = Math.sin(mate.angle + Math.PI / 2)
    const tdx = tfx * asked.forward + tsx * asked.strafe
    const tdy = tfy * asked.forward + tsy * asked.strafe
    if (tdx !== 0 || tdy !== 0) moveBody(level, mate, tdx * theirSpeed, tdy * theirSpeed, state.decor)
  }

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
    // Three hundred and seventy-three of these lines are for the creatures
    // alone. Walking over one is the original's behaviour and not a gap: the line
    // is how a mapper moves a monster without giving you a shortcut.
    if (where.monstersOnly) continue
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
   * And the lights a crossed line changes, which move nothing and are noticed
   * anyway: two of the three turn one on, and a corridor left dark until you
   * crossed the line that lit it is a corridor this game gives you no torch for.
   */
  for (const crossed of crossings(level.lines, wasX, wasY, player.x, player.y)) {
    if (state.lightLines.get(crossed.line)?.pressed === false) applyLight(crossed.line)
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

  /*
   * A hidden room, the moment you are standing in one.
   *
   * The original's secret sectors, which are most of why anybody walks into a
   * wall twice: three hundred and twenty-five of them across the two files this
   * was built against, on sixty-six of the sixty-eight maps. Counted on arrival
   * rather than on leaving, and remembered by sector, so pacing in and out of
   * one does not find it twice.
   */
  if (level.sectors[player.sector]?.special === 9 && !foundSecrets.has(player.sector)) {
    foundSecrets.add(player.sector)
    noise('pickup')
    say('a hidden room')
  }

  // The ground underfoot, after the move rather than before it: a step out of a
  // channel is a step out of it, and the clock starts again on the way back in.
  /*
   * The suit, which is the one powerup that has to be asked about here.
   *
   * The clock still runs while you stand in the channel -- `bite` is asked
   * either way, so stepping out and back in is the same decision it was -- and
   * what the suit changes is only whether the answer lands. Skipping the call
   * instead would mean a suit that expires mid-channel starts your burn clock
   * from that moment rather than from when you waded in.
   */
  const burn = bite(level, player.sector, hazard, STEP)
  if (burn > 0 && !holds(carrier.powers, 'suit')) {
    hurtPlayer(burn)
    say('burning')
    noise('hurt', 0.5)
  }
  // The same floor under the other one. Its own clock, because the interval is
  // counted from when that body stepped in rather than when this one did.
  if (mate !== null) {
    const theirBurn = bite(level, mate.sector, mateHazard, STEP)
    // Read off their own carrier, so both machines agree about whether the
    // other one is wearing a suit. A powerup consulted from the page instead
    // would be one only the machine holding it knew about.
    if (theirBurn > 0 && !holds(mateCarrier.powers, 'suit') && !holds(mateCarrier.powers, 'shield')) {
      takeDamage(mateCarrier, theirBurn)
    }
  }

  // Walked over. Nothing is taken that would give nothing, so crossing a room
  // at full health leaves the kit there for when it is worth something.
  const takeMine = (): void => {
    for (const taken of collect(pickups, player.x, player.y, PLAYER_RADIUS, carrier)) {
      const grant = taken.grant
      noise(grant.kind === 'weapon' ? 'weaponUp' : 'pickup')
      if (grant.kind === 'health') say(`+${grant.amount} health`)
      else if (grant.kind === 'ammo') say(`+${grant.amount} ${grant.ammo}`)
      else if (grant.kind === 'armour') say(`armour ${carrier.armour}`)
      else if (grant.kind === 'weapon') {
        const gun = WEAPONS[grant.weapon]
        const reserve = gun?.ammo === undefined ? '' : ` — ${heldOf(carrier, gun.ammo)} ${gun.ammo}`
        say(`${gun?.name ?? 'a weapon'}${reserve}`)
      }
      else if (grant.kind === 'power') {
        // The one powerup whose whole effect is on a thing the page owns: the
        // set of lines the automap has been shown. The cheat that does this
        // fills the same set, which is why the two read alike.
        if (grant.power === 'chart') for (const line of level.lines) seen.add(line)
        say(POWER_SAID[grant.power])
        noise('powerUp')
      } else if (grant.kind === 'pack') say(`a pack — twice what you could carry`)
      else say(`${grant.key} key`)
    }
  }
  const takeTheirs = (): void => {
    if (mate !== null) collect(pickups, mate.x, mate.y, PLAYER_RADIUS, mateCarrier)
  }
  // The host reaches first, on both machines: two people can be standing on the
  // same box on the same tick and only one of them gets it.
  for (const who of hostFirst(net === null || hosting)) {
    if (who === 'mine') takeMine()
    else takeTheirs()
  }

  /*
   * The powerup clocks, run down here with the other seconds-based ones.
   *
   * Both carriers, because both collect. Theirs is run down without saying so:
   * a line about somebody else's shield wearing off is a line about a room you
   * cannot see.
   */
  for (const ended of tickPowers(carrier.powers, STEP)) {
    say(`${POWER_ENDED[ended]}`)
    noise('powerDown')
  }
  tickPowers(mateCarrier.powers, STEP)

  cooldown = Math.max(0, cooldown - STEP)
  mateCooldown = Math.max(0, mateCooldown - STEP)
  flash = Math.max(0, flash - STEP)
  noticeTime = Math.max(0, noticeTime - STEP)
  // The same ownership test as for this side's, against their carrier. Both
  // machines run it against the same carrier, so both agree about what they are
  // holding even though only one of them pressed the key.
  if (
    theirAsk !== null &&
    theirAsk.weapon >= 0 &&
    theirAsk.weapon < WEAPONS.length &&
    mateCarrier.weapons.has(theirAsk.weapon)
  ) {
    mateWeapon = theirAsk.weapon
  }
  if (theirAsk !== null && theirAsk.slot >= 0 && theirAsk.slot < SLOTS.length) {
    const asked = weaponInSlot(theirAsk.slot, mateWeapon, mateCarrier.weapons)
    if (asked >= 0) mateWeapon = asked
  }

  /*
   * Both triggers, and always the host's first.
   *
   * The order matters more than it looks. Every roll in this game comes out of
   * one seeded generator and a shot takes one per pellet, so two sides that
   * each resolved their own shot first would draw different numbers from that
   * moment on -- and the creatures, which share the generator, would walk
   * different ways on the two screens. "Mine then theirs" is not the same
   * order on both machines. "The host's then the guest's" is.
   */
  const pullMine = (): void => {
    cooldown = pullTrigger(
      player,
      carrier,
      weaponIndex,
      cooldown,
      mate,
      mate === null ? null : mateCarrier,
      locked?.angle,
      true,
      intent.fire,
    )
  }
  const pullTheirs = (): void => {
    if (mate === null || theirAsk === null) return
    mateCooldown = pullTrigger(
      mate,
      mateCarrier,
      mateWeapon,
      mateCooldown,
      player,
      carrier,
      undefined,
      false,
      theirAsk.fire,
    )
  }
  for (const who of hostFirst(net === null || hosting)) {
    if (who === 'mine') pullMine()
    else pullTheirs()
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
        // And one wall on one map turns a light on rather than moving anything.
        // Worth the three lines for the reason the rest of the tail was worth
        // its rows: on that map it is the only wall that does it.
        applyLight(facing)
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

  /*
   * Bodies are the player, the other player and every creature, so a closing
   * door reverses off any of them. The rule is about height, not about what kind
   * of thing is under it.
   *
   * What comes back is whoever a crusher has, in the order the list was handed
   * over -- which is why the order is written out rather than spread in a loop.
   * A crusher does not reverse; it reports and keeps coming.
   */
  // Filled on the first tick of a level rather than when it loads, because a
  // level arrives from four different places and one of them would forget.
  if (padLines.length === 0 && state.teleportLines.size > 0) padLines = [...state.teleportLines.keys()]

  const bodies = mate === null ? [player, ...actors] : [player, mate, ...actors]
  const firstActor = mate === null ? 1 : 2
  for (const caught of updateMovers(level, movers, bodies, STEP)) {
    const hurt = CRUSH_DAMAGE * STEP
    if (caught === 0) {
      hurtPlayer(hurt)
      say('crushed')
      continue
    }
    if (mate !== null && caught === 1) {
      if (!holds(mateCarrier.powers, 'shield')) takeDamage(mateCarrier, hurt)
      continue
    }
    hurtActor(caught - firstActor, hurt, -1)
  }

  /*
   * Driven by this machine's own player, which is as far as the shared world
   * goes -- and worth writing down, because the powerup below reads this
   * machine's own carrier for the same reason.
   *
   * In a duel both machines run this pass and each hands it the body whose keys
   * it is holding, so the creatures are not part of what the two of you agree
   * about: they chase whoever is local, and the two views of them drift apart
   * within seconds. That was true before the powerups and is not made worse by
   * one that widens their aim. What the lockstep checks compare is the players
   * and the wounds they give each other, which is what the duel maps are for.
   * Making the creatures shared would mean naming one body, on both machines, as
   * the one they hunt -- a decision about what a duel is rather than a fix.
   */
  // Where each of them stood, before the pass that moves them. The array is
  // reused across ticks: this runs sixty times a second against every creature
  // in the level and a fresh one each time is a hundred and fifty allocations.
  for (let index = 0; index < actors.length; index++) {
    const actor = actors[index]!
    const slot = wasAt[index]
    if (slot === undefined) wasAt[index] = { x: actor.x, y: actor.y }
    else {
      slot.x = actor.x
      slot.y = actor.y
    }
  }

  const outcome = updateActors(level, actors, player, EYE_HEIGHT, STEP, {
    random: rolls,
    aimWobble: holds(carrier.powers, 'blur') ? BLUR_WOBBLE : 0,
  })

  /*
   * And the creatures that walked onto a pad.
   *
   * Three hundred and seventy-three lines across forty-two maps exist for this
   * and nothing else: a mapper puts a closet of monsters somewhere off the map
   * and lays one across its doorway, so that crossing a line in the room you are
   * standing in empties the closet into it. Unread, those monsters spend the
   * level in a cupboard.
   *
   * Against the pad lines alone rather than against every line in the map. The
   * player's crossings are asked of `level.lines`, which is two thousand of them
   * -- fine once a tick and not fine a hundred and fifty times.
   */
  if (padLines.length > 0) {
    for (let index = 0; index < actors.length; index++) {
      const actor = actors[index]!
      const before = wasAt[index]
      if (before === undefined || !isAlive(actor)) continue
      if (before.x === actor.x && before.y === actor.y) continue
      for (const crossed of crossings(padLines, before.x, before.y, actor.x, actor.y)) {
        if (!crossed.fromFront) continue
        const where = state.teleportLines.get(crossed.line)
        if (where === undefined || usedTeleports.has(crossed.line)) continue
        if (where.once) usedTeleports.add(crossed.line)
        actor.x = where.x
        actor.y = where.y
        actor.angle = where.angle
        actor.sector = where.sector
        actor.floor = (level.sectors[where.sector]?.floor ?? actor.floor) + (actor.hover ?? 0)
        // One a step, the same rule the player's arrival follows: a pad standing
        // on another pad's line would send it on again in the same tick.
        break
      }
    }
  }
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
    if (inDuel && net !== null) {
      /*
       * Say what this side wants, then run the tick only if both sides have.
       *
       * Said once per tick rather than on every pass, because a tick that has
       * to wait comes round again and re-sending would put the same asking on
       * the wire a hundred times while one packet is late.
       *
       * Breaking rather than dropping the time: the accumulator keeps what it
       * has, so a side that fell behind runs the ticks it owes when the other
       * catches up. Skipping them is how two games stop being one.
       */
      if (spokenFor < tick) {
        const asked = mergeIntents(keyboardIntent(held), touchIntent(touch as TouchState))
        const packet = speak(net, tick, asked)
        spokenFor = tick
        if (channel !== null && channel.readyState === 'open') channel.send(JSON.stringify(packet))
      }
      const both = tickReady(net, tick) ? intentsAt(net, tick) : null
      if (both === null) break
      runMine = both.mine
      runTheirs = both.theirs
      // Ticks already played are no use to anybody.
      forget(net, tick - 8)
    }
    step()
    runMine = null
    runTheirs = null
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
  // One value, read once, handed to both passes: the world and everything
  // standing in it have to be lit by the same rule or night vision looks like a
  // bug in the sprite pass.
  const lightFloor = holds(carrier.powers, 'sight') ? SIGHT_FLOOR : 0
  if (!mapOpen && !titleUp) renderView(fb, level, view, surface.cellAspect, { horizonShift, seen, lightFloor })
  /*
   * Measured here, between the two passes, rather than at the end of the frame.
   *
   * A browser check asked whether the goggles brighten the screen and read the
   * finished frame, which the sprite pass has already drawn on -- so with the
   * world pass deliberately left dark the check still passed, on the strength of
   * the creatures alone. The reading has to name one pass to be able to tell the
   * two apart.
   */
  worldBright = meanBrightness(fb)

  visible.length = 0
  /*
   * The furniture first, though the order does not decide anything: billboards
   * are sorted by depth before they are drawn. A lamp behind a creature is
   * behind it because it is further away, not because it was pushed first.
   */
  for (const piece of state.decor) visible.push(piece)
  for (const pickup of pickups) {
    if (!pickup.taken) visible.push(pickup)
  }
  for (const actor of actors) {
    // Lit by the sector it stands in, the way the original lights a thing.
    visible.push(billboardOf(actor, level.sectors[actor.sector]?.light ?? 0.5))
  }
  if (mate !== null) {
    visible.push({
      x: mate.x,
      y: mate.y,
      z: mate.floor,
      light: level.sectors[mate.sector]?.light ?? 0.5,
      // The trooper, which is the human shape this game already has baked.
      sprite: TROOPER,
    })
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
  if (!mapOpen && !titleUp) drawBillboards(fb, view, surface.cellAspect, visible, { horizonShift, lightFloor })

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
      secrets: level.sectors.filter((sector) => sector.special === 9).length,
      found: foundSecrets.size,
    })
    summaryLayout(fb.width, fb.height, lines).forEach((piece, index) => {
      drawText(fb, piece.col, piece.row, piece.text, {
        color: index === 0 ? vec3(1.2, 1, 0.6) : vec3(0.85, 0.85, 0.8),
      })
    })
  }

  const sector = level.sectors[player.sector]
  const keys = [...carrier.keys].join(' ')
  const powers = powerLine(carrier.powers)
  // What is left of what this weapon spends. Two of the nine spend nothing, and a
  // zero beside their name reads as a gun you cannot fire.
  const reserve = weapon.ammo === undefined ? '--' : `${heldOf(carrier, weapon.ammo)}`

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
  /*
   * Five panels now, and the new one is the first to go.
   *
   * The numbers moved up by one rather than the powerups being given a tie with
   * the keys: panels are dropped lowest-first and equal priorities are settled
   * by the order they were written in, so a tie would have decided which of two
   * readings a narrow screen keeps by where somebody happened to put a line.
   * What is deliberate is that a phone drops the clock and keeps where you are.
   */
  const bar = layoutBar(fb.width, fb.height, [
    { label: 'HEALTH', value: `${carrier.health}%`, priority: 5 },
    // A weapon that costs nothing has no reserve to show, and a zero beside
    // FISTS reads as a gun you cannot fire.
    { label: weapon.name.toUpperCase(), value: reserve, priority: 4 },
    { label: 'KEYS', value: keys === '' ? '--' : keys, priority: 3 },
    { label: 'AREA', value: state.def.name, priority: 2 },
    { label: 'POWER', value: powers === '' ? '--' : powers, priority: 1 },
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

  /*
   * The weapon in your hands, across the foot of the view.
   *
   * The one thing on screen in every frame of the original and the last piece
   * of it missing here. Fourteen rows of the fifty a desk draws, which is about
   * the third the original gives it, and the same fourteen on a phone -- where
   * the grid is seventy-seven rows, so it takes proportionally less. The gun is
   * furniture; the room is what is being looked at.
   *
   * Above the status bar rather than behind it, and skipped with everything
   * else while the map is open: a picture of a gun over a map of the level is
   * two things asking for the same space.
   */
  if (!mapOpen && !titleUp && !goal.reached && !isDead(carrier)) {
    /*
     * Firing for the first third of the reload rather than for the flash.
     *
     * The muzzle flash lasts sixty milliseconds, which is four frames -- right
     * for a light on a wall and far too short for a gun to visibly move. The
     * cooldown is what the weapon is actually doing: 0.28 seconds for the
     * sidearm, 0.85 for the scattergun, 1.2 for the launcher. A third of it
     * reads as recoil at every one of those speeds.
     *
     * The saw is the one this arithmetic does not flatter: its interval is 0.12,
     * so two thirds of it is eight hundredths of a second and the frame
     * alternates almost every frame. Which is what a saw does.
     */
    const recoiling = cooldown > weapon.interval * (2 / 3)
    const held = [
      recoiling ? SIDEARM_FIRING : SIDEARM_HELD,
      recoiling ? SCATTERGUN_FIRING : SCATTERGUN_HELD,
      recoiling ? LAUNCHER_FIRING : LAUNCHER_HELD,
      recoiling ? FISTS_FIRING : FISTS_HELD,
      recoiling ? CHAINSAW_FIRING : CHAINSAW_HELD,
      recoiling ? TWINBORE_FIRING : TWINBORE_HELD,
      recoiling ? AUTOGUN_FIRING : AUTOGUN_HELD,
      recoiling ? ARC_RIFLE_FIRING : ARC_RIFLE_HELD,
      recoiling ? CANNON_FIRING : CANNON_HELD,
    ][weaponIndex]
    if (held !== undefined) {
      const foot = (bar !== null ? bar.top : fb.height - 1) - 1
      drawSprite(fb, held, Math.floor((fb.width - held.rows[0]!.length) / 2), foot - held.rows.length + 1)
    }
  }


  // The same renumbering as the bar, for the same reason: the powerup clock is
  // the one reading a narrow line can do without.
  const line = bar !== null ? [] : layoutHud(fb.width, [
    { text: `${carrier.health}`, align: 'left', priority: 5 },
    { text: weapon.ammo === undefined ? weapon.name : `${weapon.name} ${reserve}`, align: 'left', priority: 4 },
    { text: keys === '' ? '' : `keys ${keys}`, align: 'left', priority: 3 },
    { text: `${state.def.name} · ${fps.toFixed(0)} fps`, align: 'right', priority: 2 },
    { text: powers, align: 'left', priority: 1 },
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
    ammo: weapon.ammo === undefined ? -1 : heldOf(carrier, weapon.ammo),
    reserve: weapon.ammo ?? '',
    /*
     * What the status line says about the powerups, rather than the clocks
     * themselves.
     *
     * The string the player reads, so a check that says "the shield is showing"
     * is checking the thing that has to be true. Reading the array would pass
     * while the line beside the health stayed empty, which has happened here
     * before with the keys.
     */
    powers,
    pack: carrier.pack,
    // How much of the level the automap has been shown, out of how much there
    // is: the only way a check can see what the chart did.
    mapped: seen.size,
    mapLines: level.lines.length,
    /**
     * Mean brightness of the cells that were drawn on.
     *
     * A light level leaves no other mark a check can read: the glyph a cell ends
     * up with depends on which ramp its material uses, so counting dense
     * characters measures the materials in view as much as the light on them.
     * Averaged over the drawn cells rather than all of them, or a frame looking
     * at a wall and one looking down a corridor would differ by how much of the
     * screen is empty.
     *
     * The walls, floors and ceilings only. Read off the finished frame it also
     * counts the creatures standing in front of them, and a check asking whether
     * the goggles light the room would pass on the strength of a lit trooper.
     */
    bright: worldBright,
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
    /**
     * Hidden rooms in this map, and how many have been walked into.
     *
     * Finding one says so on screen for a moment and then leaves no trace, so
     * this is the only way a check can ask whether it happened -- the same
     * shape the noises needed, for the same reason.
     */
    secrets: state.level.sectors.filter((sector) => sector.special === 9).length,
    found: foundSecrets.size,
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
    /**
     * What the title's cursor is standing on, by name.
     *
     * Reported because the screen cannot say it: a disabled item is drawn the
     * same as any other and only the cursor mark differs, so a check reading
     * glyphs could not tell "continue is offered" from "continue is greyed and
     * skipped". Empty once the title is down.
     */
    menuLabel: titleUp ? (menu.items[menu.cursor]?.label ?? '') : '',
    /** Whether a run is on offer, which is what enables the first menu item. */
    offering: offered !== null,
    /** Whether another player is on the other end, and where they are standing. */
    linked: channel !== null && channel.readyState === 'open',
    mateAt: mate === null ? null : { x: mate.x, y: mate.y },
    netTick: tick,
    hosting,
    /** Whether a run is being written down, and whether one is there to play. */
    recording: taping !== null,
    hasDemo: kept !== null,
    /** The other player's health, worked out here rather than taken on trust. */
    mateHealth: mate === null ? null : mateCarrier.health,
    /*
     * One number that changes if the creatures are anywhere different.
     *
     * Reported because the thing two sides have to agree about is the whole
     * world, and comparing the world cell by cell across two browsers is not
     * something a check can do. Every roll in the game comes from one seeded
     * generator, so a side that consumed them in a different order walks its
     * monsters somewhere else -- and this is what notices.
     */
    crowd: state.actors.reduce(
      (sum, one, at) => sum + (at + 1) * (Math.round(one.x * 8) + Math.round(one.y * 8) * 31 + one.health * 131),
      0,
    ),
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
    /**
     * Lays one of the things a map file places at your feet.
     *
     * A way to arrive at a pickup rather than a way to skip one: what is put
     * down is whatever `supplyFor` says that thing type is, and the ordinary
     * rule takes it on the next step -- the reach, the "would this give you
     * anything", the effect and the line that says so are all still on the path
     * being checked. Only walking to it is skipped, and Node already walks that.
     *
     * By thing number rather than by effect, so the check names what the file
     * names and cannot ask for a powerup this game does not place.
     */
    drop(type: number): boolean {
      const supply = supplyFor(type)
      if (supply === null) return false
      state.pickups.push({
        x: state.player.x,
        y: state.player.y,
        z: state.player.floor,
        light: 1,
        sprite: supply.sprite,
        grant: supply.grant,
        radius: supply.radius,
        taken: false,
      })
      return true
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

/*
 * Two people, over one string each way.
 *
 * The handshake is carried by a person because there is no server to carry it:
 * host makes a line, the other pastes it and presses join, and the line that
 * comes back is pasted into host's box and accepted. Every candidate is
 * gathered into the description before it is shown, so what is copied is the
 * whole of it and there is nothing to exchange afterwards.
 */
function meetSay(text: string): void {
  if (meetSaid !== null) meetSaid.textContent = text
}

/** Waits for the candidates, so one string is the whole offer or answer. */
async function settled(pc: RTCPeerConnection): Promise<string> {
  if (pc.iceGatheringState !== 'complete') {
    await new Promise<void>((done) => {
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') done()
      }
    })
  }
  return JSON.stringify(pc.localDescription)
}

/**
 * Starts the same map on both sides, from the same seed.
 *
 * A map that ships, because both ends already have all sixty-eight and a file
 * one of you opened is a file the other has never seen. The campaign's own
 * levels are out for a plainer reason: they are written for one person and
 * place nowhere for a second to stand.
 */
async function pairUp(seed: number, mapName: string, first: boolean): Promise<void> {
  const entry = shipped.find((one) => one.name === mapName)
  if (entry === undefined) {
    meetSay(`no map called ${mapName} on this side`)
    return
  }
  const answer = await fetch(new URL(`maps/${entry.file}`, document.baseURI))
  if (!answer.ok) {
    meetSay(`${mapName} answered ${answer.status}`)
    return
  }
  rolls = seeded(seed)
  titleUp = false
  enterWad(new Uint8Array(await answer.arrayBuffer()), mapName)
  // Not made here: it exists already, holding whatever arrived while this side
  // was fetching the map. Making a fresh one here is what threw those away.
  net = net ?? lockstep(LEAD)
  inDuel = true
  spokenFor = -1
  tick = 0
  /*
   * One of you stands where the map starts and the other where it says a
   * second player goes, and the two sides have to disagree about which is
   * which or they are not in the same world.
   *
   * This was very nearly wrong in a way no obvious check would have caught.
   * Both sides ran the same code, so both put *themselves* at the start and
   * the other at the deathmatch spot -- and everything still looked right: the
   * connection was up, the other player was drawn, and walking moved them on
   * the far screen. Two people would have been playing two games that agreed
   * about everything except where anybody was.
   *
   * The deathmatch starts come first in the list, which is what puts the two
   * of you rooms apart rather than in the same doorway.
   */
  const away = state.otherStarts[0] ?? {
    x: state.player.x + 1.5,
    y: state.player.y,
    angle: 0,
    sector: state.player.sector,
  }
  const home = { x: state.player.x, y: state.player.y, angle: state.player.angle, sector: state.player.sector }
  const mine = first ? home : away
  const theirs = first ? away : home
  state.player.x = mine.x
  state.player.y = mine.y
  state.player.angle = mine.angle
  state.player.sector = mine.sector
  state.player.floor = state.level.sectors[mine.sector]?.floor ?? state.player.floor
  mate = {
    x: theirs.x,
    y: theirs.y,
    angle: theirs.angle,
    sector: theirs.sector,
    floor: state.level.sectors[theirs.sector]?.floor ?? 0,
    radius: PLAYER_RADIUS,
    height: PLAYER_HEIGHT,
  }
  hosting = first
  mateCarrier = freshCarrier()
  mateWeapon = 0
  mateCooldown = 0
  mateHazard = makeHazard()
  mateDeadFor = 0
  myStart = mine
  theirStart = theirs
  meetPanel?.classList.remove('up')
  say(`${mapName} · two players`)
}

function listen(open: RTCDataChannel): void {
  channel = open
  // Before a word can be said, so nothing said early is lost.
  net = lockstep(LEAD)
  open.onmessage = (event: MessageEvent) => {
    const message = JSON.parse(String(event.data)) as {
      start?: { seed: number; map: string }
      tick?: number
      intent?: Intent
    }
    if (message.start !== undefined) {
      // Whoever sent the invitation stands at the map's own start.
      void pairUp(message.start.seed, message.start.map, false)
      return
    }
    if (net !== null && message.tick !== undefined && message.intent !== undefined) {
      hear(net, { tick: message.tick, intent: message.intent })
    }
  }
}

meetPanel?.addEventListener('click', (event) => {
  const pressed = (event.target as HTMLElement | null)?.id
  if (pressed === 'meetshut') meetPanel.classList.remove('up')
})

document.getElementById('meethost')?.addEventListener('click', () => {
  void (async () => {
    const pc = new RTCPeerConnection()
    wire = pc
    const open = pc.createDataChannel('play')
    listen(open)
    open.onopen = () => {
      // What the person hosting chose, or the first if the list never arrived.
      const map = meetMap?.value || shipped[0]?.name
      if (map === undefined || map === '') {
        meetSay('no maps to play on')
        return
      }
      const seed = Date.now() >>> 0
      open.send(JSON.stringify({ start: { seed, map } }))
      void pairUp(seed, map, true)
    }
    await pc.setLocalDescription(await pc.createOffer())
    const text = await settled(pc)
    if (meetMine !== null) meetMine.value = text
    meetSay('copy that to the other player')
  })()
})

document.getElementById('meetjoin')?.addEventListener('click', () => {
  void (async () => {
    const theirs = meetTheirs?.value.trim()
    if (!theirs) {
      meetSay('paste what they sent you first')
      return
    }
    const pc = new RTCPeerConnection()
    wire = pc
    pc.ondatachannel = (event: RTCDataChannelEvent) => listen(event.channel)
    await pc.setRemoteDescription(JSON.parse(theirs) as RTCSessionDescriptionInit)
    await pc.setLocalDescription(await pc.createAnswer())
    const text = await settled(pc)
    if (meetMine !== null) meetMine.value = text
    meetSay('send that back to them')
  })()
})

document.getElementById('meetaccept')?.addEventListener('click', () => {
  void (async () => {
    const theirs = meetTheirs?.value.trim()
    if (!theirs || wire === null) {
      meetSay('host first, then paste their answer')
      return
    }
    await wire.setRemoteDescription(JSON.parse(theirs) as RTCSessionDescriptionInit)
    meetSay('joined')
  })()
})

keys.textContent = 'W A S D move · ← → turn · ↑ ↓ look · Shift run · Space fire · 1 2 3 weapon · E use'
requestAnimationFrame(frame)
