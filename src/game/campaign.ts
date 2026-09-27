/**
 * The levels, in order.
 *
 * A module of its own because of which way the imports have to point. A level
 * definition needs the `LevelDef` type from `levels.ts`, so `levels.ts` cannot
 * turn round and import the levels to list them without making a cycle — and a
 * cycle between modules that export constants is not a compile error, it is an
 * `undefined` at import time that shows up as an empty map.
 *
 * So the list lives downstream of both: it knows about the levels and the
 * levels know nothing about it.
 */

import { LEVEL_1_DEF } from './level1.ts'
import { LEVEL_2_DEF } from './level2.ts'
import { loadLevel, type LevelDef, type LevelState } from './levels.ts'
import type { Carrier } from './pickups.ts'
import { freshPowers } from './powers.ts'

export const LEVELS: readonly LevelDef[] = [LEVEL_1_DEF, LEVEL_2_DEF]

/** The level after this one, or null at the end of the campaign. */
export function nextLevel(index: number): number | null {
  return index + 1 < LEVELS.length ? index + 1 : null
}

/**
 * Starts a level, and decides what the player brings into it.
 *
 * Here rather than in the page for the reason the status line and the summary
 * layout are: a rule that lives inside the frame loop is a rule nothing can
 * check. This one had been a single line in `main.ts`, which is also the
 * newest and least examined code in the project.
 *
 * Health and ammunition carry over; keys do not. Each level hides the key to
 * its own doors, and one brought forward would open something it was never
 * meant to — which would also quietly falsify the check that every lock has a
 * key in the same level, since that check assumes you arrive with none.
 *
 * Nor do the powerups: a shield taken at the end of one level is a shield spent
 * walking into the next one's first room, and the original ends every one of
 * them at the exit. The pack is the exception, because it is a bag rather than
 * an effect -- what you can carry is yours once you have found something to
 * carry it in.
 */
export function startLevel(index: number, carrier: Carrier): LevelState {
  carrier.keys.clear()
  carrier.powers = freshPowers()
  return loadLevel(levelOrThrow(index))
}

/**
 * What a run begins with.
 *
 * Here rather than written out in the page because death gives it back, so two
 * places need to agree about what "a full kit" is. A loadout that lives in the
 * frame loop is also a loadout nothing can check.
 */
export const STARTING_HEALTH = 100
/*
 * Two zeroes at the end for the two that cost nothing.
 *
 * The fists and the saw are indexed alongside the rest because everything here
 * reads a weapon's reserve by its position, and a weapon left out of these
 * lists would read as one with no ammunition and refuse to fire. A ceiling of
 * zero is right rather than merely harmless: it is what makes a canister
 * useless to them and stops the pack pretending to double something.
 */
export const STARTING_AMMO: readonly number[] = [60, 24, 8, 0, 0]
export const AMMO_CAPACITY: readonly number[] = [120, 48, 24, 0, 0]

export function freshCarrier(): Carrier {
  return {
    health: STARTING_HEALTH,
    maxHealth: STARTING_HEALTH,
    // Copied: the carrier spends its ammunition, and spending it out of the
    // constant would leave the next run starting on whatever the last one had.
    ammo: [...STARTING_AMMO],
    ammoMax: AMMO_CAPACITY,
    keys: new Set<string>(),
    // No jacket to begin with, and the share is whatever the last one worn set.
    // Zero points means the share is never consulted, so the number here is a
    // starting value rather than a rule.
    armour: 0,
    armourShare: 0,
    /**
     * What is in hand at the start.
     *
     * All three, as they always were. The maps are full of weapons -- the
     * launcher stands on fifty-eight of the sixty-eight and the scattergun on
     * fifty-seven -- and picking one up now means something for the rounds it
     * carries even where the weapon itself is already held.
     *
     * The fists are in there too, and cannot be taken out: they are the thing
     * you still have when the reserves are gone. The saw is not -- it is found,
     * thirty-seven times across the maps.
     */
    weapons: new Set([0, 1, 2, 3]),
    powers: freshPowers(),
    pack: false,
  }
}

/**
 * Whether the run is over.
 *
 * A function rather than `health <= 0` written wherever it is needed, because
 * it was needed in three places the moment dying existed at all: the step that
 * stops, the frame that draws the panel, and the check that asks.
 */
export function isDead(carrier: Carrier): boolean {
  return carrier.health <= 0
}

/**
 * Starts the level over, after dying in it.
 *
 * The opposite of `startLevel` in what it does to the carrier. Moving on is a
 * reward and keeps what you earned; dying is not, and hands back the kit you
 * began with. Both clear the keys, for the same reason: the level hides its
 * own, and the copy you are holding came from a map that no longer exists.
 *
 * The index is the level you died in, not the start of the campaign. Losing an
 * hour of progress to one bad room is the version of this rule nobody enjoys.
 */
export function restartLevel(index: number, carrier: Carrier): LevelState {
  const def = levelOrThrow(index)
  refillCarrier(carrier)
  return loadLevel(def)
}

/**
 * Hands back the kit a run begins with, in place.
 *
 * Its own function because dying is not the only way to need it: a map opened
 * from a file starts you over too, and it has no campaign index to restart by.
 * Written twice, the two would drift the moment the loadout changed -- which
 * is the whole reason the loadout stopped living in the page.
 */
export function refillCarrier(carrier: Carrier): void {
  carrier.health = STARTING_HEALTH
  carrier.ammo = [...STARTING_AMMO]
  carrier.keys.clear()
  carrier.armour = 0
  carrier.armourShare = 0
  carrier.weapons = new Set([0, 1, 2, 3])
  carrier.powers = freshPowers()
  // The bag goes back too. Dying hands back the kit you began with, and you
  // began without one.
  carrier.pack = false
}

function levelOrThrow(index: number): LevelDef {
  const def = LEVELS[index]
  if (!def) throw new Error(`no level ${index}; the campaign has ${LEVELS.length}`)
  return def
}
