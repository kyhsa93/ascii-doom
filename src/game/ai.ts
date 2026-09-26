/**
 * What the creatures do.
 *
 * Machinery only: this module knows about states, timers, sight and reach, and
 * nothing about which creature is which. The kinds and where they stand are
 * content and live beside the art, which also keeps the dependency pointing one
 * way — this file never imports the level's cast, so adding a creature cannot
 * change how creatures behave.
 *
 * The shape is the original's. A creature sleeps until it sees you, walks at
 * you until it is close enough, swings, and flinches when hit — with a chance
 * of not flinching, because a monster that staggers every time you touch it can
 * be held in place forever by a weak weapon, which is the failure the original's
 * pain chance exists to avoid.
 */

import { traceShot, type ShotBody } from '../columns/hitscan.ts'
import { lineOfSight, type Level, type RayHit } from '../columns/level.ts'
import type { Billboard, Sprite } from '../columns/sprite.ts'
import { moveBody, type Body } from './player.ts'
import { spawnProjectile, type Projectile, type ProjectileKind } from './projectiles.ts'

export type ActorState = 'dormant' | 'waking' | 'chasing' | 'winding' | 'hurt' | 'dying' | 'dead'

/** The unchanging description of a creature. */
export interface ActorKind {
  readonly name: string
  readonly sprite: Sprite
  /** Art shown once it is dead. Usually flatter and wider than the living one. */
  readonly corpse: Sprite
  readonly radius: number
  readonly height: number
  /** Eye above its own floor, used for sight in both directions. */
  readonly eye: number
  readonly health: number
  /** Map units per second while chasing. */
  readonly speed: number
  /** How far it can notice you. */
  readonly sightRange: number
  /** How close it has to be to land a blow. */
  readonly reach: number
  readonly damage: number
  /** Seconds between the decision to strike and the blow landing. */
  readonly windUp: number
  /** Seconds after a blow before it can swing again. */
  readonly recovery: number
  /** Seconds spent flinching when a hit does interrupt it. */
  readonly painTime: number
  /** Chance from 0 to 1 that a hit interrupts what it was doing. */
  readonly painChance: number
  /** Seconds the death animation holds before the corpse settles. */
  readonly deathTime: number
  /**
   * What it throws, for the ones that do not have to close the distance.
   *
   * A creature with this still prefers its claws when you are inside `reach` —
   * the choice is made when the blow lands rather than when it is decided, so
   * walking into a shooter during its wind-up gets you clubbed instead.
   */
  readonly ranged?: {
    readonly projectile: ProjectileKind
    /** How far it will shoot from. Beyond this it keeps walking. */
    readonly range: number
  }
  /**
   * A shot that arrives the instant it is fired, for the ones that carry guns.
   *
   * The largest thing the importer was getting wrong. Ten thousand of the
   * bodies across the two files attack at a distance and fewer than fifteen
   * hundred only bite -- but four thousand eight hundred of those distance
   * attackers are hitscanners, and with nothing here to be, they were all
   * arriving as something that runs at you and claws. A room of gunmen and a
   * room of dogs are not the same room.
   *
   * `spread` is how far off the line a shot can land, in radians, and `shots`
   * is how many go out at once -- one for a rifle, three for a shotgun. The
   * damage is per shot. Together they are why a hitscanner is dangerous in the
   * open and survivable behind a corner, which is the whole texture of the
   * original's fights.
   */
  readonly hitscan?: {
    readonly range: number
    readonly shots: number
    readonly damage: number
    readonly spread: number
  }
  /**
   * What it leaves behind when it dies, for the things that go off.
   *
   * A barrel is not a creature and giving it one anyway is the cheapest true
   * thing to do here: it is a body with health that stands still, and what
   * makes it a barrel is this field. Five hundred and ninety-seven of them
   * stand across these files and half of those are within three metres of
   * another, so the chain is not a flourish -- it is what the maps are built
   * around.
   *
   * The caller sets it off, because `damageActor` already says whether a blow
   * was the killing one and the blast belongs to whoever owns the body list.
   */
  readonly explodes?: {
    readonly radius: number
    readonly damage: number
  }
}

export interface Actor extends Body {
  readonly kind: ActorKind
  state: ActorState
  health: number
  /** Seconds remaining in a timed state. */
  timer: number
  /** Which way it faces. */
  angle: number
  /** Set once it has noticed the target; a woken creature does not go back to sleep. */
  awake: boolean
  /**
   * Index of another creature it would rather be fighting, or -1 for the player.
   *
   * Set when something other than the player hurts it. The original's monsters
   * turn on each other this way, and it is most of what makes a room full of
   * them worth walking away from rather than shooting into.
   *
   * An index rather than a reference, to match how a projectile names its
   * owner; the caller passes the same array every tick either way.
   */
  grudge: number
}

