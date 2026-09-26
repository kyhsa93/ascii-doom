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
import { makeGoal } from './exit.ts'
import type { LevelDef, LevelState } from './levels.ts'
import { spawnPlayer } from './player.ts'

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

  return {
    def,
    level: map.level,
    player: spawnPlayer(map.level, map.spawn.x, map.spawn.y, map.spawn.angle),
    actors: [],
    pickups: [],
    movers: [],
    goal: makeGoal(NO_EXIT),
    liftSectors: [],
  }
}
