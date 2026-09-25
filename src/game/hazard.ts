/**
 * Floors that hurt.
 *
 * A sector property rather than a kind of entity, which is how the original
 * does it and why it costs nothing: the body already knows which sector it is
 * standing in, because every step that moves it has to work that out anyway.
 *
 * Bites rather than a trickle. Damage applied per second would be a different
 * number every frame and would make a slow machine a harder game; the original
 * hurts you on a fixed clock, and a fixed clock is also the only version of
 * this with an answer a check can state — after so long, exactly this much.
 *
 * Creatures are not hurt by it. That is the original's behaviour and it is a
 * decision rather than an omission: sludge you could herd things into would
 * turn every hazard into a weapon, and the rooms here are built on the idea
 * that it is a cost you choose to pay.
 */

import type { Level } from '../columns/level.ts'

/**
 * Seconds between bites.
 *
 * Long enough that crossing a channel is a decision and not a death, short
 * enough that standing in one is obviously wrong.
 */
export const HURT_INTERVAL = 0.45

export interface Hazard {
  /** Seconds stood in it since the last bite. */
  standing: number
}

export function makeHazard(): Hazard {
  return { standing: 0 }
}

/** What standing in this sector costs per bite, or zero for ordinary ground. */
export function hurtOf(level: Level, sector: number): number {
  return level.sectors[sector]?.hurt ?? 0
}

/**
 * Advances the clock and returns the damage owed this step.
 *
 * The clock resets on leaving, so stepping through the edge of a channel costs
 * nothing and the first bite always lands a full interval after arriving. The
 * alternative -- banking the part-second -- means a corridor crossed in two
 * hops hurts as much as one stood in, which is the opposite of what the shape
 * of the room is telling you.
 *
 * The loop rather than a single subtraction is for a long frame: a tab that was
 * in the background owes every bite it was away for, not one.
 */
export function bite(level: Level, sector: number, hazard: Hazard, dt: number): number {
  const hurt = hurtOf(level, sector)
  if (hurt <= 0) {
    hazard.standing = 0
    return 0
  }

  hazard.standing += dt
  let damage = 0
  while (hazard.standing >= HURT_INTERVAL) {
    hazard.standing -= HURT_INTERVAL
    damage += hurt
  }
  return damage
}
