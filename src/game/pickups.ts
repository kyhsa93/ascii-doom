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
import { grantPower, holds, type Power } from './powers.ts'

/** What taking one does for you. */
export type PickupGrant =
  | { readonly kind: 'health'; readonly amount: number }
  | { readonly kind: 'ammo'; readonly weapon: number; readonly amount: number }
  | { readonly kind: 'key'; readonly key: string }
  /**
   * Armour, which takes a share of what hits you until it is gone.
   *
   * `cap` is what this piece tops you up to rather than what it adds: the
   * original's light and heavy jackets set you to a number instead of stacking,
   * and armour standing on sixty-four of the sixty-eight maps would otherwise
   * add up to something that cannot be hurt.
   */
  | {
      readonly kind: 'armour'
      readonly amount: number
      readonly cap: number
      readonly share: number
      /**
       * Whether this adds to what you are wearing or sets you to it.
       *
       * The jackets set: the original refuses one that would leave you worse
       * off, which is what stops armour on sixty-five of the sixty-eight maps
       * adding up to something unkillable. The scattered bits add, one point at
       * a time, up to the heavy jacket's ceiling. Modelling both as "set" made
       * the commonest armour item in the files -- seventeen hundred of them --
       * vanish on contact: worth taking by one rule and worth nothing by the
       * other, so it was picked up and granted nothing.
       */
      readonly adds: boolean
    }
  /** A weapon you did not have. Ammunition for it comes with it, as it does in the original. */
  | { readonly kind: 'weapon'; readonly weapon: number; readonly ammo: number }
  /**
   * A powerup, which starts a clock rather than adding to a number.
   *
   * The seconds are not here: `powers.ts` owns how long each one lasts, and a
   * duration written at the pickup as well would be two places to change it and
   * one of them would be a map file's idea of how long a shield should last.
   */
  | { readonly kind: 'power'; readonly power: Power }
  /**
   * The pack that doubles what you can carry, with a little of each in it.
   *
   * A multiplier rather than a bigger `ammoMax`, because the ceiling is a
   * property of the weapon and the pack is a property of the carrier -- and
   * because the original's pack does exactly this and nothing else lifts it.
   */
  | { readonly kind: 'pack'; readonly rounds: readonly number[] }

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
  /**
   * The most of each that can be carried, before the pack.
   *
   * Read through `capacityOf` rather than directly: the pack doubles it, and a
   * ceiling consulted in five places is a ceiling four of them will forget to
   * double.
   */
  readonly ammoMax: readonly number[]
  keys: Set<string>
  /**
   * Armour points, and the share of damage they take while there are any.
   *
   * Two numbers rather than one because the original's two jackets differ in
   * both: the light one soaks a third and the heavy one a half, and which you
   * are wearing has to survive picking up the other.
   */
  armour: number
  armourShare: number
  /** Which weapons are in hand. The first is always there; the rest are found. */
  weapons: Set<number>
  /**
   * Seconds left on each powerup, in `POWERS` order.
   *
   * On the carrier rather than in the page because two bodies collect -- you and
   * whoever else is in the game -- and a shield that lives in the frame loop is
   * a shield only one of them can be under.
   */
  powers: number[]
  /** Whether the pack has been found, which is what doubles the ceilings. */
  pack: boolean
}

/**
 * The most of one weapon's ammunition this carrier can hold.
 *
 * One function so the pack is applied wherever a ceiling is consulted. It was
 * four places before the pack existed and each of them read `ammoMax` straight;
 * the pack would have worked in whichever of them was edited and quietly not in
 * the others.
 */
export function capacityOf(carrier: Carrier, weapon: number): number {
  const base = carrier.ammoMax[weapon] ?? 0
  return carrier.pack ? base * 2 : base
}

/**
 * Takes a hit, through whatever armour is being worn.
 *
 * One function rather than the subtraction written wherever something hurts.
 * There were three of those -- sludge underfoot, a creature in reach, a
 * projectile arriving -- and armour would have had to be remembered at each of
 * them; the fourth place something hurts you is the one that would have
 * forgotten. It is also the only way a check can ask what armour does without
 * standing up a whole frame loop.
 *
 * The jacket takes its share of the hit and loses that much of itself, which is
 * the original's arrangement: armour is a pool that drains rather than a
 * percentage that lasts. When it runs out mid-hit the rest lands on health, so
 * the last point of armour does not absorb a rocket.
 */
