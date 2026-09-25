/**
 * Things you walk over and keep.
 *
 * A rule with a right answer, so it lives here where Node can check it rather
 * than inside the frame loop. Until now the canister and the field kit were
 * scenery: they projected, they occluded, and walking through one did nothing
 * at all.
 *
 * Three decisions worth stating, all of them the original's.
 *
 * Collection is by overlap in the map plane and ignores height. A pickup lying
 * on a ledge you are walking under is not something you should snatch out of
 * the air, but the case is rare enough that the original did not pay for it and
 * neither does this — what it buys instead is that a pickup on a lift keeps
 * working while the lift moves.
 *
 * A pickup that would give you nothing is not taken. Walking over a field kit
 * at full health leaves it there for when it is worth something, which is the
 * difference between a supply and a thing that punishes you for tidiness.
 *
 * And nothing overfills. Health stops at its maximum and ammunition stops at
 * the reserve a weapon can hold, so the excess is left in the world rather than
 * quietly discarded.
 */

import type { Sprite } from '../columns/sprite.ts'

/** What taking one does for you. */
export type PickupGrant =
  | { readonly kind: 'health'; readonly amount: number }
  | { readonly kind: 'ammo'; readonly weapon: number; readonly amount: number }
  | { readonly kind: 'key'; readonly key: string }

export interface Pickup {
  readonly x: number
  readonly y: number
  /** Height of the floor it rests on. */
  readonly z: number
  readonly light: number
  readonly sprite: Sprite
  readonly grant: PickupGrant
  /** How close you have to be, in map units. */
  readonly radius: number
  /** Once taken it stops being drawn and stops being collectable. */
  taken: boolean
}

/** Whoever is doing the collecting. */
export interface Carrier {
  health: number
  readonly maxHealth: number
  /** Rounds held, indexed the way the weapon list is. */
  ammo: number[]
  /** The most of each that can be carried. */
  readonly ammoMax: readonly number[]
  keys: Set<string>
}

/** Whether taking this pickup would change anything about the carrier. */
export function isUseful(pickup: Pickup, carrier: Carrier): boolean {
  const grant = pickup.grant
  if (grant.kind === 'health') return carrier.health < carrier.maxHealth
  if (grant.kind === 'ammo') return (carrier.ammo[grant.weapon] ?? 0) < (carrier.ammoMax[grant.weapon] ?? 0)
  return !carrier.keys.has(grant.key)
}

/**
 * Takes every pickup the carrier is standing on and can use, and says which.
 *
 * The caller supplies its own radius, so a wide creature and a narrow player
 * reach the same distance beyond their own edge rather than one of them having
 * to stoop.
 */
export function collect(pickups: Pickup[], x: number, y: number, radius: number, carrier: Carrier): Pickup[] {
  const taken: Pickup[] = []
  for (const pickup of pickups) {
    if (pickup.taken) continue
    const reach = pickup.radius + radius
    if (Math.hypot(pickup.x - x, pickup.y - y) > reach) continue
    if (!isUseful(pickup, carrier)) continue

    const grant = pickup.grant
    if (grant.kind === 'health') {
      carrier.health = Math.min(carrier.maxHealth, carrier.health + grant.amount)
    } else if (grant.kind === 'ammo') {
      const cap = carrier.ammoMax[grant.weapon] ?? 0
      carrier.ammo[grant.weapon] = Math.min(cap, (carrier.ammo[grant.weapon] ?? 0) + grant.amount)
    } else {
      carrier.keys.add(grant.key)
    }

    pickup.taken = true
    taken.push(pickup)
  }
  return taken
}
