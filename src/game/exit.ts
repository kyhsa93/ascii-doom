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

/** What the summary shows. Assembled by the caller, which is what holds the counts. */
export interface Tally {
  readonly seconds: number
  readonly kills: number
  readonly creatures: number
  readonly collected: number
  readonly supplies: number
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
export function summaryLines(tally: Tally): string[] {
  const minutes = Math.floor(tally.seconds / 60)
  const seconds = Math.floor(tally.seconds % 60)
  const clock = `${minutes}:${String(seconds).padStart(2, '0')}`
  return [
    'LEVEL COMPLETE',
    `time      ${clock}`,
    `creatures ${tally.kills} / ${tally.creatures}`,
    `supplies  ${tally.collected} / ${tally.supplies}`,
  ]
}
