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
type Target = 'lowestCeiling' | 'highestCeiling' | 'lowestFloor' | 'highestFloor' | 'nextHigherFloor' | 'ownFloor'

interface Tagged {
  surface: 'floor' | 'ceiling'
  target: Target
  fast: boolean
  /**
   * Which way the surface is supposed to travel.
   *
   * Stated rather than worked out from the heights, because it is the one thing
   * that can be checked: `updateMovers` travels toward whatever height it is
   * handed without asking which way that is, so a map whose geometry contradicts
   * its own special used to produce a door that opened downwards. Now it produces
   * no machine at all, which is what a map saying two things means.
   */
  expect: 'up' | 'down'
  /**
   * Seconds at each end for a machine that never stops, or nothing for one that
   * is worked and then stays where it was put.
   */
  cycles?: number
  /** True for one that presses through a body rather than backing off it. */
  crushes?: boolean
  /**
   * True for a machine whose working stroke is the one `updateMovers` calls
   * "closing" -- which is where a body in the way is noticed.
   *
   * A crusher is the only thing here that needs it. Everything else rests where
   * it is and travels to somewhere a neighbour decides, so the stroke that
   * matters is the one out; a crusher hangs at the ceiling and the stroke that
   * matters is the one back down, because that is the one with somebody under it.
   */
  crushing?: boolean
  /**
   * Seconds at the far end before it comes back, or nothing to stay put.
   *
   * A closing door uses this as the pause before it reopens, which falls out of
   * the arrangement rather than needing a second kind of machine: for a door that
   * closes, the far end *is* shut.
   */
  wait?: number
  /** A key colour that must be held, for the locked switches. */
  key?: string
}

