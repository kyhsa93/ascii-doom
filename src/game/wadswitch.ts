/**
 * Rooms a line moves by naming them, rather than by being next to them.
 *
 * The original's third way of making a level move, and the one this engine has
 * been missing: a door special acts on the room behind its line, a lift line
 * names a platform, and everything here names a room and says what should
 * happen to its floor or its ceiling. Forty-eight of the sixty-eight maps in
 * the files this was built against carry the switch that opens a tagged door,
 * and forty-six carry the switch that lowers a tagged floor, which puts the two
 * of them behind only plain doors and teleports.
 *
 * Nothing new moves. A door is a ceiling with two heights, a lift is a floor
 * with two, and `updateMovers` has always stepped whatever it was handed -- so
 * what this module does is arithmetic on the map, not machinery. The heights
 * come from the rooms around the named room, measured the same way the door
 * and lift importers measure theirs, because a fixed number is wrong on nearly
 * every map.
 *
 * Measured across those files, and each number is a rule below:
 *   - 279 rooms are named by a 103 switch; 246 of them are shut the way a door
 *     is shut, and the 33 standing open already are refused.
 *   - 1,194 rooms are named by a floor special and every one of them has a
 *     neighbour to measure against; 23 are already at the height they would
 *     move to and are refused.
 *   - exactly one room in the two files is named by a floor special *and*
 *     owned by a lift. Two machines on one floor would fight, so the lift keeps
 *     it.
 */

import type { Level, Line } from '../columns/level.ts'
import type { LineSpecial } from '../columns/wad.ts'
import { UNITS_PER_METRE } from '../columns/wad.ts'
import { makeMover, type Mover, type MoverKind } from './movers.ts'

/** Headroom under the lowest neighbouring ceiling, as the door importer uses. */
const HEADROOM = 4 / UNITS_PER_METRE

const SPEED = 2.2
const FAST_SPEED = 4.4

/**
 * What each special does to the room it names.
 *
 * `surface` is which one moves and `target` is where it goes, both read off the
 * rooms that share a wall with it. A switch that opens a door leaves it open --
 * every one of these is the "stays" kind -- because a tagged door that shut
 * itself again would need a second machine to know when.
 */
const TAGGED = new Map<
  number,
  {
    surface: 'floor' | 'ceiling'
    target: 'lowestCeiling' | 'lowestFloor' | 'highestFloor'
    fast: boolean
  }
>([
  /*
   * A door held open where the original would shut it again.
   *
   * 63 is the repeatable switch whose door closes itself, and this machine has
   * one wait for every special it makes: zero, meaning stay put. Eighty-two
   * lines on seventeen maps are affected and none of them becomes unplayable --
   * a door that stays open is a door you can always get back through -- but it
   * is a difference from the original rather than a decision, and the next
   * person to wonder should find it written down instead of in the maps.
   */
  // Switches that open a door somewhere else.
  [103, { surface: 'ceiling', target: 'lowestCeiling', fast: false }],
  [112, { surface: 'ceiling', target: 'lowestCeiling', fast: true }],
  [61, { surface: 'ceiling', target: 'lowestCeiling', fast: false }],
  [63, { surface: 'ceiling', target: 'lowestCeiling', fast: false }],
  // Switches that move a floor.
  [23, { surface: 'floor', target: 'lowestFloor', fast: false }],
  [102, { surface: 'floor', target: 'highestFloor', fast: false }],
  [71, { surface: 'floor', target: 'lowestFloor', fast: true }],
  // Walked across. The same rooms, reached the other way, now that a crossing
  // is something this engine can see.
  //
  // 2 and 109 are the commonest of all of these -- thirty and twenty-five maps
  // -- and both are doors you open by walking through the line rather than by
  // pressing anything. Measured: of the rooms they name, a hundred and
  // thirty-five each are shut the way a door is shut, and not one of them is
  // without a neighbour to measure an opening against.
  [2, { surface: 'ceiling', target: 'lowestCeiling', fast: false }],
  [109, { surface: 'ceiling', target: 'lowestCeiling', fast: true }],
  [38, { surface: 'floor', target: 'lowestFloor', fast: false }],
  [37, { surface: 'floor', target: 'lowestFloor', fast: false }],
  [19, { surface: 'floor', target: 'highestFloor', fast: false }],
  [36, { surface: 'floor', target: 'highestFloor', fast: true }],
])

