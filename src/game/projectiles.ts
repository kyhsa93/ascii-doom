/**
 * Things in flight.
 *
 * A projectile's step is a short hitscan. Over one tick it travels
 * `speed * dt`, and asking what it met on the way is exactly the question
 * `traceShot` already answers — the wall first, then the nearest body before
 * it. Reusing that rather than writing a second collision path means a
 * projectile cannot acquire the bug where it passes through a wall to reach
 * something standing behind it, and there is only one piece of geometry to keep
 * right.
 *
 * It hits anything that is not the thing that fired it. That is one line here
 * and it is also what the original's creatures do to each other when a shot
 * goes wide, so infighting is a consequence of the rule rather than a feature
 * layered on top of it.
 *
 * Damage is not applied here. What a hit does depends on whether it landed on a
 * player or a creature, and this module has no business knowing either; it
 * reports impacts and the caller decides.
 */

import { traceShot, type ShotBody } from '../columns/hitscan.ts'
import { lineOfSight, sectorAt, type Level } from '../columns/level.ts'
import type { Sprite } from '../columns/sprite.ts'

export interface ProjectileKind {
  /**
   * How far the blast reaches when it lands, or nothing for one that does not.
   *
   * On the projectile rather than the weapon because a barrel's blast and a
   * rocket's are the same event, and because a creature that throws something
   * explosive should be describable the same way.
   */
  readonly blastRadius?: number
  /** What the blast does at the centre. The direct hit is separate and lands too. */
  readonly blastDamage?: number
  readonly sprite: Sprite
  /** Map units per second. */
  readonly speed: number
  readonly damage: number
  /** Seconds before it gives up and fizzles out. */
  readonly life: number
}

export interface Projectile {
  x: number
  y: number
  /** Height it flies at, in world terms rather than above the floor. */
  z: number
  /** Unit direction in the map plane. */
  dx: number
  dy: number
  sector: number
  readonly kind: ProjectileKind
  /**
   * Index into the body list of whoever fired it, or -1 for something not in
   * that list. The caller must pass the same array every tick, which is the
   * price of not having identities in this project.
   */
  readonly owner: number
  alive: boolean
  /** Seconds of life left. */
  timer: number
}

/**
 * How far ahead of itself a projectile checks.
 *
 * Its thickness, in effect. Small enough not to shorten a flight visibly and
 * large enough that a step can never finish sitting on a wall.
 */
const SKIN = 0.05

/**
 * Everything within a blast, and how much of it each one takes.
 *
 * Separate from the projectile that caused it because two very different things
 * cause blasts -- a rocket arriving and a barrel dying -- and neither should
 * have to know about the other. The caller applies the damage, because what a
 * body is and how it is hurt is not this module's business: a creature takes it
 * through `damageActor` and the player through `takeDamage`, and those live in
 * two other files.
 *
 * Damage falls off linearly to nothing at the edge, which is not the original's
 * curve but is the one you can reason about while playing: half way out, half
 * the damage. What is reproduced exactly is the part that matters -- the blast
 * does not care who fired it, so standing next to your own rocket hurts.
 *
 * Sight is asked of every candidate rather than assumed. A blast that goes
 * through a wall would make the launcher a weapon for shooting floors with.
 */
export interface Blast {
  /** Index into the bodies array handed in. */
  readonly body: number
  readonly damage: number
}

export function blast(
  level: Level,
  x: number,
  y: number,
  z: number,
  radius: number,
  damage: number,
  bodies: readonly BlastBody[],
): Blast[] {
  const caught: Blast[] = []
  if (radius <= 0 || damage <= 0) return caught

  for (let index = 0; index < bodies.length; index++) {
    const body = bodies[index]!
    const distance = Math.hypot(body.x - x, body.y - y)
    if (distance >= radius) continue
    // From the middle of the body rather than its feet: a blast on the floor
    // beside something should still reach it.
    const eye = body.floor + body.height / 2
    if (!lineOfSight(level, body.sector, body.x, body.y, eye, x, y, z)) continue
    caught.push({ body: index, damage: damage * (1 - distance / radius) })
  }
  return caught
}

/** What a blast needs to know about something it might catch. */
export interface BlastBody {
  readonly x: number
  readonly y: number
  readonly sector: number
  readonly floor: number
  readonly height: number
}

/** Where a projectile stopped, and on what. */
export interface Impact {
  readonly projectile: Projectile
  /** Index into the bodies array, or -1 when it was a wall. */
  readonly body: number
  readonly x: number
  readonly y: number
}

export function spawnProjectile(
  kind: ProjectileKind,
  x: number,
  y: number,
  z: number,
  angle: number,
  sector: number,
  owner: number,
): Projectile {
  return {
    x,
    y,
    z,
    dx: Math.cos(angle),
    dy: Math.sin(angle),
    sector,
    kind,
    owner,
    alive: true,
    timer: kind.life,
  }
}

/**
 * Advances everything in flight and reports what was hit.
 *
 * Dead projectiles are left in the array rather than spliced out, because the
 * caller is usually iterating the same list to draw them and removing entries
 * underneath that is how one frame ends up skipping every other sprite. Sweep
 * them when convenient.
 */
export function updateProjectiles(
  level: Level,
  projectiles: Projectile[],
  bodies: readonly ShotBody[],
  dt: number,
  canHit: (index: number) => boolean = () => true,
): Impact[] {
  const impacts: Impact[] = []

  for (const projectile of projectiles) {
    if (!projectile.alive) continue

    projectile.timer -= dt
    if (projectile.timer <= 0) {
      projectile.alive = false
      continue
    }

    const travel = projectile.kind.speed * dt
    const angle = Math.atan2(projectile.dy, projectile.dx)
    // Looked ahead slightly further than it will actually move, which gives the
    // projectile a thickness rather than treating it as a point.
    //
    // Without it a bolt can land exactly on a wall, and a ray cast from a point
    // on a line does not find that line: `castRay` drops crossings at zero
    // distance so that a ray never rediscovers the wall it just left. The next
    // step then passes straight through and the bolt leaves the map. Measured —
    // a bolt fired 24 units at 0.2 a step arrives exactly on the far wall on
    // step 120 and was through it on 121, reporting nothing at all.
    const shot = traceShot(
      level,
      projectile.sector,
      projectile.x,
      projectile.y,
      projectile.z,
      angle,
      travel + SKIN,
      bodies,
      (index) => index !== projectile.owner && canHit(index),
    )

    if (shot.hit) {
      projectile.alive = false
      impacts.push({ projectile, body: shot.hit.index, x: shot.x, y: shot.y })
      continue
    }

    if (shot.distance < travel + SKIN - 1e-9) {
      // Something solid inside the look-ahead, so this is where it ends.
      projectile.alive = false
      impacts.push({ projectile, body: -1, x: shot.x, y: shot.y })
      continue
    }

    projectile.x += projectile.dx * travel
    projectile.y += projectile.dy * travel
    const sector = sectorAt(level, projectile.x, projectile.y)
    if (sector < 0) {
      // Outside the map. With the look-ahead above this should be unreachable,
      // and if it happens it is still an impact rather than a disappearance —
      // a bolt that vanishes silently is a bug that looks like a miss.
      projectile.alive = false
      impacts.push({ projectile, body: -1, x: projectile.x, y: projectile.y })
      continue
    }
    projectile.sector = sector
  }

  return impacts
}

/** Drops spent projectiles. Call between frames, not while drawing. */
export function sweep(projectiles: Projectile[]): void {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    if (!projectiles[i]!.alive) projectiles.splice(i, 1)
  }
}
