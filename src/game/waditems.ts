/**
 * What a map from a file leaves lying about.
 *
 * The same arrangement as the creatures: a WAD says a thing of a certain class
 * stood here, and one of this project's own supplies is put there instead.
 *
 * That sentence used to end "there is no armour here, so armour is simply not
 * picked up", which stopped being true the day armour arrived and stayed in
 * the file for weeks afterwards. Armour is picked up; so are the weapons, by
 * folding into the three this game fires; the powerups are drawn where they
 * stand and grant nothing yet.
 *
 * A whitelist again, for the reason it was one before: most of the hundred and
 * twenty-one thing types in a real map are scenery, and a lamp that heals you
 * is worse than a lamp that is missing.
 */

import type { PickupGrant } from './pickups.ts'
import {
  AMBER_CARD,
  AMBER_TOKEN,
  BACKPACK_PICKUP,
  BFG_PICKUP,
  BONUS_VIAL,
  CANISTER,
  CHAINGUN_PICKUP,
  CHAINSAW_PICKUP,
  CLIP_CARTON,
  COBALT_KEY,
  COBALT_SKULL,
  CRIMSON_KEY,
  CRIMSON_SKULL,
  DOUBLE_SHOTGUN_PICKUP,
  JACKET,
  JACKET_BIT,
  JACKET_HEAVY,
  KIT,
  PLASMA_PICKUP,
  ROCKET_LAUNCHER_PICKUP,
  SHELL_BOX,
  SHELL_CARTON,
  SHOTGUN_PICKUP,
  SLUG_CARTON,
  SLUG_CRATE,
  SPHERE,
  SPHERE_GREAT,
  STIMPACK,
} from './things.ts'
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
/*
 * The picture for each thing, rather than one for each class of thing.
 *
 * This used to answer with whichever of five pictures was nearest the idea: a
 * stimpack and a soulsphere were both the kit, a shotgun on the floor was a
 * box of rounds, and armour -- of either weight -- was drawn with the key's
 * picture. Meanwhile the real picture of every one of them sat baked into the
 * page with nothing importing it. The map says what is lying there; this now
 * says so too.
 */
const LOOKS = new Map<number, Sprite>([
  // Health, which four different things grant.
  [2011, STIMPACK],
  [2012, KIT],
  [2014, BONUS_VIAL],
  [2013, SPHERE],
  [83, SPHERE_GREAT],
  // Armour: the light jacket, the heavy one, and the scrap.
  [2018, JACKET],
  [2019, JACKET_HEAVY],
  [2015, JACKET_BIT],
  // Ammunition, loose and by the box.
  [2007, CANISTER],
  [2048, CLIP_CARTON],
  [2008, SHELL_BOX],
  [2049, SHELL_CARTON],
  [2010, SLUG_CRATE],
  [2046, SLUG_CARTON],
  // The guns, each its own, whatever this game folds it into.
  [2001, SHOTGUN_PICKUP],
  [82, DOUBLE_SHOTGUN_PICKUP],
  [2002, CHAINGUN_PICKUP],
  [2003, ROCKET_LAUNCHER_PICKUP],
  [2004, PLASMA_PICKUP],
  [2006, BFG_PICKUP],
  [2005, CHAINSAW_PICKUP],
  [8, BACKPACK_PICKUP],
  // The keys, in the colour they open and the shape the map chose.
  [5, COBALT_KEY],
  [40, COBALT_SKULL],
  [13, CRIMSON_KEY],
  [39, CRIMSON_SKULL],
  [6, AMBER_CARD],
  [38, AMBER_TOKEN],
])

export function supplyFor(type: number): Supply | null {
  const heals = HEALTH.get(type)
  if (heals !== undefined) {
    return { sprite: LOOKS.get(type) ?? KIT, grant: { kind: 'health', amount: heals }, radius: 0.4 }
  }

  const rounds = AMMO.get(type)
  if (rounds !== undefined) {
    const sprite =
      LOOKS.get(type) ?? (rounds.weapon === 0 ? CANISTER : rounds.weapon === 1 ? SHELL_BOX : SLUG_CRATE)
    return {
      sprite,
      grant: { kind: 'ammo', weapon: rounds.weapon, amount: rounds.amount },
      radius: 0.4,
    }
  }

  const jacket = ARMOUR.get(type)
  if (jacket !== undefined) {
    return {
      sprite: LOOKS.get(type) ?? JACKET,
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
    const sprite =
      LOOKS.get(type) ?? (weapon.weapon === 0 ? CANISTER : weapon.weapon === 1 ? SHELL_BOX : SLUG_CRATE)
    return { sprite, grant: { kind: 'weapon', weapon: weapon.weapon, ammo: weapon.ammo }, radius: 0.45 }
  }

  const colour = keyColourOf(type)
  if (colour !== null) {
    return { sprite: LOOKS.get(type) ?? COBALT_KEY, grant: { kind: 'key', key: colour }, radius: 0.5 }
  }

  return null
}

/** Every thing type that leaves something to pick up, for checks to count against. */
export function supplyTypes(): number[] {
  return [...HEALTH.keys(), ...AMMO.keys(), ...ARMOUR.keys(), ...WEAPON_THINGS.keys(), ...KEYS.keys()]
}
