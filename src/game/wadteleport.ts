/**
 * Teleport lines, and the pads they arrive on.
 *
 * Second only to plain doors in how often the original's level designers reach
 * for it: fifty-one of the sixty-eight maps in the two files this was built
 * against carry one, across eight hundred and sixty-three lines. A map with a
 * teleport and no way to take it is a map with rooms you can see and cannot
 * reach, which is why this comes before anything else that a crossed line does.
 *
 * The arrangement in the file has three parts and all three must agree: a line
 * carries special 97 (or 39, the one-shot form), the line names a tag, and a
 * thing of type 14 stands in a sector wearing that tag. Measured across those
 * files: every one of the fifty-one maps has all three, with four hundred and
 * forty-five pads between them -- so nothing here has to guess what to do with
 * a teleport whose destination is missing, beyond declining to make it.
 *
 * What this module does not do is move anybody. It answers "where does this
 * line send you", which is a question about a file; arriving is the page's job.
 */

import type { Line } from '../columns/level.ts'
import type { LineSpecial, WadThing } from '../columns/wad.ts'

/** The thing type that marks where a teleport arrives. */
const PAD = 14

/**
 * Walk-over teleports: 97 repeats, 39 works once.
 *
 * The monster-only variants (125, 126) are left out. They are the same machine
 * pointed at bodies this game does not teleport, and 126 appears on forty-one
 * of these maps -- taking them would send the player through lines the original
 * never lets them use.
 */
const WALK_OVER = new Map<number, { once: boolean }>([
  [97, { once: false }],
  [39, { once: true }],
])

export interface Teleport {
  /** Where the body lands, in map units. */
  readonly x: number
  readonly y: number
  /** Which way it faces on arrival -- the pad's own angle, as the original does. */
  readonly angle: number
  readonly sector: number
  /** Whether the line stops working after one use. */
  readonly once: boolean
}

/** Every special this importer treats as a teleport, for checks to count against. */
export function teleportSpecials(): number[] {
  return [...WALK_OVER.keys()]
}

/**
 * Which line sends a body where.
 *
 * A tag of zero is refused before it is looked up, the same lock the lifts
 * carry: zero is what the format writes on an ordinary sector, so one stray
 * zero would turn every untagged room in the map into a destination.
 *
 * Where a tag names several pads the first in the file wins. The original picks
 * among them and this does not, which costs nothing on these maps -- the pads a
 * single tag names stand in the same room as each other.
 */
export function teleportsFrom(
  specials: readonly LineSpecial[],
  things: readonly WadThing[],
  tagged: ReadonlyMap<number, readonly number[]>,
): Map<Line, Teleport> {
  const pads = things.filter((thing) => thing.type === PAD && thing.sector >= 0)
  const found = new Map<Line, Teleport>()

  for (const entry of specials) {
    const kind = WALK_OVER.get(entry.special)
    if (kind === undefined || entry.tag === 0) continue

    const rooms = tagged.get(entry.tag)
    if (rooms === undefined) continue
    const pad = pads.find((thing) => rooms.includes(thing.sector))
    if (pad === undefined) continue

    found.set(entry.line, {
      x: pad.x,
      y: pad.y,
      angle: pad.angle,
      sector: pad.sector,
      once: kind.once,
    })
  }
  return found
}
