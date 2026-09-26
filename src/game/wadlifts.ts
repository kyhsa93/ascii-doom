/**
 * The lifts in a map that came from a file.
 *
 * A lift in the original is a platform that starts raised, drops to the floor
 * of the lowest room touching it, waits, and climbs back. `MoverKind` says all
 * of that already -- a floor with two heights, a speed and a wait -- so nothing
 * new had to be built to make one move. What had to be built was a way to ask
 * for one.
 *
 * Doors did not need that. A manual door special carries no tag, which is the
 * format's way of saying "the room behind this line", and `moverInFront`
 * answers exactly that. Every lift line is the other kind: across the two files
 * this was built against, not one of the seven hundred and sixty-one of them
 * has a tag of zero. A tag names rooms somewhere else, and on eighty-three of
 * those lines it names more than one. So a lift is a line that calls a list of
 * platforms, and that is what this returns.
 *
 * Only the ones you press. Of the lift lines here, five hundred and sixty-five
 * across sixty-three maps are a switch on a wall and a hundred and ninety-six
 * across forty-seven are a line you walk over. This engine has no notion of
 * crossing a line -- the walk-over exit is imported as "the room across it",
 * which works for an exit because arriving is the point, and does not work for
 * a lift, where the trigger is usually nowhere near the platform. So the
 * walk-over family is left out, the way the tagged doors are.
 *
 * Sixty-eight of the switch lines have nothing behind them at all, which is the
 * same reason the switch exits needed `lineInFront`: there is no room across a
 * piece of wall.
 *
 * Nothing about the original's art or naming is reproduced. What is read is a
 * number on a line, a tag, and the floor heights of the rooms around one.
 */

import type { Level, Line } from '../columns/level.ts'
import type { LineSpecial } from '../columns/wad.ts'
import type { MoverKind } from './movers.ts'

/**
 * Metres per second, and unusually this one does not need choosing.
 *
 * The doors here run at this project's speed rather than the original's,
 * because the original's doors are slow enough next to these to read as a
 * fault. Lifts have no such clash: the lift written for the first level travels
 * at 1.4, and the original's platforms travel at about 1.35. The two agree, so
 * this is both.
 */
const SPEED = 1.4
/** The blazing variants, doubled the way the fast doors are rather than quadrupled. */
const FAST_SPEED = 2.8

/**
 * Seconds a platform rests at the bottom before climbing back.
 *
 * Three, which is the original's own figure. The doors could not take theirs
 * because this project already had doors with a feel to match; it has no
 * platform that returns by itself, so there is nothing here to disagree with.
 */
const WAIT = 3

/**
 * The lift specials this importer can make, and which of them are the fast kind.
 *
 * Counted rather than recalled, and the count corrected me twice. I expected
 * the plain walk-over and switch lifts -- 10 and 21 -- to carry most of these
 * maps; they appear zero times in either file. What is actually here is 62
 * (415 lines), 123 (149) and 122 (1).
 *
 * 122 is the once-only variant and is imported as a repeating one, because
 * nothing in this engine can be spent. That makes it more generous than the
 * original rather than less, which cannot strand anybody, and it is one line
 * out of five hundred and sixty-five.
 */
/**
 * The ones you walk across, now that a crossing is something this engine sees.
 *
 * 88 repeats and 120 is the fast form; between them they are on thirty-eight
 * and fifteen of these maps. Two hundred and five of the two hundred and eight
 * rooms they name are raised with somewhere to drop to, and the three that are
 * already at the bottom are refused by the same rule the switched ones use.
 */
const WALKED = new Map<number, { fast: boolean }>([
  [88, { fast: false }],
  [120, { fast: true }],
])

/** Every special this importer takes when it is crossed, for checks to count. */
export function walkLiftSpecials(): number[] {
  return [...WALKED.keys()]
}

const SWITCHED = new Map<number, { fast: boolean }>([
  [62, { fast: false }],
  [122, { fast: true }],
  [123, { fast: true }],
])

/** A platform this importer can make, once the rooms around it have been measured. */
export interface WadLift {
  readonly sector: number
  readonly kind: MoverKind
}

