/**
 * The menu behind the title.
 *
 * Which item is under the cursor, what moving does at the ends, and what a
 * choice means -- all questions with right answers, so they live here where a
 * check can ask them rather than in the page where only a screenshot could.
 *
 * The page keeps the list and the cursor; this decides what happens to them.
 * That split is what lets a check walk the whole menu without a browser, and it
 * is the same one the status line and the status bar already use.
 */

/**
 * What choosing an item asks the page to do.
 *
 * Three kinds, each one something the title actually offers. There were three
 * others once -- opening a file, help, going back -- written for menus that do
 * not exist; the file one was a second way to reach a picker the page already
 * shows in the corner, and a second door to one room is a thing to explain
 * rather than a thing to have.
 *
 * `map` carries a name rather than an index because a file's maps are named,
 * not numbered: E1M1 through E4M9 in one of these files and MAP01 through
 * MAP32 in the other, and the order they appear in is the file's business.
 */
export type MenuAction =
  | { readonly kind: 'begin' }
  | { readonly kind: 'level'; readonly index: number }
  | { readonly kind: 'map'; readonly name: string }
  /**
   * Turn the difficulty up or down.
   *
   * A setting rather than a destination, which is why it is one item that
   * cycles rather than three that sit there: the title has room for a handful
   * of lines and a file's map list already fills them.
   */
  | { readonly kind: 'skill' }

export interface MenuItem {
  readonly label: string
  readonly action: MenuAction
  /**
   * Whether it can be chosen at all.
   *
   * A disabled item stays visible and stays skipped. Hiding it instead would
   * make the menu change length, and a menu that reshuffles under the cursor is
   * one you cannot learn.
   */
  readonly enabled?: boolean
}

export interface Menu {
  readonly items: readonly MenuItem[]
  /** Which item the cursor is on. Always an enabled one. */
  readonly cursor: number
}

/**
 * A menu with the cursor on the first thing that can be chosen.
 *
 * Starting it at zero regardless was the first version, and on a menu whose
 * first item was disabled it opened with the cursor on something that did
 * nothing -- pressing fire looked like the game had hung.
 */
export function openMenu(items: readonly MenuItem[]): Menu {
  return { items, cursor: firstEnabled(items, 0, 1) }
}

/**
 * The menu with the cursor moved by `by`, skipping what cannot be chosen.
 *
 * Wraps at both ends. A menu of four items is a ring, and a cursor that stops
 * dead at the bottom makes you travel back up through everything to reach the
 * first item.
 */
export function moveCursor(menu: Menu, by: number): Menu {
  if (menu.items.length === 0) return menu
  const step = by < 0 ? -1 : 1
  let at = menu.cursor
  // At most one lap: a menu with nothing choosable leaves the cursor alone
  // rather than spinning.
  for (let tried = 0; tried < menu.items.length; tried++) {
    at = (at + step + menu.items.length) % menu.items.length
    if (menu.items[at]?.enabled !== false) return { ...menu, cursor: at }
  }
  return menu
}

/** What the item under the cursor asks for, or null when it cannot be chosen. */
export function chosen(menu: Menu): MenuAction | null {
  const item = menu.items[menu.cursor]
  if (item === undefined || item.enabled === false) return null
  return item.action
}

/**
 * The part of a long menu that fits, and what is hidden either side of it.
 *
 * A file holds thirty-six maps and the grid under the logo has nineteen rows on
 * a desk, seventeen lying down. Drawing the list and letting the bottom fall off
 * -- which is what `menuLayout` does on its own -- makes most of a file
 * unreachable while looking like a menu, so the list scrolls instead.
 *
 * The cursor is kept away from the edges where there is room to: a menu that
 * only scrolls once the cursor is already on the last visible line gives no
 * warning that there is more. `MARGIN` is how many items of lead to keep, and
 * it collapses on its own when the window is small.
 */
const MARGIN = 2

export interface MenuWindow {
  /** The index in `items` of the first one shown. */
  readonly from: number
  /** How many are shown. */
  readonly count: number
  /** Whether anything is hidden above and below, for the marks that say so. */
  readonly moreAbove: boolean
  readonly moreBelow: boolean
}

