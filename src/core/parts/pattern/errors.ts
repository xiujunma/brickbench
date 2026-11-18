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
