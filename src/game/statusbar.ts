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
 * So what is taken is the *arrangement*, and it is now the original's in full:
 * the ammunition first, then the health, then the arms you are carrying, then
 * the armour, then the keys, then the four reserves -- each in its own panel with
 * a rule between. That is the thing you recognise across the room, and it is also
 * the thing a character grid can actually draw.
 *
 * The face is the one piece of it that the medium refuses, and it was measured
 * rather than assumed. `STFST00` baked at four rows is a six-column blob, at six
 * rows a head-shaped mass with no features, and at nine -- which is a fifth of the
 * screen -- still a mass with no eyes. It is the same property that decides
 * `STBAR` and the small font: large flat lettering survives being averaged into
 * characters and a painting does not, and a mugshot is a painting.
 *
 * Pure arithmetic, like `hud.ts` beside it, because where a panel goes is a
 * question with a right answer and the page is the one place a check cannot
 * look.
 */

import type { Sprite } from '../columns/sprite.ts'
import {
  FACE_BAD,
  FACE_DEAD,
  FACE_DYING,
  FACE_HURT,
  FACE_UNTOUCHABLE,
  FACE_WELL,
  FACE_WORSE,
} from './freedoomart.ts'
import { capacityOf, heldOf, type Carrier } from './pickups.ts'
import { AMMO_KINDS } from './ammo.ts'
import { SLOTS } from './weapons.ts'

/** What a panel shows: a heading nobody reads twice and the number they do. */
export interface Panel {
  readonly label: string
  readonly value: string
  /** Dropped first when the grid is too narrow, lowest first. */
  readonly priority: number
  /**
   * Further lines under the number, for a panel that is a column rather than one
   * reading.
   *
   * The arms you are holding are two rows of three and the reserves are four
   * lines; a panel that could only say one thing could say neither. Counted in
   * the width a panel needs, so a long line in one of them widens the panel
   * rather than running into the next.
   */
  readonly lines?: readonly string[]
  /**
   * A picture drawn in the panel instead of any of the above.
   *
   * One panel has one: the face. It is the only thing on this bar that is not
   * lettering, which is why it took three attempts to get onto it at all -- and
   * why it cannot go through `lines`, which is a string and would throw away the
   * colour a cell at a time that makes it legible.
   */
  readonly face?: Sprite
}

export interface PlacedPanel {
  readonly label: string
  readonly value: string
  readonly lines: readonly string[]
  readonly face?: Sprite
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
 * Six rows: a rule, the labels, and four for the numbers -- the deepest panel is
 * the four reserves, and the first of its lines shares the row the single numbers
 * use. Measured against the layout rather than rounded up: seven left a blank row
 * along the whole bar.
 *
 * It was three, on the argument that a character is already as tall as a line of
 * text so nothing has to be drawn twice as large to be read. That argument is
 * still right about text and was never about a grid: the arms display is two rows
 * of three numbers and the reserves are four lines, and neither can be squeezed
 * into one. Six of fifty rows is an eighth of the screen against the sixth the
 * original spends, so the shape is the original's for the original's reason
 * rather than by coincidence.
 */
export const BAR_ROWS = 6

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
    const longest = Math.max(
      ...kept.map((panel) =>
        Math.max(panel.label.length, panel.value.length, ...(panel.lines ?? []).map((line) => line.length)),
      ),
    )
    if (each < longest + 2) continue

    return {
      top: height - BAR_ROWS,
      rows: BAR_ROWS,
      panels: kept.map((panel, index) => ({
        label: panel.label,
        value: panel.value,
        lines: panel.lines ?? [],
        ...(panel.face === undefined ? {} : { face: panel.face }),
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

/**
 * The arms display: the original's two rows of slot numbers, 2 to 7.
 *
 * A digit for a slot you have something in and a dash for one you do not, which
 * is how a single colour says what the original says with two. The fist and the
 * saw are slot one and are left out for the reason the original leaves them out:
 * you always have one of them, so the display would always read the same.
 */
export function armsRows(held: ReadonlySet<number>): string[] {
  const shown = (slot: number): string => {
    const inSlot = SLOTS[slot] ?? []
    return inSlot.some((weapon) => held.has(weapon)) ? `${slot + 1}` : '-'
  }
  return [`${shown(1)} ${shown(2)} ${shown(3)}`, `${shown(4)} ${shown(5)} ${shown(6)}`]
}

/** The three keys, one to a line, in the order the original stacks them. */
export function keyRows(held: ReadonlySet<string>): string[] {
  return ['cobalt', 'crimson', 'amber'].map((colour) => (held.has(colour) ? colour : '-'))
}

/**
 * The four reserves against what can be carried, which is the block the original
 * puts on the right of its bar.
 *
 * Against the ceiling rather than alone, because the number on its own does not
 * say whether a box of shells is worth walking to -- and the ceiling moves when
 * the pack is found.
 */
export function stockRows(kit: Carrier): string[] {
  return AMMO_KINDS.map((kind) => `${kind.slice(0, 4)} ${heldOf(kit, kind)}/${capacityOf(kit, kind)}`)
}

/**
 * Which face to show, by the five bands the original divides health into.
 *
 * The bands are the original's arithmetic -- a fifth of the maximum each -- and
 * the two states that are not a band at all come first, because being dead is
 * not a quantity of health and neither is nothing being able to touch you.
 *
 * Two of the five come out of the converter as the same picture. The original
 * separates its healthiest two faces by an eyebrow and a set of the mouth, and
 * at five rows of characters there is no eyebrow. The bands are kept anyway,
 * because the arithmetic is the original's and the day the art gets taller they
 * separate on their own -- what would be wrong is pretending there are five
 * pictures when a measurement says there are four.
 *
 * Here rather than in the page for the reason the rest of this file is: it is a
 * rule with a right answer, and the page is where nothing can check it.
 */
export function faceFor(health: number, maxHealth: number, untouchable: boolean): Sprite {
  if (health <= 0) return FACE_DEAD
  if (untouchable) return FACE_UNTOUCHABLE
  const bands = [FACE_DYING, FACE_BAD, FACE_WORSE, FACE_HURT, FACE_WELL]
  const share = Math.max(0, Math.min(1, health / Math.max(1, maxHealth)))
  // Five bands over the whole range, and the top one has to include the maximum
  // itself: a share of exactly one would otherwise index past the end.
  const band = Math.min(bands.length - 1, Math.floor(share * bands.length))
  return bands[band]!
}
