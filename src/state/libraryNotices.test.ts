import { describe, expect, it } from 'bun:test';
import { getPart } from '../core/parts/catalog';
import { FAILURE_QUIET_MS, retryWhenOnline, watchLibraryFailures } from './libraryNotices';
import { createEditorStore } from './store';

describe('library failure notices', () => {
  it('tells the user once per burst of failures', () => {
    const store = createEditorStore({ lookup: getPart, nextId: () => 'x' });
    let fail: (partId: string, message: string) => void = () => undefined;
    let time = 0;
    const stop = watchLibraryFailures(store, { onFailure: (listener) => ((fail = listener), () => undefined) }, () => time);

    fail('ldraw:3001', 'HTTP 404');
    fail('ldraw:3002', 'HTTP 404');
    expect(store.getState().toasts.map((t) => t.message)).toEqual(['LDraw part 3001 could not be loaded, so it is shown as a plain box.']);
    time += FAILURE_QUIET_MS;
    fail('ldraw:3003', 'HTTP 404');
    expect(store.getState().toasts).toHaveLength(2);
    stop();
  });

  it('tries failed parts again when the connection comes back', () => {
    const target = new EventTarget();
    let retried = 0;
    const stop = retryWhenOnline({ retryFailed: () => void (retried += 1) }, target as unknown as Window);
    target.dispatchEvent(new Event('online'));
    expect(retried).toBe(1);
    stop();
    target.dispatchEvent(new Event('online'));
    expect(retried).toBe(1);
  });
});
