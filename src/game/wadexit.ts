/**
 * Where a map from a file ends.
 *
 * This engine finishes a level when the body walks into a particular sector.
 * The original finishes one when the body crosses a particular *line*, or
 * presses a switch on one, which is two different machines and only the first
 * of them fits what is here: crossing a line means arriving in the room beyond
 * it, and arriving in a room is a question this game already asks every step.
 *
 * Both come across now, by two different routes. A walk-over exit becomes the
 * room across the line, because arriving there is what crossing it means. A
 * switch is the line itself: you face that piece of wall and press it, and
 * thirty-two of the thirty-five such lines here have nothing behind them at
 * all, so there is no room to name. Counted across the two files this was
 * built against: thirty-six of the sixty-eight maps end on a line you walk
 * over, thirty-two on one you press, and no map has neither.
 *
 * Secret exits are treated as exits. There is nothing secret to go to.
 */

import type { Line } from '../columns/level.ts'
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

/**
 * The specials that end a level by being pressed.
 *
 * 11 is the ordinary one, 51 the secret variant. Thirty-two of the sixty-eight
 * maps here end this way, which is why leaving them out left half the set
 * unfinishable.
 */
const SWITCHED = new Set([11, 51])

/**
 * The pieces of wall that end the level when pressed.
 *
 * The line itself rather than a sector, and no requirement that anything lie
 * behind it: of the thirty-five such lines across these files, thirty-two have
 * nothing on their far side. That is the whole reason this needed a way to
 * face a *line* -- the machinery that finds doors looks for the room across
 * the line you are facing, and for a switch there is no room.
 */
export function switchExitLines(specials: readonly LineSpecial[]): Set<Line> {
  const lines = new Set<Line>()
  for (const entry of specials) {
    if (SWITCHED.has(entry.special)) lines.add(entry.line)
  }
  return lines
}

/** Every special this importer finishes a level on when pressed, for checks. */
export function switchExitSpecials(): number[] {
  return [...SWITCHED]
}
