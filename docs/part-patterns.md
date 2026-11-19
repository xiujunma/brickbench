# Part patterns

A part pattern describes parts the way a regular expression describes text:
by kind, size and height, and by their top face, stud by stud. `P2x4` is a
2 × 4 plate, `S45[oo/..]` a 45° slope with a row of studs at the back and the
slope at the front, and `B1x(1|2) -side-studs` a 1 × 1 or 1 × 2 brick with no
studs on its sides.

BrickBench reads patterns in the parts search box and in the agent's
`find_parts` tool, and writes each part's own pattern for agents to read.
This page defines the language. [`src/core/parts/pattern`](../src/core/parts/pattern)
implements it, and its tests check every example on this page.

## At a glance

| Pattern | Means | Finds among the built-in parts |
| --- | --- | --- |
| `P2x4` | a 2 × 4 plate | `plate-2x4` |
| `B1x(1\|2)` | a 1 × 1 or 1 × 2 brick, one brick tall | `brick-1x1` `brick-1x2` |
| `B1x2^*` | a 1 × 2 brick of any height | `brick-1x2` `brick-1x2x3` `brick-1x2x5` |
| `B1x2x5` | a 1 × 2 brick five bricks tall | `brick-1x2x5` |
| `P{1,2}x*` | a plate one or two studs wide, any length | 16 parts |
| `S45 2x2` | a 45° slope, 2 × 2 | `slope45-2x2` `slope45-2x2-inv` |
| `S45[oo/..]` | a 45° slope: two studs at the back, the slope at the front | `slope45-2x2` |
| `Si` | an inverted slope | `slope45-2x1-inv` `slope45-2x2-inv` `slope33-3x2-inv` |
| `T[..]{2}` | a tile, two rows of two smooth cells | `tile-2x2` |
| `R[o]^1` | a round part one stud across and one plate tall | `round-plate-1x1` |
| `[o]` | any part whose top is a single stud | 7 parts |
| `[o+/.+]` | two rows: studs at the back, none at the front | 6 parts |
| `A ^6` | an arch two bricks tall | `arch-1x6x2` `arch-1x8x2` |
| `+cheese` | a cheese slope | `slope30-1x1` `slope30-1x2` |
| `B !+round` | a brick that is not round | 16 parts |
| `P2x4 \| T2x4` | a 2 × 4 plate or a 2 × 4 tile | `plate-2x4` `tile-2x4` |
| `=30*` | a part whose number starts with 30 | 33 parts |
| `"round" ^1` | a part with "round" in its name, one plate tall | `round-plate-1x1` `round-tile-1x1` `round-plate-2x2` `round-tile-2x2` |
| `@basic *` | every built-in part | 87 parts |

## How patterns see a part

Every part, built in or from the LDraw library, has:

