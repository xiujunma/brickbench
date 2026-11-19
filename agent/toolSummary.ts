/** A few words for the chat on what one of BrickBench's tool calls does, whichever agent made it. */

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** A field as words: only text and numbers, so nothing a model sends can throw or run here. */
const words = (value: unknown): string => (typeof value === 'string' || typeof value === 'number' ? String(value) : '');

/** The call's input as an object, or an empty one when it is anything else. */
function fieldsOf(input: unknown): Readonly<Record<string, unknown>> {
  return typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

/** `tool` is the bare name, such as "place_bricks". */
export function summarizeTool(tool: string, input: unknown): string {
  const value = fieldsOf(input);
  switch (tool) {
    case 'place_bricks':
      return `Placing ${plural(Array.isArray(value['bricks']) ? value['bricks'].length : 0, 'brick', 'bricks')}`;
    case 'find_parts':
      return `Searching parts for “${words(value['query'])}”`;
    case 'paint_bricks':
      return `Painting bricks ${words(value['color'])}`.trim();
    case 'set_model_name':
      return `Naming the model “${words(value['name'])}”`;
    case 'look':
      return typeof value['view'] === 'string' && value['view'] !== 'iso' ? `Looking at the model from the ${value['view']}` : 'Looking at the model';
    case 'undo':
      return typeof value['steps'] === 'number' && value['steps'] > 1 ? `Undoing ${value['steps']} steps` : 'Undoing the last step';
    case 'get_model':
      return 'Reading the model';
    case 'move_bricks':
      return 'Moving bricks';
    case 'remove_bricks':
      return 'Removing bricks';
    case 'clear_model':
      return 'Clearing the model';
    case 'list_colors':
      return 'Reading the colours';
    case 'list_owned_parts':
      return 'Reading your parts';
    default:
      return `Using ${tool}`;
  }
}