export function spawnActor(kind: ActorKind, x: number, y: number, sector: number, floor: number): Actor {
  return {
    kind,
    x,
    y,
    sector,
    floor,
    radius: kind.radius,
    height: kind.height,
    state: 'dormant',
    health: kind.health,
    timer: 0,
    angle: 0,
    awake: false,
    grudge: -1,
  }
}

/**
 * Points a creature at another one.
 *
 * Called by whoever worked out that something other than the player did the
 * hurting — this module never learns that on its own, because the thing that
 * knows is the impact, and the impact belongs to the caller.
 */
export function provoke(actor: Actor, attacker: number): void {
  if (actor.state === 'dead' || actor.state === 'dying') return
  actor.grudge = attacker
  actor.awake = true
  if (actor.state === 'dormant') {
    actor.state = 'chasing'
    actor.timer = 0
  }
}

/** What the creatures did this step. */
export interface ActorOutcome {
  /** Total damage landed on the target by claws and teeth. */
  damage: number
  /** Anything thrown, for the caller to add to whatever it keeps in flight. */
  shots: Projectile[]
}

export interface UpdateOptions {
  /**
   * How far in front of itself a sleeping creature can notice you, in radians
   * either side. A creature facing away has to be alerted by being shot.
   */
  wakeCone?: number
  /** Source of randomness, so a check can pin the pain rolls. */
  random?: () => number
}

const scratchHits: RayHit[] = []

/**
 * Advances every creature by `dt` seconds.
 *
 * The target is the player's body; its eye height is read from its own floor so
 * that a creature on a platform and a player below it agree about whether they
 * can see each other.
 */
export function updateActors(
  level: Level,
  actors: Actor[],
  target: Body,
  targetEye: number,
  dt: number,
  options: UpdateOptions = {},
): ActorOutcome {
  const wakeCone = options.wakeCone ?? Math.PI * 0.75
  let damage = 0
  const shots: Projectile[] = []
  /*
   * Everything a shot can stop on, with the target last.
   *
   * The same list a player's shot is traced against, in the same order, so a
   * creature standing between a gunman and you takes the bullet -- which is
   * where infighting comes from and is the reason walking into a crossfire is
   * a thing you can do on purpose.
   */
  const bodies: ShotBody[] = [...actors, target]
  const playerIndex = actors.length

  for (const actor of actors) {
    if (actor.state === 'dead') continue

    // Who this one is actually after. A grudge outranks the player, and lapses
    // the moment its object stops being worth fighting — otherwise a creature
    // would stand over a corpse forever while you shot it in the back.
    const wanted = actor.grudge >= 0 ? actors[actor.grudge] : undefined
    const fighting = wanted !== undefined && wanted !== actor && isAlive(wanted)
    if (actor.grudge >= 0 && !fighting) actor.grudge = -1
    const aim: Body = fighting ? wanted : target
    const aimEye = fighting ? wanted.kind.eye : targetEye

    const dx = aim.x - actor.x
    const dy = aim.y - actor.y
    const distance = Math.hypot(dx, dy)
    const facing = Math.atan2(dy, dx)

    if (actor.state === 'dying') {
      actor.timer -= dt
      if (actor.timer <= 0) actor.state = 'dead'
      continue
    }

    if (actor.state === 'hurt') {
      actor.timer -= dt
      if (actor.timer <= 0) actor.state = 'chasing'
      continue
    }

    const canSee =
      distance <= actor.kind.sightRange &&
      lineOfSight(
        level,
        actor.sector,
        actor.x,
        actor.y,
        actor.floor + actor.kind.eye,
        aim.x,
        aim.y,
        aim.floor + aimEye,
        scratchHits,
      )

    if (actor.state === 'dormant') {
      // Asleep until it both sees you and is facing roughly your way. Being
      // shot wakes it regardless, which `alert` handles.
      const offset = Math.abs(normalizeAngle(facing - actor.angle))
      if (canSee && offset <= wakeCone / 2) alert(actor)
      continue
    }

    if (actor.state === 'waking') {
      actor.timer -= dt
      actor.angle = facing
      if (actor.timer <= 0) actor.state = 'chasing'
      continue
    }

    if (actor.state === 'winding') {
      actor.timer -= dt
      actor.angle = facing
      if (actor.timer > 0) continue
      // The blow lands now, and only if you are still there to be hit. Backing
      // out of reach during the wind-up is the whole of how a melee creature is
      // played around.
      //
      // Which attack it turns out to be is decided here rather than when it was
      // committed, so closing on a shooter mid-wind-up gets you clubbed and
      // backing away from a brawler gets you shot at by anything that can.
      const gun = actor.kind.hitscan
      const ranged = actor.kind.ranged
      if (distance <= actor.kind.reach + aim.radius && canSee) {
        // Only the player's share is reported. A creature clawing another
        // creature must not turn up in the number the page subtracts from your
        // health, which is the one way this could go quietly and badly wrong.
        if (fighting) damageActor(wanted, actor.kind.damage, options.random ?? Math.random)
        else damage += actor.kind.damage
      } else if (gun !== undefined && canSee && distance <= gun.range) {
        // Traced the moment it is fired, against the same bodies a player's
        // shot is traced against -- so a creature standing between the two
        // takes it, and a wall stops it.
        for (let shot = 0; shot < gun.shots; shot++) {
          const off = ((options.random ?? Math.random)() * 2 - 1) * gun.spread
          const hit = traceShot(
            level,
            actor.sector,
            actor.x,
            actor.y,
            actor.floor + actor.kind.eye,
            facing + off,
            gun.range,
            bodies,
            (index) => index === playerIndex || (actors[index] !== actor && isAlive(actors[index]!)),
          ).hit
          if (hit === null) continue
          if (hit.index === playerIndex) damage += gun.damage
          else {
            const struck = actors[hit.index]
            if (struck !== undefined && struck !== actor) damageActor(struck, gun.damage, options.random ?? Math.random)
          }
        }
      } else if (ranged && canSee && distance <= ranged.range) {
        shots.push(
          spawnProjectile(
            ranged.projectile,
            actor.x,
            actor.y,
            actor.floor + actor.kind.eye,
            facing,
            actor.sector,
            actors.indexOf(actor),
          ),
        )
      }
      actor.state = 'chasing'
      actor.timer = actor.kind.recovery
      continue
    }

    // Chasing.
    actor.timer = Math.max(0, actor.timer - dt)
    if (canSee) actor.angle = facing

    const ranged = actor.kind.ranged
    const gun = actor.kind.hitscan
    const inMelee = distance <= actor.kind.reach + aim.radius
    // Either way of attacking at a distance counts. Written as the thrown one
    // alone, a creature that only carries a gun never left the chase: it walked
    // into claw range before it was allowed to attack, so the whole hitscan
    // branch below was unreachable and a check caught it doing nothing from
    // twelve metres away.
    const inShot =
      (ranged !== undefined && distance <= ranged.range) || (gun !== undefined && distance <= gun.range)
    if (canSee && (inMelee || inShot) && actor.timer <= 0) {
      actor.state = 'winding'
      actor.timer = actor.kind.windUp
      continue
    }
    // A shooter that can already see you has no reason to close, so only the
    // ones with nothing to throw keep walking once they are in range.
    if (inShot && canSee) continue

    if (distance > 1e-6) {
      const step = actor.kind.speed * dt
      const moved = moveBody(level, actor, (dx / distance) * step, (dy / distance) * step)
      if (!moved) {
        // Blocked. Try sliding sideways rather than grinding into the corner,
        // which is what turns a creature into scenery in a doorway.
        const sx = -dy / distance
        const sy = dx / distance
        moveBody(level, actor, sx * step, sy * step)
      }
    }
  }

  return { damage, shots }
}

