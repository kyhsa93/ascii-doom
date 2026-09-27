/**
 * The four reserves, and which of them a weapon spends.
 *
 * A module of its own for one reason: the weapons and the things you pick up
 * both need to name a reserve, and neither of them should have to import the
 * other to do it. `weapons.ts` would otherwise have to know about pickups or
 * `pickups.ts` about guns, and the first version of either arrangement is a
 * cycle that resolves to `undefined` at import time.
 *
 * Four rather than one per weapon, which is how the original has it and was not
 * how this game had it. Reserves were indexed by the weapon that spent them, so
 * a scattergun and the twin-barrelled one drew from two separate piles of
 * shells -- fine while there was one of each kind of gun, and wrong the moment
 * there were two. Sharing is most of what makes finding a second shotgun
 * interesting: it is a better way to spend the shells you already have rather
 * than a second supply of them.
 */

export type Ammo = 'bullets' | 'shells' | 'rockets' | 'cells'

/**
 * The order the reserves are stored in.
 *
 * An array indexed by this rather than a record, for the reason the powerup
 * clocks are: four numbers copy, compare and serialise without anybody having
 * to keep a set of keys in step, and a save can write them down as they are.
 */
export const AMMO_KINDS: readonly Ammo[] = ['bullets', 'shells', 'rockets', 'cells']

/** Where in the reserves this kind lives, or -1 for something that is not one. */
export function indexOfAmmo(kind: Ammo): number {
  return AMMO_KINDS.indexOf(kind)
}
