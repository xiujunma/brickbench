import { PatternSyntaxError } from './errors';

/** A place in a pattern's text, moved along as the parser reads it. */
export class Cursor {
  i = 0;

  constructor(readonly text: string) {}

  peek(offset = 0): string | undefined {
    return this.text[this.i + offset];
  }

  rest(): string {
    return this.text.slice(this.i);
  }

  get done(): boolean {
    return this.i >= this.text.length;
  }

  fail(message: string, at = this.i): never {
    throw new PatternSyntaxError(message, at);
  }

  skipSpaces(): void {
    while (/\s/.test(this.text[this.i] ?? '')) this.i += 1;
  }

  /** Reads what `pattern`, which must start with ^, matches here; null when it does not. */
  read(pattern: RegExp): string | null {
    const found = pattern.exec(this.rest())?.[0];
    if (found === undefined) return null;
    this.i += found.length;
    return found;
  }
}
