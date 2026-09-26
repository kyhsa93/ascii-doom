/**
 * A map read from a WAD, as something this game can run.
 *
 * The parser hands back geometry and a place to stand. This wraps that in the
 * state the page steps every frame, filling in what each importer can answer
 * for: the creatures, the supplies, the doors you press open, the platforms a
 * marked wall calls, and the two ways a map can end. What none of them can
 * answer for is left out rather than guessed at -- a line you have to walk
 * across to trigger, and a switch that opens a tagged room somewhere else, are
 * both things this engine cannot say.
 *
 * This comment said "no creatures, no supplies, no doors and no way to finish"
 * for four rounds after each of those stopped being true, and then said "no
 * lifts" in the round that added them. Kept as a note to whoever writes the
 * next importer: the header is the first thing to go stale and the last thing
 * anybody reads.
 *
 * The player is built by the same `spawnPlayer` the authored levels use. A body
 * made a second way here would drift from that one -- a different radius, a
 * floor height set from the wrong place -- and the two would disagree about
 * what fits through a door long before anybody noticed.
 */

import type { Line } from '../columns/level.ts'
import type { Sprite } from '../columns/sprite.ts'
import { readArt, readMap } from '../columns/wad.ts'
import { deathFrame, frontFacing, pictureSize, readPicture, spriteFromPicture } from '../columns/wadpic.ts'
import { spawnActor, type Actor } from './ai.ts'
import { makeGoal } from './exit.ts'
import type { LevelDef, LevelState } from './levels.ts'
import { makeMover, type Mover } from './movers.ts'
import type { Pickup } from './pickups.ts'
import { spawnPlayer } from './player.ts'
import { doorsFrom } from './waddoors.ts'
import { exitSectorFrom, switchExitLines } from './wadexit.ts'
import { liftsFrom } from './wadlifts.ts'
import { supplyFor, supplyPictureFor } from './waditems.ts'
import { creatureFor, creaturePictureFor } from './wadthings.ts'
import { teleportsFrom } from './wadteleport.ts'

/**
 * A sector index no map can have.
 *
 * Not -1: that is what `sectorAt` returns for a point outside the map, so a
 * player who walked off the edge of a WAD would finish a level that has no
 * exit in it.
 */
const NO_EXIT = -2

