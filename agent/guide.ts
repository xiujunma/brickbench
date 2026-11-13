/** What agents are told about BrickBench: the MCP server's instructions and each tool's description. */
import { GRID_LIMIT, MAX_LAYER } from '../src/core/grid';
import { MAX_BATCH, type ToolName } from '../src/agent/protocol';

export const SERVER_INSTRUCTIONS = `BrickBench is a LEGO-style brick builder open in the user's browser. These tools build in it live: each change shows at once, and the user can undo it.

The grid
- x runs left to right and z from back to front, in studs. y is height, in plates: a brick is 3 plates tall, a plate or tile 1.
- A part's position (x, y, z) is the corner of its footprint with the smallest x and z, at its bottom layer. A part w studs wide (x) and d deep (z) fills x to x+w-1 and z to z+d-1 at rotation 0; rotation 1 or 3 (quarter turns) swaps w and d.
- y = 0 stands on the ground or baseplate. To stack, add the height of what is below: on a brick at y 0 the next layer is y 3; on a plate at y 0 it is y 1.
- Whole parts must fit within x and z from -${GRID_LIMIT} to ${GRID_LIMIT - 1} and y from 0 to ${MAX_LAYER - 1}. Parts never overlap: one that would is refused, with the brick in the way.

Building well
- Find parts with find_parts and use the part ids and sizes it returns: "brick-2x4", "plate-1x6", "tile-2x2", "slope45-2x2", or "ldraw:3001" for the LDraw library. Colours take names ("Red", "Dark Bluish Grey", "Trans Clear") or LDraw codes; list_colors has them all.
- Plan the model first, then build from the bottom up, a layer at a time, in few place_bricks calls (up to ${MAX_BATCH} bricks each). Overlap the joints between layers, as real brickwork does, so walls hold together.
- Read each reply: refused bricks come with the reason, and "floating" lists bricks with nothing holding them up.
- Check your work with look, which returns a picture, and fix what is off. get_model lists bricks with their ids for moving, painting or removing them.
- Leave the user's own bricks alone unless they ask you to change them.`;

export const TOOL_DESCRIPTIONS: Readonly<Record<ToolName, string>> = {
  get_model:
    'Describe the model: its name, size, the parts and colours it uses, and its bricks (id, part, color, x, y, z, r), bottom layer first. Give a region to list only the bricks reaching into it; limit caps the list.',
  find_parts:
    'Search parts by everyday words, size or part number: "2x4 brick", "1x2 plate with clip", "window", "3001". Returns part ids with sizes: w along x and d along z in studs, h in plates.',
  list_colors: 'List every colour with its LDraw code and name.',
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
