/**
 * What a map from a file leaves lying about.
 *
 * The same arrangement as the creatures: a WAD says a thing of a certain class
 * stood here, and one of this project's own supplies is put there instead.
 * None of the original's art or names is reproduced, and nothing is reproduced
 * that this game has no notion of -- there is no armour here, so armour is
 * simply not picked up.
 *
 * A whitelist again, for the reason it was one before: most of the hundred and
 * twenty-one thing types in a real map are scenery, and a lamp that heals you
 * is worse than a lamp that is missing.
 */

import type { PickupGrant } from './pickups.ts'
import { CANISTER, KEY_TOKEN, KIT, SHELL_BOX, SLUG_CRATE } from './things.ts'
import type { Sprite } from '../columns/sprite.ts'

/** What to put down, and what taking it does. */
export interface Supply {
  readonly sprite: Sprite
  readonly grant: PickupGrant
  /** How close you have to be, matching the sizes the hand-written levels use. */
  readonly radius: number
}

/**
 * The keys, by the colour the original gives them.
 *
 * This is the one place in either importer that rests on recalled knowledge
 * rather than on something measured: which number is which colour. It is a
 * safe place for it. The doors are read from the same table, so a colour
 * swapped here is swapped on both sides of every lock, and a level stays
 * exactly as completable as it was. Getting it wrong costs the right word in a
 * status line, not a way through.
 */
const KEYS = new Map<number, string>([
  [5, 'cobalt'],
  [40, 'cobalt'],
  [13, 'crimson'],
  [39, 'crimson'],
  [6, 'amber'],
  [38, 'amber'],
])

/** The key colour a lock of this thing type asks for, or null if it is not a key. */
export function keyColourOf(type: number): string | null {
  return KEYS.get(type) ?? null
}

const HEALTH = new Map<number, number>([
  [2014, 2], // the small scattered one
  [2011, 25],
  [2012, 50],
])

/** Rounds, by the weapon this game indexes them under: 0 sidearm, 1 scattergun, 2 launcher. */
const AMMO = new Map<number, { weapon: number; amount: number }>([
  [2007, { weapon: 0, amount: 10 }],
  [2048, { weapon: 0, amount: 50 }],
  [2008, { weapon: 1, amount: 4 }],
  [2049, { weapon: 1, amount: 20 }],
  [2010, { weapon: 2, amount: 1 }],
  [2046, { weapon: 2, amount: 5 }],
])

/** What lies where the map put a thing of this type, or null for one to ignore. */
export function supplyFor(type: number): Supply | null {
  const heals = HEALTH.get(type)
  if (heals !== undefined) {
    return { sprite: KIT, grant: { kind: 'health', amount: heals }, radius: 0.4 }
  }

  const rounds = AMMO.get(type)
  if (rounds !== undefined) {
    const sprite = rounds.weapon === 0 ? CANISTER : rounds.weapon === 1 ? SHELL_BOX : SLUG_CRATE
    return {
      sprite,
      grant: { kind: 'ammo', weapon: rounds.weapon, amount: rounds.amount },
      radius: 0.4,
    }
  }

  const colour = keyColourOf(type)
  if (colour !== null) {
    return { sprite: KEY_TOKEN, grant: { kind: 'key', key: colour }, radius: 0.5 }
  }

  return null
}

/** Every thing type that leaves something to pick up, for checks to count against. */
export function supplyTypes(): number[] {
  return [...HEALTH.keys(), ...AMMO.keys(), ...KEYS.keys()]
}
