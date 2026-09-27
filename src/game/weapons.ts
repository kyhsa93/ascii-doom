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
import type { Level, Line } from '../columns/level.ts'
import { damageActor, isAlive, type Actor } from './ai.ts'
import type { Body } from './player.ts'
import { spawnProjectile, type Projectile, type ProjectileKind } from './projectiles.ts'
import { RAGE_MULTIPLIER } from './powers.ts'
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
  /**
   * True for something swung rather than fired.
   *
   * It costs nothing, which is what makes it the weapon you still have when the
   * reserves are gone, and it reaches about as far as a creature's claws do --
   * the same distance beyond your own edge that they reach beyond theirs. A
   * shot from one still resolves as a trace: a swing that stops at the wall
   * between you and what you swung at is the behaviour either way.
   */
  readonly melee?: boolean
  /**
   * True for the bare hand in particular, which rage makes heavy.
   *
   * Separate from `melee` because the original's berserk multiplies the fist and
   * leaves the saw alone, and a saw at ten times its damage would make the
   * powerup the only decision in the game.
   */
  readonly bare?: boolean
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

/**
 * Bare hands, which cost nothing and are always in them.
 *
 * The thing you are left with, and -- with rage -- briefly the best thing you
 * have. Ten a swing at one every half second is under half the sidearm's rate
 * of killing, which is the price of it being free.
 */
export const FISTS: Weapon = {
  name: 'fists',
  damage: 10,
  pellets: 1,
  spread: 0,
  // A creature's widest reach is nine tenths, measured from its edge. This is
  // that plus the player's own radius, so you and a hound standing nose to nose
  // can each just reach the other rather than one of you having to lean in.
  range: 1.25,
  interval: 0.5,
  cost: 0,
  melee: true,
  bare: true,
}

/**
 * The saw, which the maps put down thirty-seven times and nothing could hold.
 *
 * Eight a bite at eight a second, free, at arm's length: more damage than
 * anything else here and only against what you are touching. It is the answer
 * to a corridor and the wrong answer to a room.
 */
export const CHAINSAW: Weapon = {
  name: 'chainsaw',
  damage: 8,
  pellets: 1,
  spread: 0,
  range: 1.25,
  interval: 0.12,
  cost: 0,
  melee: true,
}

/*
 * The order is append-only on purpose.
 *
 * Everything indexes weapons by position in this list -- the reserves, the
 * ceilings, what a map's shotgun folds into, a save on somebody's disk -- so
 * putting the fists first where the original has them would renumber all of it
 * for the sake of a number nothing shows.
 */
export const WEAPONS: readonly Weapon[] = [SIDEARM, SCATTERGUN, LAUNCHER, FISTS, CHAINSAW]

/**
 * The weapon as it lands, given whether the carrier is raging.
 *
 * Here rather than at the trigger because it is a rule with a right answer, and
 * because the trigger is in the page where nothing can check it. Returns the
 * same object when nothing applies, so the common case allocates nothing.
 */
export function asSwung(weapon: Weapon, raging: boolean): Weapon {
  if (!raging || weapon.bare !== true) return weapon
  return { ...weapon, damage: weapon.damage * RAGE_MULTIPLIER }
}

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
  /**
   * The walls pellets stopped on, for whatever those walls work.
   *
   * Only the ones that actually met a wall: a pellet that hit a creature, or
   * one that ran out in open air, contributes nothing. Duplicates are left in
   * -- a scattergun puts several pellets into the same door, and deciding that
   * this counts once is the caller's business rather than the tracer's.
   */
  readonly walls: Line[]
  /** Anything now in flight, for the caller to add to what it is tracking. */
  readonly shots: Projectile[]
  /**
   * Pellets that landed on somebody who is not a creature, one entry each.
   *
   * Reported rather than resolved, which is the whole point of the second
   * list. A creature is damaged here because this is what traces the pellets
   * and there is nowhere else to do it; anything else that can be hit belongs
   * to whoever passed it in, and this says only what it struck and how hard.
   *
   * One entry per pellet rather than per body: a scattergun is several shots,
   * and what several hits add up to is the caller's arithmetic.
   */
  readonly struck: { readonly index: number; readonly damage: number }[]
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
  /**
   * Bodies that can be hit and are not creatures. Usually another player.
   *
   * A second list rather than more entries in the first, because the first
   * one's meaning is load-bearing: every count in this game reads it as the
   * creatures of the level. A player put in there becomes a monster to the
   * tally at the end of a level, to what the creatures decide to fight, and to
   * what a barrel's blast catches.
   *
   * Traced together with the creatures rather than separately, so the two
   * kinds cannot shadow each other: whoever is nearer takes the shot, and a
   * player standing behind a monster is behind it.
   */
  others: readonly ShotBody[] = [],
): FireResult {
  const bodies: ShotBody[] = others.length === 0 ? actors : [...actors, ...others]
  let hits = 0
  let kills = 0
  const ends: { x: number; y: number }[] = []
  const walls: Line[] = []
  const shots: Projectile[] = []
  const killed: number[] = []
  const struck: { index: number; damage: number }[] = []

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
      // Past the creatures is the other list, and nothing in it is ever a
      // corpse to be shot through: a player is either there or not playing.
      (index) => index >= actors.length || isAlive(actors[index]!),
    )
    ends.push({ x: shot.x, y: shot.y })
    if (shot.wall) walls.push(shot.wall)
    if (!shot.hit) continue
    hits++
    const at = shot.hit.index
    if (at >= actors.length) {
      // Not a creature: say what was hit and let the caller decide what that
      // means. Nothing here counts it, because a kill is a creature killed.
      struck.push({ index: at - actors.length, damage: weapon.damage })
      continue
    }
    if (damageActor(actors[at]!, weapon.damage, random)) {
      kills++
      killed.push(at)
    }
  }

  return { hits, kills, killed, ends, shots, walls, struck }
}
