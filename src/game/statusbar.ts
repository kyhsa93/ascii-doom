/**
 * The status bar, laid out the way the original's is.
 *
 * Built out of characters rather than converted from the picture, and that is a
 * decision rather than a shortcut. `STBAR` is 320 by 32 pixels of metal
 * texture; every number, key and face on it is composited at runtime from
 * separate lumps. Averaged down to nine rows of characters it comes out as a
 * stripe of `=` and `%` with nothing legible on it -- a photograph of an
 * interface, which is worse than an interface.
 *
 * So what is taken is the *arrangement*: the health on the left, the ammunition
 * beside it, the keys on the right, the level between them, each in its own
 * panel with a rule between. That is the thing you recognise across the room,
 * and it is also the thing a character grid can actually draw.
 *
 * Pure arithmetic, like `hud.ts` beside it, because where a panel goes is a
 * question with a right answer and the page is the one place a check cannot
 * look.
 */

/** What a panel shows: a heading nobody reads twice and the number they do. */
export interface Panel {
  readonly label: string
  readonly value: string
  /** Dropped first when the grid is too narrow, lowest first. */
  readonly priority: number
}

export interface PlacedPanel {
  readonly label: string
  readonly value: string
  /** Leftmost column of the panel's box. */
  readonly col: number
  /** How many columns the box spans, rule included. */
  readonly width: number
}

export interface Bar {
  /** Topmost row of the bar; everything above it is still the world. */
  readonly top: number
  readonly rows: number
  readonly panels: readonly PlacedPanel[]
}

/**
 * How tall the bar is on a grid this size.
 *
 * Three rows: a rule, the labels, the numbers. The original's is thirty-two of
 * two hundred pixels, which is a sixth of the screen; three of fifty rows is a
 * sixteenth, and the difference is that a character is already as tall as a
 * line of text so nothing has to be drawn twice as large to be read.
 */
export const BAR_ROWS = 3

/**
 * The narrowest grid that gets a bar at all.
 *
 * A phone is forty-nine columns. Four panels with rules between them need about
 * ten columns each before the numbers start colliding, and below that the
 * single status line in `hud.ts` -- which drops what does not fit, by priority
 * -- says more in one row than a cramped bar says in three. So a narrow screen
 * keeps the line, and this returns nothing.
 */
export const NARROWEST = 72

/**
 * Where each panel goes, or null for a grid too narrow to have a bar.
 *
 * Panels share the width evenly rather than being sized to their contents: the
 * original's bar does not move its health reading when the number goes from a
 * hundred to ninety-nine, and a bar whose fields shuffle as you take damage is
 * a bar you cannot read at a glance.
 */
export function layoutBar(width: number, height: number, panels: readonly Panel[]): Bar | null {
  if (width < NARROWEST || height < BAR_ROWS + 4 || panels.length === 0) return null

  // Dropped lowest-priority first until each panel has room for its longest
  // line plus a space each side.
  const weakestFirst = [...panels].sort((a, b) => a.priority - b.priority)
  for (let dropped = 0; dropped < panels.length; dropped++) {
    const survivors = new Set(weakestFirst.slice(dropped))
    const kept = panels.filter((panel) => survivors.has(panel))
    if (kept.length === 0) break

    const each = Math.floor(width / kept.length)
    const longest = Math.max(...kept.map((panel) => Math.max(panel.label.length, panel.value.length)))
    if (each < longest + 2) continue

    return {
      top: height - BAR_ROWS,
      rows: BAR_ROWS,
      panels: kept.map((panel, index) => ({
        label: panel.label,
        value: panel.value,
        col: index * each,
        // The last panel takes whatever the division left over, so the bar
        // reaches the right-hand edge instead of stopping a column short.
        width: index === kept.length - 1 ? width - index * each : each,
      })),
    }
  }
  return null
}

/** The column a panel's text is centred on. */
export function centreOf(panel: PlacedPanel): number {
  return panel.col + Math.floor(panel.width / 2)
}
