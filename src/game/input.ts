/**
 * What the player is asking for this frame, and how each device says it.
 *
 * The simulation used to read the keyboard directly, which was fine while a
 * keyboard was the only thing there. Adding touch that way would put a second
 * set of rules inside the frame loop — where nothing can check them — and this
 * project has already had to pull three things back out of there for exactly
 * that reason.
 *
 * So a device produces an intent and the simulation consumes one. Keyboard and
 * touch are two producers of the same thing rather than one path and a special
 * case, and the parts with right answers — that opposing keys cancel, that a
 * diagonal is not faster than a straight line, that a thumb resting on a stick
 * is not a movement — are answerable without a browser.
 */

export interface Intent {
  /** Forward is +1, back is -1. Never more than 1 together with `strafe`. */
  readonly forward: number
  /** Strafe right is +1. */
  readonly strafe: number
  /** Turn left is +1, as a fraction of the turn rate. */
  readonly turn: number
  /** Look up is +1, as a fraction of the look rate. */
  readonly look: number
  readonly run: boolean
  readonly fire: boolean
  readonly use: boolean
  /** Weapon asked for by position in the weapon list, or -1 for no change. */
  readonly weapon: number
  /**
   * Weapon slot asked for, one of the original's seven, or -1 for no change.
   *
   * Separate from `weapon` because a slot is not a weapon: two of the seven hold
   * two guns each and pressing the key again moves between them, so what a slot
   * resolves to depends on what is held -- which is not something this module
   * knows. The page resolves it. A phone's one cycling button asks by weapon
   * instead, because it is already cycling and has nothing to toggle within.
   */
  readonly slot: number
  /**
   * Whether the automap is being asked for right now.
   *
   * Held rather than a pulse, because a device cannot know what a press means:
   * selecting weapon two twice is selecting weapon two, but toggling a map
   * twice is not toggling it. The edge belongs to whoever holds the map's
   * state, which is the page.
   */
  readonly map: boolean
}

export const IDLE: Intent = {
  forward: 0,
  strafe: 0,
  turn: 0,
  look: 0,
  run: false,
  fire: false,
  use: false,
  weapon: -1,
  slot: -1,
  map: false,
}

/**
 * How far a thumb has to move before it counts.
 *
 * A finger resting on a virtual stick is never exactly at its centre, so
 * without this the view drifts whenever anybody is holding the phone.
 */
export const DEADZONE = 0.18

/**
 * Scales a movement pair so a diagonal is not faster than a straight line.
 *
 * Shared by both producers rather than applied once in the simulation, so that
 * a stick pushed into a corner and two keys held at once mean the same speed.
 */
function clampMove(forward: number, strafe: number): { forward: number; strafe: number } {
  const magnitude = Math.hypot(forward, strafe)
  if (magnitude <= 1) return { forward, strafe }
  return { forward: forward / magnitude, strafe: strafe / magnitude }
}

/** The intent a set of held keys amounts to. */
export function keyboardIntent(held: ReadonlySet<string>): Intent {
  const down = (key: string) => held.has(key)
  // Opposing keys cancel rather than one winning, which is what a player
  // pressing both expects and what stops a stuck key pinning you to a wall.
  const forward = (down('w') ? 1 : 0) - (down('s') ? 1 : 0)
  const strafe = (down('d') ? 1 : 0) - (down('a') ? 1 : 0)
  const turn = (down('ArrowLeft') ? 1 : 0) - (down('ArrowRight') ? 1 : 0)
  const look = (down('ArrowUp') ? 1 : 0) - (down('ArrowDown') ? 1 : 0)
  const moved = clampMove(forward, strafe)

  /*
   * Seven keys for seven slots, which is the original's arrangement.
   *
   * These asked for weapons by position for as long as the weapon list was also
   * the order you would want to press them in. It is not: the list is
   * append-only -- everything from a save file to a map's shotgun indexes it --
   * so the fists ended up fourth and the saw fifth, and the four weapons added
   * after them ended up wherever there was room. A slot is the thing a key
   * means, and one press of `1` is the fist while a second is the saw.
   */
  let slot = -1
  if (down('1')) slot = 0
  else if (down('2')) slot = 1
  else if (down('3')) slot = 2
  else if (down('4')) slot = 3
  else if (down('5')) slot = 4
  else if (down('6')) slot = 5
  else if (down('7')) slot = 6

  return {
    forward: moved.forward,
    strafe: moved.strafe,
    turn,
    look,
    run: down('Shift'),
    fire: down(' '),
    use: down('e'),
    // The keyboard never asks by position: it has a key per slot, and which
    // weapon that reaches is the page's to work out.
    weapon: -1,
    slot,
    map: down('Tab'),
  }
}

/** Where a thumb sits on the movement stick, and what the buttons say. */
export interface TouchState {
  /**
   * Thumb offset from the stick's centre, each axis already divided by the
   * stick's radius. Null when nobody is touching it.
   */
  readonly stick: { readonly x: number; readonly y: number } | null
  /** Horizontal drag on the looking half, as a fraction of the turn rate. */
  readonly turn: number
  /** Vertical drag on the looking half. */
  readonly look: number
  readonly fire: boolean
  readonly use: boolean
  /** Weapon asked for by a button, or -1. */
  readonly weapon: number
  /** Whether the map button is under a thumb. */
  readonly map: boolean
}

export function touchIntent(touch: TouchState): Intent {
  let forward = 0
  let strafe = 0
  if (touch.stick) {
    const magnitude = Math.hypot(touch.stick.x, touch.stick.y)
    if (magnitude > DEADZONE) {
      // Up on the stick is forward, and screen y grows downward.
      const moved = clampMove(-touch.stick.y, touch.stick.x)
      forward = moved.forward
      strafe = moved.strafe
    }
  }

  return {
    forward,
    strafe,
    turn: clamp(touch.turn),
    look: clamp(touch.look),
    // Running is not a separate control on a phone. Pushing the stick all the
    // way is the whole gesture, so the far edge is the run.
    run: Math.hypot(forward, strafe) > 0.92,
    fire: touch.fire,
    use: touch.use,
    weapon: touch.weapon,
    // A phone has one button that cycles, so it never asks for a slot.
    slot: -1,
    map: touch.map,
  }
}

/**
 * Combines two intents, so a tablet with a keyboard attached obeys both.
 *
 * Axes take whichever is pushed further rather than adding, which keeps a
 * thumb and a key held at once from doubling the speed; buttons are either.
 */
export function mergeIntents(a: Intent, b: Intent): Intent {
  const stronger = (x: number, y: number) => (Math.abs(x) >= Math.abs(y) ? x : y)
  const moved = clampMove(stronger(a.forward, b.forward), stronger(a.strafe, b.strafe))
  return {
    forward: moved.forward,
    strafe: moved.strafe,
    turn: stronger(a.turn, b.turn),
    look: stronger(a.look, b.look),
    run: a.run || b.run,
    fire: a.fire || b.fire,
    use: a.use || b.use,
    weapon: a.weapon >= 0 ? a.weapon : b.weapon,
    slot: a.slot >= 0 ? a.slot : b.slot,
    map: a.map || b.map,
  }
}

function clamp(value: number): number {
  return value < -1 ? -1 : value > 1 ? 1 : value
}
