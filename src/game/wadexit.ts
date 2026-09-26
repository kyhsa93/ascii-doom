/**
 * Where a map from a file ends.
 *
 * This engine finishes a level when the body walks into a particular sector.
 * The original finishes one when the body crosses a particular *line*, or
 * presses a switch on one, which is two different machines and only the first
 * of them fits what is here: crossing a line means arriving in the room beyond
 * it, and arriving in a room is a question this game already asks every step.
 *
 * So the walk-over exits come across and the switches do not, which is worth
 * being plain about because it is half the maps. Counted across the two files
 * this was built against: thirty-six of the sixty-eight end on a line you walk
 * over, thirty-two on a switch you press, and no map has neither. A switch exit
 * wants a way to press a line rather than a sector, which this game has no
 * notion of yet.
 *
 * Secret exits are treated as exits. There is nothing secret to go to.
 */

import type { LineSpecial } from '../columns/wad.ts'

/**
 * The specials that end a level by being walked over.
 *
 * 52 is the ordinary one and 124 the secret variant; on these files the first
 * appears on thirty-six maps and the second on four.
 */
const WALK_OVER = new Set([52, 124])

/**
 * The sector a map's exit line leads into, or null for a map this game cannot
 * finish.
 *
 * The line's far side, because that is where crossing it puts you -- and being
 * there is the only thing `reachExit` can notice. A line with nothing on its
 * far side is skipped: it cannot be walked across, whatever it claims.
 *
 * The first one wins. A wide doorway is several lines carrying the same
 * special -- as many as ten on one map here -- and they usually open into the
 * same room; where they do not, the rest are simply not the exit.
 */
export function exitSectorFrom(specials: readonly LineSpecial[]): number | null {
  for (const line of specials) {
    if (!WALK_OVER.has(line.special)) continue
    if (line.back === null) continue
    return line.back
  }
  return null
}

/** Every special this importer can finish a level on, for checks to count against. */
export function walkOverExitSpecials(): number[] {
  return [...WALK_OVER]
}
