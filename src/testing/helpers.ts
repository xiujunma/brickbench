/**
 * Small test helpers for things bun:test leaves to the user. Test-only:
 * nothing in the app imports this folder.
 */

interface Stubbed {
  readonly name: string;
  readonly existed: boolean;
  readonly value: unknown;
}

const globals = globalThis as Record<string, unknown>;
const stubbed: Stubbed[] = [];

/** Replaces a global (say `window`) until unstubAllGlobals() puts it back. */
export function stubGlobal(name: string, value: unknown): void {
  stubbed.push({ name, existed: Object.prototype.hasOwnProperty.call(globals, name), value: globals[name] });
  globals[name] = value;
}

/** Restores every global stubbed since the last call, newest first. */
export function unstubAllGlobals(): void {
  for (let entry = stubbed.pop(); entry; entry = stubbed.pop()) {
    if (entry.existed) globals[entry.name] = entry.value;
    else delete globals[entry.name];
  }
}

/** Retries an assertion until it passes, failing with its last error after `timeoutMs`. */
export async function waitFor(assertion: () => void, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      assertion();
      return;
    } catch (error: unknown) {
      if (Date.now() > deadline) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
