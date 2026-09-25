/**
 * A level as data, and the state that running one produces.
 *
 * The distinction is the whole point of this file. Until now a level was module
 * state: the map was built once and doors raised and lowered its sectors, while
 * its pickups carried a `taken` flag that stayed set. That works exactly once.
 * Play it twice — or play it after a check has played it — and the doors start
 * open and the supplies are gone, which is why the playthrough check has to
 * save and restore the world around itself.
 *
 * So a definition is a template and nothing ever writes to it. Loading builds
 * the map from its sector outlines afresh, copies every placement into new
 * objects, and hands back a bundle the game may mutate freely. Two levels are
 * then the same shape as one, and replaying is simply loading again.
 */

import { buildLevel, sectorAt, type Level, type SectorDef } from '../columns/level.ts'
import { spawnActor, type Actor, type ActorKind } from './ai.ts'
import { makeGoal, type Goal } from './exit.ts'
import { makeMover, type Mover, type MoverKind } from './movers.ts'
import type { Pickup } from './pickups.ts'
import { spawnPlayer, type Player } from './player.ts'

/** Where a creature stands before anything has noticed you. */
export interface ActorPlacement {
  readonly kind: ActorKind
  readonly x: number
  readonly y: number
  /** Which way it faces while asleep, which decides whether it sees you first. */
  readonly angle: number
}

/** Which sector moves, named by tag so inserting a room cannot repoint it. */
export interface MoverPlacement {
  readonly tag: string
  readonly kind: MoverKind
}

export interface LevelDef {
  readonly name: string
  /** Outlines rather than a built map, so loading can start from a clean one. */
  readonly sectors: readonly SectorDef[]
  readonly spawn: { readonly x: number; readonly y: number; readonly angle: number }
  readonly movers: readonly MoverPlacement[]
  readonly actors: readonly ActorPlacement[]
  /** Templates. Loading copies them; nothing writes to these. */
  readonly pickups: readonly Pickup[]
  /** Tag of the sector that ends the level when entered. */
  readonly exitTag: string
}

/** Everything one run of a level owns and is free to change. */
export interface LevelState {
  readonly def: LevelDef
  readonly level: Level
  readonly player: Player
  readonly actors: Actor[]
  readonly pickups: Pickup[]
  readonly movers: Mover[]
  readonly goal: Goal
  /** Sectors that carry you when you stand on them, for calling a lift. */
  readonly liftSectors: readonly number[]
}

/** The index of a tagged sector, or -1. */
export function sectorIndexByTag(level: Level, tag: string): number {
  return level.sectors.findIndex((sector) => sector.tag === tag)
}

/**
 * Builds a fresh, entirely mutable world from a definition.
 *
 * Throws rather than limping when something names nothing. A mover attached to
 * no sector, or an exit that is not there, produces a level that looks finished
 * and cannot be completed — the most expensive kind of level bug to find, and
 * the cheapest to refuse at load.
 */
export function loadLevel(def: LevelDef): LevelState {
  const level = buildLevel(def.sectors)
  const player = spawnPlayer(level, def.spawn.x, def.spawn.y, def.spawn.angle)

  const actors: Actor[] = def.actors.map((placement) => {
    const sector = sectorAt(level, placement.x, placement.y)
    if (sector < 0) {
      throw new Error(`${def.name}: ${placement.kind.name} at (${placement.x}, ${placement.y}) is outside the map`)
    }
    const actor = spawnActor(placement.kind, placement.x, placement.y, sector, level.sectors[sector]!.floor)
    actor.angle = placement.angle
    return actor
  })

  const movers: Mover[] = def.movers.map((placement) => {
    const sector = sectorIndexByTag(level, placement.tag)
    if (sector < 0) throw new Error(`${def.name}: no sector tagged ${placement.tag} for a mover`)
    return makeMover(sector, placement.kind)
  })

  const exitSector = sectorIndexByTag(level, def.exitTag)
  if (exitSector < 0) throw new Error(`${def.name}: no sector tagged ${def.exitTag} to exit through`)

  return {
    def,
    level,
    player,
    actors,
    // Copied, not shared: `taken` is the one field of a pickup that changes,
    // and a template that remembers having been collected is a level that can
    // only be played once.
    pickups: def.pickups.map((pickup) => ({ ...pickup, taken: false })),
    movers,
    goal: makeGoal(exitSector),
    liftSectors: movers
      .filter((mover) => mover.kind.surface === 'floor')
      .map((mover) => mover.sector),
  }
}