export function takeDamage(carrier: Carrier, damage: number): void {
  if (damage <= 0) return

  let toHealth = damage
  if (carrier.armour > 0) {
    const wanted = damage * carrier.armourShare
    const soaked = Math.min(carrier.armour, wanted)
    carrier.armour -= soaked
    toHealth = damage - soaked
    if (carrier.armour <= 0) carrier.armourShare = 0
  }
  carrier.health = Math.max(0, carrier.health - toHealth)
}

/** Whether taking this pickup would change anything about the carrier. */
export function isUseful(pickup: Pickup, carrier: Carrier): boolean {
  const grant = pickup.grant
  if (grant.kind === 'health') return carrier.health < carrier.maxHealth
  if (grant.kind === 'ammo') return (carrier.ammo[grant.weapon] ?? 0) < capacityOf(carrier, grant.weapon)
  // A weapon you already hold is still worth walking over for the rounds in it,
  // which is the original's rule and the reason this is not just a set test.
  if (grant.kind === 'weapon') {
    return !carrier.weapons.has(grant.weapon) || (carrier.ammo[grant.weapon] ?? 0) < capacityOf(carrier, grant.weapon)
  }
  // One place decides, and `collect` does as it is told. The rule lived in both
  // for a while and the copy in `collect` was unreachable -- this one refused
  // the pickup first -- so a deliberate break of it changed nothing and no
  // check noticed.
  if (grant.kind === 'armour') {
    return grant.adds ? carrier.armour < grant.cap : carrier.armour < grant.amount
  }
  /*
   * A powerup is worth taking while it is already running, because taking it
   * puts the clock back to the top -- except for the two that never run out,
   * which a second time would grant nothing at all. The chart is the clear case:
   * a map you have read is read, and a second terminal in the same room should
   * stay standing rather than vanish for nothing.
   *
   * Rage is the same rule with one extra reason to take it: the original's
   * berserk also fills you up, so one found while raging is still worth having
   * if you are hurt.
   */
  if (grant.kind === 'power') {
    if (grant.power === 'chart') return !holds(carrier.powers, 'chart')
    if (grant.power === 'rage') return !holds(carrier.powers, 'rage') || carrier.health < carrier.maxHealth
    return true
  }
  // The pack is worth it for the ceiling if you have not got one, and for what
  // is in it if you have.
  if (grant.kind === 'pack') {
    if (!carrier.pack) return true
    return grant.rounds.some((amount, weapon) => amount > 0 && (carrier.ammo[weapon] ?? 0) < capacityOf(carrier, weapon))
  }
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
      const cap = capacityOf(carrier, grant.weapon)
      carrier.ammo[grant.weapon] = Math.min(cap, (carrier.ammo[grant.weapon] ?? 0) + grant.amount)
    } else if (grant.kind === 'armour') {
      if (grant.adds) {
        // A bit picked up with nothing on starts a jacket of its own class;
        // picked up while wearing one it is a point, and the class you are
        // wearing is the class you keep.
        if (carrier.armour <= 0) carrier.armourShare = grant.share
        carrier.armour = Math.min(grant.cap, carrier.armour + grant.amount)
      } else {
        carrier.armour = Math.min(grant.cap, grant.amount)
        carrier.armourShare = grant.share
      }
    } else if (grant.kind === 'weapon') {
      carrier.weapons.add(grant.weapon)
      const cap = capacityOf(carrier, grant.weapon)
      carrier.ammo[grant.weapon] = Math.min(cap, (carrier.ammo[grant.weapon] ?? 0) + grant.ammo)
    } else if (grant.kind === 'power') {
      grantPower(carrier.powers, grant.power)
      // The original's berserk fills you up as well as making your fists heavy,
      // and it is the only powerup that touches anything but its own clock.
      if (grant.power === 'rage') carrier.health = Math.max(carrier.health, carrier.maxHealth)
    } else if (grant.kind === 'pack') {
      // The ceiling first, so what is in the pack is capped against the raised
      // one: the original's pack hands you a clip you could not have held a
      // moment earlier.
      carrier.pack = true
      for (let weapon = 0; weapon < grant.rounds.length; weapon++) {
        const amount = grant.rounds[weapon] ?? 0
        if (amount <= 0) continue
        carrier.ammo[weapon] = Math.min(capacityOf(carrier, weapon), (carrier.ammo[weapon] ?? 0) + amount)
      }
    } else {
      carrier.keys.add(grant.key)
    }

    pickup.taken = true
    taken.push(pickup)
  }
  return taken
}
