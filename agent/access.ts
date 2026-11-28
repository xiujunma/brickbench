/**
 * Who may use the agent bridge's tools. The chat's own agent shows a token
 * the app hands it; agents in a terminal show a token from a file only the
 * user can read, which exists only while the user lets them in. Each token
 * lasts as long as the bridge. Web pages get neither: the bridge refuses
 * them before it looks for a token.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

/** Where agents in a terminal find the bridge, and the token that lets them in: the connection file. */
export interface Connection {
  /** Such as http://127.0.0.1:7425. */
  readonly url: string;
  readonly token: string;
}

/** In the app's folder for the bridge: the connection file, and whether the user lets agents in a terminal in. */
export const CONNECTION_FILE = 'connection.json';
const SETTINGS_FILE = 'settings.json';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const connectionSchema = z.object({ url: z.string().regex(/^http:\/\/127\.0\.0\.1:\d{1,5}$/), token: z.string().regex(TOKEN_PATTERN) });
const settingsSchema = z.object({ terminal: z.boolean() });

/** A fresh token: 32 random bytes, URL-safe. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The token a request carries, as `Authorization: Bearer <token>`; null for none or a malformed one. */
export function bearer(request: Request): string | null {
  const match = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '');
  const token = match?.[1];
  return token !== undefined && TOKEN_PATTERN.test(token) ? token : null;
}

/** Whether `given` is `expected`, taking as long however much of it matches. */
function same(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Reads a JSON file against a schema; null when it is missing or is not that. */
async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  try {
    const parsed = schema.safeParse(JSON.parse(await readFile(path, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    // missing or not JSON: as if never written
    return null;
  }
}

/** Writes a file only its owner can read, replacing one that may have been readable by others. */
async function writePrivate(path: string, text: string): Promise<void> {
  await rm(path, { force: true });
  await writeFile(path, text, { mode: 0o600, flag: 'wx' });
}

/** The connection file's contents, or null when there is none or it is not one: agents in a terminal are not let in. */
export function readConnection(path: string): Promise<Connection | null> {
  return readJson(path, connectionSchema);
}

export interface Access {
  /** The token the chat's own agent shows. */
  readonly chatToken: string;
  /** Whether agents in a terminal are let in now. */
  readonly terminalOpen: boolean;
  /** Whether the request shows a token that is let in now. */
  allows(request: Request): boolean;
  /**
   * Lets agents in a terminal in, with a fresh token in the connection file,
   * or out, removing it; remembered for the next time the bridge starts.
   */
  setTerminal(open: boolean): Promise<void>;
  /** Lets agents in a terminal out, as the bridge stops; the setting stays as it was. */
  close(): Promise<void>;
}

export interface AccessOptions {
  /** The app's folder for the bridge, made if need be, for the connection file and the setting. */
  readonly folder: string;
  /** The bridge's address, such as http://127.0.0.1:7425, for agents in a terminal to find. */
  readonly url: string;
}

/** Sets up access to a bridge that has just started: agents in a terminal are let in again if the user left them so. */
export async function createAccess(options: AccessOptions): Promise<Access> {
  const { folder, url } = options;
  const connectionFile = join(folder, CONNECTION_FILE);
  const settingsFile = join(folder, SETTINGS_FILE);
  const chatToken = newToken();
  let terminalToken: string | null = null;
  /** Changes, one after another, so the file always says what was asked last. */
  let queue: Promise<void> = Promise.resolve();

  const inTurn = (step: () => Promise<void>): Promise<void> => {
    const turn = queue.then(step);
    queue = turn.catch(() => undefined);
    return turn;
  };
  const letIn = async (): Promise<void> => {
    const token = newToken();
    const connection: Connection = { url, token };
    await writePrivate(connectionFile, JSON.stringify(connection));
    terminalToken = token;
  };
  const letOut = async (): Promise<void> => {
    terminalToken = null;
    await rm(connectionFile, { force: true });
  };

  await mkdir(folder, { recursive: true, mode: 0o700 });
  // a file left by a bridge that did not stop cleanly names a token nobody holds any more
  await letOut();
  if ((await readJson(settingsFile, settingsSchema))?.terminal === true) await letIn();

  return {
    chatToken,
    get terminalOpen() {
      return terminalToken !== null;
    },
    allows(request) {
      const token = bearer(request);
      if (token === null) return false;
      return same(token, chatToken) || (terminalToken !== null && same(token, terminalToken));
    },
    setTerminal: (open) =>
      inTurn(async () => {
        const remember = (): Promise<void> => writePrivate(settingsFile, JSON.stringify({ terminal: open }));
        if (open) {
          // remembered first: if that fails, nobody was let in
          await remember();
          await letIn();
        } else {
          // out first: if remembering fails, they are out all the same
          await letOut();
          await remember();
        }
      }),
    close: () => inTurn(letOut),
  };
}
