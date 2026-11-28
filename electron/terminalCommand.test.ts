import { describe, expect, it } from 'bun:test';
import { claudeAddCommand, shellWord } from './terminalCommand';

describe('the command that adds BrickBench to Claude Code', () => {
  it('runs the server script with the app’s own executable, as plain Node', () => {
    expect(
      claudeAddCommand(
        { executable: '/Applications/BrickBench.app/Contents/MacOS/BrickBench', script: '/Users/ann/Library/Application Support/BrickBench/agent/mcp.cjs' },
        'darwin',
      ),
    ).toBe(
      'claude mcp add brickbench -e ELECTRON_RUN_AS_NODE=1 -- /Applications/BrickBench.app/Contents/MacOS/BrickBench "/Users/ann/Library/Application Support/BrickBench/agent/mcp.cjs"',
    );
  });

  it('quotes words a shell would split or read into', () => {
    expect(shellWord('/home/ann/My Apps/BrickBench.AppImage', 'linux')).toBe('"/home/ann/My Apps/BrickBench.AppImage"');
    expect(shellWord('/tmp/$HOME`x`"q"\\', 'darwin')).toBe('"/tmp/\\$HOME\\`x\\`\\"q\\"\\\\"');
    expect(shellWord('C:\\Users\\Ann Lee\\AppData\\Roaming\\BrickBench\\agent\\mcp.cjs', 'win32')).toBe('"C:\\Users\\Ann Lee\\AppData\\Roaming\\BrickBench\\agent\\mcp.cjs"');
    expect(shellWord('C:\\Programs\\BrickBench.exe', 'win32')).toBe('C:\\Programs\\BrickBench.exe');
  });
});
