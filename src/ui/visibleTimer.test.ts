import { describe, expect, it } from 'bun:test';
import { afterVisibleTime, MAX_FRAME_MS, type FrameClock } from './visibleTimer';

/** A frame clock driven by hand: each `frame(ms)` moves time on and runs the waiting callback. */
function handClock() {
  let time = 0;
  let waiting: ((now: number) => void) | null = null;
  const clock: FrameClock = {
    now: () => time,
    request: (callback) => {
      waiting = callback;
      return 1;
    },
    cancel: () => {
      waiting = null;
    },
  };
  const frame = (ms: number): void => {
    time += ms;
    const callback = waiting;
    waiting = null;
    callback?.(time);
  };
  return { clock, frame };
}

describe('time on screen', () => {
  it('counts frames, not the clock, so a frozen page does not use the time up', () => {
    const { clock, frame } = handClock();
    let done = 0;
    afterVisibleTime(1000, () => void (done += 1), clock);
    // software WebGL starting up froze the page for 20 s: that is one frame
    frame(20_000);
    expect(done).toBe(0);
    for (let shown = MAX_FRAME_MS; shown + 16 < 1000; shown += 16) frame(16);
    expect(done).toBe(0);
    frame(16);
    expect(done).toBe(1);
    // finished: no more frames asked for
    frame(16);
    expect(done).toBe(1);
  });

  it('stops when cancelled', () => {
    const { clock, frame } = handClock();
    let done = false;
    const cancel = afterVisibleTime(50, () => void (done = true), clock);
    cancel();
    frame(16);
    frame(100);
    expect(done).toBe(false);
  });

  it('ignores a clock that runs backwards', () => {
    const { clock, frame } = handClock();
    let done = false;
    afterVisibleTime(30, () => void (done = true), clock);
    frame(-500);
    expect(done).toBe(false);
    frame(16);
    frame(16);
    expect(done).toBe(true);
  });
});
