/**
 * Laying out the status line.
 *
 * Pure arithmetic on purpose. The status line is drawn by the page, but where
 * its pieces go is a thing with a right answer, so it lives here where Node can
 * check it rather than in the browser code where only a screenshot could.
 *
 * The rule it exists to enforce: at 163 columns everything fits comfortably and
 * at 49 it does not. Written naively — left group at column 1, right group at
 * the last column — the two run into each other on a phone and the floor's own
 * glyphs fill the gap between them, so the whole bottom row reads as one
 * unbroken string of numbers and punctuation. Rather than shrink the text or
 * pick a width and hope, segments carry a priority and the least important ones
 * are dropped until what remains has room.
 */

export interface HudSegment {
  readonly text: string
  readonly align: 'left' | 'right'
  /** Higher survives. The most important segment is never dropped. */
  readonly priority: number
}

export interface PlacedSegment {
  readonly text: string
  /** Column to draw at, matching `drawText`'s meaning of the alignment. */
  readonly col: number
  readonly align: 'left' | 'right'
}

/**
 * Places what fits and drops the rest, lowest priority first.
 *
 * `gap` is the blank space demanded between the left and right groups. It is
 * not decoration: without it the two groups touch, and two touching runs of
 * text on a character grid are one run of text.
 */
export function layoutHud(width: number, segments: readonly HudSegment[], gap = 3): PlacedSegment[] {
  // Two different orderings, and the first version of this used one for both.
  //
  // Priority decides what survives: sort weakest first and slice from the
  // front, and each attempt drops exactly the least important thing left. But
  // the survivors must then be *placed* in the order the caller wrote them, or
  // the status line comes out with the weapon before the health because the
  // weapon happened to matter less. One value doing two jobs, and the screen
  // said so.
  const weakestFirst = [...segments].sort((a, b) => a.priority - b.priority)
  for (let dropped = 0; dropped < segments.length; dropped++) {
    const survivors = new Set(weakestFirst.slice(dropped))
    const kept = segments.filter((segment) => survivors.has(segment))
    const placed = tryPlace(width, kept, gap)
    if (placed) return placed
  }
  return []
}

function tryPlace(width: number, kept: readonly HudSegment[], gap: number): PlacedSegment[] | null {
  const placed: PlacedSegment[] = []
  // One space in from each edge, so nothing sits against the frame.
  let leftCursor = 1
  let rightCursor = width - 2

  for (const segment of kept) {
    if (segment.align !== 'left') continue
    placed.push({ text: segment.text, col: leftCursor, align: 'left' })
    leftCursor += segment.text.length + 1
  }
  for (const segment of kept) {
    if (segment.align !== 'right') continue
    placed.push({ text: segment.text, col: rightCursor, align: 'right' })
    rightCursor -= segment.text.length + 1
  }

  // `leftCursor` is the first free column on the left; `rightCursor` is the
  // last occupied column on the right after stepping past everything placed.
  const rightEdge = rightCursor + 1
  if (rightEdge - leftCursor < gap) return null
  return placed
}
