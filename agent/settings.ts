/**
 * The bridge's settings, read from an environment: the terminal's for
 * `bun run agent`, the desktop app's when it runs the bridge itself.
 */

export type Environment = Readonly<Record<string, string | undefined>>;

export const DEFAULT_PORT = 7425;
/** The most one chat request may spend in Claude Code unless the user says otherwise: enough for a big build, not a runaway. */
export const DEFAULT_BUDGET_USD = 5;

/** A setting's value, or undefined when it is unset or blank. */
export function readSetting(env: Environment, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/** BRICKBENCH_AGENT_PORT, or the default. */
export function portOf(env: Environment): number {
  const value = readSetting(env, 'BRICKBENCH_AGENT_PORT');
  if (value === undefined) return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`BRICKBENCH_AGENT_PORT must be a port number, not "${value}".`);
  return port;
}

/** BRICKBENCH_AGENT_BUDGET_USD: Claude Code's cap per request, the default, or undefined for none. */
export function budgetOf(env: Environment): number | undefined {
  const value = readSetting(env, 'BRICKBENCH_AGENT_BUDGET_USD');
  if (value === undefined) return DEFAULT_BUDGET_USD;
  if (value.toLowerCase() === 'none') return undefined;
  const budget = Number(value);
  if (!(budget > 0)) throw new Error(`BRICKBENCH_AGENT_BUDGET_USD must be a positive amount or "none", not "${value}".`);
  return budget;
}
