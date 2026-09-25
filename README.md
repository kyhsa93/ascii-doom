# ascii-doom

A first-person shooter drawn with characters, built on
[ascii-engine](https://github.com/kyhsa93/ascii-engine).

Play it at <https://kyhsa93.github.io/ascii-doom/>.

## What this is

The rendering techniques and gameplay systems of the 1993 shooter, implemented
against a character grid.

What is in it now: sector-based maps, a column renderer for walls with
horizontal spans for floors and ceilings, light that falls off with distance,
billboard creatures that wake when they see you and swing when they reach you,
one that throws bolts instead of closing the distance, two instant weapons and
one that throws, doors and lifts, supplies you walk over, keys and the doors
that ask for them, and an exit that ends a level, tallies what you did and
hands you to the next one.

Running out of health ends the run rather than leaving you walking around
unarmed. Everything stops, the room you died in stays on screen behind the
panel, and firing starts that level again with the kit you began it with — the
level you died in, not the campaign. There is a moment before the trigger is
listened to, because the trigger you are holding is usually what killed you.

A bolt hits anything that is not the thing that fired it, so a shot that goes
wide lands on whatever was behind you — and whatever it lands on turns on
whoever threw it. Two creatures that have started on each other keep at it
until one of them is dead, and walking away from that is often the better move.
The grudge lapses when its object dies, and then they remember you.

## The levels

Each map is a loop rather than a corridor.

**The outpost.** The key lies in the hall, the key opens the north door, the
door leads to a chamber, the lift is the only way onto the ledge, and the ledge
opens onto the way out.

**The cistern.** A hub you keep crossing, with the way on sunk below the floor
you arrive at. The store off the hub holds what the vault asks for, and the pit
between them is deep enough to feel like a drop and shallow enough to climb
back out of.

Health and ammunition carry between them. Keys do not — each map hides the key
to its own doors, and one brought forward would open something it was never
meant to.

## Controls

| | |
| --- | --- |
| `W` `A` `S` `D` | move and strafe |
| `←` `→` | turn |
| `↑` `↓` | look up and down |
| `Shift` | run |
| `Space` | fire |
| `1` `2` `3` | sidearm, scattergun, launcher |
| `E` | open what you are facing |

On a touch screen the same controls appear as a stick and three buttons, and
the keyboard ones keep working if there is one attached.

| | |
| --- | --- |
| left stick | walk and strafe — pushed to its edge, run |
| right half | drag to turn and look; it keeps turning while held out |
| fire | shoot |
| use | open what you are facing |
| weapon | cycle to the next one |

There is deliberately no run button. Pushing the stick all the way is the run,
which is one gesture rather than two and leaves the other thumb for aiming.

**All content is original.** The levels, the creatures, the weapons, the
textures and the names are written for this project. Nothing is extracted from
a commercial game, and no commercial data file is needed to play. If you want
to run genuinely Doom-compatible content one day,
[Freedoom](https://freedoom.github.io/) is the freely licensed asset set that
belongs in that slot.

## Why characters suit this

A character grid is a grid of *columns*, and the renderer this game needs is a
column renderer. Two properties of the 1993 design fall out of that:

- A wall column has one distance, so it has one shade — the whole column is a
  single colour and a run of glyphs, which is one escape sequence rather than
  one per cell.
- A floor row has one distance too, because a floor is a horizontal plane:
  `distance = k / (row − horizon)`.

So a frame is a few hundred runs rather than a few thousand cells, and the
number of rays cast per frame is the number of columns — 163 on a typical
browser grid, against the 8150 a per-cell raymarcher would need.

The engine's `resolve(ramp)` — glyph chosen from luminance, last — is already
the shape of the original's lighting: a light level scaled by distance and
quantised into a small table of shades.

## Layout

```
vendor/ascii-engine/  the renderer, as a submodule -- not modified here
src/columns/          walls, floor spans, sprites: things with a checkable answer
src/game/             levels, entities, weapons, rules: things you have to play
web/                  the page
scripts/              checks
```

The split is by *what can be falsified*, not by what might be reused. How many
rows tall a wall is at a given distance is arithmetic, and it is checked. How
long a door should take to open is not, and it is not.

## Running it

```sh
git clone --recurse-submodules https://github.com/kyhsa93/ascii-doom.git
cd ascii-doom
npm install
npm run dev
```

Already cloned without submodules? `git submodule update --init --recursive`.

- `npm run dev` — the page, with hot reload
- `npm run build` — typecheck and build into `dist/`
- `npm run viewcheck` — the built page, driven in a real browser
- `npm run check` — everything with a right answer, in Node: the geometry, the
  projection, both levels walked end to end, and the rules for shooting,
  carrying, finishing and dying
