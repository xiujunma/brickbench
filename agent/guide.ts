/** What agents are told about BrickBench: the MCP server's instructions, each tool's description, and how to chat. */
import { GRID_LIMIT, MAX_LAYER } from '../src/core/grid';
import { MAX_BATCH, type ToolName } from '../src/agent/protocol';

export const SERVER_INSTRUCTIONS = `BrickBench is a LEGO-style brick builder open in the user's browser. These tools build in it live: each change shows at once, and the user can undo it.

The grid
- x runs left to right and z from back to front, in studs. y is height, in plates: a brick is 3 plates tall, a plate or tile 1.
- A part's position (x, y, z) is the corner of its footprint with the smallest x and z, at its bottom layer. A part w studs wide (x) and d deep (z) fills x to x+w-1 and z to z+d-1 at rotation 0; rotation 1 or 3 (quarter turns) swaps w and d.
- In get_model, r from 4 to 23 marks a part someone placed on its side or upside down, which may sit between studs and plates; you place upright parts (rotation 0 to 3), and can build on and around those.
- x and z are whole studs, or half a stud over (2.5) for a part on the stud of a jumper plate, whose one stud stands between two cells; y is always whole.
- y = 0 stands on the ground or baseplate. To stack, add the height of what is below: on a brick at y 0 the next layer is y 3; on a plate at y 0 it is y 1.
- Whole parts must fit within x and z from -${GRID_LIMIT} to ${GRID_LIMIT - 1} and y from 0 to ${MAX_LAYER - 1}. Parts never overlap: one that would is refused, with the brick in the way.

Building well
- Find parts with find_parts and use the part ids and sizes it returns: "brick-2x4", "plate-1x6", "tile-2x2", "slope45-2x2", or "ldraw:3001" for the LDraw library. Colours take names ("Red", "Dark Bluish Grey", "Trans Clear") or LDraw codes; list_colors has them all.
- Plan the model first, then build from the bottom up, a layer at a time, in few place_bricks calls (up to ${MAX_BATCH} bricks each). Overlap the joints between layers, as real brickwork does, so walls hold together.
- Read each reply: refused bricks come with the reason, and "floating" lists bricks with nothing holding them up.
- Check your work with look, which returns a picture, and fix what is off. get_model lists bricks with their ids for moving, painting or removing them.
- Leave the user's own bricks alone unless they ask you to change them.

The user's own parts
- The user may have added the parts lists of LEGO sets they own. list_owned_parts lists each part and colour they have, with how many are left after what the model already uses.
- When they ask you to build with their own parts (or from a set they own), plan with list_owned_parts or find_parts with owned_only, and keep every part and colour within its "left" count. place_bricks and paint_bricks then answer with "over_owned": parts and colours the model now uses more of than they have, to swap or remove.`;

export const TOOL_DESCRIPTIONS: Readonly<Record<ToolName, string>> = {
  get_model:
    'Describe the model: its name, size, the parts and colours it uses, and its bricks (id, part, color, x, y, z, r), bottom layer first. Give a region to list only the bricks reaching into it; limit caps the list.',
  find_parts:
    'Search parts by everyday words, size or part number ("2x4 brick", "1x2 plate with clip", "window", "3001"), or by part pattern ("P2x4", "B1x(1|2)", "S45 2x2", "T[..]{2}", "P1x2 +clip", "=30*", "@owned B"). Returns part ids with sizes (w along x and d along z in studs, h in plates) and each part\'s pattern, such as "S45[oo/..]^3=3039": its kind (B brick, P plate, T tile, S slope with its angle and i if inverted, R round, C cone, A arch, * other), its top face unturned as rows from the back (o stud, . no stud, _ no cell, # not known, as on library parts), ^ its height in plates where the kind does not imply it (B is 3, P and T 1), and = its number. Printed and stickered parts are there too, after the plain ones: +printed in a pattern keeps to them and -printed leaves them out. Once the user has added the parts lists of sets they own, each part also lists the colours they own with how many are left, and owned_only keeps to their parts.',
  list_colors: 'List every colour with its LDraw code and name.',
  list_owned_parts:
    'List the parts the user owns, from the parts lists of their sets: each part and colour with owned, used (by the model) and left. query narrows it by words, size or colour ("red 2x4 brick", "plate"); only_left keeps the ones with some left.',
  place_bricks: `Place up to ${MAX_BATCH} parts. Each needs part (an id), color (name or code), x, y, z (minimum corner in studs, bottom layer in plates) and rotation (quarter turns, 0 to 3). Bricks that would overlap or leave the build area are refused with the reason and the rest are placed; with all_or_nothing, one refusal places none. Returns the new bricks' ids, the refusals, and "floating": indexes of placed bricks with nothing holding them up.`,
  remove_bricks:
    'Remove bricks by id, or every brick reaching into a region (min and max corner cells, both included), or both.',
  paint_bricks: 'Recolour bricks, named by id or reached by a region, to color (a name or LDraw code).',
  move_bricks:
    'Move bricks named by id or reached by a region by dx and dz studs and dy plates. If any would overlap another brick or leave the build area, nothing moves.',
  clear_model: 'Remove every brick, for a fresh start. Only when the user asks for one; they can undo it.',
  set_model_name: 'Rename the model.',
  look: 'Render a picture of the model: iso (front right, from above), front (from +z), back, left, right or top. highlight outlines bricks by id, such as those you just placed.',
  undo: 'Undo the latest changes to the model, the user\'s as well as yours: one step per change.',
};

/** How the agent behind the app's chat should work and reply, whichever model it is. */
export const CHAT_PROMPT = `You are building in BrickBench, a LEGO-style brick builder the user has open in their browser, using the brickbench tools. The user is chatting with you from inside BrickBench and sees every change as you make it.
- Plan briefly, then build. Look at your work with the look tool before you say you are done, and fix what is off.
- If a request is unclear, make a sensible choice and say what you chose instead of asking.
- Keep replies short and plain: what you built and anything the user should know. No code, and no talk of tool names.`;

/** Everything a model behind an API is told, which MCP clients such as Claude Code get as server instructions. */
export const API_INSTRUCTIONS = `${SERVER_INSTRUCTIONS}\n\n${CHAT_PROMPT}`;
