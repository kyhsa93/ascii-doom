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
import { sectorAt, type Level } from '../columns/level.ts'
import type { Sprite } from '../columns/sprite.ts'

export interface ProjectileKind {
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
