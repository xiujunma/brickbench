/** Part patterns: a regex-like language for describing parts, defined in docs/part-patterns.md. */
export type { Dim, Footprint, Height, Kind, PartPattern, PartTerm, PatternNode, Source } from './ast';
export { DEFAULT_PLATES, KIND_NAMES } from './ast';
export { describeGrid, describeSubject, type DescribeOptions } from './describe';
export { PatternTooCostlyError, TOO_COSTLY_MESSAGE, WorkBudget, type PatternError } from './errors';
export { matchesPattern, type MatchContext } from './match';
export { MAX_PATTERN_LENGTH, parsePattern, type ParseResult } from './parse';
export { patternColour, readQuery, type QueryReading } from './query';
export { subjectOf, type Subject } from './subject';
