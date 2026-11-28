/**
 * How an agent in a terminal starts BrickBench as its MCP server: the app's
 * own executable runs the server script (mcp.cjs) as plain Node, with
 * ELECTRON_RUN_AS_NODE=1, so no window, Dock icon or second copy of the app
 * starts, as VS Code's `code` command runs. The Agent panel shows it as a
 * `claude mcp add` command to paste.
 */

/** The variable that has the app's executable run a script as plain Node. */
export const RUN_AS_NODE = 'ELECTRON_RUN_AS_NODE';

export interface McpServerLaunch {
  /** The app's executable: on Linux the AppImage itself when the app runs from one, since its mount moves each time. */
  readonly executable: string;
  /** The server script, in the app's folder for the bridge beside the connection file, where it stays when the app moves. */
  readonly script: string;
}

const PLAIN = /^[\w@%+=:,./-]+$/;
const PLAIN_ON_WINDOWS = /^[\w@%+=:,./\\-]+$/;

/** A word as a shell takes it: as it is when plain, else in double quotes (Windows paths keep their backslashes). */
export function shellWord(word: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') return PLAIN_ON_WINDOWS.test(word) ? word : `"${word}"`;
  return PLAIN.test(word) ? word : `"${word.replace(/(["\\$`])/g, '\\$1')}"`;
}

/** The command that adds BrickBench's MCP server to Claude Code. */
export function claudeAddCommand(launch: McpServerLaunch, platform: NodeJS.Platform): string {
  return `claude mcp add brickbench -e ${RUN_AS_NODE}=1 -- ${shellWord(launch.executable, platform)} ${shellWord(launch.script, platform)}`;
}