/*
 * What is deliberately still out, so the next reader does not take the gaps for
 * oversights. Each was measured rather than guessed:
 *
 *   The locked switches -- 133, 137 and the four rarer ones -- are out, and
 *   they were briefly in. Every colour was tried for the two commonest against
 *   all sixty-eight maps: nine combinations, seven to eleven maps left with a
 *   lock no key of theirs can open, against six with the pair removed
 *   altogether. Nothing about them is an improvement yet.
 *
 *   The evidence is thin as well as unhelpful. In the first file not one of
 *   their lines carries a coloured door texture; in the second, 133 is DOORBLU
 *   twenty-four times against twenty-two plain lines and 137 is DOORYEL twelve
 *   against thirty. And MAP21 settles 137 on its own -- one lock, one key, and
 *   that key is red -- which the second file's DOORYEL flatly contradicts. Two
 *   readings that disagree mean a third thing is going on, and guessing which
 *   is how the key colours went wrong an hour earlier.
 *
 *   18 and 20 (thirty-nine lines between them) raise a floor to the *next*
 *   height above it, which is a fourth kind of target this does not have; only
 *   half their rooms even have somewhere lower, so folding them into
 *   "highestFloor" would move most of them the wrong way.
 *
 *   46 (twenty-six lines) has twenty-eight of its thirty-two rooms already at
 *   the bottom, which is what a gun-triggered door looks like from here: the
 *   trigger is the missing half, not the geometry.
 */

/** Which of these are worked by pressing, rather than by walking across. */
const PRESSED = new Set([103, 112, 61, 63, 23, 102, 71])

export interface TaggedMachines {
  /** The movers to add to the level, in the order they were made. */
  readonly movers: Mover[]
  /** Walls that work them when pressed. */
  readonly pressed: Map<Line, readonly Mover[]>
  /** Lines that work them when crossed. */
  readonly crossed: Map<Line, readonly Mover[]>
}

export function taggedSpecials(): number[] {
  return [...TAGGED.keys()]
}

/**
 * The tagged machines a map's line specials describe.
 *
 * `owned` is the sectors a lift already has. One room in these two files is
 * named by both and the lift keeps it: a platform and a floor special on one
 * floor would take turns dragging it in opposite directions.
 */
export function taggedFrom(
  level: Level,
  specials: readonly LineSpecial[],
  tagged: ReadonlyMap<number, readonly number[]>,
  owned: ReadonlySet<number> = new Set(),
): TaggedMachines {
  const movers: Mover[] = []
  const madeFor = new Map<number, number>()
  const pressed = new Map<Line, readonly Mover[]>()
  const crossed = new Map<Line, readonly Mover[]>()

  for (const entry of specials) {
    const kind = TAGGED.get(entry.special)
    // The same tag-zero lock the lifts carry, for the same reason: zero is what
    // the format writes on an ordinary room.
    if (kind === undefined || entry.tag === 0) continue

    const worked: Mover[] = []
    for (const sector of tagged.get(entry.tag) ?? []) {
      if (owned.has(sector)) continue

      const existing = madeFor.get(sector)
      if (existing !== undefined) {
        worked.push(movers[existing]!)
        continue
      }

      const room = level.sectors[sector]
      if (room === undefined) continue
      const target = targetFor(level, sector, kind.target)
      if (target === null) continue

      const rest = kind.surface === 'ceiling' ? room.ceiling : room.floor
      const open = kind.target === 'lowestCeiling' ? target - HEADROOM : target
      // A machine that would not move is not a machine, and one that would move
      // the wrong way is worse: `updateMovers` travels toward whatever height it
      // is handed without asking which way that is.
      if (kind.surface === 'ceiling' && open <= rest) continue
      if (kind.surface === 'floor' && Math.abs(open - rest) < 1e-9) continue

      const made: MoverKind = {
        surface: kind.surface,
        shut: rest,
        open,
        speed: kind.fast ? FAST_SPEED : SPEED,
        // No wait: these stay where they are put. A tagged door that shut itself
        // again would need something to decide when, and the original's answer
        // for that is a different special.
        wait: 0,
      }
      madeFor.set(sector, movers.length)
      const mover = makeMover(sector, made)
      movers.push(mover)
      worked.push(mover)
    }

    if (worked.length === 0) continue
    const into = PRESSED.has(entry.special) ? pressed : crossed
    into.set(entry.line, [...(into.get(entry.line) ?? []), ...worked])
  }

  return { movers, pressed, crossed }
}

/** The height a named room's surface is measured against, or null. */
function targetFor(
  level: Level,
  sector: number,
  want: 'lowestCeiling' | 'lowestFloor' | 'highestFloor',
): number | null {
  let found: number | null = null
  for (const line of level.lines) {
    if (line.back === null) continue
    const other = line.front === sector ? line.back : line.back === sector ? line.front : null
    if (other === null || other === sector) continue
    const room = level.sectors[other]
    if (room === undefined) continue
    const value = want === 'lowestCeiling' ? room.ceiling : room.floor
    if (found === null) found = value
    else if (want === 'highestFloor') found = Math.max(found, value)
    else found = Math.min(found, value)
  }
  return found
}
