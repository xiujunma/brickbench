/**
 * BrickBench's MCP server for agents in a terminal, bundled as mcp.cjs: the
 * app's own executable runs it as plain Node (ELECTRON_RUN_AS_NODE=1), see
 * terminalCommand.ts. The app keeps a copy in its folder for the bridge,
 * beside the connection file, so the server finds that file next to itself
 * and stays where the agent's settings point when the app moves (an
 * AppImage's mount does, every time it opens).
 */
import { dirname, join } from 'node:path';
import { CONNECTION_FILE } from '../agent/access';
import { serveStdio } from '../agent/mcpStdio';

// this script's own path, as Node resolves it (Bun would bake __dirname in at build time)
const here = dirname(process.argv[1] ?? '.');
serveStdio({ connectionFile: join(here, CONNECTION_FILE) }).then(
  // once the last answers have left: on macOS, writes to a pipe finish later
  () => void process.stdout.write('', () => process.exit(0)),
  (error: unknown) => {
    process.stderr.write(`BrickBench's MCP server stopped: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
