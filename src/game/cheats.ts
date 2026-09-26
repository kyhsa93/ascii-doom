/**
 * The typed words, and what each of them does.
 *
 * Doom's cheats are not bound keys: no letter does anything on its own, and a
 * word takes effect the moment its last letter lands. That makes the whole of
 * it a function from a stream of letters to an effect, which is why none of it
 * needs a page, a frame loop or a browser to be checked.
 *
 * The words are the original's, spelled the way people actually remember them.
 * This project takes the original's techniques rather than its files, and a
 * cheat is a technique whose whole point is that you already know it -- a
 * renamed one would be a cheat nobody can use.
 *
 * What they do is named for what happens here rather than for the original's
 * internal words: `god`, `kit`, `ghost`, `chart`.
 */

/** What a finished word asks for. */
export type Cheat = 'god' | 'kit' | 'ghost' | 'chart' | 'record' | 'replay'

/*
 * No word may be the tail of another.
 *
 * A rolling buffer matches on the end, so a word ending inside a longer one
 * could never be reached -- every attempt at the long one would fire the short
 * one first. A check writes this out separately and asserts it.
 */
const WORDS = new Map<string, Cheat>([
  ['iddqd', 'god'],
  ['idkfa', 'kit'],
  ['idclip', 'ghost'],
  ['iddt', 'chart'],
  /*
   * Recording and playing back, which are typed for the same reason the rest
   * are: this game's only screen is its title, and a demo is not something to
   * put a menu in front of. The original's own demos were recorded from the
   * command line, which is the same idea in the place that era had for it.
   */
  ['idrec', 'record'],
  ['idplay', 'replay'],
])

/** Every word this game knows, for a check to count against. */
export function cheatWords(): string[] {
  return [...WORDS.keys()]
}

const LONGEST = Math.max(...[...WORDS.keys()].map((word) => word.length))

/** Nothing typed yet. */
export function fresh(): string {
  return ''
}

/**
 * One more letter, keeping only as much as the longest word could need.
 *
 * Rolling rather than reset-on-mismatch, which is what makes a false start
 * harmless: the letters before the word simply fall off the front. Anything
 * that is not a letter is ignored rather than clearing the buffer -- a player
 * who turns while typing has not changed their mind about the word.
 */
export function typeLetter(typed: string, key: string): string {
  if (key.length !== 1) return typed
  const letter = key.toLowerCase()
  if (letter < 'a' || letter > 'z') return typed
  return (typed + letter).slice(-LONGEST)
}

/** The cheat the buffer now ends in, or null. */
export function effectOf(typed: string): Cheat | null {
  for (const [word, effect] of WORDS) {
    if (typed.endsWith(word)) return effect
  }
  return null
}