/** Wakes a creature, whether it saw you or you shot it in the back. */
export function alert(actor: Actor): void {
  if (actor.state === 'dead' || actor.state === 'dying') return
  actor.awake = true
  if (actor.state === 'dormant') {
    actor.state = 'waking'
    actor.timer = 0.25
  }
}

/**
 * Applies damage, and says whether this was the killing blow.
 *
 * A hit always wakes; it only interrupts some of the time. Interrupting every
 * time would let a fast weak weapon hold a creature still indefinitely.
 */
export function damageActor(actor: Actor, amount: number, random: () => number = Math.random): boolean {
  if (actor.state === 'dead' || actor.state === 'dying') return false
  actor.health -= amount
  actor.awake = true
  if (actor.health <= 0) {
    actor.state = 'dying'
    actor.timer = actor.kind.deathTime
    return true
  }
  if (actor.state === 'dormant') {
    actor.state = 'chasing'
    actor.timer = 0
  } else if (random() < actor.kind.painChance) {
    actor.state = 'hurt'
    actor.timer = actor.kind.painTime
  }
  return false
}

/**
 * A creature as something to draw.
 *
 * The corpse swaps in the moment it starts dying rather than when it finishes,
 * so the blow that kills is answered immediately. Waiting for the animation to
 * end makes a dead creature stand there for half a second looking alive, which
 * reads as the shot having missed.
 */
export function billboardOf(actor: Actor, light: number): Billboard {
  const down = actor.state === 'dead' || actor.state === 'dying'
  return {
    x: actor.x,
    y: actor.y,
    z: actor.floor,
    light,
    sprite: down ? actor.kind.corpse : actor.kind.sprite,
  }
}

/** Whether a creature still occupies space and can be hit. */
export function isAlive(actor: Actor): boolean {
  return actor.state !== 'dead' && actor.state !== 'dying'
}

/**
 * Folds an angle into -pi..pi, so "how far off" never reads as almost a full turn.
 *
 * Exported because the aiming help asks the same question a creature asks when
 * it decides whether you are in front of it, and two copies of a wrap are two
 * chances for one of them to be written with the wrong sign.
 */
export function normalizeAngle(angle: number): number {
  let a = angle
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}