const TAGGED = new Map<number, Tagged>([
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
  [103, { surface: 'ceiling', target: 'lowestCeiling', fast: false, expect: 'up' }],
  [112, { surface: 'ceiling', target: 'lowestCeiling', fast: true, expect: 'up' }],
  [61, { surface: 'ceiling', target: 'lowestCeiling', fast: false, expect: 'up' }],
  [63, { surface: 'ceiling', target: 'lowestCeiling', fast: false, expect: 'up' }],
  // Switches that move a floor.
  [23, { surface: 'floor', target: 'lowestFloor', fast: false, expect: 'down' }],
  [102, { surface: 'floor', target: 'highestFloor', fast: false, expect: 'down' }],
  [71, { surface: 'floor', target: 'lowestFloor', fast: true, expect: 'down' }],
  /*
   * Floors that rise to the next step up rather than to the highest one.
   *
   * 18 and 20 are switches -- every one of their thirty-nine lines across the
   * two files carries a switch plate, which is the file saying so rather than
   * me remembering it -- and they raise the room they name to the nearest floor
   * above its own. That is a fourth kind of target: "highest" would send most
   * of them too far in one go, which is why they were left out until there was
   * somewhere for them to go.
   *
   * Measured: thirty-six of 18's forty-three rooms and all twenty-one of 20's
   * have a floor above them to stop at. The seven that do not are already the
   * highest thing around and are refused, like every other machine here that
   * would not move.
   */
  [18, { surface: 'floor', target: 'nextHigherFloor', fast: false, expect: 'up' }],
  [20, { surface: 'floor', target: 'nextHigherFloor', fast: false, expect: 'up' }],
  // Walked across. The same rooms, reached the other way, now that a crossing
  // is something this engine can see.
  //
  // 2 and 109 are the commonest of all of these -- thirty and twenty-five maps
  // -- and both are doors you open by walking through the line rather than by
  // pressing anything. Measured: of the rooms they name, a hundred and
  // thirty-five each are shut the way a door is shut, and not one of them is
  // without a neighbour to measure an opening against.
  [2, { surface: 'ceiling', target: 'lowestCeiling', fast: false, expect: 'up' }],
  [109, { surface: 'ceiling', target: 'lowestCeiling', fast: true, expect: 'up' }],
  [38, { surface: 'floor', target: 'lowestFloor', fast: false, expect: 'down' }],
  [37, { surface: 'floor', target: 'lowestFloor', fast: false, expect: 'down' }],
  [19, { surface: 'floor', target: 'highestFloor', fast: false, expect: 'down' }],
  [36, { surface: 'floor', target: 'highestFloor', fast: true, expect: 'down' }],
  // Opened by being shot rather than by being touched. The room it names is a
  // door like any other; only the trigger is unusual.
  [46, { surface: 'ceiling', target: 'lowestCeiling', fast: false, expect: 'up' }],
  /*
   * The locked switches, which were out for a round and are in now.
   *
   * They were tried and removed, and the reason was written down: every colour
   * was guessed for the two commonest against all sixty-eight maps, nine
   * combinations, and none of them was an improvement. The textures disagreed
   * with each other -- 133 is DOORBLU twenty-four times and plain twenty-two --
   * and one map settled 137 on a red key, which the second file's DOORYEL
   * flatly contradicted.
   *
   * What was missing was not more guessing. The original's own dispatcher names
   * all six: 99 and 133 blue, 134 and 135 red, 136 and 137 yellow. Two readings
   * that disagree meant a third thing was going on, and the third thing was that
   * a door texture is decoration -- a mapper is free to put a plain wall on a
   * locked door and often did.
   */
  [99, { surface: 'ceiling', target: 'lowestCeiling', fast: true, expect: 'up', key: 'cobalt' }],
  [133, { surface: 'ceiling', target: 'lowestCeiling', fast: true, expect: 'up', key: 'cobalt' }],
  [134, { surface: 'ceiling', target: 'lowestCeiling', fast: true, expect: 'up', key: 'crimson' }],
  [135, { surface: 'ceiling', target: 'lowestCeiling', fast: true, expect: 'up', key: 'crimson' }],
  [136, { surface: 'ceiling', target: 'lowestCeiling', fast: true, expect: 'up', key: 'amber' }],
  [137, { surface: 'ceiling', target: 'lowestCeiling', fast: true, expect: 'up', key: 'amber' }],
  /*
   * Doors that shut rather than open, which need no new machine.
   *
   * A mover travels between two heights and is worked by being triggered; which
   * of the two is "shut" is a name rather than a rule. So a closing door is one
   * whose far end is its own floor, and 16 -- the one that closes for thirty
   * seconds and opens again -- is that with a wait on it. Nothing here knew how
   * to make a door close before, and thirteen lines across eight maps are the
   * only way through on the far side of a room you have already crossed.
   */
  [3, { surface: 'ceiling', target: 'ownFloor', fast: false, expect: 'down' }],
  [110, { surface: 'ceiling', target: 'ownFloor', fast: true, expect: 'down' }],
  [16, { surface: 'ceiling', target: 'ownFloor', fast: false, expect: 'down', wait: 30 }],
  /*
   * Doors that open and shut themselves, which is what the original means by
   * "raise" as against "open". Four seconds, which is the original's wait.
   */
  [4, { surface: 'ceiling', target: 'lowestCeiling', fast: false, expect: 'up', wait: 4 }],
  [90, { surface: 'ceiling', target: 'lowestCeiling', fast: false, expect: 'up', wait: 4 }],
  [105, { surface: 'ceiling', target: 'lowestCeiling', fast: true, expect: 'up', wait: 4 }],
  [114, { surface: 'ceiling', target: 'lowestCeiling', fast: true, expect: 'up', wait: 4 }],
  [106, { surface: 'ceiling', target: 'lowestCeiling', fast: true, expect: 'up' }],
  /*
   * Floors that rise until the room runs out of headroom, which is what the
   * original's plain "raise floor" does: it stops at the lowest ceiling around,
   * not at the highest floor. Six specials and eighty-odd lines say it.
   */
  [5, { surface: 'floor', target: 'lowestCeiling', fast: false, expect: 'up' }],
  [91, { surface: 'floor', target: 'lowestCeiling', fast: false, expect: 'up' }],
  [101, { surface: 'floor', target: 'lowestCeiling', fast: false, expect: 'up' }],
  [64, { surface: 'floor', target: 'lowestCeiling', fast: false, expect: 'up' }],
  [56, { surface: 'floor', target: 'lowestCeiling', fast: false, expect: 'up' }],
  [24, { surface: 'floor', target: 'lowestCeiling', fast: false, expect: 'up' }],
  /*
   * Two that raise a floor by a fixed number of map units -- thirty-two and five
   * hundred and twelve -- and are approximated by the room's own limits instead.
   *
   * A fixed rise cannot be carried across honestly: this game's map unit is not
   * the original's, and five hundred and twelve of them is either thirteen metres
   * or twenty depending on which of this project's scales you believe. Four lines
   * in total, and a floor that rises as far as the room allows is closer to what
   * the mapper wanted than a floor that rises through the ceiling.
   */
  [140, { surface: 'floor', target: 'lowestCeiling', fast: false, expect: 'up' }],
  [14, { surface: 'floor', target: 'nextHigherFloor', fast: false, expect: 'up' }],
  // A ceiling that rises out of the way, which is the one special here that
  // moves a ceiling upward rather than opening it like a door.
  [40, { surface: 'ceiling', target: 'highestCeiling', fast: false, expect: 'up' }],
  // Floors that drop, to their neighbours or to the lowest of them.
  [45, { surface: 'floor', target: 'highestFloor', fast: false, expect: 'down' }],
  [60, { surface: 'floor', target: 'lowestFloor', fast: false, expect: 'down' }],
  [82, { surface: 'floor', target: 'lowestFloor', fast: false, expect: 'down' }],
  // And floors that step up once, which is the commonest of all of these: a
  // hundred and one lines across the two files.
  [47, { surface: 'floor', target: 'nextHigherFloor', fast: false, expect: 'up' }],
  [68, { surface: 'floor', target: 'nextHigherFloor', fast: false, expect: 'up' }],
  [69, { surface: 'floor', target: 'nextHigherFloor', fast: false, expect: 'up' }],
  [119, { surface: 'floor', target: 'nextHigherFloor', fast: false, expect: 'up' }],
  [128, { surface: 'floor', target: 'nextHigherFloor', fast: false, expect: 'up' }],
  [22, { surface: 'floor', target: 'nextHigherFloor', fast: false, expect: 'up' }],
  [129, { surface: 'floor', target: 'nextHigherFloor', fast: true, expect: 'up' }],
  [130, { surface: 'floor', target: 'nextHigherFloor', fast: true, expect: 'up' }],
  [131, { surface: 'floor', target: 'nextHigherFloor', fast: true, expect: 'up' }],
  // A platform that drops, waits and comes back, which is a lift worked by
  // crossing a line rather than by standing on it.
  [121, { surface: 'floor', target: 'lowestFloor', fast: true, expect: 'down', wait: 3 }],
  /*
   * The crushers, which are the first machines here that do not give way.
   *
   * Sixty-four lines on twelve maps, and every one of them was a plain wall --
   * so a room built as a trap was a room you walked through. They are the same
   * mover with two differences: it comes down to the floor rather than stopping
   * at somebody's ceiling, and a body underneath is reported rather than backed
   * off. What that costs is the page's business.
   *
   * They rest at the top and are worked once. `wait` is the pause up there
   * before each descent and `cycles` the pause on the floor before the next --
   * both short, because a crusher you can walk under between blows is a puzzle
   * rather than a trap.
   */
  [25, { surface: 'ceiling', target: 'ownFloor', fast: false, expect: 'down', crushes: true, crushing: true, cycles: 0.6, wait: 0.6 }],
  [49, { surface: 'ceiling', target: 'ownFloor', fast: false, expect: 'down', crushes: true, crushing: true, cycles: 0.6, wait: 0.6 }],
  [141, { surface: 'ceiling', target: 'ownFloor', fast: false, expect: 'down', crushes: true, crushing: true, cycles: 0.6, wait: 0.6 }],
  [6, { surface: 'ceiling', target: 'ownFloor', fast: true, expect: 'down', crushes: true, crushing: true, cycles: 0.3, wait: 0.3 }],
  [77, { surface: 'ceiling', target: 'ownFloor', fast: true, expect: 'down', crushes: true, crushing: true, cycles: 0.3, wait: 0.3 }],
  /*
   * And the platform that never stops, which is the same idea without the
   * cruelty: it backs off a body the way every door here does and simply keeps
   * going up and down until the level ends.
   */
  [53, { surface: 'floor', target: 'lowestFloor', fast: false, expect: 'down', cycles: 2, wait: 2 }],
  /*
   * The tail: nine numbers with one line each, on nine different maps.
   *
   * Worth the nine rows precisely because they are one line each. A special that
   * appears five hundred times is one a player meets whatever this importer does
   * about it; a special that appears once is the only way through one room on one
   * map, and the person who meets it has no idea the rest of the game works.
   *
   * 9 is the odd one. The original's "donut" lowers a room and raises the ring
   * around it in one move, which is two machines and a geometry test this
   * importer has no other use for. It arrives as the lowering half, which is the
   * half that opens the way.
   */
  [58, { surface: 'floor', target: 'nextHigherFloor', fast: false, expect: 'up' }],
  [83, { surface: 'floor', target: 'highestFloor', fast: false, expect: 'down' }],
  [70, { surface: 'floor', target: 'highestFloor', fast: true, expect: 'down' }],
  [9, { surface: 'floor', target: 'lowestFloor', fast: false, expect: 'down' }],
  [86, { surface: 'ceiling', target: 'lowestCeiling', fast: false, expect: 'up' }],
  [115, { surface: 'ceiling', target: 'lowestCeiling', fast: true, expect: 'up' }],
  [75, { surface: 'ceiling', target: 'ownFloor', fast: false, expect: 'down' }],
  [107, { surface: 'ceiling', target: 'ownFloor', fast: true, expect: 'down' }],
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
 *   46 was out for exactly one reason and is now in. Its geometry was always
 *   fine -- eighteen of the twenty-two rooms its twenty-six lines name are shut
 *   the way a door is shut -- and what was missing was that a bullet stopping
 *   on a wall was not something the level could hear. That is a third way of
 *   working a machine rather than a fourth kind of machine.
 */

/** Which of these are worked by pressing, rather than by walking across. */
const PRESSED = new Set([
  103, 112, 61, 63, 23, 102, 71, 18, 20, 49,
  // The locked ones, all of which are switch plates.
  99, 133, 134, 135, 136, 137,
  // And the rest the original's `P_UseSpecialLine` answers for.
  114, 101, 64, 45, 60, 68, 69, 131, 140, 14,
  // And the tail's switches.
  70, 9, 115,
])

/** And which are worked by being shot, which is neither of those. */
const SHOT = new Set([46, 24, 47])

export interface TaggedMachines {
  /** The movers to add to the level, in the order they were made. */
  readonly movers: Mover[]
  /** Walls that work them when pressed. */
  readonly pressed: Map<Line, readonly Mover[]>
  /** Lines that work them when crossed. */
  readonly crossed: Map<Line, readonly Mover[]>
  /** And walls that work them when a shot stops on them. */
  readonly shot: Map<Line, readonly Mover[]>
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
  const shot = new Map<Line, readonly Mover[]>()

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
      /*
       * Headroom only where the far end is somebody else's ceiling.
       *
       * An opening door stops a little short of the lowest neighbouring ceiling,
       * which is the original's arrangement and what keeps a doorway looking like
       * a doorway. A door travelling to its own floor is shutting, and shutting
       * short of the floor would leave a gap you could see through.
       */
      const working = kind.target === 'lowestCeiling' ? target - HEADROOM : target
      /*
       * Two ends: where it rests and where it works to.
       *
       * Naming them that way rather than "shut" and "open" is what lets a crusher
       * be the same machine as a door. `updateMovers` notices a body in the way
       * only on the stroke toward `shut`, which for a door is the way home and for
       * a crusher is the whole point -- so a crusher's resting end is its `open`
       * and its working end is its `shut`, and everything else is the other way
       * round.
       *
       * A machine that would not move is not a machine, and one that moves the
       * wrong way is worse, so the direction is declared in the table: a map whose
       * geometry disagrees with its own special gets no machine.
       */
      if (Math.abs(working - rest) < 1e-9) continue
      if (kind.expect === 'up' && working < rest) continue
      if (kind.expect === 'down' && working > rest) continue

      const made: MoverKind = {
        surface: kind.surface,
        shut: kind.crushing === true ? working : rest,
        open: kind.crushing === true ? rest : working,
        speed: kind.fast ? FAST_SPEED : SPEED,
        /*
         * Usually none: most of these stay where they are put, because a tagged
         * door that shut itself again would need something to decide when and the
         * original's answer for that is a different special. The ones that do
         * come back say so in the table -- and for the doors that *close*, the
         * far end is shut, so this is the pause before they open again.
         */
        wait: kind.wait ?? 0,
        ...(kind.key === undefined ? {} : { requiresKey: kind.key }),
        ...(kind.cycles === undefined ? {} : { cycles: kind.cycles }),
        ...(kind.crushes === undefined ? {} : { crushes: kind.crushes }),
        // A machine whose working stroke is the way down also rests at the top,
        // which is one fact rather than two: without it the room would load
        // already crushed.
        ...(kind.crushing === undefined ? {} : { startsOpen: kind.crushing }),
      }
      madeFor.set(sector, movers.length)
      const mover = makeMover(sector, made)
      movers.push(mover)
      worked.push(mover)
    }

    if (worked.length === 0) continue
    const into = SHOT.has(entry.special)
      ? shot
      : PRESSED.has(entry.special)
        ? pressed
        : crossed
    into.set(entry.line, [...(into.get(entry.line) ?? []), ...worked])
  }

  return { movers, pressed, crossed, shot }
}

/** The height a named room's surface is measured against, or null. */
function targetFor(level: Level, sector: number, want: Target): number | null {
  const here = level.sectors[sector]
  if (here === undefined) return null

  // The one target that needs no neighbour: a door that closes travels to its own
  // floor, which is where a shut door's ceiling is.
  if (want === 'ownFloor') return here.floor

  let found: number | null = null
  for (const line of level.lines) {
    if (line.back === null) continue
    const other = line.front === sector ? line.back : line.back === sector ? line.front : null
    if (other === null || other === sector) continue
    const room = level.sectors[other]
    if (room === undefined) continue
    const value = want === 'lowestCeiling' || want === 'highestCeiling' ? room.ceiling : room.floor
    // The next step up is the lowest neighbour that is still above this room,
    // so neighbours at or below it are not candidates at all. Everything else
    // takes every neighbour and then picks an end.
    if (want === 'nextHigherFloor') {
      if (value <= here.floor) continue
      found = found === null ? value : Math.min(found, value)
      continue
    }
    if (found === null) found = value
    else if (want === 'highestFloor' || want === 'highestCeiling') found = Math.max(found, value)
    else found = Math.min(found, value)
  }
  return found
}
