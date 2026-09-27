/**
 * The powerups, and the clocks they run on.
 *
 * Two hundred and fifty-six of these stand across the sixty-eight maps this
 * game can open, and until now every one of them was scenery: the pictures were
 * baked, the things were placed, and walking into one did nothing. They are
 * here rather than in the page because "for how long" and "what it does" are
 * rules with right answers, and a rule that lives in the frame loop is a rule
 * nothing can check.
 *
 * Six of them, which is the original's set minus the one whose picture this
 * project does not have -- see `waditems.ts` for why the radiation suit is
 * placed but the rest are not.
 *
 * Time, not a flag, because the interesting thing about a shield is that it runs
 * out while you are still in the room you took it into. The two that never run
 * out say so with an infinite clock rather than with a boolean of their own:
 * one field counts down, one rule reads it, and the difference between "lasts
 * thirty seconds" and "lasts the level" is a number in the table below instead
 * of a second code path. A save writes the clocks out, so `Infinity` has to
 * survive the trip -- `save.ts` maps it to a negative and back, which is the
 * one place that knows the representation.
 */

/**
 * What you can be under the effect of.
 *
 * `rage` and `chart` are the two that stay: the original's berserk leaves your
 * fists heavy for the rest of the level, and a map you have read is read.
 */
export type Power = 'shield' | 'rage' | 'blur' | 'suit' | 'chart' | 'sight'

/**
 * The order the clocks are stored in.
 *
 * An array indexed by this rather than a record, for the same reason the save
 * names everything by index: six numbers copy, compare and serialise without
 * anybody having to keep a set of keys in step.
 */
export const POWERS: readonly Power[] = ['shield', 'rage', 'blur', 'suit', 'chart', 'sight']

/**
 * Seconds each lasts, the original's numbers where it has them.
 *
 * Thirty for the shield is short on purpose: it is long enough to cross a room
 * you could not otherwise cross and too short to clear one, so what it buys is
 * a decision about which room.
 */
export const LASTS: Readonly<Record<Power, number>> = {
  shield: 30,
  rage: Infinity,
  blur: 60,
  suit: 60,
  chart: Infinity,
  sight: 120,
}

/** How much heavier a swing lands while raging. The original's tenfold. */
export const RAGE_MULTIPLIER = 10

/**
 * Extra radians of error on a creature's aim while you are blurred.
 *
 * The original made monsters lose you outright most of the time; this widens
 * the cone instead, because a creature that stops firing reads as a bug and one
 * that fires past you reads as the powerup working. Point four five is about
 * twenty-six degrees either side -- at ten metres that is a miss by five.
 */
export const BLUR_WOBBLE = 0.45

/** What the goggles lift a sector's light to. Distance still dims it. */
export const SIGHT_FLOOR = 1

/** Six clocks at zero. */
export function freshPowers(): number[] {
  return POWERS.map(() => 0)
}

/** Whether a clock is still running. */
export function holds(powers: readonly number[], power: Power): boolean {
  const at = POWERS.indexOf(power)
  return at >= 0 && (powers[at] ?? 0) > 0
}

/** How long is left on one, in seconds. Zero for one not held. */
export function leftOn(powers: readonly number[], power: Power): number {
  const at = POWERS.indexOf(power)
  return at < 0 ? 0 : Math.max(0, powers[at] ?? 0)
}

/**
 * Starts a clock, or starts it again.
 *
 * Refreshes rather than stacks: two shields found back to back are thirty
 * seconds from the second one, not sixty. The original's rule, and the reason
 * is that stacking turns a room with four of them into a room with no rules.
 */
export function grantPower(powers: number[], power: Power): void {
  const at = POWERS.indexOf(power)
  if (at < 0) return
  powers[at] = LASTS[power]
}

/**
 * Runs every clock down by `dt`, and says which ones ran out on this step.
 *
 * The ones that ran out are returned rather than merely cleared so the page can
 * say so. A powerup that ends silently is one you find out about by dying.
 */
export function tickPowers(powers: number[], dt: number): Power[] {
  const ended: Power[] = []
  for (let i = 0; i < POWERS.length; i++) {
    const left = powers[i] ?? 0
    if (left <= 0) continue
    const now = left - dt
    powers[i] = now > 0 ? now : 0
    if (now <= 0) ended.push(POWERS[i]!)
  }
  return ended
}
