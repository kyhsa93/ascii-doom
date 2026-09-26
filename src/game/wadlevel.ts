/**
 * A map read from a WAD, as something this game can run.
 *
 * The parser hands back geometry and a place to stand. This wraps that in the
 * state the page steps every frame -- which mostly means being honest about
 * everything a WAD map does not have here: no creatures, no supplies, no doors
 * and no way to finish. It is a place to walk around in, and saying so in the
 * types rather than in a comment is why the lists below are empty rather than
 * absent.
 *
 * The player is built by the same `spawnPlayer` the authored levels use. A body
 * made a second way here would drift from that one -- a different radius, a
 * floor height set from the wrong place -- and the two would disagree about
 * what fits through a door long before anybody noticed.
 */

import { readMap } from '../columns/wad.ts'
import { spawnActor, type Actor } from './ai.ts'
import { makeGoal } from './exit.ts'
import type { LevelDef, LevelState } from './levels.ts'
import { makeMover } from './movers.ts'
import type { Pickup } from './pickups.ts'
import { spawnPlayer } from './player.ts'
import { doorsFrom } from './waddoors.ts'
import { supplyFor } from './waditems.ts'
import { creatureFor } from './wadthings.ts'

/**
 * A sector index no map can have.
 *
 * Not -1: that is what `sectorAt` returns for a point outside the map, so a
 * player who walked off the edge of a WAD would finish a level that has no
 * exit in it.
 */
const NO_EXIT = -2

export function wadLevelState(bytes: Uint8Array, mapName: string): LevelState {
  const map = readMap(bytes, mapName)
  if (!map.spawn) throw new Error(`${mapName} has no player start to stand on`)
  if (map.spawn.sector < 0) throw new Error(`${mapName} starts the player outside its own map`)

  /**
   * Enough of a definition for the page, and no more.
   *
   * Only `name` is read once a level is running -- the status line, the notice
   * when it starts, and the probe. The rest is here because the type asks for
   * it, and a map from a file has none of it to give.
   */
  const def: LevelDef = {
    name: mapName,
    sectors: [],
    spawn: { x: map.spawn.x, y: map.spawn.y, angle: map.spawn.angle },
    movers: [],
    actors: [],
    pickups: [],
    exitTag: '',
  }

  /**
   * What the map placed, where this game has an answer for it.
   *
   * Two things are dropped rather than guessed at. A number this game has no
   * creature for -- a lamp, a medikit, a marker -- puts nothing there, which is
   * why the mapping is a whitelist. And a thing the file places outside every
   * sector has no floor to stand on, so it is skipped instead of being spawned
   * into nowhere.
   *
   * The facing comes across, because it decides which way a creature is looking
   * when you walk in on it, and that is the difference between being seen and
   * seeing first.
   */
  const actors: Actor[] = []
  const pickups: Pickup[] = []
  for (const thing of map.things) {
    if (thing.sector < 0) continue
    const room = map.level.sectors[thing.sector]
    if (!room) continue

    const kind = creatureFor(thing.type)
    if (kind) {
      const actor = spawnActor(kind, thing.x, thing.y, thing.sector, room.floor)
      actor.angle = thing.angle
      actors.push(actor)
      continue
    }

    // Supplies rest on the floor of the room they were put in and are lit by
    // it, the same as the ones placed by hand in the levels written here.
    const supply = supplyFor(thing.type)
    if (supply) {
      pickups.push({
        x: thing.x,
        y: thing.y,
        z: room.floor,
        light: room.light,
        sprite: supply.sprite,
        grant: supply.grant,
        radius: supply.radius,
        taken: false,
      })
    }
  }

  return {
    def,
    level: map.level,
    player: spawnPlayer(map.level, map.spawn.x, map.spawn.y, map.spawn.angle),
    actors,
    pickups,
    /**
     * The doors you open by pressing them.
     *
     * No lifts and no switches: both of those act on a sector named by a tag
     * rather than on the one behind the line, and this game has no notion of
     * either. So `liftSectors` stays empty -- a lift here is a floor that
     * carries you when you stand on it, and nothing in a file is imported as
     * one.
     */
    movers: doorsFrom(map.level, map.specials).map((door) => makeMover(door.sector, door.kind)),
    goal: makeGoal(NO_EXIT),
    liftSectors: [],
  }
}
