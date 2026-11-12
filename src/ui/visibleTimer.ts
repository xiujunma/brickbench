/** The most one frame may count, so time the page spent frozen or hidden is not taken as time seen. */
export const MAX_FRAME_MS = 100;

/** What the timer needs from the browser, so tests can drive it by hand. */
export interface FrameClock {
  readonly now: () => number;
  readonly request: (callback: (now: number) => void) => number;
  readonly cancel: (handle: number) => void;
}

const browserClock: FrameClock = {
  now: () => performance.now(),
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (handle) => window.cancelAnimationFrame(handle),
};

/**
 * Calls `onDone` once the page has been on screen and responsive for `ms`,
 * and returns a function that cancels it. Unlike setTimeout, a stretch where
 * the page was frozen (software WebGL starting up, say) or hidden in a
 * background tab counts as one short frame at most, so a message is never
 * gone before it could be read.
 */
export function afterVisibleTime(ms: number, onDone: () => void, clock: FrameClock = browserClock): () => void {
  let shown = 0;
  let last = clock.now();
  let handle = 0;
  const tick = (now: number): void => {
    // a frame's time can start before the moment it was asked for: never count backwards
    shown += Math.min(Math.max(now - last, 0), MAX_FRAME_MS);
    last = now;
    if (shown >= ms) onDone();
    else handle = clock.request(tick);
  };
  handle = clock.request(tick);
  return () => clock.cancel(handle);
}
