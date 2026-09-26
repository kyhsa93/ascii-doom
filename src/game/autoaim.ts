/**
 * Aiming the shot for you, for the devices that cannot aim it themselves.
 *
 * Turning on a phone is a rate: you hold a thumb away from where it landed and
 * the view keeps swinging. That is the right control for looking around a room
 * and the wrong one for putting a crosshair on something three cells wide, and
 * no amount of tuning fixes it -- a rate control has no resting position to
 * settle on. So on a touch device the shot is aimed at what you are looking at
 * rather than at exactly where the body happens to be pointing.
 *
 * The shot rather than the body. Turning the player would fight the thumb that
 * is already turning it, and would move the whole picture to make one bullet
 * land; the original bent its shots the same way, vertically, for the same
 * reason -- the aim its players had was not fine enough for the geometry.
 *
 * Three conditions, all of them things a player would say out loud. It has to
 * be alive, it has to be something you could see -- `lineOfSight`, the same
 * rule that decides whether a creature has noticed you -- and it has to be on
 * screen, because being aimed at something outside the picture is indisting-
 * uishable from the gun firing somewhere at random. Among those, the nearest.
 *
 * One honest gap. Sight is tested along a line from your eye to the creature's,
 * which slopes; the shot travels level from your eye. A target far above or
 * below can pass one test and fail the other, and then the help picks something
 * the bullet cannot reach. Nothing here pretends otherwise -- the shot is still
 * resolved by the same tracer it always was, so the miss is a real miss.
 */

import { lineOfSight, type Level } from '../columns/level.ts'
import { isAlive, normalizeAngle, type Actor } from './ai.ts'
import type { Body } from './player.ts'

export interface AimTarget {
  /** Index into the array handed in, so the caller can find it again. */
  readonly index: number
  /** The direction to fire, in radians. */
  readonly angle: number
  /** How far away it is, in metres. */
  readonly distance: number
}

/**
 * The nearest creature worth aiming at, or null when there is nothing to help
 * with.
 *
 * `halfAngle` is how far either side of straight ahead counts, and the caller
 * passes the edge of the screen: a thing you cannot see is a thing you did not
 * mean. Nearest by distance rather than nearest to the crosshair, because on a
 * phone the one about to reach you is the one you meant, whichever side of the
 * picture it is on.
 */
export function aimAt(
  level: Level,
  shooter: Body & { angle: number },
  eye: number,
  actors: readonly Actor[],
  halfAngle: number,
): AimTarget | null {
  const az = shooter.floor + eye
  let best: AimTarget | null = null

  for (let index = 0; index < actors.length; index++) {
    const actor = actors[index]!
    if (!isAlive(actor)) continue

    const dx = actor.x - shooter.x
    const dy = actor.y - shooter.y
    const distance = Math.hypot(dx, dy)
    if (distance < 1e-6) continue
    // Cheap tests first, and the distance before the ray: anything no nearer
    // than the best so far cannot win, so it is not worth casting for.
    if (best !== null && distance >= best.distance) continue

    const angle = Math.atan2(dy, dx)
    if (Math.abs(normalizeAngle(angle - shooter.angle)) > halfAngle) continue

    if (
      !lineOfSight(
        level,
        shooter.sector,
        shooter.x,
        shooter.y,
        az,
        actor.x,
        actor.y,
        actor.floor + actor.kind.eye,
      )
    ) {
      continue
    }

    best = { index, angle, distance }
  }

  return best
}
