/**
 * The guns. Original designs, written for this project.
 *
 * Two of them, chosen to pose different questions rather than to be a better
 * and a worse one. The sidearm is accurate, cheap and slow to kill, so it is
 * what you use on something far away or nearly dead. The scattergun throws a
 * handful of pellets in a cone, which makes it devastating at arm's length and
 * nearly useless across a hall — the distance at which you choose between them
 * is the whole of the decision.
 *
 * Firing is resolved as hitscan: the shot arrives the instant it is fired.
 * That is the original's answer for this class of weapon and it matters for
 * feel — a projectile you can watch travel invites you to lead the target,
 * which is not a skill a keyboard and a character grid can express well.
 */

import { traceShot, type ShotBody } from '../columns/hitscan.ts'
import type { Level } from '../columns/level.ts'
import { damageActor, isAlive, type Actor } from './ai.ts'
import type { Body } from './player.ts'

export interface Weapon {
  readonly name: string
  /** Damage per pellet that connects. */
  readonly damage: number
  /** Pellets thrown per pull of the trigger. */
  readonly pellets: number
  /** Half-angle of the cone, in radians. Zero is perfectly accurate. */
  readonly spread: number
  /** How far a pellet carries. */
  readonly range: number
  /** Seconds between shots. */
  readonly interval: number
  /** Rounds taken from the reserve per pull. */
  readonly cost: number
}

/** Accurate, cheap, and slow to finish anything. */
export const SIDEARM: Weapon = {
  name: 'sidearm',
  damage: 9,
  pellets: 1,
  spread: 0,
  range: 40,
  interval: 0.28,
  cost: 1,
}

/**
 * Seven pellets in a wide cone.
 *
 * The spread is what makes the choice interesting: at two units nearly all of
 * it lands, at fifteen most of it goes past. The numbers are set so that it
 * kills a crawler outright up close and cannot kill one across the hall.
 */
export const SCATTERGUN: Weapon = {
  name: 'scattergun',
  damage: 6,
  pellets: 7,
  spread: 0.17,
  range: 26,
  interval: 0.85,
  cost: 1,
}

export const WEAPONS: readonly Weapon[] = [SIDEARM, SCATTERGUN]

/** What one pull of the trigger did. */
export interface FireResult {
  /** Pellets that connected with something. */
  readonly hits: number
  /** Creatures that died from this shot. */
  readonly kills: number
  /** Where each pellet ended, for drawing a spark. */
  readonly ends: { x: number; y: number }[]
}

/**
 * Fires once from a body along its facing.
 *
 * Every pellet is traced separately, because a cone that resolved as one ray
 * with a damage multiplier would pass through a doorway it should mostly hit
 * the frame of. The randomness is injectable so a check can pin the cone.
 */
export function fire(
  level: Level,
  shooter: Body & { angle: number },
  weapon: Weapon,
  actors: Actor[],
  height: number,
  random: () => number = Math.random,
): FireResult {
  const bodies: ShotBody[] = actors
  let hits = 0
  let kills = 0
  const ends: { x: number; y: number }[] = []

  for (let pellet = 0; pellet < weapon.pellets; pellet++) {
    const angle = shooter.angle + (random() * 2 - 1) * weapon.spread
    const shot = traceShot(
      level,
      shooter.sector,
      shooter.x,
      shooter.y,
      shooter.floor + height,
      angle,
      weapon.range,
      bodies,
      (index) => isAlive(actors[index]!),
    )
    ends.push({ x: shot.x, y: shot.y })
    if (!shot.hit) continue
    hits++
    if (damageActor(actors[shot.hit.index]!, weapon.damage, random)) kills++
  }

  return { hits, kills, ends }
}
