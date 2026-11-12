import { describe, expect, it } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { partLibrary, useLibrary } from './library';

function Status() {
  return createElement('output', null, useLibrary((s) => `${s.status}:${s.entries.length}`));
}

describe('useLibrary', () => {
  it('reads the shared library state into components', () => {
    // a server render sees the store's initial state: nothing loaded yet
    expect(renderToString(createElement(Status))).toBe('<output>idle:0</output>');
    expect(partLibrary.store.getInitialState().status).toBe('idle');
  });
});
