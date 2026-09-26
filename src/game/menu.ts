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

/** What choosing an item asks the page to do. */
export type MenuAction =
  | { readonly kind: 'begin' }
  | { readonly kind: 'level'; readonly index: number }
  | { readonly kind: 'openWad' }
  | { readonly kind: 'help' }
  | { readonly kind: 'back' }

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
  for (let i = 0; i < menu.items.length; i++) {
    const row = top + i * 2
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
  return placed
}

function firstEnabled(items: readonly MenuItem[], from: number, step: number): number {
  for (let tried = 0; tried < items.length; tried++) {
    const at = (from + step * tried + items.length) % items.length
    if (items[at]?.enabled !== false) return at
  }
  return 0
}
