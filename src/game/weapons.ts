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
import { spawnProjectile, type Projectile, type ProjectileKind } from './projectiles.ts'
import { SLUG } from './things.ts'

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
  /**
   * What it throws, for the ones that do not arrive instantly.
   *
   * With this the shot leaves the muzzle and has to get there, so `damage` and
   * `range` on the weapon stop applying — the projectile carries its own. A
   * thrown weapon is worth aiming ahead of something that is moving, and worth
   * not firing at a wall you are standing against.
   */
  readonly projectile?: ProjectileKind
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

/**
 * A launcher, throwing a heavy slug that arrives when it arrives.
 *
 * Slow enough to walk out of the way of, which cuts both ways: it is the only
 * weapon here you can miss with by firing at where something was, and the only
 * one that can be fired into a room before you walk into it.
 */
export const LAUNCHER: Weapon = {
  name: 'launcher',
  damage: 0,
  pellets: 1,
  spread: 0.02,
  range: 0,
  interval: 1.2,
  cost: 1,
  /*
   * Most of it is the blast rather than the impact, which is what makes a
   * launcher a different weapon rather than a slow rifle.
   *
   * Forty-eight on the body was the whole of it before, and a rocket that only
   * hurts what it touches is worth less than the scattergun at every range. The
   * total against a single body standing still is now higher -- twenty on
   * impact and up to fifty-five from the blast -- and the cost is that the
   * blast does not ask who fired it. Four and a half metres is a hundred and
   * eighteen map units, near enough the original's radius, and at this scale it
   * is about the width of a corridor: fire it at a wall you are standing
   * against and you will feel it.
   */
  projectile: {
    sprite: SLUG,
    speed: 14,
    damage: 20,
    life: 5,
    blastRadius: 4.5,
    blastDamage: 55,
  },
}

export const WEAPONS: readonly Weapon[] = [SIDEARM, SCATTERGUN, LAUNCHER]

/** What one pull of the trigger did. */
export interface FireResult {
  /** Pellets that connected with something. Always zero for a thrown weapon. */
  readonly hits: number
  /** Creatures that died from this shot. */
  readonly kills: number
  /**
   * Which ones died, as indices into the actors handed in.
   *
   * The count alone was enough while every death was just a death. It stopped
   * being enough when a barrel became a body: whoever fired has to know *what*
   * it killed to set off what the thing leaves behind, and a pistol shot that
   * failed to burst a barrel a rocket would have burst is the kind of
   * inconsistency nobody reports and everybody feels.
   */
  readonly killed: number[]
  /** Where each pellet ended, for drawing a spark. Empty for a thrown weapon. */
  readonly ends: { x: number; y: number }[]
  /** Anything now in flight, for the caller to add to what it is tracking. */
  readonly shots: Projectile[]
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
  owner: number,
  random: () => number = Math.random,
  /**
   * The direction the shot actually goes, when something has aimed it.
   *
   * Left out, a shot goes wherever the body is pointing, which is what a
   * keyboard means by aiming. A phone cannot point a body that precisely --
   * turning there is a rate rather than a position -- so the touch controls
   * hand the direction of what you are looking at instead. The spread opens
   * around this rather than around the body, or a scattergun would be aimed
   * and thrown in two different directions at once.
   */
  aim?: number,
): FireResult {
  const bodies: ShotBody[] = actors
  let hits = 0
  let kills = 0
  const ends: { x: number; y: number }[] = []
  const shots: Projectile[] = []
  const killed: number[] = []

  for (let pellet = 0; pellet < weapon.pellets; pellet++) {
    const angle = (aim ?? shooter.angle) + (random() * 2 - 1) * weapon.spread

    if (weapon.projectile) {
      // Nothing is resolved here. It leaves the muzzle and the flight decides,
      // which is the whole difference between this and the instant weapons.
      shots.push(
        spawnProjectile(weapon.projectile, shooter.x, shooter.y, shooter.floor + height, angle, shooter.sector, owner),
      )
      continue
    }

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
    if (damageActor(actors[shot.hit.index]!, weapon.damage, random)) {
      kills++
      killed.push(shot.hit.index)
    }
  }

  return { hits, kills, killed, ends, shots }
}
