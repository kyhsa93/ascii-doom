/**
 * Sectors that move: doors, lifts, and anything else that changes height.
 *
 * This is the last structural idea of the original's level design, and it is
 * deliberately tiny — which is the whole payoff of the three earlier decisions.
 * A sector already carries a floor and a ceiling; the renderer reads them every
 * frame, collision asks `openingBetween` whether a body fits, and sight asks the
 * same function whether a line passes. So a door is not a feature. It is a
 * ceiling with a number that changes, and every one of those three answers
 * follows without being told.
 *
 * A closing door that meets somebody reverses rather than crushing them. That
 * is the original's behaviour and it is also the only place this module needs to
 * know that bodies exist at all.
 */

import { acrossFrom, castRay, type Level, type RayHit } from '../columns/level.ts'

export type MoverState = 'shut' | 'opening' | 'open' | 'closing'

export interface MoverKind {
  /** Which surface moves. A door lifts its ceiling; a lift raises its floor. */
  readonly surface: 'floor' | 'ceiling'
  /** Height of that surface when shut. */
  readonly shut: number
  /** Height of it when open. */
  readonly open: number
  /** Units per second, in both directions. */
  readonly speed: number
  /**
   * Seconds it waits at the open end before closing itself.
   *
   * Zero means it stays open, which is what a lift wants and what a door held
   * by a switch wants. A door in a wall usually wants a few seconds.
   */
  readonly wait: number
  /**
   * A key that must be held before this will move.
   *
   * A locked door is not a different machine; it is the same one that declines
   * to start. Leaving the lock out here and putting it in the caller would mean
   * every place that can open a door has to remember to ask, and one of them
   * eventually would not.
   */
  readonly requiresKey?: string
}

export interface Mover {
  readonly sector: number
  readonly kind: MoverKind
  state: MoverState
  /** Seconds left of the wait, when open. */
  timer: number
}

/** Anything that can be caught under a closing surface. */
export interface MoverBody {
  readonly sector: number
  readonly height: number
}

export function makeMover(sector: number, kind: MoverKind): Mover {
  return { sector, kind, state: 'shut', timer: 0 }
}

/**
 * Sets a mover going, or holds it open if it is already there.
 *
 * Triggering a closing door reopens it, which is what makes a door you are
 * standing in forgiving; triggering an open one only refreshes its wait.
 */
export function activate(mover: Mover, keys: ReadonlySet<string> = NO_KEYS): boolean {
  const needed = mover.kind.requiresKey
  if (needed !== undefined && !keys.has(needed)) return false
  if (mover.state === 'open') {
    mover.timer = mover.kind.wait
    return true
  }
  mover.state = 'opening'
  return true
}

const NO_KEYS: ReadonlySet<string> = new Set<string>()

/** Puts a sector's moving surface back to a height, for a reset or a load. */
export function applyHeight(level: Level, mover: Mover, height: number): void {
  const sector = level.sectors[mover.sector]
  if (!sector) return
  if (mover.kind.surface === 'ceiling') sector.ceiling = height
  else sector.floor = height
}

/**
 * Where a mover's surface is standing right now.
 *
 * Exported because a save has to write it down: the state says which way a
 * door is going and the height says how far it got, and the two are kept in
 * different places -- the state on the mover, the height on the sector.
 */
export function heightOf(level: Level, mover: Mover): number {
  const sector = level.sectors[mover.sector]
  if (!sector) return mover.kind.shut
  return mover.kind.surface === 'ceiling' ? sector.ceiling : sector.floor
}

/**
 * Advances every mover by `dt` seconds.
 *
 * `bodies` is only consulted while closing. A body standing in the sector needs
 * its own height of room, so a ceiling coming down past that — or a floor rising
 * up to meet it — sends the mover back the other way instead of squeezing.
 */
export function updateMovers(level: Level, movers: Mover[], bodies: readonly MoverBody[], dt: number): void {
  for (const mover of movers) {
    const sector = level.sectors[mover.sector]
    if (!sector) continue
    const kind = mover.kind
    const current = heightOf(level, mover)

    if (mover.state === 'opening') {
      const next = toward(current, kind.open, kind.speed * dt)
      applyHeight(level, mover, next)
      if (next === kind.open) {
        mover.state = 'open'
        mover.timer = kind.wait
      }
      continue
    }

    if (mover.state === 'open') {
      // A wait of zero means it stays where it is until something else moves it.
      if (kind.wait <= 0) continue
      mover.timer -= dt
      if (mover.timer <= 0) mover.state = 'closing'
      continue
    }

    if (mover.state === 'closing') {
      const next = toward(current, kind.shut, kind.speed * dt)
      if (wouldCrush(level, mover, bodies, next)) {
        // Back up rather than through. The body is what decides, not a flag on
        // the door, so a creature blocks it exactly as a player does.
        mover.state = 'opening'
        continue
      }
      applyHeight(level, mover, next)
      if (next === kind.shut) mover.state = 'shut'
      continue
    }
  }
}

/** Whether moving the surface to `next` would leave someone without headroom. */
function wouldCrush(level: Level, mover: Mover, bodies: readonly MoverBody[], next: number): boolean {
  const sector = level.sectors[mover.sector]
  if (!sector) return false
  const floor = mover.kind.surface === 'floor' ? next : sector.floor
  const ceiling = mover.kind.surface === 'ceiling' ? next : sector.ceiling
  for (const body of bodies) {
    if (body.sector !== mover.sector) continue
    if (ceiling - floor < body.height) return true
  }
  return false
}

const reachHits: RayHit[] = []

/**
 * The mover on the other side of whatever you are standing in front of.
 *
 * Which door a press of the use key opens is a question with a right answer, so
 * it lives here rather than in the page: cast a short ray, take the first thing
 * it crosses, and see whether a mover owns the sector beyond it. Only the first
 * crossing counts — reaching through one door to open the next would be a
 * strange power to hand out by accident.
 */
export function moverInFront(
  level: Level,
  movers: readonly Mover[],
  fromSector: number,
  x: number,
  y: number,
  angle: number,
  reach = 1.8,
): Mover | null {
  if (fromSector < 0) return null
  castRay(level, x, y, Math.cos(angle), Math.sin(angle), reach, reachHits)
  const first = reachHits[0]
  if (!first) return null
  const beyond = acrossFrom(first.line, fromSector)
  if (beyond < 0) return null
  return movers.find((mover) => mover.sector === beyond) ?? null
}

/** Steps a value toward a target without overshooting it. */
function toward(current: number, target: number, step: number): number {
  if (current < target) return Math.min(target, current + step)
  if (current > target) return Math.max(target, current - step)
  return target
}