export interface WadLifts {
  readonly platforms: readonly WadLift[]
  /**
   * Which platforms each wall calls, as indices into `platforms`.
   *
   * Indices rather than the platforms themselves so that a sector called by two
   * different walls is one machine rather than two that fight each other over
   * the same floor. Lines with nothing left to call are absent rather than
   * present and empty, so a press can tell "not a lift" from "a lift that does
   * nothing".
   */
  readonly calls: ReadonlyMap<Line, readonly number[]>
  /**
   * And which platforms each *crossed* line calls, the same way.
   *
   * Separate from `calls` rather than flagged inside it, because the page asks
   * two different questions: a wall is what you are facing when you press use,
   * and a crossed line is one your last step passed through. A single table
   * would have to be filtered at both call sites, and one of them would
   * eventually forget.
   */
  readonly crossed: ReadonlyMap<Line, readonly number[]>
}

/**
 * The floor of the lowest room sharing a wall with this one.
 *
 * Where a platform goes when it is called. A twin of the door importer's
 * `lowestNeighbourCeiling` rather than a shared function with a switch in it:
 * the two ask about different surfaces for different reasons, and the thing
 * they have in common is six lines of loop.
 *
 * Measured rather than chosen, for the same reason the door heights are: across
 * these files the drop runs from four map units to thirteen hundred, with a
 * median of a hundred and twenty-eight.
 */
function lowestNeighbourFloor(level: Level, sector: number): number | null {
  let lowest: number | null = null
  for (const line of level.lines) {
    if (line.back === null) continue
    const other = line.front === sector ? line.back : line.back === sector ? line.front : null
    if (other === null || other === sector) continue
    const floor = level.sectors[other]?.floor
    if (floor === undefined) continue
    if (lowest === null || floor < lowest) lowest = floor
  }
  return lowest
}

/**
 * The lifts a map's line specials describe.
 *
 * A tag of zero is refused before anything is looked up. It would otherwise be
 * a catastrophe rather than a miss: zero is what the format writes on every
 * ordinary sector, so one lift line with a stray zero would turn every untagged
 * room in the map into a platform. The parser does not put zero in the table
 * for the same reason; this is the second lock on the same door.
 */
export function liftsFrom(
  level: Level,
  specials: readonly LineSpecial[],
  tagged: ReadonlyMap<number, readonly number[]>,
): WadLifts {
  const platforms: WadLift[] = []
  const madeFor = new Map<number, number>()
  const calls = new Map<Line, readonly number[]>()
  const crossed = new Map<Line, readonly number[]>()

  for (const entry of specials) {
    const switched = SWITCHED.get(entry.special) ?? WALKED.get(entry.special)
    if (!switched || entry.tag === 0) continue
    const byCrossing = WALKED.has(entry.special)

    const called: number[] = []
    for (const sector of tagged.get(entry.tag) ?? []) {
      const existing = madeFor.get(sector)
      if (existing !== undefined) {
        called.push(existing)
        continue
      }

      const room = level.sectors[sector]
      if (!room) continue
      const lowest = lowestNeighbourFloor(level, sector)
      if (lowest === null) continue
      // A platform already at the bottom is not a platform. Ninety-eight of the
      // six hundred and seventy-three rooms these lines point at are like that,
      // and `updateMovers` travels toward whatever height it is handed without
      // asking which way that is -- so one left in would rise when called.
      if (lowest >= room.floor) continue

      const index = platforms.length
      platforms.push({
        sector,
        kind: {
          surface: 'floor',
          // Shut is the raised position, which is where the file leaves it. The
          // names come from doors and read backwards here; what they mean is
          // "at rest" and "called", and a lift is at rest when it is up.
          shut: room.floor,
          open: lowest,
          speed: switched.fast ? FAST_SPEED : SPEED,
          wait: WAIT,
        },
      })
      madeFor.set(sector, index)
      called.push(index)
    }

    if (called.length === 0) continue
    const into = byCrossing ? crossed : calls
    into.set(entry.line, [...(into.get(entry.line) ?? []), ...called])
  }

  return { platforms, calls, crossed }
}

/** Every special this importer treats as a lift, for checks to count against. */
export function switchLiftSpecials(): number[] {
  return [...SWITCHED.keys()]
}
