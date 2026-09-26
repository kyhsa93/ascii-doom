/**
 * Two browsers agreeing about one game, with nothing in between them.
 *
 * There is no server here and there is not going to be one: this is a static
 * page. What two peers can do is hold the same rules and feed them the same
 * input, which is lockstep -- neither advances a tick until it holds what both
 * players asked for on that tick.
 *
 * The demo round built everything this needs without meaning to. A fixed step
 * of a sixtieth, one seeded generator behind every roll, and an intent per tick
 * are exactly the conditions under which the same input twice is the same game
 * twice; a recording and a remote player are the same idea pointed in different
 * directions.
 *
 * Input is addressed a few ticks ahead of the one being played. Without that,
 * every tick would wait a round trip and the game would run at the speed of the
 * connection; with it, the wait is absorbed and only a delay longer than the
 * lead is felt. The opening ticks belong to nobody, and both sides agree they
 * are idle -- that agreement *is* the lead, and it has to be the same number at
 * both ends or the two games are not the same game.
 */

import { IDLE, type Intent } from './input.ts'

/** What goes down the wire: one tick's worth of one player's asking. */
export interface Packet {
  readonly tick: number
  readonly intent: Intent
}

/** What both players asked for on a tick. */
export interface Both {
  readonly mine: Intent
  readonly theirs: Intent
}

export interface Lockstep {
  /** How many ticks ahead input is addressed. The same at both ends. */
  readonly lead: number
  readonly mine: Map<number, Intent>
  readonly theirs: Map<number, Intent>
}

export function lockstep(lead: number): Lockstep {
  return { lead, mine: new Map(), theirs: new Map() }
}

/**
 * Records what this player is asking for, and returns what to send.
 *
 * The tick handed in is the one being played; the packet is addressed to the
 * one it will land on. Returning the packet rather than sending it keeps the
 * connection out of here, which is what lets all of this be checked without a
 * browser.
 */
export function speak(net: Lockstep, tick: number, intent: Intent): Packet {
  const at = tick + net.lead
  net.mine.set(at, intent)
  return { tick: at, intent }
}

/** Records what the other player asked for. Order does not matter. */
export function hear(net: Lockstep, packet: Packet): void {
  net.theirs.set(packet.tick, packet.intent)
}

/**
 * Whether a tick can be played.
 *
 * The opening ticks -- the ones before anybody's input could have been
 * addressed -- are settled in advance rather than waited for.
 */
export function ready(net: Lockstep, tick: number): boolean {
  if (tick < net.lead) return true
  return net.mine.has(tick) && net.theirs.has(tick)
}

/** What both players asked for on a tick, or null if it cannot be played yet. */
export function intentsAt(net: Lockstep, tick: number): Both | null {
  if (tick < net.lead) return { mine: IDLE, theirs: IDLE }
  const mine = net.mine.get(tick)
  const theirs = net.theirs.get(tick)
  if (mine === undefined || theirs === undefined) return null
  return { mine, theirs }
}

/**
 * Drops ticks already played.
 *
 * An hour at a sixtieth is two hundred thousand of them, and a game that keeps
 * every one is a game that runs out of memory rather than ending.
 */
export function forget(net: Lockstep, before: number): void {
  for (const map of [net.mine, net.theirs]) {
    for (const tick of map.keys()) {
      if (tick < before) map.delete(tick)
    }
  }
}

/**
 * Which of the two to resolve first, so that both sides pick the same one.
 *
 * Anything that draws from the shared generator -- a shot takes one roll per
 * pellet -- has to happen in the same order at both ends, or the two sides
 * draw different numbers from that moment on and the creatures, which share
 * that generator, walk different ways on the two screens.
 *
 * "Mine, then theirs" is the obvious rule and is wrong, because it names a
 * different player on each machine. "The host, then the guest" names the same
 * one, which is what this returns: the side that is hosting resolves itself
 * first, and the side that is not resolves the other first.
 *
 * A function rather than the condition written at each place that needs it.
 * It was written twice within a day of existing -- once for firing and once
 * for two people reaching the same box -- and a rule kept in two places is a
 * rule that will be half changed.
 */
export function hostFirst(iAmHost: boolean): readonly ('mine' | 'theirs')[] {
  return iAmHost ? ['mine', 'theirs'] : ['theirs', 'mine']
}

/** How many ticks are being held, for a check that memory stays bounded. */
export function held(net: Lockstep): number {
  return net.mine.size + net.theirs.size
}

/**
 * The oldest tick still held, or Infinity when nothing is.
 *
 * Exported for the check that sweeping works, which would otherwise have to
 * assert a count -- and a count is a number with nothing behind it, where
 * "nothing older than the line survived" is the rule itself.
 */
export function earliestHeld(net: Lockstep): number {
  let oldest = Infinity
  for (const map of [net.mine, net.theirs]) {
    for (const tick of map.keys()) oldest = Math.min(oldest, tick)
  }
  return oldest
}