export function menuWindow(menu: Menu, rows: number): MenuWindow {
  const total = menu.items.length
  const count = Math.max(0, Math.min(total, rows))
  // Nothing visible means everything is below, not above: a window with no
  // rows has not scrolled past anything. The first version said the opposite
  // and the marks would have pointed the wrong way on a grid too short to draw
  // a single line of the list.
  if (count === 0) return { from: 0, count: 0, moreAbove: false, moreBelow: total > 0 }

  // Lead of MARGIN where the window is big enough to have any, and half the
  // window when it is not -- on a three-line window the cursor sits in the
  // middle rather than being pinned to an edge it cannot leave.
  const lead = Math.min(MARGIN, Math.floor((count - 1) / 2))
  let from = menu.cursor - lead
  if (menu.cursor + lead >= from + count) from = menu.cursor + lead - count + 1
  from = Math.max(0, Math.min(total - count, from))

  return {
    from,
    count,
    moreAbove: from > 0,
    moreBelow: from + count < total,
  }
}

/**
 * Where each line of the menu goes on a grid.
 *
 * Centred as a block under whatever sits above it, one blank row between lines
 * so the cursor mark has somewhere to be. Lines that would fall off the bottom
 * are dropped rather than drawn past it -- the same rule the summary uses.
 */
export function menuLayout(
  width: number,
  height: number,
  menu: Menu,
  top: number,
): { readonly text: string; readonly col: number; readonly row: number; readonly under: boolean }[] {
  const placed: { text: string; col: number; row: number; under: boolean }[] = []

  /*
   * What fits, rather than everything with the rest falling off the bottom.
   *
   * A blank row between items is right for a menu of three and wrong for a menu
   * of thirty-six: at two rows each, the nineteen free on a desk hold nine maps
   * of a file's thirty-six. So a long list is drawn packed and scrolled, and a
   * short one keeps the spacing it always had.
   */
  const spacing = menu.items.length * 2 <= height - top ? 2 : 1
  const window = menuWindow(menu, Math.max(0, Math.floor((height - top) / spacing)))

  for (let i = window.from; i < window.from + window.count; i++) {
    const row = top + (i - window.from) * spacing
    if (row < 0 || row >= height) continue
    const item = menu.items[i]!
    // The cursor is drawn into the text rather than beside it, so a centred
    // line does not jump sideways when it becomes the selected one.
    const text = `${i === menu.cursor ? '>' : ' '} ${item.label} ${i === menu.cursor ? '<' : ' '}`
    placed.push({
      text,
      col: Math.max(0, Math.floor((width - text.length) / 2)),
      row,
      under: i === menu.cursor,
    })
  }
  /*
   * And a mark at each end that has more behind it.
   *
   * On the line itself rather than beside it: a centred list with a marker in
   * the margin shifts sideways as you scroll, and there is no margin to put it
   * in on a phone anyway.
   */
  if (window.moreAbove && placed[0] !== undefined) {
    placed[0] = { ...placed[0], text: hint(placed[0].text, '^') }
  }
  const foot = placed[placed.length - 1]
  if (window.moreBelow && foot !== undefined) {
    placed[placed.length - 1] = { ...foot, text: hint(foot.text, 'v') }
  }
  return placed
}

/**
 * The line with a mark where its leading space is, so it does not move.
 *
 * Never over the cursor's own mark. Where the window has no room for lead --
 * two rows, or the ends of a long list -- the item under the cursor is also the
 * one at the window's edge, and the first version wrote the scroll mark over
 * the `>`: the line came out `^ E1M11 <`, which says there is more above and
 * no longer says which line you are on. The scroll mark goes on the tail in
 * that case, where the `<` already is, because losing the hint that the list
 * runs on costs less than losing the cursor.
 */
function hint(text: string, mark: string): string {
  if (!text.startsWith('>')) return `${mark}${text.slice(1)}`
  return `${text.slice(0, -1)}${mark}`
}

function firstEnabled(items: readonly MenuItem[], from: number, step: number): number {
  for (let tried = 0; tried < items.length; tried++) {
    const at = (from + step * tried + items.length) % items.length
    if (items[at]?.enabled !== false) return at
  }
  return 0
}
