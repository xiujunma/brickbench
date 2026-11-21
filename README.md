# BrickBench

A 3D brick-building workshop that runs in the browser. Pick parts and colours, snap them together on a baseplate, then save your model or export it to LDraw, glTF or an image. Models made in BrickLink Studio, LeoCAD and other LDraw editors open too.

![The sample cottage in BrickBench](docs/screenshot.png)

## Features

- **87 basic parts in six families:** bricks (including tall 1×1×3 to 1×2×5), plates up to 16×16, tiles, slopes (45°, 33°, 65°, inverted, cheese), round parts and cones, and arches, all generated in code, and hollow underneath with tubes and pins as real bricks are.
- **The LDraw community parts library:** over 17,000 more parts, from Technic beams and hinges to wheels with their tyres, windows, doors and minifigure accessories, and nearly 10,000 of them printed or stickered (tiles with displays and signs, minifigure faces and torsos), converted from the [LDraw](https://www.ldraw.org) library when the app is built. Parts made in several colours keep the colours they fix, so a wheel's tyre stays black whatever colour you build the wheel in. Each takes up only the space its shape fills, so a corner plate leaves its corner free and an arch its opening, and each mesh loads the first time you use it.
- **Finding the right part:**
  - **One search covers every part.** Type sizes any way ("2x4", "2 by 4", "two by four"), hobby nicknames ("cheese", "jumper", "macaroni", "SNOT"), US spellings ("tire", "windshield") or a part number, including BrickLink's. Sizes work either way round ("4x2" finds 2 × 4). Name a colour too ("red 2x4 brick") and the part is built in it. If you mistype, close spellings show instead.
  - **Size, height and shape filters** narrow thousands of parts to a handful: say 1 × 2, 1 plate, with a clip.
  - **Printed and stickered parts** come after the plain ones, so a search for "tile 2x2" starts with the tiles rather than their hundreds of prints. Search for what a print shows ("police", "map") or press **Printed** to see only the prints.
  - **Part patterns** describe parts the way regular expressions describe text, stud by stud: `S45[oo/..]` is a 45° slope with its studs at the back, `B1x(1|2)` a 1 × 1 or 1 × 2 brick. See [Part patterns](#part-patterns).
  - **Mine** keeps your starred favourites, recent picks and the parts already in your model. Favourites and picks stay in this browser, shared by its tabs.
  - **Keyboard first:** press `/`, type, use ↑ ↓ and press Enter to build with the part.
- **Build with the parts you own:** add the parts lists of your sets from Rebrickable or BrickLink, and BrickBench counts how many of each part you have left as you build. The parts list shows what's missing, and an agent can build from your parts too. See [Building with the parts you own](#building-with-the-parts-you-own).
- **Build with an AI agent:** ask Claude Code, GPT, Grok or a model on your own computer, from a chat panel in the app (or Claude Code and other agents from your terminal), to build or change the model. It places, paints and moves bricks while you watch, checks its work with pictures of the model, and one undo takes back a whole request.
- **68 colours:** solid, transparent and metallic, following the LDraw palette, the newer ones included (Dark Purple, Light Aqua, Warm Tan, Reddish Orange and more).
- **Grid snapping that understands bricks.** Point at a top face to stack, at a side to build beside it (lined up with that brick's courses), or underneath to hang below. Parts never overlap: the preview turns red when there's no room, and drops land on top of whatever is in the way. A part put on a jumper plate's stud sits half a stud over, and what you build against it lines up with it.
- **Sideways and upside down (SNOT).** Point at a stud on a part's side, as on a brick with studs on its sides or a bracket, and the part you build turns to face out from it, its underside on the stud; `R` spins it about its top. Build on the studs of a part on its side the same way, and under studs facing down. `T` tips the part you build over, on its side or upside down, to lay it anywhere. Parts off the grid like these are placed exactly, to the LDraw unit, and collide by the space they really fill.
- **Technic, hinges, minifigures, bars and clips.** Build a Technic pin, axle or beam, a gear or wheel, a click hinge, a minifigure part, a bar or a clip at a part with a connection it fits, and it plugs in: a pin into a hole from the side you point at, as far as it goes; a beam onto a pin by one of its holes; an axle through a hole, flush with its far face; a gear, wheel or bush onto an axle, half a stud at a time along it; a click hinge's finger into its fork, and an older hinge plate's two fingers between another's three; a hinge brick's top onto its base, a hinge plate's top onto the base it swivels on, a turntable's top onto its base; a minifigure's torso onto its hips, a head on the neck, an arm at a shoulder, a hand at a wrist, legs on the hips; a bar into a clip or a minifigure's hand; a bar, or a part that is little more than one (a lightsaber blade, a spear, a sword by its hilt), down an open stud by the free end of its shaft; a clip along a bar. Parts that only have a bar on them, such as a plate with a handle, still stack on an open stud. `R` turns the part a quarter turn about the connection and `T` turns it over. Select parts hanging on a hinge, turntable, pin, axle or bar, or a minifigure's head, arm, hand or leg, and `R` swings them 15° about it (`⇧R` back), as far as the ground and the build area let it; parts held by an axle in an axle hole, or on two lines at once, can't swing, and a brick standing on the baseplate or on another brick's studs turns on the grid as it always has, whatever is plugged into it. Parts plugged together or at an angle are placed exactly and don't collide, and parts build on their studs at whatever angle they stand. A ready-made assembly from the library (a complete hinge brick or turntable, a torso with its arms on) is one part: the joints inside it are taken, so parts stack on it as on any other. The connections come from the LDraw library: the Technic ones, click hinges and older hinge plates' fingers from the primitives LDraw draws them with, the hinge bricks', swivelling hinge plates' and turntables' pivots from where LDraw's own assembled ones put their halves, the minifigure joints from the files every torso, head, hips, leg, arm and hand is drawn from, placed where LDraw's own assembled minifigures put them, clips, handles and open studs from their primitives, and bars from their shape: a whole cylinder of a bar's 3.18 mm. 7,454 of its parts have them, most of its Technic parts, wheels and minifigure parts among them.
- **Tools:** Build, Select & move (click, Shift-click, box select, drag to move), Paint and Erase, plus an eyedropper (Alt-click) and rotate, nudge, copy, paste and duplicate.
- **Unlimited undo** (up to 200 steps) and **autosave** in the browser.
- **Accounts and a gallery:** sign in with GitHub or Google to keep models online and open them on any computer, and publish them to a gallery where anyone can browse, open a copy and build on it. See [Accounts and the gallery](#accounts-and-the-gallery).
- **Files:** save and open `.brickbench.json`, or load the sample cottage. **File › Copy share link** puts the whole model in a link: whoever opens it gets their own copy, with no server in between (links to big models get too long, and the file is the way to send those).
- **Open models from elsewhere:** LDraw files (`.ldr`, `.mpd`) and BrickLink Studio files (`.io`) open as BrickBench models, built in the model's own order, with a report on any parts that couldn't come in. Use File › Open, or drop a file on the window. See [Opening LDraw and Studio files](#opening-ldraw-and-studio-files).
- **A desktop app** for macOS, Windows and Linux, with the parts library inside, a native menu, and LDraw and Studio files opened from Finder or Explorer. See [Desktop app](#desktop-app).
- **Building instructions:** a printable PDF booklet with a cover, the parts list, then one page per step showing the parts to add and the model so far, with the new parts outlined. Steps are planned for you, or arranged by hand, with sub-assemblies on pages of their own and a view for any step. See [Building instructions](#building-instructions).
- **Time-lapse video:** a video of your model being built, each brick dropping into place while the camera circles, ready to share. See [Time-lapse video](#time-lapse-video).
- **Exports:** LDraw (`.ldr`, opens in Studio, LeoCAD and LDView), glTF (`.glb`, at real-world scale for Blender), PNG, a time-lapse video (MP4 or WebM), and a parts list (CSV).
- **Light that looks real.** Ambient occlusion darkens the seams and corners where bricks meet, in the view, in images and in videos (**Scene › Ambient occlusion**; on unless the computer draws 3D without a graphics card). **File › Photo (.png)…** path traces a still of the view: light bounces between the bricks, shadows soften and transparent bricks turn to glass, in seconds to minutes depending on quality and size.
- **Fast with big models.** Resting bricks are instanced, one draw call per part type, and studs hidden under other bricks are skipped. Rendering only happens when something changes.

## Getting started

```bash
bun install
bun run ldraw      # once: downloads and converts the LDraw parts library (about 5 minutes)
bun run dev        # http://localhost:5173
bun run api        # optional, in another terminal: accounts and the gallery (see below)
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
| Rotate | | `R` (`⇧R` turns back); on its side, `R` spins the part about its top; plugged into a connection, about that; a selection on a hinge, turntable, pin, axle or bar swings 15° |
| Tip over, on a side or upside down | | `T` (`⇧T` tips back): the part you build tips away from you |
| Tools | | `V` select, `B` build, `P` paint, `E` erase |
| Copy / cut / paste / duplicate | | `⌘C` `⌘X` `⌘V` `⌘D` |
| Delete | | `Del` / `Backspace` |
| Undo / redo | | `⌘Z` / `⇧⌘Z` |
| Pick up a part and colour | Alt-click a brick | |
| Frame / reset view | | `F` / `Home` |
| Save / open | | `⌘S` / `⌘O` |
| Search parts / help | | `/` / `?` |
| Choose a search result | | `↑` `↓`, `Enter` builds with it, `Esc` clears |
| Previous / next instruction step (while arranging steps) | | `[` / `]` |

On Windows and Linux, use Ctrl in place of ⌘.

## Building instructions

Choose **File › Building instructions (.pdf)…**, or **Instructions** in the Model panel, once your model is built.

- **Steps are planned for you.** "Bottom up" builds layer by layer and groups bricks that sit near each other, so every step can actually be built. "As you built it" follows the order you placed the bricks.
- **Parts per step:** 3, 6, 10, 20 or 40. Big models need bigger steps; booklets are limited to 400 pages, which fits models up to about 15,000 bricks.
- **Or arrange them yourself.** **Edit steps…** opens the steps in the 3D view, one at a time: what is built so far, the step's new parts outlined, and later steps faint. `[` and `]`, or the arrows beside the step's number, go from step to step. Select bricks to move them into the step on show or into a new step after it, or to make them a **sub-assembly**: built on pages of its own, named as you like, then added whole in one step. **Draw it from this view** gives a step a view of its own, say to show the back of the model. Every change is one step to undo, and your steps are saved with the model. **Done**, or `Esc`, goes back to building. The booklet then follows "Your steps"; bricks added since you arranged them are planned bottom up after them. A step adding more kinds of parts than a page can list is spread over several pages.
- **Paper:** A4 or US Letter, landscape.
- **Pictures use your current view.** Turn the model to show its best side before you start. Every page uses the same view and scale, so the model grows in place from page to page. New parts get an outline that stays the same width in every picture: blue on red, orange, yellow and tan bricks, orange on the rest.

The PDF is made entirely in your browser: each step is drawn offscreen with three.js and laid out with [jsPDF](https://github.com/parallax/jsPDF), which loads only when you make a booklet.

## Time-lapse video

Choose **File › Time-lapse video…** to film your model going together, brick by brick, for a clip to share.

- **Order:** "As you built it" replays the order you placed the bricks; "Bottom up" builds layer by layer, as the instructions do.
- **Length:** 5 to 60 seconds. However many bricks the model has, they arrive evenly over the video, each dropping into place, and the finished model stays on screen for the last couple of seconds.
- **Shape and size:** landscape (16:9), square, or portrait (9:16) for phones, at 1080p or 720p, 30 frames a second.
- **Camera:** it starts on the side you are looking from, at about the same height (kept between a low and a high angle), and circles the model: once round for 20 seconds or more, part of the way for shorter videos. Untick the option to keep it still. It stays at one distance all the way round, as near as it can while keeping the whole model in the picture.
- **Brick count:** "312 / 1,504 bricks" in a corner as the bricks arrive, unless you turn it off.

The video is made in your browser and saved to your downloads: an MP4 (H.264), or a WebM where the browser can't make MP4. Frames are drawn offscreen in the editor's light and encoded with WebCodecs and [Mediabunny](https://mediabunny.dev) (MPL-2.0), which loads only when you make a video. On a computer with a graphics card, a 10-second 1080p video of a model of a few thousand bricks takes a few seconds; bigger models take longer, and software graphics much longer.

## Opening LDraw and Studio files

**File › Open…** also opens models made elsewhere: LDraw files (`.ldr`, `.mpd`) from LeoCAD, MLCad or the [LDraw model repository](https://library.ldraw.org/omr) of official sets, and BrickLink Studio files (`.io`), old and new. Submodels are built where the model puts them, in their colours. Parts come in in the model's own order, so a time-lapse of an opened model follows its building steps. Its steps (`0 STEP`) and submodels become the steps of its instructions too: each use of a submodel is a sub-assembly, built on pages of its own and added at the step that uses it.

BrickBench builds parts where the model puts them. Upright parts go on whole plates and on whole studs, or half a stud over as on a jumper plate; parts on their sides or upside down, and parts between studs, go exactly where the model puts them, to the nearest LDraw unit. Parts at an angle, as on hinges and Technic pins, and parts that reach into their neighbours, such as a tyre on its wheel, glass in its frame or a pin in its hole, go in exactly too, loose: they take no part in collisions. What can't come in stays out, and a report says what and why:

- **Not in BrickBench:** parts the library doesn't have.
- **Mirrored:** mirror images of parts, which LDraw files can hold but no real part is made as.
- **Drawing shapes** (strings and wires a model draws itself) and **submodels kept in other files**.

To bring in as much as it can, it also:

- **finds the grid the model was built on**, wherever the editor put it, and moves a submodel built a little off the rest (a train body resting just above its bogies) by up to a quarter stud or half a plate, as one piece, to line up;
- **turns submodels square** that a model stands at an angle for show, such as a car parked at 30°;
- keeps **printed and stickered parts** with their prints, and builds the few the library lacks (stickers on their own, prints newer than the library) as their plain part;
- builds **colours** BrickBench doesn't have (Light Grey, Brown) in the nearest it does.

The model stands in the middle of the scene on a baseplate big enough to hold it, or on none if it brings its own.

Loose parts keep their exact place and angle in BrickBench's own files and in the LDraw files it saves.

Studio files are ZIP archives: BrickBench reads the LDraw model inside with [zip.js](https://gildas-lormeau.github.io/zip.js/) (BSD-3-Clause), which loads only when you open one.

## Building with the parts you own

Choose **File › Your parts…**, or **Add their parts lists** under **Mine** in the parts panel, and add a parts list for each set you own:

- **From Rebrickable:** open a set's inventory and choose Export Parts, as Rebrickable CSV or BrickLink XML. A CSV with Part, Color and Quantity columns works too, such as an export of all your parts.
- **From BrickLink:** download a set's inventory as XML. Wanted lists and BrickStore files work too.

Set how many copies of a set you have, and BrickBench counts with all of them:

- **Mine** gets a **Parts you own** section: every part in the colours you have, each with how many are left. Click one to build with it in that colour.
- **Part tiles** say how many you have left in the colour they show (under "In this model", how many the model uses). The count turns red when the model uses more than you have.
- **The Owned filter** over the search box keeps a search to your parts.
- **Building with** in the inspector says how many of the part, in the current colour, are left.
- **The parts list** gets Have and Missing columns, in the CSV as well, so you know what to buy. **Buy missing parts** there writes what you lack as a BrickLink wanted list (`.xml`, for Wanted › Upload) or a Rebrickable parts list (`.csv`), in each catalogue's own part numbers and colours. Without sets added, it lists every part the model uses.
- **An agent** can see your parts: ask it to build something from your sets, and it is told whenever a change uses more of a part than you have.

**How lists are matched.** BrickLink and Rebrickable mostly number parts as LDraw does. Where they differ, LDraw parts note the other numbers ("BrickLink 4073" on 6141), and the library build records the numbers LDraw moved or merged (3040 is now 3040b). Colours are matched with Rebrickable's table of colour numbers. Checked against Rebrickable's inventories of 3,145 sets from 2018 on, about 98% of their parts matched before printed parts came into the library, and most of the rest were prints. What is still left is listed with each set, with the reason: mostly sticker sheets, which BrickBench leaves out, and parts too new for the LDraw library. Minifigures and alternate parts in BrickLink inventories are left out, and you are told how many. A list added while the parts library could not load is matched again once it does, as are all lists when a rebuilt library has more parts.

Your lists stay in this browser, like favourites, and are shared by its tabs.

## Part patterns

Type a part pattern in the search box to say exactly which parts you mean; the **?** beside the box lists the syntax, with examples to try. A capital letter gives the kind, then a size, a top face and a height can follow:

| Pattern | Finds |
| --- | --- |
| `P2x4` | 2 × 4 plates |
| `B1x(1\|2)` | 1 × 1 and 1 × 2 bricks |
| `B1x2x5` | 1 × 2 bricks five bricks tall |
| `S45 2x2` | 2 × 2 slopes at 45° |
| `S45[oo/..]` | 45° slopes with two studs at the back and the slope at the front |
| `T[..]{2}` | tiles with two rows of two smooth cells |
| `[o_/oo]` | anything shaped like a corner plate, with studs on top |
| `P1x2 +clip` | 1 × 2 plates with a clip |
| `@owned S :red` | slopes from your sets, to build in red |

In the brackets, rows go from the back of the part to the front: `o` is a stud, `.` a cell without one, `_` a cell the part leaves out and `#` any cell, with `*`, `+`, `?`, `{2,4}`, `( | )` and `[ ]` as in regular expressions. Terms side by side must all hold, `|` gives a choice and `!` a "not". Library parts have `#` for their cells, since the library doesn't say where their studs are.

Agents get each part's own pattern from `find_parts`, such as `S45[oo/..]^3=3039`, so they know where a part has its studs. [docs/part-patterns.md](docs/part-patterns.md) defines the language in full; its tests check every example there.

## Accounts and the gallery

Where the site is hosted with its API (see [Hosting](#hosting)), you can sign in with GitHub or Google. Signing in is never needed to build; it keeps models online and lets you share them.

- **File › Save online** keeps the open model online, with a picture of it, and saves over that copy each time after. Open it on any computer you sign in on from **File › Your models online…**, which also publishes models to the gallery, takes them out again, copies their links and deletes them. Each account keeps up to 100 models, in 25 MB (a model of a few hundred bricks takes some 20 kB, its picture included).
- **Saves never pass each other unseen.** Each save follows on from the one you opened, so if the model was saved from somewhere else in the meantime, BrickBench asks before saving, and keeps both.
- **The gallery** (**Gallery** in the top bar, or **File › Gallery…**) shows published models, the latest first, with a search by name. Anyone can open one, which opens a copy to build on: saving it online keeps a copy of your own. A model's link (`#gallery=…`) opens it straight away. Saving a published model again updates it in the gallery.
- **Reports and moderation.** Signed-in builders can report a model as offensive, spam, copied or something else. Moderators (the accounts named in `ADMINS`) see a **Reported** view in the gallery, the most reported models first, where they take models out of the gallery, keep them or delete them, and stop accounts saving, publishing and reporting (their models leave the gallery with them) or let them back in. A stopped account that deletes itself loses its models, but its GitHub or Google account number is kept, so signing in again does not start it afresh.
- **Your account** (from your name in the top bar) changes the name the gallery shows, signs out, or deletes the account with all its models.

The desktop app has no accounts yet: it builds on your computer, and you share its models by file.

**How it works.** The API is one function from a request to a response (`server/app.ts`). On Cloudflare Pages it runs as a Pages Function (`functions/api/[[path]].ts`) on a D1 database, at the site's own address, so the page needs no permission to reach it. It makes its tables itself the first time it runs. A signed-in browser holds a random secret in a cookie that scripts cannot read, and the database keeps only its hash; a session lasts 30 days from when it was last renewed, and is renewed when used in its last 15. Anything that changes something must come from the site's own page (its `Origin`) as well as carry the cookie, and is limited per account (saves, publishing, reports) or per visitor (sign-ins, counted by a hash of the visitor's address that is cleared out after a day). Signing in uses OAuth with PKCE and asks the provider for an id and a name only, never an email address; the provider's token is used once and not kept. A model online is its file, deflated, with a JPEG of it drawn the way the building instructions draw their pages; the gallery shows only models that are published, not taken out by a moderator, and from accounts in good standing.

`bun run api` runs the same API on this computer, on SQLite (kept in `.data/`), at `http://127.0.0.1:8788`, and the dev server and `bun run preview` pass the site's `/api` requests to it. It offers **Sign in for testing**, which lets anyone in under any name and is honoured only on this computer, never on a hosted site; signing in for testing as "admin" moderates. To try real sign-in, set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, or Google's, with `http://127.0.0.1:5173/api/auth/github/callback` (or `…/google/callback`) as the app's callback address, and open the site at `http://127.0.0.1:5173`.

## Desktop app

BrickBench also runs as a desktop app, built with [Electron](https://www.electronjs.org): the same app, with the parts library inside it, so it works offline.

- **Open models from your desktop:** choose BrickBench in a file's **Open With** menu for LDraw (`.ldr`, `.mpd`) and Studio (`.io`) files (it offers to open them without taking them over from other apps), drop a file on the window or on the Dock icon, or use **File › Open…**.
- **A native menu** with File, Edit and View. The keys work as in the browser: ⌘Z undoes in the scene, and undoes your typing in a text box.
- **Saving** asks where to save, as other desktop apps do, then says where the file went (and nothing if you cancel).
- **Your work stays in the app:** autosave, favourites and your parts lists are kept in the app's own storage, apart from your browser's.
- **The agent chat** needs no `bun run agent`: the app runs the agent bridge itself while the Agent panel is connected, and uses Claude Code if it is installed. It finds Claude Code where its installers put it, since an app opened from the Finder or the Start menu has no terminal's PATH; on Windows, that is the native installer's `claude.exe`. Agents in a terminal reach the app's MCP server at the address the Agent panel shows. Opened from a terminal, the app takes the same settings as `bun run agent`, such as `BRICKBENCH_AGENT_PROVIDER`.

To run it from this repository, `bun run desktop` builds the web app and opens it in Electron (`bun scripts/desktop.ts start --skip-web` reuses the last build). To make an installer, `bun run desktop:dist` builds everything and writes it to `release/`: a `.dmg` on macOS, an installer on Windows and an AppImage on Linux. Build each on its own system; `bun scripts/desktop.ts dist --dir` makes just the app, unpacked, which is quicker to try. The installers aren't signed with a developer certificate yet (that needs an Apple Developer ID and a Windows code-signing certificate). The macOS app is signed ad hoc, so the first time you open a downloaded copy, macOS needs **right-click › Open**; Windows asks before running the installer.

**How it works.** Electron shows the built web app from a scheme of its own, `brickbench://app`, which serves only the app's own files (a `file://` page couldn't load the parts library). The page runs sandboxed, with no access to Node or your files; a small preload script passes it menu commands and the files you open. Links to websites open in your browser, and the page can't navigate anywhere else. The main process is in `electron/`, bundled by Bun; `bun run e2e:desktop` builds the app and runs its tests in Electron, and with `BRICKBENCH_DESKTOP_APP` set to a packaged app's executable, `bunx --bun playwright test -c playwright.desktop.config.ts` runs them against that instead. The tests keep their own storage, apart from your copy of the app.

## Building with an AI agent

An AI agent can build in BrickBench: Claude Code, GPT, Grok or a model on your own computer from the **Agent** panel in the app, or Claude Code (or any other agent that speaks [MCP](https://modelcontextprotocol.io)) from a terminal. It places, paints, moves and removes bricks while you watch, looks at pictures of the model to check its work, and whatever it does for one request is one step you can undo.

![The Agent panel: Claude Code making a house's roof dark grey and putting a white fence around its garden](docs/agent-panel.png)

1. Start the agent bridge, a small server on your computer, in a terminal in the BrickBench folder (the [desktop app](#desktop-app) runs it itself, so skip this there):

   ```bash
   bun run agent
   ```

2. Open BrickBench and click **Agent** in the top bar. Ask for something: "build a small red house with a door and two windows", "make the roof dark grey", "put a fence around it".

Unless you choose another model (below), the chat runs [Claude Code](https://code.claude.com) on your computer with your own login, so Claude Code has to be installed. It gets the BrickBench tools and nothing else: no shell, no files, and none of your Claude Code hooks, plugins or settings files. That use of your login is meant for you on your own computer; if other people will use the chat, set `ANTHROPIC_API_KEY` for the bridge so it runs on an API key instead.

**Other models: GPT, Grok, OpenRouter, or a model on your computer.** Start the bridge with `BRICKBENCH_AGENT_PROVIDER` set, and the chat runs that model instead. It gets the same tools and instructions as Claude Code, calls them by function calling, and sees the pictures `look` draws (a model that cannot see pictures carries on without them, and the chat says so). One request is still one step to undo.

| Provider | `BRICKBENCH_AGENT_PROVIDER` | API key | Model, unless `BRICKBENCH_AGENT_MODEL` says otherwise |
|---|---|---|---|
| [OpenAI](https://developers.openai.com/api/docs/models) (GPT) | `openai` | `OPENAI_API_KEY` | `gpt-6.2-sol` |
| [xAI](https://docs.x.ai/developers/models) (Grok) | `xai` | `XAI_API_KEY` | `grok-4.7` |
| [OpenRouter](https://openrouter.ai/models) | `openrouter` | `OPENROUTER_API_KEY` | none: set one |
| [Ollama](https://ollama.com), on your computer | `ollama` | none | none: set one that `ollama list` shows |
| [LM Studio](https://lmstudio.ai), on your computer | `lmstudio` | none | none: set one it has loaded |
| Any other OpenAI-compatible API | `custom`, with `BRICKBENCH_AGENT_BASE_URL` | the variable `BRICKBENCH_AGENT_API_KEY_VAR` names, if any | none: set one |

```bash
# Grok, with the API key from your xAI console in XAI_API_KEY
BRICKBENCH_AGENT_PROVIDER=xai bun run agent

# or a model on this computer, through Ollama
BRICKBENCH_AGENT_PROVIDER=ollama BRICKBENCH_AGENT_MODEL=qwen3.5:9b bun run agent
```

Choose a model that handles tool calls well and can see pictures; small models on your computer manage simple builds. What you ask, and the model being built, go to the provider under your API key (with Ollama or LM Studio, only to wherever you run it). The bridge asks OpenAI and xAI not to store the conversation, and sends it whole with each request instead. There is no spending cap as there is for Claude Code; instead, a request stops after 60 rounds of tool calls.

**From a terminal.** With the bridge running and BrickBench open, add BrickBench to Claude Code once:

```bash
claude mcp add --transport http brickbench http://127.0.0.1:7425/mcp
```

then ask Claude Code to build something in BrickBench. Any MCP client can use the same address. Agents build in the BrickBench tab you used last, and once the Agent panel has connected, BrickBench reconnects by itself on later visits (until you click Disconnect).

**The tools agents get:**

| Tool | What it does |
|---|---|
| `get_model` | The model's name, size, parts and colours, and its bricks with their ids, optionally only those in a region |
| `find_parts` | Searches parts like the search box does, by words or [part pattern](#part-patterns), and returns part ids with their sizes and patterns; with your sets added, also the colours you own and how many are left, or only your parts |
| `list_colors` | The colours, with names and LDraw codes |
| `list_owned_parts` | The parts of your sets, each part and colour with how many you own, the model uses and are left |
| `place_bricks` | Places up to 2,000 parts at once; refuses any that would overlap or leave the build area, with the reason, and points out bricks with nothing holding them up and parts the model now uses more of than you own |
| `paint_bricks`, `move_bricks`, `remove_bricks` | Change bricks named by id or reached by a region; painting, too, points out parts the model now uses more of than you own |
| `look` | A picture of the model from any side, with bricks outlined if asked |
| `set_model_name`, `undo`, `clear_model` | Rename, undo steps, or start afresh (only when you ask) |

**Settings** (environment variables for `bun run agent`, or for the desktop app when you open it from a terminal):

| Variable | What it sets |
|---|---|
| `BRICKBENCH_AGENT_PORT` | The bridge's port, 7425 by default. Open BrickBench with `?agentPort=` and the same number to match. |
| `BRICKBENCH_AGENT_PROVIDER` | Who runs the chat's model: `claude` (Claude Code, the default), `openai`, `xai`, `openrouter`, `ollama`, `lmstudio` or `custom` |
| `BRICKBENCH_AGENT_MODEL` | The model the chat uses: for Claude Code, such as `sonnet` or `opus` (its default otherwise); for the others, as the provider names it |
| `BRICKBENCH_AGENT_BUDGET_USD` | For Claude Code, the most one chat request may spend: $5 unless you set it, or `none` for no cap |
| `BRICKBENCH_CLAUDE` | Where the `claude` command is, if it is not on your PATH |
| `BRICKBENCH_AGENT_API_KEY_VAR` | The name of the environment variable that holds the API key, if not the provider's usual one (as in the table above) |
| `BRICKBENCH_AGENT_BASE_URL` | The API's address, ending in `/v1`: needed for `custom`, or to reach Ollama or LM Studio on another computer |
| `BRICKBENCH_AGENT_API` | `responses` or `chat`, to override how the bridge talks to the API: OpenAI and xAI use the Responses API, the rest Chat Completions |
| `BRICKBENCH_AGENT_ORIGINS` | The only pages that may connect, comma-separated, such as `http://localhost:5173` |

The bridge listens on this computer only (127.0.0.1) and answers only pages served from this computer. Any of them could start the chat, so if you run other web servers you do not trust, set `BRICKBENCH_AGENT_ORIGINS` to BrickBench's own address.

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Start the dev server (Vite) |
| `bun run build` | Type-check, build the LDraw library if it is missing, and build to `dist/` |
| `bun run ldraw` | Download and convert the LDraw parts library into `public/ldraw/` |
| `bun run agent` | Start the agent bridge, so the Agent panel's chat and other MCP agents can build in BrickBench |
| `bun run api` | Run the accounts and gallery API on this computer, on SQLite ([Accounts and the gallery](#accounts-and-the-gallery)) |
| `bun test` | Run the unit tests (`bun test`, about a second) |
| `bun run coverage` | Run the unit tests with coverage; fails if any file drops below 80% of its lines or functions |
| `bun run e2e` | Run the browser tests (Playwright; starts the dev server itself) |
| `bun run desktop` | Build the web app and open it in the desktop app (Electron) |
| `bun run desktop:dist` | Build everything and package the desktop app into `release/` |
| `bun run e2e:desktop` | Build the desktop app and run its tests in Electron |
| `bun run typecheck` | Type-check the app, tests and tooling with `bun check` |

The first time you run the browser tests, install a browser with `bunx playwright install chromium`. Unit tests share one process, so they must not depend on each other's state: `bun test --randomize` and `bun test --isolate` should pass too.

`bun scripts/colourNumbers.ts <colours.json> <LDConfig.ldr>` rewrites the table that matches Rebrickable's and BrickLink's colour numbers to LDraw's, from Rebrickable's colour list (as its API gives it) and LDraw's colour table. Run it when the catalogues add colours.

`bun scripts/ldrawColours.ts .ldraw-cache/ldraw/LDConfig.ldr` rewrites the table of every LDraw colour (name, value and finish) that opened models in colours outside the palette are matched by. Run it when LDraw adds colours.

### Checking LDraw mappings

Each part records its LDraw part number and where the LDraw origin sits on it, which keeps exports correctly placed and turned. A test compares every part against the real LDraw library:

```bash
bun run ldraw --fetch-only    # downloads the library into .ldraw-cache/ldraw, if you have not yet
LDRAW_DIR=.ldraw-cache/ldraw bun test src/core/parts/ldraw.verify.test.ts src/core/io/ldrawExport.verify.test.ts
```

`LDRAW_DIR=.ldraw-cache/ldraw bun test verify` runs every check against the real library.

The first file checks each part's size, origin and slope direction. The second exports every part at all four rotations and confirms the LDraw part lands exactly where the brick sits. Without `LDRAW_DIR` both are skipped. Run them whenever you add or change a part.

### Continuous integration

GitHub Actions runs `.github/workflows/test.yml` on every push to `main` and on every pull request, in two jobs, plus a third that deploys the site once it is [set up](#hosting):

- **Type check and unit tests:** `bun run typecheck` and `bun run coverage`, about a minute.
- **LDraw checks and browser tests:** builds the LDraw library, runs `bun test verify` against it, builds the app, then runs `bun run e2e` against that build in headless Chromium. The library download and the converted library are cached, so only the first run, or one after the converter changes, spends a few minutes converting. Traces of failed browser tests are kept for a week as a `playwright-traces` artifact.

The runners have no GPU, so WebGL is drawn on the CPU: with `CI` set, Playwright tests the production build (`vite preview`, which sends the hosted site's headers and security policy; any test whose page breaks the policy fails) one test at a time, gives each test two minutes, retries once, and stops after three failures. Run the same way locally with `bunx --bun vite build && CI=1 bun run e2e`. The browser tests also start the agent bridge, on port 7499, with a stand-in for Claude Code that builds through MCP, so they spend nothing on a real model, and the accounts and gallery API, on port 7490, on a database that lasts as long as the tests.

To pick up a newer LDraw release in CI, bump `ldraw-download-v1` in the workflow.

### Hosting

BrickBench is a static site: `bun run build` writes it to `dist/`, about 350 MB in some 17,600 files, nearly all of them the parts library. Building in it needs no server of its own, and the parts are stored compressed, which the app undoes itself, so any static host serves it as it is. Only accounts and the gallery need the API, and without it the page leaves them out. Mind a host's limit on files: Cloudflare Pages takes 20,000 per site on its free plan (100,000 on paid ones), which leaves room for some 2,400 more parts, and the deploy job warns once a build passes 19,000 files. The build also writes `third-party-licences.txt`, the licences of the packages bundled into it, which About links to.

The workflow deploys to [Cloudflare Pages](https://pages.cloudflare.com) after both test jobs pass on `main`. To switch it on:

1. In Cloudflare, create a Pages project for direct upload (no Git connection), and an API token allowed to edit Cloudflare Pages. Note your account ID.
2. In the GitHub repository's settings, add the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and the variable `CLOUDFLARE_PROJECT` set to the project's name.
3. Push to `main`, or run the workflow by hand. The **Deploy to Cloudflare Pages** job uploads the build; Cloudflare sends only files that changed.
4. Add your domain to the project under Custom domains. Cloudflare sets up HTTPS.

The deploy also uploads the API, from `functions/`. It answers only once the site has a database; until then the page has no accounts or gallery. To switch them on, in the Cloudflare dashboard:

1. Create a D1 database (Storage & Databases › D1), and bind it to the Pages project as `DB` (the project's Settings › Bindings). The API makes its tables on its first request. D1's free plan holds 5 GB, room for tens of thousands of models.
2. Register the sign-in apps, with your domain in their addresses:
   - **GitHub:** Settings › Developer settings › OAuth Apps › New OAuth App, with the homepage `https://your-domain` and the callback URL `https://your-domain/api/auth/github/callback`. Then generate a client secret.
   - **Google:** in the Google Cloud console, set up the OAuth consent screen (with the scopes `openid` and `profile`), then create an OAuth client ID for a web application, with the redirect URI `https://your-domain/api/auth/google/callback`.
3. Add the Pages project's settings (Settings › Variables and Secrets), as secrets: `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, and `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Either pair alone is enough: the page offers the ways in that are set up. Then deploy again.
4. Name the moderators in `ADMINS`: provider and account number, comma-separated, such as `github:1234567`. A GitHub account's number is the `id` at `https://api.github.com/users/<login>`; a Google account's is the `sub` it signs in with. Never set `TEST_SIGN_IN` on a hosted site (the API ignores it there anyway).
5. Add a rate limiting rule for `/api/` (Security › WAF; the free plan has one), say 100 requests a minute from one address. The API limits what each account and visitor may change, but not how often anyone reads, and a gallery search reads every published model.

`public/_headers` sets the hosted site's response headers: a Content Security Policy, other security headers, and how long browsers keep files (the app's own for good, since their names change with every build; library files for a day). The agent chat on a hosted site still talks to the bridge on each visitor's own computer: start it with `BRICKBENCH_AGENT_ORIGINS=https://your-domain bun run agent` to let the site's page in.

## The LDraw parts library

`bun run ldraw` turns the [LDraw parts library](https://library.ldraw.org) into files the app can load quickly, in `public/ldraw/` (not committed; `bun run build` makes it whenever it is missing, incomplete or partial):

- `index.json` lists every part: its name, category, keywords, author, how it sits on the grid, the studs on its sides and underside and, when it leaves some of its box empty, which cells it fills. Printed and stickered parts say so, with the plain part each decorates when the library has it (3068b for 3068bp80). It also lists the part numbers LDraw moved or merged, each with the part it now is (4073 is 6141), so parts lists that use the old numbers still match.
- `parts/<number>.bin` holds one mesh per part: gzip-compressed, 16-bit positions and 8-bit normals, with its triangles in runs by colour when the part fixes colours of its own. A 2 × 4 brick is under 5 kB.
- `CREDITS.txt` names the author of every part and of every primitive it uses, and copies of the LDraw licence files sit alongside.
- `build.json` says the build is complete and, for downloads, records the archive's SHA-256. `complete.zip` always holds the latest LDraw release; keep a copy and pass `--library` to pin one.

A build is written to `public/ldraw.partial/` and swapped in only when it has finished, so an interrupted run leaves the previous library in place. The tool only ever deletes folders it built itself.

The converter (`scripts/ldraw/`) follows each part's sub-files and primitives, honouring LDraw's back-face rules (winding, inverted and mirrored references, double-sided sections), drops edge lines, smooths curved surfaces, and moves the part so its body stands centred on its footprint with the top studs over cell centres. Parts drawn in several colours, such as wheels with their tyres, keep the colours they fix, read from LDraw's colour table (`LDConfig.ldr`), apart from the part's own. It keeps printed and stickered parts, whose prints LDraw draws as coloured shapes, and leaves out stickers on their own (sheets to stick on parts, which BrickBench cannot do), obsolete and alias files and third-party parts, and the two twisted strings whose meshes run past 200,000 vertices. That leaves about 17,500 parts, some 9,800 of them printed or stickered, and 320 MB of meshes in as many files.

```bash
bun run ldraw                                # download complete.zip into .ldraw-cache/ and convert everything
bun run ldraw --library /path/to/ldraw       # or LDRAW_DIR=…: use a library you already have
bun run ldraw --only 3001,3003,3040b         # just these parts, handy while developing (a partial build)
bun run ldraw --limit 200                    # the first 200 parts (also partial)
bun run ldraw --fetch-only                   # just download and unpack it into .ldraw-cache/ldraw
```

In the app, library parts are ordinary parts with ids like `ldraw:3001`. Each sits in the smallest box of whole cells that holds its body (a fifth of a stud may stick out on a side), placed so its top studs sit over cell centres, so it stacks and collides like any brick. Within that box it fills only the cells its shape takes up: the missing corner of a corner plate, the opening of an arch, window or door frame, and the space under a bracket's overhang stay free for other parts. A cell counts as filled when the part reaches two LDraw units or more into it, or when the part closes it in on every side and from above, as it does the hollow underside of a brick. Jumper plates keep their half-stud offset, and the index says which way their stud sits between cells, so what goes on it sits half a stud over. The index also lists the studs on a part's sides and underside, where each stands and which way it faces, so parts can be built facing out from them, and the Technic and click-hinge connections LDraw's primitives draw (pin and axle holes, pins, axles, and hinges' fingers and forks), with where each runs, which way and how far, so parts plug into each other. The primitives for a hole's two faces join into one hole through the part, and an axle is told from an axle hole drawn with the same primitive by which way its surfaces face. Minifigure joints (neck and head, waist and hips, the hips' axle and legs, shoulders and arms, wrists and hands) are set on the LDraw files every variant of those parts is drawn from (`scripts/ldraw/minifigJoints.ts`), where LDraw's own assembled minifigures put the parts, so printed torsos, heads and legs have them too. The older hinge plates' fingers have primitives (`h1`, `h2`) like the click hinges'; the pivots of hinge bricks, swivelling hinge plates and turntables are set on their parts' files (`scripts/ldraw/hingeJoints.ts`): LDraw draws both halves of each about one origin, so the pivot is the same line in both, checked against where each part's round surfaces are centred and against LDraw's assembled hinges and turntables. A Technic primitive drawn more than 15% off its size (a hinge plate's small pivot is drawn with a pin's) is not taken for a Technic connection. Connections a part's own pieces plug into each other are left out, as in LDraw's ready-made assemblies: both halves of a complete hinge brick's or turntable's joint, the shoulders and wrists of a torso with its arms and hands on, a pin's end in its hole. A hole, an axle or a bar that goes on past what it holds stays. Clips and handles come from LDraw's clip and handle primitives, the holes bars stand in from its open-stud primitives, and bars from any whole cylinder of a bar's radius (4 LDU) and at least 8 LDU long, outside the cylinders studs are drawn with. A part drawn in several colours takes the colour you choose wherever LDraw draws it in the part's own colour; the colours it fixes are drawn as the palette's version of that colour when there is one, and as LDraw defines them otherwise. While a mesh loads, a plain box of the right size stands in; parts that fail to load are retried when the connection comes back.

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
              and part finder (search, nicknames, filters, part patterns),
              immutable model operations, spatial index, picking and placement,
              undo history, file format, LDraw and Studio import, LDraw and
              parts-list export, and
              instruction steps, page layout and camera framing
  engine/     three.js: procedural part geometry, library mesh loading, instanced
              batches, selection and preview layers, ground, viewport, thumbnails,
              glTF export
  editor/     connects state and scene: pointer gestures, keyboard, drag and drop
  state/      zustand store and actions, selectors, autosave, file commands, accounts
              and models online
  ui/         React panels, dialogs and toasts
  agent/      the build tools agents call, the link to the agent bridge, and the chat
  instructions/  building-instruction booklets: rendering steps and writing the PDF
  desktop/    what the desktop app and the page say to each other
  samples/    the sample cottage
scripts/ldraw/  the LDraw library converter (run straight from TypeScript by Bun)
agent/        the agent bridge: an MCP server for agents, a WebSocket for BrickBench tabs,
              and the chat's agent: Claude Code run headless, or a model behind an API (api/)
electron/     the desktop app's main process and preload script, and the agent bridge it runs
server/       the accounts and gallery API, as Cloudflare runs it, and on SQLite here (local.ts)
functions/    the Cloudflare Pages Function that runs the API
e2e/          Playwright tests (e2e-desktop/: the desktop app's)
```

**Grid and units.** One world unit is one stud pitch (8 mm). Bricks snap to whole studs on X/Z and whole plates (3.2 mm) on Y. A brick is stored as its part, its colour and the corner of the box it fills, plus which of the 24 ways it faces (`src/core/orientation.ts`): upright, turned in quarter turns, or on a side or upside down. Upright bricks on whole or half studs and whole plates fill grid cells; the rest are placed to the LDraw unit and collide by their exact boxes, which the spatial index keeps in each cell they reach into.

**Placement.** Picking intersects the cursor ray with the boxes each part fills (arches leave their opening free, and library parts fill only the cells their shape takes up), so it never needs triangle tests. The solver turns the face that was hit into a grid position, and a spatial index answers "who fills this cell?" in constant time for collision checks.

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

`x`, `y` and `z` are the corner of the box the part fills: `x` and `z` in studs, `y` in plates. `r` is the way it faces: 0 to 3 upright, turned that many quarter turns; 4 to 23 on a side or upside down, as `src/core/orientation.ts` counts them (four quarter turns about the part's own top for each of the six ways its top can face: up, down, +x, -x, +z, -z). Upright parts stand on whole or half studs (a part on a jumper plate's stud stands half a stud over) and whole plates; parts on their sides, and parts built on them, stand on any whole LDraw unit, a twentieth of a stud or an eighth of a plate. Parts from the LDraw library are written as `ldraw:` plus their LDraw number, e.g. `ldraw:3001`. Colours are LDraw colour codes. Files are validated on load: unknown parts, bricks off the grid and bricks that overlap others are skipped, unknown colours are replaced, and you get a warning for each. Models are limited to 50,000 bricks and 2 million grid cells.

A model with instruction steps of its own (arranged by hand, or from an opened LDraw file) also has an `instructions` field. Its steps name bricks by their place in `bricks`, counting from 0, and sub-assemblies by their place in `assemblies`; a `view` is a direction to look along (x, y, z), never straight up or down:

```json
"instructions": {
  "steps": [{ "bricks": [0, 1] }, { "bricks": [4], "assembly": 0, "view": [1, -0.6, -1] }],
  "assemblies": [{ "name": "Roof", "steps": [{ "bricks": [2] }, { "bricks": [3] }] }]
}
```

Bricks it leaves out are planned bottom up after its steps. If it cannot be read, the model still opens, with a warning, and its steps are planned afresh.

## Adding a part

1. Add it to `src/core/parts/catalog.ts`. The helpers (`rectangular`, `slope`, `round`, `arch`) cover the existing families; give the LDraw file and, if it isn't the default, the LDraw origin.
2. Run `bun test`. Every part is checked for a clean mesh, a sensible footprint and stud layout.
3. Run the LDraw check above.

## Not done yet

- Ball joints, the rarer hinges (car roofs, panels, the articulated and 2 × 5 hinge plates, hinge tiles), clips drawn without LDraw's clip primitives (some tiles with clips), and minifigure parts drawn other than the classic ones (some heads, legs and arms): LDraw draws their connections with plain shapes, so the library build can't find them
- Plugging a group in by its connections (one part at a time plugs in)
- Tipping over a pasted group (`T` tips the part you build; a pasted group turns with `R` only)
- Accounts in the desktop app (it shares models by file for now)

## Privacy

Your models, favourite and recent parts, and parts lists stay in your browser's storage (in the desktop app, on your computer), unless you sign in and save a model online. Signing in is up to you. With an account, the site keeps the models you save online, private to you until you put one in the gallery, the name and account number GitHub or Google gives it, and a cookie that keeps you signed in; it never sees your password or email address, and deleting your account deletes them all (if a moderator has stopped the account, the account number stays, so it stays stopped). To limit sign-in attempts, the site counts them for a while by a hash of your internet address, never the address itself. BrickBench downloads only its own files, such as the LDraw parts you use, from wherever it is hosted, with no tracking or adverts. If you connect an AI agent, what you ask it and the model it works on go to whoever runs it: with Claude Code, to Anthropic under your own account; with GPT or Grok, to OpenAI or xAI under your API key. With a model you run yourself, through Ollama or LM Studio, they go only to where it runs, usually your own computer. A share link carries the model after its `#`, which browsers never send to the site. **About & privacy**, at the foot of the parts panel, says the same in the app, with the credits and trademark notices.

## Licence

BrickBench is released under the [MIT Licence](LICENSE). That covers its own code. The LDraw parts library that `bun run ldraw` builds, and the desktop app ships, keeps its own licence (CC BY 4.0, older parts CC BY 2.0; see below), as do the packages BrickBench uses.

## Credits

Part numbers, colour codes and colour values follow the [LDraw](https://www.ldraw.org) standard. The library parts are converted from the LDraw.org Parts Library, made by its contributors and licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (older contributions also [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/)); `bun run ldraw` writes the full credits to `public/ldraw/CREDITS.txt`, and the app links to them. LDraw™ is a trademark of the Estate of James Jessiman.

Rebrickable's and BrickLink's colour numbers are matched to LDraw's with [Rebrickable](https://rebrickable.com)'s colour cross-references (`src/core/inventory/colourNumbers.ts`, written by `scripts/colourNumbers.ts`). Opened models' colours are matched with LDraw's colour table, LDConfig.ldr (`src/core/io/ldrawImport/colourTable.ts`, written by `scripts/ldrawColours.ts`).

The desktop app is built with [Electron](https://www.electronjs.org) and [electron-builder](https://www.electron.build) (both MIT).

Studio files are read with [zip.js](https://gildas-lormeau.github.io/zip.js/) (BSD-3-Clause). BrickLink Studio is BrickLink's; BrickBench reads the LDraw model it saves, as the [LDraw wiki](https://wiki.ldraw.org/wiki/Studio) describes.

LEGO® is a trademark of the LEGO Group, which does not sponsor, authorise or endorse this project.
