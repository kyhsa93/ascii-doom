/**
 * The doors in a map that came from a file.
 *
 * Only the ones you open by pressing them. In the original a door is not a
 * property of a room, it is a number on a line, and there are two families of
 * them: a line that opens *the sector behind it*, and a line that opens every
 * sector carrying some tag. The first is what this engine already models --
 * `moverInFront` finds the sector across the line you are facing -- and the
 * second wants a tag table and a notion of a switch, which this game does not
 * have. So the untagged ones come across and the rest are left alone.
 *
 * On the maps this was built against that is not a small corner: six hundred
 * and ninety-two of them in the first file, against a few dozen tagged door
 * specials.
 *
 * Nothing about the original's art or naming is reproduced. What is read is a
 * number on a line and the heights of the rooms either side of it.
 */

import type { Level } from '../columns/level.ts'
import type { LineSpecial } from '../columns/wad.ts'
import { UNITS_PER_METRE } from '../columns/wad.ts'
import type { MoverKind } from './movers.ts'
import { keyColourOf } from './waditems.ts'

/**
 * How far below the lowest neighbouring ceiling a door stops.
 *
 * Four map units, which is the original's own gap and is why a doorway never
 * quite reaches the ceiling of the room it opens into.
 */
const HEADROOM = 4 / UNITS_PER_METRE

/**
 * Metres per second.
 *
 * Not the original's speed. A door there travels about sixty centimetres a
 * second, which next to the doors written for this game -- they run at two and
 * a bit -- reads as a fault rather than as a style. So these match the ones
 * here, and the fast variants keep their character by being twice that.
 */
const SPEED = 2.2
const FAST_SPEED = 4.4

/** Seconds a door that closes itself stays open, which the original agrees with. */
const WAIT = 4

/**
 * The manual door specials, and what each one is.
 *
 * `stays` is the difference between a door that shuts behind you and one that
 * is open for good. `key` is the colour asked for, read from the same table
 * the key items are read from -- so a colour I have remembered wrongly is
 * wrong on both sides of the same lock, and the level stays as completable as
 * it ever was.
 */
const MANUAL = new Map<number, { stays: boolean; fast: boolean; keyThing: number | null }>([
  [1, { stays: false, fast: false, keyThing: null }],
  [31, { stays: true, fast: false, keyThing: null }],
  [117, { stays: false, fast: true, keyThing: null }],
  [118, { stays: true, fast: true, keyThing: null }],
  [26, { stays: false, fast: false, keyThing: 5 }],
  [27, { stays: false, fast: false, keyThing: 6 }],
  [28, { stays: false, fast: false, keyThing: 13 }],
  [32, { stays: true, fast: false, keyThing: 5 }],
  [33, { stays: true, fast: false, keyThing: 13 }],
  [34, { stays: true, fast: false, keyThing: 6 }],
])

/** A door this importer can make, once the geometry has been measured. */
export interface WadDoor {
  readonly sector: number
  readonly kind: MoverKind
}

/**
 * The lowest ceiling among the rooms that share a wall with this one.
 *
 * What a door opens to. It is not a constant: across one file the gap between
 * a shut door and its opening runs from sixty map units to a hundred and
 * twenty-four, so a fixed height would be wrong for nearly every one of them.
 */
function lowestNeighbourCeiling(level: Level, sector: number): number | null {
  let lowest: number | null = null
  for (const line of level.lines) {
    if (line.back === null) continue
    const other = line.front === sector ? line.back : line.back === sector ? line.front : null
    if (other === null || other === sector) continue
    const ceiling = level.sectors[other]?.ceiling
    if (ceiling === undefined) continue
    if (lowest === null || ceiling < lowest) lowest = ceiling
  }
  return lowest
}

/**
 * The doors a map's line specials describe.
 *
 * Tagged lines are skipped: they act on somewhere else, and this cannot say
 * where. A line with nothing behind it is skipped too -- a manual door is the
 * room on the far side, and there is no far side.
 */
export function doorsFrom(level: Level, specials: readonly LineSpecial[]): WadDoor[] {
  const doors: WadDoor[] = []
  const claimed = new Set<number>()

  for (const line of specials) {
    const manual = MANUAL.get(line.special)
    if (!manual || line.tag !== 0 || line.back === null) continue
    // A door often has its special on both of its sides' lines; the first wins
    // rather than the sector gaining two machines that fight each other.
    if (claimed.has(line.back)) continue

    const room = level.sectors[line.back]
    if (!room) continue
    const lowest = lowestNeighbourCeiling(level, line.back)
    if (lowest === null) continue

    const open = lowest - HEADROOM
    // A door that would open downwards is not a door. `updateMovers` travels
    // toward whichever height it is given without asking which way that is, so
    // one of these left in would close upward in silence.
    if (open <= room.ceiling) continue

    const colour = manual.keyThing === null ? null : keyColourOf(manual.keyThing)
    doors.push({
      sector: line.back,
      kind: {
        surface: 'ceiling',
        shut: room.ceiling,
        open,
        speed: manual.fast ? FAST_SPEED : SPEED,
        wait: manual.stays ? 0 : WAIT,
        ...(colour === null ? {} : { requiresKey: colour }),
      },
    })
    claimed.add(line.back)
  }

  return doors
}

/** Every special this importer treats as a door, for checks to count against. */
export function manualDoorSpecials(): number[] {
  return [...MANUAL.keys()]
}