- **a kind**: brick, plate, tile, slope, round part, cone or arch, or none.
  Built-in parts take theirs from their category, with the cone apart from
  the other round parts. Library parts take theirs from their name: a name
  starting "Slope" (or a part in LDraw's Slope category) is a slope, then
  "Arch" an arch, "Cone" a cone, "Brick", "Plate" or "Tile" followed by a size
  and "Round" a round part, as is "Cylinder", and then "Tile", "Plate" and
  "Brick" what they say. Other parts, such as Technic beams and minifigure
  parts, have no kind.
- **a slope angle**, for slopes whose names give one: "Slope 45° 2 × 2",
  "Slope Brick 31 1 × 1 × 0.667". Curved slopes have none. A slope is
  **inverted** when it is built so or its name says "Inverted".
- **a size**: the footprint it is sold as, short side first. "Plate 1 × 1 with
  Clip" is 1 × 1, though its clip takes a second cell. A size in the name
  that is far bigger than the part, such as a wheel's millimetres, gives way
  to the cells it takes.
- **a height** in plates, as sold: plates and tiles 1, bricks 3 a brick, or
  what the name says ("Brick 1 × 2 × 5" is 15). A name is trusted only within
  a plate of the part's real height.
- **features**, read from the name as the search box's feature filter reads
  them, and **nicknames** builders use. Built-in parts add the nicknames among
  their keywords, such as "cheese", and library parts with a print or
  stickers are `printed`.
- **a top face**: a grid with a cell for each stud position of the box the
  part fills, in rows from the back of the part to the front. Each cell is
  `o` for a stud, `.` for no stud (smooth or sloped), `_` for a cell the part
  leaves out (the missing corner of a corner plate), or `#` for a cell whose
  top is not known. Library parts have `#` for every cell they fill: the
  library records their shape but not where their studs are.

## Part terms

A part term gives any of a kind, a size, a top face and a height, in that
order and with no spaces: `P`, `P2x4`, `P[oo]`, `P2x4^1`, `S45i[oo]{2}^3`.
Each part it finds has all it gives.

### Kind

| Letter | Kind | Height unless the term gives one |
| --- | --- | --- |
| `B` | brick | 3 plates: one brick |
| `P` | plate | 1 plate |
| `T` | tile | 1 plate |
| `S` | slope | any |
| `R` | round brick, plate or tile, or cylinder | any |
| `C` | cone | any |
| `A` | arch | any |
| `*` | any part, of any kind or none | any |

A term with no kind letter, such as `2x4`, also matches any part. Kinds are
capital letters. A capital followed by a letter or a hyphen starts a word,
not a kind, so `Brick`, `BAR` and `C-clip` are words (a cone without a clip
is `C -clip`); the one exception is `Si`, an inverted slope.

`S` may take an angle and `i`: `S45` is a 45° slope, `S45i` an inverted 45°
slope, `Si` any inverted slope. Without `i`, a slope may be inverted or not;
`S !Si` keeps to slopes that are not. Digits after `S` start a size if an `x`
follows them, so `S2x2` is a 2 × 2 slope of any angle; give both as two terms,
`S45 2x2`.

### Size

Two sides joined by `x` (or `×`), matched either way round: `P2x4` finds a
plate 2 × 4 or 4 × 2. Each side is

| Side | Means |
| --- | --- |
| `4` | 4 studs |
| `*` | any number |
| `{2,4}` | 2 to 4 |
| `{2,}` | 2 or more |
| `(1\|2\|4)` | 1, 2 or 4 |

A third side gives the height in bricks, as LDraw names do: `B1x2x5` is
`B1x2^15`.

### Top face

Rows of cells in brackets, from the back of the part to the front, joined by
`/`. Each row is a regular expression over its cells:

| In a row | Means |
| --- | --- |
| `o` | a cell with a stud |
| `.` | a filled cell without a stud |
| `#` | any filled cell |
| `_` | a cell the part leaves out |
| `[o_]` | any one of the cells listed |
| `(oo\|o)` | a choice, within one row |
| `*` `+` `?` | any number of the cell or group before, at least one, at most one |
| `{3}` `{2,4}` `{2,}` | 3 of them, 2 to 4, 2 or more |

A count after the brackets repeats all the rows: `[oo]{2}` is `[oo/oo]`, and
`[o/.]{1,2}` is `[o/.]` or `[o/./o/.]`.

The face must match the whole grid, and matches it in any of the four
quarter turns (not mirrored): `P[oooo]{2}` and `P[oo]{4}` both find the
2 × 4 plate. The `#` cells of library parts match `o`, `.` and `#`, so
`[oo]` finds library parts of that shape whatever their studs.

A count cannot apply to a group that holds one, as in `(o*)*`, and no count
may follow another, as in `o**`.

### Height

`^` and a height in plates, written as a side is: `^3`, `^{1,3}`, `^(1|2)`, or
`^*` for any height, overriding the kind's own. `B^*` is any brick, `P^2` a
plate two plates tall.

## Other terms

| Term | Means |
| --- | --- |
| `+clip` | has the feature |
| `-clip` | does not have the feature |
| `:red` | in that colour |
| `=3001` | that part number |
| `@library` | from that source |
| `"with clip"` | those words in the name |

**Features** are `clip`, `bar` (bars and handles), `side-studs`, `holes` (holes,
pins and axles), `round` (round or curved), `slope` (slopes and wedges),
`hinge` (hinges, turntables, balls and sockets), `smooth` (smooth tops),
`window-door`, and `wheel` (wheels, tyres and rims). **Nicknames** work the
same way: `cheese`, `jumper`, `macaroni`, `snot`, `erling`, `dot` and
`liftarm`. So does `printed`, for parts with a print or stickers: `T2x2
+printed` finds printed 2 × 2 tiles, and `-printed` leaves prints out.

A **colour** is a palette name with hyphens for spaces (`:dark-bluish-grey`),
a builder's name for one (`:grey`, `:clear`, `:gold`; `gray` as well), or an
LDraw code (`:4`). Parts here come in every colour, so a colour leaves the
parts found as they are; in the search box it picks the colour to build in,
as words do: `P2x4 :red` is `red 2x4 plate`, and `:red` alone, like `red`,
only picks the colour.

A **part number** may hold `*` for any run of characters and `?` for any one:
`=30*`, `=3040?`. Case does not matter, and `.dat` may follow.

A **source** is `@basic` (the built-in parts), `@library` (the LDraw library)
or `@owned` (the parts in the parts lists of sets the user owns).

**Words** in quotes must each start a word of the part's name, in any order:
`"with clip"` finds "Plate 1 × 2 with Clip".

## Putting terms together

| Write | Means |
| --- | --- |
| `P2x4 +clip` | both: terms side by side must all hold |
| `P2x4 \| T2x4` | either |
| `!+clip` | not |
| `(P \| T) 2x4` | grouping |

`!` binds tightest, then terms side by side, then `|`: `P | T :red` is
`P | (T :red)`. Terms may touch where it is clear where one ends:
`S45[oo/..]^3=3039`, `P1x2+clip`.

A kind's height belongs to its own term. `B ^15` asks for a part that is a
brick one brick tall and is also 15 plates tall, which no part is: write
`B^15` or `B1x1x5`.

## Patterns that do not read

A pattern that does not read says what is wrong and where:

| Refused | Says |
| --- | --- |
| `p2x4` | Kinds are capital letters: P |
| `B2` | A size has two sides, as in 2x4 (a part number goes after =, as in =3001) |
| `Brick` | Words of a name go in quotes: "brick" |
| `P2x4 [oo` | A “[” needs its “]” |
| `[(o*)*]` | A group with a count inside cannot be counted again: write (oo)* or o*, not (o*)* |
| `[o**]` | A count cannot follow another count: write o*, not o** |
| `C-clip` | Words of a name go in quotes: "c-clip" |
| `[oo/(o/.)]` | A row ends only outside ( ): close the group before the “/” |
| `[]` | Each row, and each choice in it, needs at least one cell |
| `B1x2x5^15` | Give the height once: a third size in bricks (B1x2x5) or ^ and plates (B1x2^15) |
| `S95` | A slope’s angle is from 1 to 90 degrees |
| `+shiny` | “shiny” is not a feature: clip, bar, side-studs, holes, round, slope, hinge, smooth, window-door, wheel, cheese, jumper, macaroni, snot, erling, dot, liftarm, printed |
| `:sparkly` | No colour is called “sparkly” |
| `@mine` | A source is @basic, @library or @owned |
| `P \|` | Nothing to match here: each side of “\|”, and each ( ), needs a term |
| `B)` | This “)” has no “(” to close |

## Canonical patterns

Every part has one pattern of its own: its kind (with a slope's angle and
`i`), its top face as the part sits unturned, `^` and its height unless its
kind implies it, and `=` and its number. Rows that are all alike are written
once and counted, and runs of five or more alike cells are counted. A top
face longer than 120 characters, as on some big irregular parts, gives way
to the part's size.

Read back, a part's canonical pattern finds the part, and among the built-in
parts only that part.

| Part | Canonical pattern |
| --- | --- |
| `plate-2x4` | `P[oooo]{2}=3020` |
| `plate-16x16` | `P[o{16}]{16}=91405` |
| `brick-1x2x5` | `B[oo]^15=2454a` |
| `tile-1x6` | `T[.{6}]=6636` |
| `slope45-2x2` | `S45[oo/..]^3=3039` |
| `slope33-3x2` | `S33[oo/../..]^3=3298` |
| `slope45-2x2-inv` | `S45i[oo]{2}^3=3660b` |
| `slope30-1x2` | `S30[..]^2=85984` |
| `round-plate-1x1` | `R[o]^1=6141` |
| `cone-1x1` | `C[o]^3=4589` |
| `arch-1x6x2` | `A[o{6}]^6=3307` |

Library parts, whose studs are not known:

| Library part | Canonical pattern |
| --- | --- |
| `3001` Brick 2 × 4 | `B[####]{2}=3001` |
| `2420` Plate 2 × 2 Corner | `P[#_/##]=2420` |
| `54200` Slope Brick 31 1 × 1 × 0.667 | `S31[#]^2=54200` |
| `15068` Slope Brick Curved 2 × 2 × 0.667 | `S[##]{2}^2=15068` |
| `4085c` Plate 1 × 1 with Clip Vertical | `P[#]{2}=4085c` |
| `32523` Technic Beam 3 | `*[#]{3}^3=32523` |
| `3811` Baseplate 32 × 32 | `*[#{32}]{32}^1=3811` |
| `3229bc04` Train Track 4.5V Curved Slotted | `*44x44^3=3229bc04` |

## In the search box and for agents

The search box reads a query as a pattern when it has something only
patterns have (one of `[ ] ^ = @ ! " | ( ) { } * + :`, a word starting with
`-`, or a kind letter not followed by a letter or a hyphen, as in `B`,
`P2x4` and `Si`) and reads as one. `BAR` and `C-clip` stay words. A size alone, such as `2x4`, stays words, which rank the plain parts
first. A query that looks like a pattern but does not read as one is
searched as words, and if that finds nothing, the search box says what is
wrong with the pattern.

Where a part is both built in and in the library, the search box shows the
library copy only when the pattern finds it and not the built-in part:
`=3001` finds the built-in 2 × 4 brick, `@library =3001` the library's.

The agent's `find_parts` reads patterns in its query the same way, and gives
each part it finds its canonical pattern, so the agent knows where the part
has studs. Its query may be as long as a pattern, so any part's pattern can
be sent back.

## Grammar

```ebnf
pattern    = { space } or { space } ;
or         = and { "|" and } ;
and        = { space } not { { space } not } { space } ;
not        = "!" { space } not | "(" or ")" | term ;
term       = part | feature | colour | number | source | words ;

part       = kind [ size ] [ face ] [ height ]
           | size [ face ] [ height ]
           | face [ height ]
           | height ;
kind       = "B" | "P" | "T" | "R" | "C" | "A" | "*" | "S" [ angle ] [ "i" ] ;
angle      = digits ;                     (* 1 to 90; digits followed by x start a size *)
size       = side "x" side [ "x" side ] ; (* × also joins sides; a third side counts bricks *)
side       = digits | "*" | "{" count "}" | "(" digits { "|" digits } ")" ;
count      = digits [ "," [ digits ] ] ;
height     = "^" side ;
face       = "[" row { "/" row } "]" [ "{" count "}" ] ;
row        = cells { "|" cells } ;
cells      = item { item } ;
item       = ( cell | "[" cell { cell } "]" | "(" row ")" ) [ times ] ;
cell       = "o" | "." | "_" | "#" ;
times      = "*" | "+" | "?" | "{" count "}" ;  (* not on a group holding a count *)

feature    = ( "+" | "-" ) lower { lower | "-" } ;
colour     = ":" ( letter | digit ) { letter | digit | "-" | "_" } ;
number     = "=" glob { glob } [ ".dat" ] ;
glob       = letter | digit | "_" | "-" | "*" | "?" ;
source     = "@" ( "basic" | "library" | "owned" ) ;
words      = '"' { any character but '"' } '"' ;  (* “ and ” quote too *)
```

## Limits

A pattern has at most 500 characters and nests `(` and `!` at most 32 deep.
Sizes and counts go up to 256, heights to 1023 plates.

Matching follows every position a top face can reach at once, without
backtracking, and counts never nest. A count can still repeat its work from
every position a `*` before it reached, so one search looks at no more than
6 million grid positions. The heaviest likely patterns, such as
`[(#|_)*]{1,256}` over the whole library, look at about 2 million. A search
that would need more stops and says:

> This pattern asks too much of a search: use smaller counts, or fewer *, + and | before them.
