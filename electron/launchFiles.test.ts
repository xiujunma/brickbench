import { describe, expect, it } from 'bun:test';
import { filesToOpen } from './launchFiles';

describe('filesToOpen', () => {
  it('picks the model files from a command line, made absolute', () => {
    const argv = ['/Applications/BrickBench.app/Contents/MacOS/BrickBench', '--inspect', '.desktop', 'models/car.ldr', '/tmp/whale.io', 'notes.txt', 'house.brickbench.json'];
    expect(filesToOpen(argv, '/home/me')).toEqual(['/home/me/models/car.ldr', '/tmp/whale.io', '/home/me/house.brickbench.json']);
  });

  it('finds nothing in an ordinary start', () => {
    expect(filesToOpen(['/usr/bin/brickbench'], '/')).toEqual([]);
    expect(filesToOpen(['electron', '.desktop', '--no-sandbox=false.ldr'], '/')).toEqual([]);
  });
});
