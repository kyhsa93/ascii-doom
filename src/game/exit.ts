/**
 * Finishing the level.
 *
 * The exit is a sector you walk into. That is deliberately the dullest of the
 * available designs: a switch would need its own "what am I facing" ray, which
 * already exists for doors and would then exist twice, and a second copy of
 * that logic is a second thing to keep in agreement. Walking in asks one
 * question — which sector is the body in — and the sector was already being
 * tracked every time it moved.
 *
 * Reaching it fires once. Everything downstream of finishing a level tends to
 * be a thing you only want to happen once (a summary appearing, a clock
 * stopping, a sound), and making that this module's business rather than each
 * caller's is what stops three of them disagreeing about whether the level is
 * over.
 */

export interface Goal {
  /** The sector that ends the level when entered. */
  readonly exitSector: number
  /** Set the moment it is reached, and never cleared. */
  reached: boolean
  /**
   * Seconds played.
   *
   * Counts while the level is running and stops when it ends, so the number in
   * the summary is how long it took rather than how long the summary has been
   * on screen.
   */
  elapsed: number
}

export function makeGoal(exitSector: number): Goal {
  return { exitSector, reached: false, elapsed: 0 }
}

/**
 * Advances the clock and notices arrival.
 *
 * Returns true only on the step the exit is first reached, so a caller can
 * hang a one-off on it without tracking the edge itself.
 */
export function reachExit(goal: Goal, sector: number, dt: number): boolean {
  if (goal.reached) return false
  goal.elapsed += dt
  if (sector !== goal.exitSector) return false
  goal.reached = true
  return true
}

/**
 * Ends the level from somewhere other than a sector.
 *
 * Some maps finish on a switch rather than on a room you walk into: you face a
 * piece of wall and press it. That cannot be phrased as "which sector is the
 * body in", so it needs its own way in -- but not its own idea of what being
 * finished means. This keeps the one-off where `reachExit` keeps it, so that
 * two ways of ending a level cannot disagree about whether it has ended.
 *
 * Returns true only on the call that ends it, the same as `reachExit`.
 */
export function finishNow(goal: Goal): boolean {
  if (goal.reached) return false
  goal.reached = true
  return true
}

/** What the summary shows. Assembled by the caller, which is what holds the counts. */
export interface Tally {
  readonly seconds: number
  readonly kills: number
  readonly creatures: number
  readonly collected: number
  readonly supplies: number
  /**
   * Hidden rooms found, and how many there were.
   *
   * The original counts these and it is most of why anybody walks into a wall
   * twice. Three hundred and twenty-five sectors across the two files this was
   * built against are marked secret, on sixty-six of the sixty-eight maps --
   * and a level written here has none, so the line is left out rather than
   * printed as "0 / 0", which reads as a failure rather than as absence.
   */
  readonly secrets: number
  readonly found: number
}

/** A summary line, already placed. */
export interface PlacedLine {
  readonly text: string
  /** Leftmost column, resolved here so nothing downstream repeats the centring. */
  readonly col: number
  readonly row: number
}

/**
 * Places the summary on a grid.
 *
 * Separated from the page for the same reason the status line was: a summary
 * that fits on a wide screen and runs off a narrow one is a thing with a right
 * answer, and the page is the one place a check cannot look. On a 49-column
 * phone grid the longest of these lines is most of the width, so centring it
 * carelessly pushes its left edge off the screen.
 *
 * The column returned is the left edge rather than the centre, so the caller
 * draws left-aligned and the centring rule lives in exactly one place. Lines
 * that will not fit vertically are dropped rather than drawn off the bottom.
 */
export function summaryLayout(width: number, height: number, lines: readonly string[]): PlacedLine[] {
  const spacing = 2
  const tall = (lines.length - 1) * spacing + 1
  const top = Math.max(0, Math.floor((height - tall) / 2))
  const placed: PlacedLine[] = []

  for (let index = 0; index < lines.length; index++) {
    const text = lines[index]!
    const row = top + index * spacing
    if (row >= height) break
    // Clamped, so a line wider than the grid loses its right-hand end rather
    // than starting off the left of it.
    const col = Math.max(0, Math.floor((width - text.length) / 2))
    placed.push({ text, col, row })
  }
  return placed
}

/**
 * The summary as lines of text, longest-lived first.
 *
 * Here rather than in the page because what a completed level says is content
 * with a shape, and because laying it out as strings makes it something a
 * check can read without a browser.
 */
/**
 * What the death panel says.
 *
 * Laid out by `summaryLayout` like the summary, because a second centring rule
 * is a second thing to get wrong on a narrow grid. The second line names the
 * thing to press rather than a key, since the same button is a thumb on a
 * phone and a space bar on a desk.
 */
export function deathLines(): string[] {
  return ['YOU DIED', 'fire to try again']
}

export function summaryLines(tally: Tally): string[] {
  const minutes = Math.floor(tally.seconds / 60)
  const seconds = Math.floor(tally.seconds % 60)
  const clock = `${minutes}:${String(seconds).padStart(2, '0')}`
  const lines = [
    'LEVEL COMPLETE',
    `time      ${clock}`,
    `creatures ${tally.kills} / ${tally.creatures}`,
    `supplies  ${tally.collected} / ${tally.supplies}`,
  ]
  // Only where there were any. A map with nothing hidden in it should not be
  // told it found none.
  if (tally.secrets > 0) lines.push(`secrets   ${tally.found} / ${tally.secrets}`)
  return lines
}
