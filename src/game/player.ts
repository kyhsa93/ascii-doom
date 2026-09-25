/**
 * Moving through the map, and what stops you.
 *
 * The rules are the original's, and all three of them come from the same idea:
 * a player is a cylinder, and a line is passable when the gap it opens is tall
 * enough to stand in and its floor is low enough to step onto. Nothing is
 * flagged as a door or a ledge — a shut door is a portal whose ceiling has
 * been driven down to its floor, and the first rule rejects it without knowing
 * what a door is.
 *
 * Collision is resolve-by-pushing rather than reject-the-move: the position is
 * advanced first and then pushed back out of anything it ended up inside. That
 * is what makes a wall you walk into at an angle slide you along it instead of
 * stopping you dead, which is most of what running through a level feels like.
 */

import { sectorAt, type Level, type Line } from '../columns/level.ts'

/** Half the width of the player's cylinder. */
export const PLAYER_RADIUS = 0.35
/** Eye above the floor being stood on. */
export const EYE_HEIGHT = 1.6
/** Total height, which is what an opening has to clear for you to pass. */
export const PLAYER_HEIGHT = 1.75
/**
 * The tallest step that can be walked up.
 *
 * Roughly the original's proportion, a little under half of eye height.
 * Anything higher needs stairs or a lift, which is a level design decision
 * rather than a physics one.
 */
export const STEP_HEIGHT = 0.7

export interface Player {
  x: number
  y: number
  /** Yaw in radians; 0 faces +x. */
  angle: number
  sector: number
  /** Height of the floor underfoot. */
  floor: number
}

export function spawnPlayer(level: Level, x: number, y: number, angle: number): Player {
  const sector = sectorAt(level, x, y)
  if (sector < 0) throw new Error(`spawn point (${x}, ${y}) is outside the map`)
  return { x, y, angle, sector, floor: level.sectors[sector]!.floor }
}

/** Where the eye sits, which is the only height the renderer needs. */
export function eyeHeight(player: Player): number {
  return player.floor + EYE_HEIGHT
}

/**
 * Whether a line stops a player standing on a floor at `standingFloor`.
 *
 * Deliberately independent of which side the player is on. The opening a
 * two-sided line leaves is the same from both directions — the higher of the
 * two floors up to the lower of the two ceilings — and the only asymmetric
 * part, whether that floor is a step up or a step down, is answered by
 * comparing it against the floor already underfoot.
 */
function blocks(level: Level, line: Line, standingFloor: number): boolean {
  if (line.back === null || line.blocking) return true
  const front = level.sectors[line.front]!
  const back = level.sectors[line.back]!
  const openingTop = Math.min(front.ceiling, back.ceiling)
  const openingBottom = Math.max(front.floor, back.floor)
  if (openingTop - openingBottom < PLAYER_HEIGHT) return true
  if (openingBottom - standingFloor > STEP_HEIGHT) return true
  return false
}

/** The point on a segment nearest to a position, clamped to the ends. */
function closestOnSegment(px: number, py: number, line: Line, out: [number, number]): void {
  const ex = line.bx - line.ax
  const ey = line.by - line.ay
  const length2 = ex * ex + ey * ey
  if (length2 < 1e-12) {
    out[0] = line.ax
    out[1] = line.ay
    return
  }
  let t = ((px - line.ax) * ex + (py - line.ay) * ey) / length2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  out[0] = line.ax + ex * t
  out[1] = line.ay + ey * t
}

const scratch: [number, number] = [0, 0]

/**
 * Advances the player by a step in map coordinates, sliding along anything
 * solid it runs into.
 *
 * A move that would end outside the map is refused entirely rather than
 * partly. That case means the pushing above failed to keep the player inside —
 * two walls meeting at a sharp angle can push a position out through the far
 * side — and standing still for one frame is a great deal better than falling
 * out of the world.
 */
export function movePlayer(level: Level, player: Player, dx: number, dy: number): void {
  let nx = player.x + dx
  let ny = player.y + dy

  // A handful of passes, because pushing out of one wall can push into
  // another. Three settles a corner; more would only hide a map that has the
  // player wedged into a gap narrower than they are.
  for (let pass = 0; pass < 3; pass++) {
    let touched = false
    for (const line of level.lines) {
      if (!blocks(level, line, player.floor)) continue
      closestOnSegment(nx, ny, line, scratch)
      const ox = nx - scratch[0]
      const oy = ny - scratch[1]
      const distance = Math.hypot(ox, oy)
      if (distance >= PLAYER_RADIUS) continue
      touched = true
      if (distance < 1e-9) {
        // Exactly on the line, so there is no direction to be pushed along.
        // Undo the step instead; the next frame will try again from outside.
        nx = player.x
        ny = player.y
        continue
      }
      const push = (PLAYER_RADIUS - distance) / distance
      nx += ox * push
      ny += oy * push
    }
    if (!touched) break
  }

  const sector = sectorAt(level, nx, ny)
  if (sector < 0) return

  player.x = nx
  player.y = ny
  player.sector = sector
  player.floor = level.sectors[sector]!.floor
}
