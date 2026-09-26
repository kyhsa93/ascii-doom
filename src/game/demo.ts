/**
 * Recording a run, and playing it back into the same game.
 *
 * A demo is only a recording if the game it replays into behaves the same way
 * twice, and almost all of this one already does: one fixed step of a
 * sixtieth, no clock inside the rules, nothing read from the wall. The two
 * exceptions are rolls -- a shot's spread and a creature's aim -- so a demo
 * carries the seed those rolls came from and the page runs its generator
 * instead of `Math.random` while one is being recorded or played.
 *
 * What is stored is the intent per tick rather than the keys pressed. Keys are
 * a device's business and there are two of them here, a keyboard and a pair of
 * thumbs; the intent is what both of them turn into and is what the rules
 * actually read, so a demo recorded on a phone plays back on a desk.
 *
 * Runs of identical intents are stored once with a count, because input barely
 * changes between one sixtieth and the next. A minute of standing still is one
 * entry rather than three and a half thousand copies of the same object.
 */

import { IDLE, type Intent } from './input.ts'

/** A run of identical ticks: what was asked for, and for how many. */
export interface Run {
  readonly intent: Intent
  readonly ticks: number
}

/** A finished recording, which is a plain object and survives being text. */
export interface Demo {
  /** What the rolls were seeded with. */
  readonly seed: number
  /** Which campaign level it was recorded in. */
  readonly levelIndex: number
  /** How many ticks long it is, counted rather than derived by a reader. */
  readonly ticks: number
  readonly runs: readonly Run[]
}

/** A recording in progress. */
export interface Tape {
  readonly seed: number
  readonly runs: Run[]
  ticks: number
}

/**
 * A repeatable generator.
 *
 * The same one the checks have used for measuring spread since before demos
 * existed: a plain linear congruential generator, which is not a good source
 * of randomness and is an excellent source of the same numbers twice. That is
 * the only property being asked for here.
 */
export function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    return (state % 2147483648) / 2147483648
  }
}

export function record(seed: number): Tape {
  return { seed, runs: [], ticks: 0 }
}

/** Whether two intents ask for exactly the same thing. */
function same(a: Intent, b: Intent): boolean {
  return (
    a.forward === b.forward &&
    a.strafe === b.strafe &&
    a.turn === b.turn &&
    a.look === b.look &&
    a.run === b.run &&
    a.fire === b.fire &&
    a.use === b.use &&
    a.weapon === b.weapon &&
    a.map === b.map
  )
}

/**
 * One more tick.
 *
 * Returns the tape rather than mutating in place as far as the caller is
 * concerned, which keeps the checks honest about what a tape is; the array
 * inside is appended to, because copying a minute of runs every sixtieth of a
 * second is a cost with nothing to show for it.
 */
export function remember(tape: Tape, intent: Intent): Tape {
  const last = tape.runs[tape.runs.length - 1]
  if (last !== undefined && same(last.intent, intent)) {
    tape.runs[tape.runs.length - 1] = { intent: last.intent, ticks: last.ticks + 1 }
  } else {
    // Copied, because the page hands the same object back with new numbers in
    // it every tick and a tape full of references would all say the same thing.
    tape.runs.push({ intent: { ...intent }, ticks: 1 })
  }
  tape.ticks++
  return tape
}

/** Closes a recording, naming the level it belongs to. */
export function sealed(tape: Tape, levelIndex: number): Demo {
  return { seed: tape.seed, levelIndex, ticks: tape.ticks, runs: [...tape.runs] }
}

/**
 * What was asked for at a tick, or null once the recording has run out.
 *
 * Null rather than the last frame repeating, so a caller can tell "the demo is
 * over" from "the player was standing still at the end" -- which look the same
 * on screen and mean entirely different things.
 */
export function intentAt(demo: Demo, tick: number): Intent | null {
  if (tick < 0 || tick >= demo.ticks) return null
  let at = 0
  for (const run of demo.runs) {
    if (tick < at + run.ticks) return run.intent
    at += run.ticks
  }
  return null
}

/** An empty demo, for a page that has nothing recorded yet. */
export function noDemo(): Demo {
  return { seed: 0, levelIndex: 0, ticks: 0, runs: [{ intent: IDLE, ticks: 0 }].slice(0, 0) }
}
