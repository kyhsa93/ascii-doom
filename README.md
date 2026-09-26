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

## What you see first

A title, because the game used to begin in the first room with no warning and
there was nowhere for it to say what it was. The logo is Freedoom's own, turned
into characters like everything else here — and it is the only piece of that
interface that survives the conversion. The title painting and the status bar
are 320 by 200 and 320 by 32 pixels of detail; averaged down to anything that
fits on a character grid they come out as a fog of colons with no shape in
them. The logo is large flat lettering, which is why it reads at eight rows and
is crisp at twelve.

So the status bar is built rather than converted. What is taken from the
original is the arrangement — health, then ammunition, then keys, then where
you are, each in its own panel with a rule between — because that is the part
you recognise across the room and the part a grid of characters can actually
draw. Below about seventy columns there is no room for four panels, and a
phone keeps the single status line instead, which drops what does not fit by
priority and says more in one row than a cramped bar says in three.

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

On a touch screen the shot is aimed for you, and the mark moves onto whatever
it has hold of: the nearest creature you can actually see — not through a wall,
and inside the picture rather than off the side of it. That is not a
concession to the small screen. Turning with a thumb is a *rate* and not a
position — you hold the thumb away from where it landed and the view keeps
swinging — which is the right control for looking around a room and a hopeless
one for putting a mark three cells wide onto a creature three cells wide. A
keyboard gets no help because it does not need any, and the original aimed its
players' shots too, vertically, for exactly this reason.

The half of the screen you drag is as tall as the picture rather than a share
of the phone, so the two cannot drift apart when the controls take a different
shape lying down.

**No commercial data file is needed to play, and none is used.** The levels, the
weapons and the names are written for this project. What you are looking at is
[Freedoom](https://freedoom.github.io/) — its own artwork, under a three-clause
BSD licence, and an independent work that merely happens to be compatible with
a commercial game rather than taken from one.

The pictures are turned into characters before the game ships, by
`scripts/bakeart.ts`, and the result is committed as source. No WAD is
redistributed and none is needed: the converter reads one once, at a desk. The
notice the licence asks to travel with the work is in `docs/freedoom/`, with
the contributors it names.

That costs something and it is worth saying which: the page was seventeen
kilobytes gzipped and is about forty-nine now. Thirty-one of that is the art
itself; the first figure written here was thirty-one, which was the generated
file measured on its own rather than the page it ends up inside.

## Installing it

The page is a progressive web app: it can be installed from the browser's own
menu and then runs from the home screen with no address bar, which on a phone
is the difference between a web page and a game.

Uninstalled it still fits. The page is sized to the window you can actually see
rather than to the one the browser reports having, and on iOS Safari those are
not the same number while the address bar is up — the difference is about the
height of the strip the controls sit in, which is why it was the controls that
went missing.

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

There is a file picker on the page — bottom right at a desk, above the stick on
a phone. It is for playing somebody else's maps; the art needs nothing from
you, because it is already here.
Give it a WAD — [Freedoom](https://freedoom.github.io/) is the freely licensed
one — and the first map in it is drawn by this renderer, with that file's own
pictures. The page says which it did: how many things it drew from the file, or
that the file had no pictures in it.
Nothing is bundled: thirty megabytes of someone else's work has no business in
a page that is thirty kilobytes and caches itself for offline use, and the file
never leaves your machine.

An exit in the original is a line rather than a room, and there are two kinds:
one you walk across and one you press like a switch. Both come across, by two
different routes — crossing a line means arriving in the room beyond it, which
this game already notices, while a switch is the piece of wall itself, so the
page asks what you are facing instead. Thirty-two of the thirty-five switch
lines in these files have nothing behind them at all, which is why they needed
the second route rather than the first.

Sixty-five of the sixty-eight maps can be finished. The three that cannot are
the ones the original ends by killing what is standing in the room, and no line
in them says so.

The doors you open by pressing come across. In the original a door is not a
property of a room but a number on a line, and there are two families: a line
that opens the room behind it, and a line that opens every room carrying some
tag. The first is what this engine already models — it finds the sector across
the line you are facing — so those arrive, locks and all, while the tagged kind
are left alone. The height a door opens to is measured from the rooms around it
rather than chosen: across one file that gap runs from sixty map units to a
hundred and twenty-four, so any fixed number would be wrong nearly every time.

The lifts come across too, and they are the first thing here that needed a tag
at all. A manual door special carries none — that is the format's way of saying
"the room behind this line" — but every one of the seven hundred and sixty-one
lift lines in these two files carries one, and eighty-three of them name more
than one room. So a lift is a line that calls a list of platforms, and pressing
the wall the map marked is what calls them. Five hundred and sixty-five of
those lines are a switch, and five hundred and eight of those arrive as
something you can press — across sixty-two of the sixty-eight maps. The
hundred and ninety-six you trigger by walking over instead do not arrive at
all, because crossing a line is not something this engine can notice.

A platform starts raised, drops to the floor of the lowest room touching it,
rests three seconds and climbs back. None of that needed building: a door is a
ceiling with two heights and a lift is a floor with two, and the same loop has
always stepped both. Ninety-eight of the rooms those lines point at are already
at the bottom, and are refused rather than imported as floors that would rise
when called.

The supplies come across the same way the creatures do — the file says
something of a certain class lay here, and one of this project's own is put
there instead. Health, ammunition and keys have counterparts here and arrive;
armour has none, so it is not quietly turned into something else, it simply is
not there. The first map of the set this was built against leaves sixty-four
things lying about, one of them a key.

A file you open still brings its own pictures, which matters for a WAD whose
art is not Freedoom's. A creature or a supply the file has a drawing for is
drawn with it: the picture is decoded out of the file's own sprite lumps,
averaged down to a grid of characters, and kept in colour a cell at a time
rather than as one tint for the whole thing — a monster in a single colour is a
silhouette. What does not change is anything you can feel. How big it is, how
hard it hits, how far it can see and what it does when it notices you are this
game's, exactly as they were; the file decides only what you are looking at.

Two rules there fell out of the files rather than being chosen. A creature
keeps its height standing and its width lying down, so it does not change size
as it falls. And the frame it falls into is found by walking the death sequence
until the height jumps back up, which is where the bursting starts: across nine
creatures the largest rise inside a death is 1.33 and the smallest jump into a
burst is 2.4, so there is a wide gap to put the line in. Two of those nine have
no frame that lies down at all — a skull bursts into something larger than it
was — and they keep the art drawn for them here.

A picture is also stretched until its own brightest part reaches the brightness
this game's own art is drawn at. Taken at face value it was four times darker
than everything standing beside it, and being dark it spent only the bottom two
glyphs of a nine-glyph ramp, so the shape washed out into colons. A grid with
nine levels cannot say both "this is dark" and "this is the shape of a face".

The creatures themselves come across after a fashion. A map says where
something stood and roughly what weight it was, and one of this project's own
three creatures stands there instead — the grouping is by weight rather than by
identity, and nothing of its behaviour is reproduced.
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
