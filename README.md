# BrickBench

A 3D brick-building workshop that runs in the browser. Pick parts and colours, snap them together on a baseplate, then save your model or export it to LDraw, glTF or an image.

![The sample cottage in BrickBench](docs/screenshot.png)

## Features

- **87 basic parts in six families:** bricks (including tall 1×1×3 to 1×2×5), plates up to 16×16, tiles, slopes (45°, 33°, 65°, inverted, cheese), round parts and cones, and arches, all generated in code.
- **The LDraw community parts library:** over 6,000 more parts, from Technic beams and hinges to wheels, windows, doors and minifigure accessories, converted from the [LDraw](https://www.ldraw.org) library when the app is built. Each mesh loads the first time you use it.
- **Finding the right part:**
  - **One search covers every part.** Type sizes any way ("2x4", "2 by 4", "two by four"), hobby nicknames ("cheese", "jumper", "macaroni", "SNOT"), US spellings ("tire", "windshield") or a part number, including BrickLink's. Sizes work either way round ("4x2" finds 2 × 4). Name a colour too ("red 2x4 brick") and the part is built in it. If you mistype, close spellings show instead.
  - **Size, height and shape filters** narrow thousands of parts to a handful: say 1 × 2, 1 plate, with a clip.
  - **Mine** keeps your starred favourites, recent picks and the parts already in your model. Favourites and picks stay in this browser, shared by its tabs.
  - **Keyboard first:** press `/`, type, use ↑ ↓ and press Enter to build with the part.
- **Build with an AI agent:** ask Claude Code, from a chat panel in the app or from your terminal, to build or change the model. It places, paints and moves bricks while you watch, checks its work with pictures of the model, and one undo takes back a whole request.
- **54 colours:** solid, transparent and metallic, following the LDraw palette.
- **Grid snapping that understands bricks.** Point at a top face to stack, at a side to build beside it (lined up with that brick's courses), or underneath to hang below. Parts never overlap: the preview turns red when there's no room, and drops land on top of whatever is in the way.
- **Tools:** Build, Select & move (click, Shift-click, box select, drag to move), Paint and Erase, plus an eyedropper (Alt-click) and rotate, nudge, copy, paste and duplicate.
- **Unlimited undo** (up to 200 steps) and **autosave** in the browser.
- **Files:** save and open `.brickbench.json`, or load the sample cottage.
- **Building instructions:** a printable PDF booklet with a cover, the parts list, then one page per step showing the parts to add and the model so far, with the new parts outlined.
- **Exports:** LDraw (`.ldr`, opens in Studio, LeoCAD and LDView), glTF (`.glb`, at real-world scale for Blender), PNG, and a parts list (CSV).
- **Fast with big models.** Resting bricks are instanced, one draw call per part type, and studs hidden under other bricks are skipped. Rendering only happens when something changes.

## Getting started

```bash
bun install
bun run ldraw      # once: downloads and converts the LDraw parts library (about 3 minutes)
bun run dev        # http://localhost:5173
```

Requires [Bun](https://bun.sh) 1.4 or later and a browser with WebGL 2. Bun runs everything outside the browser, so Node is not needed. Without GPU acceleration the app still runs, but skips shadows. Without `bun run ldraw` the app works with the basic parts, and the LDraw library tab explains how to add the rest.

## Controls

| Action | Mouse | Keyboard |
| --- | --- | --- |
| Place a part (Build) | Click, or drag a part tile onto the scene | |
| Orbit | Right-drag, Alt-drag, or left-drag in Build/Paint/Erase | |
| Pan / zoom | Middle-drag or Shift + right-drag / scroll or pinch | |
| Select | Click, Shift-click to add, drag a box on empty space | `⌘A` all |
| Move selection | Drag a selected brick | Arrows; `⇧↑` / `⇧↓` for one plate up or down |
| Rotate | | `R` (`⇧R` turns back) |
| Tools | | `V` select, `B` build, `P` paint, `E` erase |
| Copy / cut / paste / duplicate | | `⌘C` `⌘X` `⌘V` `⌘D` |
| Delete | | `Del` / `Backspace` |
| Undo / redo | | `⌘Z` / `⇧⌘Z` |
| Pick up a part and colour | Alt-click a brick | |
| Frame / reset view | | `F` / `Home` |
| Save / open | | `⌘S` / `⌘O` |
| Search parts / help | | `/` / `?` |
| Choose a search result | | `↑` `↓`, `Enter` builds with it, `Esc` clears |

On Windows and Linux, use Ctrl in place of ⌘.

## Building instructions

Choose **File › Building instructions (.pdf)…**, or **Instructions** in the Model panel, once your model is built.

- **Steps are planned for you.** "Bottom up" builds layer by layer and groups bricks that sit near each other, so every step can actually be built. "As you built it" follows the order you placed the bricks.
- **Parts per step:** 3, 6, 10, 20 or 40. Big models need bigger steps; booklets are limited to 400 pages, which fits models up to about 15,000 bricks.
- **Paper:** A4 or US Letter, landscape.
- **Pictures use your current view.** Turn the model to show its best side before you start. Every page uses the same view and scale, so the model grows in place from page to page. New parts get an outline that stays the same width in every picture: blue on red, orange, yellow and tan bricks, orange on the rest.

The PDF is made entirely in your browser: each step is drawn offscreen with three.js and laid out with [jsPDF](https://github.com/parallax/jsPDF), which loads only when you make a booklet.

## Building with an AI agent

An AI agent can build in BrickBench: Claude Code from the **Agent** panel in the app, or Claude Code (or any other agent that speaks [MCP](https://modelcontextprotocol.io)) from a terminal. It places, paints, moves and removes bricks while you watch, looks at pictures of the model to check its work, and whatever it does for one request is one step you can undo.

1. Start the agent bridge, a small server on your computer, in a terminal in the BrickBench folder:

   ```bash
   bun run agent
   ```

2. Open BrickBench and click **Agent** in the top bar. Ask for something: "build a small red house with a door and two windows", "make the roof dark grey", "put a fence around it".

The chat runs [Claude Code](https://code.claude.com) on your computer with your own login, so Claude Code has to be installed. It gets the BrickBench tools and nothing else: no shell, no files, and none of your Claude Code hooks, plugins or settings files. That use of your login is meant for you on your own computer; if other people will use the chat, set `ANTHROPIC_API_KEY` for the bridge so it runs on an API key instead.

**From a terminal.** With the bridge running and BrickBench open, add BrickBench to Claude Code once:

```bash
claude mcp add --transport http brickbench http://127.0.0.1:7425/mcp
```

then ask Claude Code to build something in BrickBench. Any MCP client can use the same address. Agents build in the BrickBench tab you used last, and once the Agent panel has connected, BrickBench reconnects by itself on later visits (until you click Disconnect).

**The tools agents get:**

| Tool | What it does |
|---|---|
| `get_model` | The model's name, size, parts and colours, and its bricks with their ids, optionally only those in a region |
| `find_parts` | Searches parts like the search box does, and returns part ids with their sizes |
| `list_colors` | The colours, with names and LDraw codes |
| `place_bricks` | Places up to 2,000 parts at once; refuses any that would overlap or leave the build area, with the reason, and points out bricks with nothing holding them up |
| `paint_bricks`, `move_bricks`, `remove_bricks` | Change bricks named by id or reached by a region |
| `look` | A picture of the model from any side, with bricks outlined if asked |
| `set_model_name`, `undo`, `clear_model` | Rename, undo steps, or start afresh (only when you ask) |

**Settings** (environment variables for `bun run agent`):

| Variable | What it sets |
|---|---|
| `BRICKBENCH_AGENT_PORT` | The bridge's port, 7425 by default. Open BrickBench with `?agentPort=` and the same number to match. |
| `BRICKBENCH_AGENT_MODEL` | The model the chat uses, such as `sonnet` or `opus`; Claude Code's default otherwise |
| `BRICKBENCH_AGENT_BUDGET_USD` | The most one chat request may spend: $5 unless you set it, or `none` for no cap |
| `BRICKBENCH_CLAUDE` | Where the `claude` command is, if it is not on your PATH |
| `BRICKBENCH_AGENT_ORIGINS` | The only pages that may connect, comma-separated, such as `http://localhost:5173` |

The bridge listens on this computer only (127.0.0.1) and answers only pages served from this computer. Any of them could start the chat, so if you run other web servers you do not trust, set `BRICKBENCH_AGENT_ORIGINS` to BrickBench's own address.

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Start the dev server (Vite) |
| `bun run build` | Type-check, build the LDraw library if it is missing, and build to `dist/` |
| `bun run ldraw` | Download and convert the LDraw parts library into `public/ldraw/` |
| `bun run agent` | Start the agent bridge, so Claude Code and other MCP agents can build in BrickBench |
| `bun test` | Run the unit tests (`bun test`, about a second) |
| `bun run coverage` | Run the unit tests with coverage; fails if any file drops below 80% of its lines or functions |
| `bun run e2e` | Run the browser tests (Playwright; starts the dev server itself) |
| `bun run typecheck` | Type-check the app, tests and tooling with `bun check` |

The first time you run the browser tests, install a browser with `bunx playwright install chromium`. Unit tests share one process, so they must not depend on each other's state: `bun test --randomize` and `bun test --isolate` should pass too.

### Checking LDraw mappings

Each part records its LDraw part number and where the LDraw origin sits on it, which keeps exports correctly placed and turned. A test compares every part against the real LDraw library:

```bash
bun run ldraw --fetch-only    # downloads the library into .ldraw-cache/ldraw, if you have not yet
LDRAW_DIR=.ldraw-cache/ldraw bun test src/core/parts/ldraw.verify.test.ts src/core/io/ldrawExport.verify.test.ts
```

`LDRAW_DIR=.ldraw-cache/ldraw bun test verify` runs every check against the real library.

The first file checks each part's size, origin and slope direction. The second exports every part at all four rotations and confirms the LDraw part lands exactly where the brick sits. Without `LDRAW_DIR` both are skipped. Run them whenever you add or change a part.

### Continuous integration

GitHub Actions runs `.github/workflows/test.yml` on every push to `main` and on every pull request, in two jobs:

- **Type check and unit tests:** `bun run typecheck` and `bun run coverage`, about a minute.
- **LDraw checks and browser tests:** builds the LDraw library, runs `bun test verify` against it, builds the app, then runs `bun run e2e` against that build in headless Chromium. The library download and the converted library are cached, so only the first run, or one after the converter changes, spends a few minutes converting. Traces of failed browser tests are kept for a week as a `playwright-traces` artifact.

The runners have no GPU, so WebGL is drawn on the CPU: with `CI` set, Playwright tests the production build (`vite preview`) one test at a time, gives each test two minutes, retries once, and stops after three failures. Run the same way locally with `bunx --bun vite build && CI=1 bun run e2e`. The browser tests also start the agent bridge, on port 7499, with a stand-in for Claude Code that builds through MCP, so they spend nothing on a real model.

To pick up a newer LDraw release in CI, bump `ldraw-download-v1` in the workflow.

## The LDraw parts library

`bun run ldraw` turns the [LDraw parts library](https://library.ldraw.org) into files the app can load quickly, in `public/ldraw/` (not committed; `bun run build` makes it whenever it is missing, incomplete or partial):

- `index.json` lists every part: its name, category, keywords, author and how it sits on the grid.
- `parts/<number>.bin` holds one mesh per part: gzip-compressed, 16-bit positions and 8-bit normals. A 2 × 4 brick is under 5 kB.
- `CREDITS.txt` names the author of every part and of every primitive it uses, and copies of the LDraw licence files sit alongside.
- `build.json` says the build is complete and, for downloads, records the archive's SHA-256. `complete.zip` always holds the latest LDraw release; keep a copy and pass `--library` to pin one.

A build is written to `public/ldraw.partial/` and swapped in only when it has finished, so an interrupted run leaves the previous library in place. The tool only ever deletes folders it built itself.

The converter (`scripts/ldraw/`) follows each part's sub-files and primitives, honouring LDraw's back-face rules (winding, inverted and mirrored references, double-sided sections), drops edge lines, smooths curved surfaces, and moves the part so its body stands centred on its footprint with the top studs over cell centres. It leaves out printed and sticker parts, obsolete and alias files, third-party parts, and parts drawn in more than one fixed colour, such as wheels with their tyres. It also leaves out the two twisted strings whose meshes run past 200,000 vertices. That leaves about 6,300 parts and 110 MB of meshes in as many files.

```bash
bun run ldraw                                # download complete.zip into .ldraw-cache/ and convert everything
bun run ldraw --library /path/to/ldraw       # or LDRAW_DIR=…: use a library you already have
bun run ldraw --only 3001,3003,3040b         # just these parts, handy while developing (a partial build)
bun run ldraw --limit 200                    # the first 200 parts (also partial)
bun run ldraw --fetch-only                   # just download and unpack it into .ldraw-cache/ldraw
```

In the app, library parts are ordinary parts with ids like `ldraw:3001`. Each fills the smallest box of whole cells that holds its body (a fifth of a stud may stick out on a side), placed so its top studs sit over cell centres, so it stacks and collides like any brick. Jumper plates keep their half-stud offset. While a mesh loads, a plain box of the right size stands in; parts that fail to load are retried when the connection comes back.

Opening a model or restoring the autosave loads the library index first. If bricks still cannot be restored, say because the library is unreachable or a rebuilt library gave a part a different size, the whole session is kept and **File › Recover earlier session** opens it later.

Two opt-in tests convert real parts: one checks that every built-in part's LDraw file comes out with exactly the built-in footprint, height and origin (and is not an outdated "moved" file), the other spot-checks meshes and skipped parts:

```bash
LDRAW_DIR=.ldraw-cache/ldraw bun test src/core/parts/libraryFit.verify.test.ts scripts/ldraw/library.verify.test.ts
```

## How it is built

TypeScript, [three.js](https://threejs.org) for rendering, React for the panels, [zustand](https://zustand.docs.pmnd.rs) for state and [zod](https://zod.dev) to validate files. Vite builds it. [Bun](https://bun.sh) installs the packages and runs the scripts, the LDraw converter, the unit tests and type checking, and runs Vite and Playwright too.

```
src/
  core/       pure logic, no three.js: units and rotation, colours, part catalogue
              and part finder (search, nicknames, filters),
              immutable model operations, spatial index, picking and placement,
              undo history, file format, LDraw and parts-list export, and
              instruction steps, page layout and camera framing
  engine/     three.js: procedural part geometry, library mesh loading, instanced
              batches, selection and preview layers, ground, viewport, thumbnails,
              glTF export
  editor/     connects state and scene: pointer gestures, keyboard, drag and drop
  state/      zustand store and actions, selectors, autosave, file commands
  ui/         React panels, dialogs and toasts
  agent/      the build tools agents call, the link to the agent bridge, and the chat
  instructions/  building-instruction booklets: rendering steps and writing the PDF
  samples/    the sample cottage
scripts/ldraw/  the LDraw library converter (run straight from TypeScript by Bun)
agent/        the agent bridge: an MCP server for agents, a WebSocket for BrickBench tabs,
              and Claude Code run headless for the chat
e2e/          Playwright tests
```

**Grid and units.** One world unit is one stud pitch (8 mm). Bricks snap to whole studs on X/Z and whole plates (3.2 mm) on Y. A brick is stored as its part, its colour and the corner of its footprint, plus a quarter-turn rotation.

**Placement.** Picking intersects the cursor ray with the boxes each part fills (arches leave their opening free), so it never needs triangle tests. The solver turns the face that was hit into a grid position, and a spatial index answers "who fills this cell?" in constant time for collision checks.

**Geometry.** Parts are built from three generators: a beveled loft along an axis (boxes, slopes, arches), a lathe (round parts, cones, studs) and filleted 2D paths. Explicit normals keep bevels smooth and flat faces flat.

### File format

```json
{
  "format": "brickbench.model",
  "version": 1,
  "name": "Garden cottage",
  "settings": { "baseplateSize": 32, "baseplateColor": 2 },
  "bricks": [{ "part": "brick-2x4", "color": 4, "x": 0, "y": 0, "z": 0, "r": 0 }]
}
```

`x`/`z` are in studs, `y` is in plates and `r` is quarter turns. Parts from the LDraw library are written as `ldraw:` plus their LDraw number, e.g. `ldraw:3001`. Colours are LDraw colour codes. Files are validated on load: unknown parts, bricks off the grid and bricks that overlap others are skipped, unknown colours are replaced, and you get a warning for each. Models are limited to 50,000 bricks and 2 million grid cells.

## Adding a part

1. Add it to `src/core/parts/catalog.ts`. The helpers (`rectangular`, `slope`, `round`, `arch`) cover the existing families; give the LDraw file and, if it isn't the default, the LDraw origin.
2. Run `bun test`. Every part is checked for a clean mesh, a sensible footprint and stud layout.
3. Run the LDraw check above.

## Not done yet

- Connections beyond the stud grid: library parts place by their bounding box, so hinges don't swing, Technic pins don't plug into holes, minifigures don't assemble and half-stud offsets (jumper plates) aren't possible
- Multi-colour and printed library parts (wheels with tyres, printed tiles)
- Hollow undersides and tubes on the basic parts (library parts have them)
- Ambient occlusion and a photoreal render mode
- Editing instruction steps by hand, sub-assemblies and per-step camera angles (steps are planned automatically)
- Accounts, sharing and a gallery

## Credits

Part numbers, colour codes and colour values follow the [LDraw](https://www.ldraw.org) standard. The library parts are converted from the LDraw.org Parts Library, made by its contributors and licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (older contributions also [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/)); `bun run ldraw` writes the full credits to `public/ldraw/CREDITS.txt`, and the app links to them. LDraw™ is a trademark of the Estate of James Jessiman.

LEGO® is a trademark of the LEGO Group, which does not sponsor, authorise or endorse this project.
