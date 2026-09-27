/**
 * What a map from a file leaves lying about.
 *
 * The same arrangement as the creatures: a WAD says a thing of a certain class
 * stood here, and one of this project's own supplies is put there instead.
 *
 * That sentence used to end "there is no armour here, so armour is simply not
 * picked up", which stopped being true the day armour arrived and stayed in
 * the file for weeks afterwards. Then it said the powerups were "drawn where
 * they stand and grant nothing yet", and that stayed in the file for a round of
 * its own. Everything a map puts down that this game has a rule for is now
 * picked up: armour, the weapons by folding into the five this game holds, the
 * six powerups, and the pack.
 *
 * A whitelist again, for the reason it was one before: most of the hundred and
 * twenty-one thing types in a real map are scenery, and a lamp that heals you
 * is worse than a lamp that is missing.
 */

import type { Ammo } from './ammo.ts'
import type { PickupGrant } from './pickups.ts'
import type { Power } from './powers.ts'
import {
  AMBER_CARD,
  AMBER_TOKEN,
  BACKPACK_PICKUP,
  BFG_PICKUP,
  BONUS_VIAL,
  CANISTER,
  CELL_CANISTER,
  CELL_CARTON,
  CHAINGUN_PICKUP,
  CHAINSAW_PICKUP,
  CLIP_CARTON,
  COBALT_KEY,
  COBALT_SKULL,
  CRIMSON_KEY,
  CRIMSON_SKULL,
  DOUBLE_SHOTGUN_PICKUP,
  BERSERK_PACK,
  BLUR_SPHERE,
  CHART,
  GOGGLES,
  HAZARD_SUIT,
  INVULNERABILITY_SPHERE,
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
 * Nothing is folded any more. This game has all nine the files place, so every
 * one of these maps to itself -- which is what this comment used to spend a
 * paragraph explaining away: the two shotguns were both the scattergun, the two
 * rapid-fire guns were both the sidearm, and the saw was left where it stood.
 *
 * `rounds` is what comes in the box, into the reserve the weapon spends. The
 * original hands you ammunition with a gun and this keeps that, which is most of
 * what picking up a second shotgun is for -- and now that the two draw on the
 * same shells, it is all of it.
 */
const WEAPON_THINGS = new Map<number, { weapon: number; ammo: Ammo | null; rounds: number }>([
  [2001, { weapon: 1, ammo: 'shells', rounds: 8 }],
  [82, { weapon: 5, ammo: 'shells', rounds: 8 }],
  [2002, { weapon: 6, ammo: 'bullets', rounds: 20 }],
  [2004, { weapon: 7, ammo: 'cells', rounds: 40 }],
  [2006, { weapon: 8, ammo: 'cells', rounds: 40 }],
  [2003, { weapon: 2, ammo: 'rockets', rounds: 2 }],
  // The saw, which comes with nothing because it spends nothing.
  [2005, { weapon: 4, ammo: null, rounds: 0 }],
])

/**
 * The powerups, by what they set going.
 *
 * Six of the original's six. How long each lasts is not here -- `powers.ts`
 * owns that -- so a map cannot have an opinion about the length of a shield.
 */
const POWER_THINGS = new Map<number, Power>([
  [2022, 'shield'],
  [2023, 'rage'],
  [2024, 'blur'],
  [2025, 'suit'],
  [2026, 'chart'],
  [2045, 'sight'],
])

/**
 * What comes in the pack, beyond what it lets you carry.
 *
 * The original's clip of each. The two free weapons are left out rather than
 * given zero, because the list is read by position and a trailing zero would
 * only invite somebody to put a number there.
 */
const PACK_ROUNDS: readonly number[] = [10, 4, 1, 20]

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

/**
 * Rounds, by the reserve they go into and the amount the original puts in each.
 *
 * The cells were the two numbers this table could not hold before: two hundred
 * and thirty-eight of them stand across these maps and there was nothing here
 * that spent cells, so they were the one supply the importer knowingly dropped.
 */
const AMMO = new Map<number, { ammo: Ammo; amount: number }>([
  [2007, { ammo: 'bullets', amount: 10 }],
  [2048, { ammo: 'bullets', amount: 50 }],
  [2008, { ammo: 'shells', amount: 4 }],
  [2049, { ammo: 'shells', amount: 20 }],
  [2010, { ammo: 'rockets', amount: 1 }],
  [2046, { ammo: 'rockets', amount: 5 }],
  [2047, { ammo: 'cells', amount: 20 }],
  [17, { ammo: 'cells', amount: 100 }],
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
  [2047, 'CELL'],
  [17, 'CELP'],
  [5, 'BKEY'],
  [40, 'BSKU'],
  [13, 'RKEY'],
  [39, 'RSKU'],
  [6, 'YKEY'],
  [38, 'YSKU'],
  // The powerups and the pack. `SUIT` is the one of these that had never been
  // baked, which is why the radiation suit was the one powerup that could not
  // even be drawn.
  [2022, 'PINV'],
  [2023, 'PSTR'],
  [2024, 'PINS'],
  [2025, 'SUIT'],
  [2026, 'PMAP'],
  [2045, 'PVIS'],
  [8, 'BPAK'],
  [2005, 'CSAW'],
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
  [2047, CELL_CANISTER],
  [17, CELL_CARTON],
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
  // The powerups, each its own.
  [2022, INVULNERABILITY_SPHERE],
  [2023, BERSERK_PACK],
  [2024, BLUR_SPHERE],
  [2025, HAZARD_SUIT],
  [2026, CHART],
  [2045, GOGGLES],
  // The keys, in the colour they open and the shape the map chose.
  [5, COBALT_KEY],
  [40, COBALT_SKULL],
  [13, CRIMSON_KEY],
  [39, CRIMSON_SKULL],
  [6, AMBER_CARD],
  [38, AMBER_TOKEN],
])

/**
 * What to draw for a reserve when the table above has no picture of its own.
 *
 * A fallback nothing should reach -- every supply in these files has its own
 * picture -- kept because `LOOKS` is a whitelist and a number added to one table
 * and not the other should come out as the wrong box rather than as a crash.
 */
const FALLBACK_AMMO: Readonly<Record<Ammo, Sprite>> = {
  bullets: CANISTER,
  shells: SHELL_BOX,
  rockets: SLUG_CRATE,
  cells: CANISTER,
}

export function supplyFor(type: number): Supply | null {
  const heals = HEALTH.get(type)
  if (heals !== undefined) {
    return { sprite: LOOKS.get(type) ?? KIT, grant: { kind: 'health', amount: heals }, radius: 0.4 }
  }

  const rounds = AMMO.get(type)
  if (rounds !== undefined) {
    return {
      sprite: LOOKS.get(type) ?? FALLBACK_AMMO[rounds.ammo],
      grant: { kind: 'ammo', ammo: rounds.ammo, amount: rounds.amount },
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
    return {
      sprite: LOOKS.get(type) ?? (weapon.ammo === null ? CANISTER : FALLBACK_AMMO[weapon.ammo]),
      grant: { kind: 'weapon', weapon: weapon.weapon, ammo: weapon.ammo, rounds: weapon.rounds },
      radius: 0.45,
    }
  }

  const power = POWER_THINGS.get(type)
  if (power !== undefined) {
    return { sprite: LOOKS.get(type) ?? SPHERE, grant: { kind: 'power', power }, radius: 0.4 }
  }

  if (type === 8) {
    return { sprite: LOOKS.get(type) ?? CANISTER, grant: { kind: 'pack', rounds: PACK_ROUNDS }, radius: 0.45 }
  }

  const colour = keyColourOf(type)
  if (colour !== null) {
    return { sprite: LOOKS.get(type) ?? COBALT_KEY, grant: { kind: 'key', key: colour }, radius: 0.5 }
  }

  return null
}

/** Every thing type that leaves something to pick up, for checks to count against. */
export function supplyTypes(): number[] {
  return [
    ...HEALTH.keys(),
    ...AMMO.keys(),
    ...ARMOUR.keys(),
    ...WEAPON_THINGS.keys(),
    ...POWER_THINGS.keys(),
    8,
    ...KEYS.keys(),
  ]
}
