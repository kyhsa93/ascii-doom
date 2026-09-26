/**
 * Which lines a step crossed.
 *
 * The one thing this engine never had. A door in the original is often not
 * something you press but something you walk through the line of, and the same
 * is true of most lifts, most floor moves, and every teleport -- so a map whose
 * only way on is a line you cross was a map that stopped where that line was.
 *
 * A step is a segment. The body was at one point at the start of the frame and
 * is at another at the end of it, and the question is which of the map's lines
 * lie between. That is a segment-segment intersection and nothing more; what it
 * deliberately is not is a test of where the body *is*, which is what the exit
 * importer had to approximate with "the room across the line" because this did
 * not exist.
 *
 * Two things the original cares about come out of the same arithmetic and are
 * returned rather than decided here:
 *
 *   - which way it was crossed, because a lift line called from the back is a
 *     line that does nothing, and
 *   - the order of the crossings, because one step at running speed can pass
 *     through two lines and they must fire in the order they were met.
 */

import type { Line } from './level.ts'

export interface Crossing {
  readonly line: Line
  /** How far along the step it happened, 0 at the start and 1 at the end. */
  readonly at: number
  /**
   * Which side it was entered from.
   *
   * `true` when the body came from the line's front -- its right-hand side, the
   * side the file's first sidedef faces. The original refuses several specials
   * crossed from the back and this is what that question is asked of.
   */
  readonly fromFront: boolean
}

/**
 * Every line in `lines` that the step from (ax, ay) to (bx, by) passed through,
 * in the order it met them.
 *
 * A step that does not move returns nothing rather than everything it is
 * standing on: a body resting exactly on a line has not crossed it, and saying
 * otherwise would fire it sixty times a second.
 */
export function crossings(
  lines: readonly Line[],
  ax: number,
  ay: number,
  bx: number,
  by: number,
): Crossing[] {
  const found: Crossing[] = []
  const dx = bx - ax
  const dy = by - ay
  if (dx === 0 && dy === 0) return found

  for (const line of lines) {
    const ex = line.bx - line.ax
    const ey = line.by - line.ay
    // The denominator is the cross product of the two directions. Zero means
    // parallel -- including a step running exactly along the line, which is a
    // step that never gets to the other side.
    const denominator = dx * ey - dy * ex
    if (denominator === 0) continue

    const rx = line.ax - ax
    const ry = line.ay - ay
    const at = (rx * ey - ry * ex) / denominator
    const along = (rx * dy - ry * dx) / denominator
    // Both ends open at the start and closed at the end, so a step that begins
    // exactly on a line does not re-fire it and one that ends on it does. The
    // alternative loses the crossing entirely for a body that stops on the
    // line, which is what standing in a doorway is.
    if (at <= 0 || at > 1) continue
    if (along < 0 || along > 1) continue

    found.push({ line, at, fromFront: denominator < 0 })
  }

  found.sort((one, other) => one.at - other.at)
  return found
}
