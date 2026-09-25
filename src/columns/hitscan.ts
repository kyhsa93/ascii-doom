/**
 * Where a shot stops, and what it hits on the way.
 *
 * Two questions with arithmetic answers, which is why they live here rather
 * than with the weapons. How far a bullet carries is the map's business: it
 * walks portals exactly the way sight does, passing through an opening only if
 * the shot's height clears the floor and ducks the ceiling. What it hits is a
 * ray against upright cylinders, nearest first.
 *
 * Shots are horizontal. The original had no vertical aim for its hitscan
 * weapons either — you point at a creature in the map plane and the shot finds
 * it at whatever height it is standing — and that is not a simplification so
 * much as the thing that makes a keyboard-only shooter playable. A shot
 * travelling level from the eye also means one height for the whole trace,
 * which is what lets the portal walk use a single number.
 */

import { acrossFrom, castRay, openingBetween, type Level, type RayHit } from './level.ts'

/** Anything a shot can hit: a position and a radius, and nothing else. */
export interface ShotBody {
  readonly x: number
  readonly y: number
  readonly radius: number
}

export interface ShotHit {
  /** Index into the array of bodies handed in. */
  readonly index: number
  /** How far along the shot the body sits. */
  readonly distance: number
}

export interface ShotResult {
  /** Where the shot ended: a body, a wall, or the end of its range. */
  readonly distance: number
  /** Where it stopped in the map plane, for a spark or a scorch mark. */
  readonly x: number
  readonly y: number
  /** What it hit, or null if it met a wall or simply ran out. */
  readonly hit: ShotHit | null
}

const scratchHits: RayHit[] = []

/**
 * How far a level shot carries from a point before meeting something solid.
 *
 * Exported because a creature about to fire wants the same answer, and because
 * it is the half of a shot that has nothing to do with who is standing where.
 */
export function wallDistance(
  level: Level,
  fromSector: number,
  ox: number,
  oy: number,
  height: number,
  dx: number,
  dy: number,
  range: number,
): number {
  if (fromSector < 0) return 0
  castRay(level, ox, oy, dx, dy, range, scratchHits)

  let current = fromSector
  for (const hit of scratchHits) {
    const next = acrossFrom(hit.line, current)
    if (next < 0) return hit.t
    const opening = openingBetween(level, current, next)
    if (!opening) return hit.t
    if (height <= opening.bottom || height >= opening.top) return hit.t
    current = next
  }
  return range
}

/**
 * Traces one shot and reports the first body it meets.
 *
 * `bodies` is searched linearly, which at a few dozen creatures is nothing
 * beside the wall walk it shares a frame with. A body behind the wall the shot
 * stops at is not hit, which is the case a naive nearest-body search gets
 * wrong and the reason the wall distance is found first.
 */
export function traceShot(
  level: Level,
  fromSector: number,
  ox: number,
  oy: number,
  height: number,
  angle: number,
  range: number,
  bodies: readonly ShotBody[],
  alive: (index: number) => boolean = () => true,
): ShotResult {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const limit = wallDistance(level, fromSector, ox, oy, height, dx, dy, range)

  let best: ShotHit | null = null
  for (let index = 0; index < bodies.length; index++) {
    if (!alive(index)) continue
    const body = bodies[index]!
    const toX = body.x - ox
    const toY = body.y - oy
    // How far along the shot the body's centre projects, and how far off the
    // line it sits. Behind the muzzle is not a target.
    const along = toX * dx + toY * dy
    if (along <= 0 || along > limit) continue
    const offX = toX - dx * along
    const offY = toY - dy * along
    if (Math.hypot(offX, offY) > body.radius) continue
    if (best === null || along < best.distance) best = { index, distance: along }
  }

  const distance = best ? best.distance : limit
  return { distance, x: ox + dx * distance, y: oy + dy * distance, hit: best }
}
