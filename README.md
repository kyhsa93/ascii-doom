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

There is an automap, drawn from what you have actually been able to see rather
than from the level file: the renderer marks a wall the moment a column of the
view reaches it, which costs nothing because those rays were cast to draw the
frame anyway, and means a room behind a shut door stays blank until you open
it. Walls you cannot pass and thresholds you can are drawn differently, and
boundaries between two sectors at the same height are left out — they are a
seam in how the map was authored rather than anything you could see standing
there, and drawing them turns the picture into a mesh.

Some ground is not safe to stand on. It has its own family of glyphs rather
than a tint on the floor's, so it reads as a different kind of thing rather
than as a floor lit oddly, and it takes a bite out of you on a fixed clock
rather than a trickle per second — crossing the edge of it costs nothing, and
the clock starts again each time you step in. Creatures ignore it, as they do
in the original: sludge you could herd things into would turn every hazard into
a weapon. What sits in it is always optional, and the way to an exit never
runs through it.

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
| `Tab` | the automap |

On a touch screen the same controls appear as a stick and three buttons, and
the keyboard ones keep working if there is one attached.

| | |
| --- | --- |
| left stick | walk and strafe — pushed to its edge, run |
| right half | drag to turn and look; it keeps turning while held out |
| fire | shoot |
| use | open what you are facing |
| weapon | cycle to the next one |
| map | the automap |

There is deliberately no run button. Pushing the stick all the way is the run,
which is one gesture rather than two and leaves the other thumb for aiming.

**All content is original.** The levels, the creatures, the weapons, the
textures and the names are written for this project. Nothing is extracted from
a commercial game, and no commercial data file is needed to play. If you want
to run genuinely Doom-compatible content one day,
[Freedoom](https://freedoom.github.io/) is the freely licensed asset set that
belongs in that slot.

## Installing it

The page is a progressive web app: it can be installed from the browser's own
menu and then runs from the home screen with no address bar, which on a phone
is the difference between a web page and a game.

One visit is enough to play it with the network off. That takes a little doing,
because the build hashes its asset names and the service worker is copied
through the build untouched — so the only place those names exist is the page
that refers to them. The worker reads them out of it while installing. Without
that, a first visit caches a page whose scripts were fetched before the worker
was in charge, and going offline serves you a shell pointing at files that are
not there.

The page itself is fetched from the network first and falls back to the cache,
since it is the one file the build does not hash; everything else is
content-addressed, so a cache hit is always the right bytes.

The icons are generated rather than drawn — `npm run icon` renders them from
the game's own characters in the game's own colours. They are wider than they
are tall in character counts for the same reason the sprites are: a monospace
cell is about 0.6 as wide as it is high, so an eleven-by-eleven mark is a tall
rectangle.

## Opening a map from a WAD

There is a file picker on the page. Give it a WAD — [Freedoom](https://freedoom.github.io/)
is the freely licensed one — and the first map in it is drawn by this renderer.
Nothing is bundled: thirty megabytes of someone else's work has no business in
a page that is thirty kilobytes and caches itself for offline use, and the file
never leaves your machine.

Be clear about what arrives. It is not a level: no supplies, no doors, and no
way to finish.

The creatures do come across, after a fashion. A map says where something
stood and roughly what weight it was, and one of this project's own three
creatures stands there instead — nothing of the original's art, names or
behaviour is reproduced, and the grouping is by weight rather than by identity.
Numbers this game has no answer for put nothing there at all, which is why a
map arrives without its lamps and barrels rather than with them swinging at
you. The first map of the set this was built against places fifty-three of
them.

What else comes across is the geometry, the lighting, the outdoor rooms — drawn as open air rather
than as a ceiling twenty metres up — and the damaging floors, which land on the
same hazard rules the maps here already use, because the original marks them
with a sector type this engine now reads. Dying in one puts you back at its
start rather than in the campaign.

The first map only. Choosing between the thirty-odd in a file wants a menu, and
this wanted to work.

Two things made it possible, both of them changes to the engine rather than to
the importer. A sector is defined by its boundary rather than by an ordered
outline, which is what lets a room with a pillar in it exist at all — a fifth
to a quarter of the sectors in a real map are that shape. And a WAD has no
outlines to give: it describes lines and which sector lies on each side, which
is the same thing said differently.

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
