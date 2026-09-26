/**
 * Writing a run down, and reading it back.
 *
 * A save cannot hold anything the level owns. Loading builds the level again
 * from its definition, so every line, kind and sprite in the running copy is a
 * new object by the time a save is applied -- and a save that had kept the old
 * ones would restore an automap drawing a place that no longer exists. So
 * nothing here names a thing by what it is; everything is named by where it
 * sits in the array the definition produced.
 *
 * That makes the position an assumption worth checking rather than trusting,
 * which is what `fits` is for. A save applied to a level with a different
 * number of creatures would hand somebody else's health to whoever happened to
 * be standing in that slot.
 *
 * What is deliberately not written: anything in flight. A bolt halfway across a
 * room is a frame of animation rather than a piece of progress, and restoring
 * one means restoring who fired it, which is an index into a list of creatures
 * that may since have died. Loading drops them, and the room is quieter for a
 * moment.
 */

import type { Line } from '../columns/level.ts'
import type { LevelState } from './levels.ts'
import { applyHeight, heightOf, type MoverState } from './movers.ts'
import type { Carrier } from './pickups.ts'
import type { ActorState } from './ai.ts'

/**
 * Bumped when the shape below changes in a way an older save cannot satisfy.
 *
 * A save from a previous shape is refused rather than read leniently: the
 * failure of a half-understood save is a level that looks right and is wrong
 * somewhere nobody looks.
 */
export const SAVE_VERSION = 1

export interface Save {
  readonly version: number
  /** Which campaign level, as an index. Never a map opened from a file. */
  readonly levelIndex: number
  readonly carrier: {
    readonly health: number
    readonly ammo: readonly number[]
    readonly keys: readonly string[]
    readonly armour: number
    readonly armourShare: number
    readonly weapons: readonly number[]
  }
  readonly player: {
    readonly x: number
    readonly y: number
    readonly angle: number
    readonly sector: number
    readonly floor: number
  }
  readonly actors: readonly {
    readonly x: number
    readonly y: number
    readonly sector: number
    readonly floor: number
    readonly angle: number
    readonly health: number
    readonly state: ActorState
    readonly timer: number
    readonly awake: boolean
    readonly grudge: number
  }[]
  /** One flag per pickup, in the order the level built them. */
  readonly pickups: readonly boolean[]
  readonly movers: readonly {
    readonly state: MoverState
    readonly timer: number
    /** Where the surface actually is, which the state alone does not say. */
    readonly height: number
  }[]
  readonly goal: { readonly reached: boolean; readonly elapsed: number }
  /** Sectors already found, and lines already walked past, as indices. */
  readonly secrets: readonly number[]
  readonly seen: readonly number[]
  readonly kills: number
  readonly shotsFired: number
}

/** What the page owns rather than the level, and has to be handed back. */
export interface Extras {
  seen: Set<Line>
  secrets: Set<number>
  kills: number
  shotsFired: number
}

/** Writes down a run in progress. Nothing here refers to the level's objects. */
export function snapshot(
  levelIndex: number,
  state: LevelState,
  carrier: Carrier,
  extras: Extras,
): Save {
  const lineIndex = new Map<Line, number>()
  state.level.lines.forEach((line, index) => lineIndex.set(line, index))

  return {
    version: SAVE_VERSION,
    levelIndex,
    carrier: {
      health: carrier.health,
      ammo: [...carrier.ammo],
      keys: [...carrier.keys],
      armour: carrier.armour,
      armourShare: carrier.armourShare,
      weapons: [...carrier.weapons],
    },
    player: {
      x: state.player.x,
      y: state.player.y,
      angle: state.player.angle,
      sector: state.player.sector,
      floor: state.player.floor,
    },
    actors: state.actors.map((actor) => ({
      x: actor.x,
      y: actor.y,
      sector: actor.sector,
      floor: actor.floor,
      angle: actor.angle,
      health: actor.health,
      state: actor.state,
      timer: actor.timer,
      awake: actor.awake,
      grudge: actor.grudge,
    })),
    pickups: state.pickups.map((pickup) => pickup.taken),
    movers: state.movers.map((mover) => ({
      state: mover.state,
      timer: mover.timer,
      height: heightOf(state.level, mover),
    })),
    goal: { reached: state.goal.reached, elapsed: state.goal.elapsed },
    secrets: [...extras.secrets],
    // Dropped rather than kept when a line cannot be placed, which cannot
    // happen for a level built from the same definition and would otherwise
    // write a -1 that came back as the first line on the map.
    seen: [...extras.seen].map((line) => lineIndex.get(line) ?? -1).filter((at) => at >= 0),
    kills: extras.kills,
    shotsFired: extras.shotsFired,
  }
}

/**
 * Whether this save can be laid onto this level at all.
 *
 * Counts rather than contents, because counts are what the indices depend on.
 * A level whose definition gained a creature or a door since the save was
 * written is a different level as far as this is concerned.
 */
export function fits(save: Save, state: LevelState): boolean {
  if (save.version !== SAVE_VERSION) return false
  if (save.actors.length !== state.actors.length) return false
  if (save.pickups.length !== state.pickups.length) return false
  if (save.movers.length !== state.movers.length) return false
  return true
}

/**
 * Lays a save onto a level just built from its definition.
 *
 * In place, because that is what the page has: `enterLevel` has already put a
 * fresh level in and cleared everything around it, and this is what turns that
 * into the room somebody left.
 */
export function restore(save: Save, state: LevelState, carrier: Carrier): Extras {
  carrier.health = save.carrier.health
  carrier.ammo = [...save.carrier.ammo]
  carrier.keys = new Set(save.carrier.keys)
  carrier.armour = save.carrier.armour
  carrier.armourShare = save.carrier.armourShare
  carrier.weapons = new Set(save.carrier.weapons)

  state.player.x = save.player.x
  state.player.y = save.player.y
  state.player.angle = save.player.angle
  state.player.sector = save.player.sector
  state.player.floor = save.player.floor

  save.actors.forEach((written, index) => {
    const actor = state.actors[index]
    if (actor === undefined) return
    actor.x = written.x
    actor.y = written.y
    actor.sector = written.sector
    actor.floor = written.floor
    actor.angle = written.angle
    actor.health = written.health
    actor.state = written.state
    actor.timer = written.timer
    actor.awake = written.awake
    actor.grudge = written.grudge
  })

  save.pickups.forEach((taken, index) => {
    const pickup = state.pickups[index]
    if (pickup !== undefined) pickup.taken = taken
  })

  save.movers.forEach((written, index) => {
    const mover = state.movers[index]
    if (mover === undefined) return
    mover.state = written.state
    mover.timer = written.timer
    // The height last, because it is the half the state does not carry.
    applyHeight(state.level, mover, written.height)
  })

  state.goal.reached = save.goal.reached
  state.goal.elapsed = save.goal.elapsed

  const seen = new Set<Line>()
  for (const at of save.seen) {
    const line = state.level.lines[at]
    if (line !== undefined) seen.add(line)
  }
  return { seen, secrets: new Set(save.secrets), kills: save.kills, shotsFired: save.shotsFired }
}