export function wadLevelState(bytes: Uint8Array, mapName: string, cellAspect = 0.6): LevelState {
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
  /**
   * The pictures the file draws its things with, if it has any.
   *
   * A whole separate question from the map: the art sits in one run of lumps
   * for the whole file, and a file is free to have none -- every fixture the
   * checks are written against is exactly that. When there is none, or when a
   * picture will not decode, the creature keeps the art baked into the game,
   * which is Freedoom's too and looks the same; what an opened file buys is
   * looking like *that* file, which matters for one whose art is its own.
   *
   * What is taken is the shape and the colours. How big the thing is, how hard
   * it hits, how far it can see and what it does when it notices you are all
   * this project's, unchanged.
   */
  const art = readArt(bytes)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // A map places fifty-three creatures and perhaps four kinds of them, so the
  // same picture is asked for over and over.
  const drawn = new Map<string, Sprite | null>()

  function pictureOf(prefix: string | null, fit: { height: number } | { width: number }, dead = false): Sprite | null {
    if (prefix === null || art === null) return null
    const key = `${prefix}|${dead}|${'height' in fit ? `h${fit.height}` : `w${fit.width}`}`
    const already = drawn.get(key)
    if (already !== undefined) return already

    let made: Sprite | null = null
    try {
      const standing = frontFacing(art.sprites, prefix)
      if (standing !== null) {
        const wanted = dead
          ? deathFrame(view, art.sprites, prefix, pictureSize(view, art.sprites.get(standing)!).height)
          : standing
        const at = wanted === null ? undefined : art.sprites.get(wanted)
        if (at !== undefined) made = spriteFromPicture(readPicture(view, at), art.palette, fit, cellAspect)
      }
    } catch {
      // Bytes a player chose. A picture that will not read leaves the thing
      // looking like this game's own, rather than stopping the level loading.
      made = null
    }
    drawn.set(key, made)
    return made
  }

  const actors: Actor[] = []
  const pickups: Pickup[] = []
  // Counted as it happens. Whether a picture came out of this file is known
  // exactly here and nowhere else afterwards.
  let fromFile = 0
  for (const thing of map.things) {
    if (thing.sector < 0) continue
    const room = map.level.sectors[thing.sector]
    if (!room) continue

    const kind = creatureFor(thing.type)
    if (kind) {
      // Standing is fitted to the creature's own height; the corpse is fitted
      // to the standing picture's width, so falling over does not change its
      // size. Either may come back null, and null means keep what we had.
      const prefix = creaturePictureFor(thing.type)
      const upright = pictureOf(prefix, { height: kind.height })
      const fallen = upright === null ? null : pictureOf(prefix, { width: upright.width }, true)
      const looks =
        upright === null ? kind : { ...kind, sprite: upright, corpse: fallen ?? kind.corpse }
      if (upright !== null) fromFile++
      const actor = spawnActor(looks, thing.x, thing.y, thing.sector, room.floor)
      actor.angle = thing.angle
      actors.push(actor)
      continue
    }

    // Supplies rest on the floor of the room they were put in and are lit by
    // it, the same as the ones placed by hand in the levels written here.
    const supply = supplyFor(thing.type)
    if (supply) {
      // Fitted to the height this game already draws that supply at, so a box
      // of ammunition out of a file is the same size as one written here.
      const shown = pictureOf(supplyPictureFor(thing.type), { height: supply.sprite.height })
      if (shown !== null) fromFile++
      pickups.push({
        x: thing.x,
        y: thing.y,
        z: room.floor,
        light: room.light,
        sprite: shown ?? supply.sprite,
        grant: supply.grant,
        radius: supply.radius,
        taken: false,
      })
    }
  }

  /**
   * Both kinds of moving floor and ceiling, built before the state so the lifts
   * can be named twice: once in `movers`, which is what steps them every frame,
   * and once in the table that says which wall calls which.
   */
  const doors = doorsFrom(map.level, map.specials).map((door) => makeMover(door.sector, door.kind))
  const lifts = liftsFrom(map.level, map.specials, map.tagged)
  const platforms = lifts.platforms.map((lift) => makeMover(lift.sector, lift.kind))
  const liftLines = new Map<Line, readonly Mover[]>()
  for (const [line, called] of lifts.calls) {
    liftLines.set(
      line,
      called.map((index) => platforms[index]!),
    )
  }

  return {
    def,
    level: map.level,
    player: spawnPlayer(map.level, map.spawn.x, map.spawn.y, map.spawn.angle),
    actors,
    pickups,
    /**
     * The doors you press open and the platforms a marked wall calls.
     *
     * One list because one loop steps them: a door is a ceiling with two
     * heights and a lift is a floor with two heights, and `updateMovers` has
     * never needed to know which it is looking at.
     */
    movers: [...doors, ...platforms],
    /**
     * Where the map ends, if it ends anywhere this game can notice.
     *
     * A walk-over exit becomes the room on the far side of the line, because
     * arriving there is what crossing it means and arriving somewhere is the
     * only question `reachExit` knows how to ask. A map whose exit is only a
     * switch keeps the sentinel here and is finished through `exitLines`
     * instead, so the sentinel means "no room ends this", not "nothing does".
     */
    goal: makeGoal(exitSectorFrom(map.specials) ?? NO_EXIT),
    /**
     * And the ones that end it by being pressed, which a sector cannot say.
     *
     * A map may have both kinds or neither; the two are read separately and
     * neither stands in for the other.
     */
    exitLines: switchExitLines(map.specials),
    /**
     * And the walls that call a platform, which is how every lift in a file is
     * asked for -- not one of the seven hundred and sixty-one lift lines in the
     * two files this was built against is untagged.
     */
    liftLines,
    /**
     * And the lines that put you somewhere else entirely.
     *
     * The pad the tag names, not the room: a teleport arrives at a thing, and
     * a room is not a place to stand.
     */
    teleportLines: teleportsFrom(map.specials, map.things, map.tagged),
    /**
     * Still empty, and now for a reason rather than for want of an importer.
     * A lift here is a floor that carries you when you stand on it; a lift in a
     * file starts raised and is called from a wall, and putting one in this
     * list would drop it out from under anybody who climbed on.
     */
    liftSectors: [],
    fromFile,
  }
}
