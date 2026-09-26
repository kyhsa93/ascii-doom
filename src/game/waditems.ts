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

/**
 * Armour, by how much it sets you to and how much of a hit it takes.
 *
 * The two jackets and the bit you scavenge. `cap` is what the piece tops you up
 * to rather than what it adds -- with armour standing on sixty-four of the
 * sixty-eight maps, anything that stacked would end in a player who cannot be
 * hurt. The shares are the original's: a third for the light one, a half for
 * the heavy.
 */
const ARMOUR = new Map<number, { amount: number; cap: number; share: number; adds: boolean }>([
  [2018, { amount: 100, cap: 100, share: 1 / 3, adds: false }],
  [2019, { amount: 200, cap: 200, share: 1 / 2, adds: false }],
  // The scattered bit adds rather than sets, one point at a time up to the
  // heavy jacket's ceiling. There are seventeen hundred of them across these
  // files, on sixty-one of the sixty-eight maps, which makes it the commonest
  // armour in the game and the one it would be worst to get wrong.
  [2015, { amount: 1, cap: 200, share: 1 / 3, adds: true }],
])

/**
 * Weapons, grouped the way the creatures are grouped.
 *
 * This game has three and the files place seven, so they go by what they are
 * for: the two shotguns are the scattergun, the rapid-fire ones are the
 * sidearm, the launcher is the launcher. The chainsaw has no answer here --
 * there is nothing you swing -- so it is left where it stands, the same way an
 * unmapped creature number puts nothing down.
 *
 * `ammo` is what comes in the box. The original hands you rounds with a weapon
 * and this keeps that, which is most of what picking up a second shotgun is for.
 */
const WEAPON_THINGS = new Map<number, { weapon: number; ammo: number }>([
  [2001, { weapon: 1, ammo: 8 }],
  [82, { weapon: 1, ammo: 8 }],
  [2002, { weapon: 0, ammo: 20 }],
  [2004, { weapon: 0, ammo: 40 }],
  [2006, { weapon: 0, ammo: 40 }],
  [2003, { weapon: 2, ammo: 2 }],
])

const HEALTH = new Map<number, number>([
  [2014, 2], // the small scattered one
  [2011, 25],
  [2012, 50],
  // The spheres, which are health by another name. A soulsphere stands on
  // forty-eight of these maps and a megasphere on eleven; both go over the
  // hundred in the original and are capped here, because nothing in this game
  // can hold more than its maximum and a pickup that grants nothing is one you
  // walk over forever.
  [2013, 100],
  [83, 100],
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

/**
 * What the file calls each supply's picture, by the same four-letter naming the
 * creatures use. All fifteen resolve in both files -- supplies, unlike
 * monsters, did not change between the two games.
 */
const PICTURE = new Map<number, string>([
  [2014, 'BON1'],
  [2015, 'BON2'],
  [2018, 'ARM1'],
  [2019, 'ARM2'],
  [2013, 'SOUL'],
  [83, 'MEGA'],
  [2001, 'SHOT'],
  [82, 'SGN2'],
  [2002, 'MGUN'],
  [2004, 'PLAS'],
  [2006, 'BFUG'],
  [2003, 'LAUN'],
  [2011, 'STIM'],
  [2012, 'MEDI'],
  [2007, 'CLIP'],
  [2048, 'AMMO'],
  [2008, 'SHEL'],
  [2049, 'SBOX'],
  [2010, 'ROCK'],
  [2046, 'BROK'],
  [5, 'BKEY'],
  [40, 'BSKU'],
  [13, 'RKEY'],
  [39, 'RSKU'],
  [6, 'YKEY'],
  [38, 'YSKU'],
])

/** What this supply's picture is called in a file, or null if nothing is known. */
export function supplyPictureFor(type: number): string | null {
  return PICTURE.get(type) ?? null
}

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

  const jacket = ARMOUR.get(type)
  if (jacket !== undefined) {
    return {
      sprite: KEY_TOKEN,
      grant: {
        kind: 'armour',
        amount: jacket.amount,
        cap: jacket.cap,
        share: jacket.share,
        adds: jacket.adds,
      },
      radius: 0.4,
    }
  }

  const weapon = WEAPON_THINGS.get(type)
  if (weapon !== undefined) {
    const sprite = weapon.weapon === 0 ? CANISTER : weapon.weapon === 1 ? SHELL_BOX : SLUG_CRATE
    return { sprite, grant: { kind: 'weapon', weapon: weapon.weapon, ammo: weapon.ammo }, radius: 0.45 }
  }

  const colour = keyColourOf(type)
  if (colour !== null) {
    return { sprite: KEY_TOKEN, grant: { kind: 'key', key: colour }, radius: 0.5 }
  }

  return null
}

/** Every thing type that leaves something to pick up, for checks to count against. */
export function supplyTypes(): number[] {
  return [...HEALTH.keys(), ...AMMO.keys(), ...ARMOUR.keys(), ...WEAPON_THINGS.keys(), ...KEYS.keys()]
}
