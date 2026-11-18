/** A pattern that does not read, and where in it the trouble starts. */
export class PatternSyntaxError extends Error {
  constructor(
    message: string,
    /** Where in the pattern, counting from 0. */
    readonly at: number,
  ) {
    super(message);
    this.name = 'PatternSyntaxError';
  }
}

export interface PatternError {
  readonly message: string;
  /** Where in the pattern, counting from 0. */
  readonly at: number;
}

export const TOO_COSTLY_MESSAGE = 'This pattern asks too much of a search: use smaller counts, or fewer *, + and | before them';

/** A search ran out of the work it may do, so a pattern cannot stall it. */
export class PatternTooCostlyError extends Error {
  constructor() {
    super(TOO_COSTLY_MESSAGE);
    this.name = 'PatternTooCostlyError';
  }
}

/**
 * The work one search may still do, counted in grid positions looked at.
 * Mutable on purpose: every part a search matches draws on the one budget.
 */
export class WorkBudget {
  private used = 0;

  constructor(readonly limit: number) {}

  get spent(): number {
    return this.used;
  }

  /** Takes `steps`, throwing PatternTooCostlyError once the limit is passed. */
  spend(steps: number): void {
    this.used += steps;
    if (this.used > this.limit) throw new PatternTooCostlyError();
  }
}
