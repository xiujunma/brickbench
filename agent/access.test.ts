import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bearer, CONNECTION_FILE, createAccess, newToken, readConnection } from './access';

const URL = 'http://127.0.0.1:7425';
const showing = (token: string | null): Request => new Request(`${URL}/mcp`, token === null ? {} : { headers: { authorization: `Bearer ${token}` } });

let folder = '';
afterEach(async () => {
  if (folder) await rm(folder, { recursive: true, force: true });
  folder = '';
});

async function freshFolder(): Promise<string> {
  folder = await mkdtemp(join(tmpdir(), 'brickbench-access-'));
  return join(folder, 'agent');
}

describe('access to the bridge', () => {
  it('lets in the chat’s own agent by its token, and nobody else, until the user lets agents in a terminal in', async () => {
    const dir = await freshFolder();
    const access = await createAccess({ folder: dir, url: URL });
    expect(access.terminalOpen).toBe(false);
    expect(await readConnection(join(dir, CONNECTION_FILE))).toBeNull();
    expect(access.allows(showing(access.chatToken))).toBe(true);
    expect(access.allows(showing(newToken()))).toBe(false);
    expect(access.allows(showing(null))).toBe(false);
    expect(access.allows(new Request(URL, { headers: { authorization: `Basic ${access.chatToken}` } }))).toBe(false);
  });

  it('writes a token only the user can read while agents in a terminal are let in, a fresh one each time', async () => {
    const dir = await freshFolder();
    const access = await createAccess({ folder: dir, url: URL });
    await access.setTerminal(true);
    const file = join(dir, CONNECTION_FILE);
    const first = await readConnection(file);
    expect(first?.url).toBe(URL);
    expect(first?.token).not.toBe(access.chatToken);
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(access.terminalOpen).toBe(true);
    expect(access.allows(showing(first?.token ?? null))).toBe(true);

    await access.setTerminal(true);
    const second = await readConnection(file);
    expect(second?.token).not.toBe(first?.token);
    expect(access.allows(showing(first?.token ?? null))).toBe(false);
    expect(access.allows(showing(second?.token ?? null))).toBe(true);

    await access.setTerminal(false);
    expect(await readConnection(file)).toBeNull();
    expect(access.allows(showing(second?.token ?? null))).toBe(false);
    expect(access.allows(showing(access.chatToken))).toBe(true);
  });

  it('remembers the setting for the next bridge, with new tokens, and lets agents out when it stops', async () => {
    const dir = await freshFolder();
    const before = await createAccess({ folder: dir, url: URL });
    await before.setTerminal(true);
    const old = await readConnection(join(dir, CONNECTION_FILE));
    await before.close();
    expect(await readConnection(join(dir, CONNECTION_FILE))).toBeNull();
    expect(before.terminalOpen).toBe(false);

    const after = await createAccess({ folder: dir, url: 'http://127.0.0.1:7500' });
    const now = await readConnection(join(dir, CONNECTION_FILE));
    expect(after.terminalOpen).toBe(true);
    expect(now?.url).toBe('http://127.0.0.1:7500');
    expect(now?.token).not.toBe(old?.token);
    expect(after.chatToken).not.toBe(before.chatToken);
  });

  it('clears a connection file a bridge left behind, and reads only a well-formed one', async () => {
    const dir = await freshFolder();
    const first = await createAccess({ folder: dir, url: URL });
    const file = join(dir, CONNECTION_FILE);
    await writeFile(file, JSON.stringify({ url: URL, token: newToken() }));
    expect(await readConnection(file)).not.toBeNull();
    await createAccess({ folder: dir, url: URL });
    expect(await readConnection(file)).toBeNull();
    expect(first.terminalOpen).toBe(false);

    for (const junk of ['not json', '{}', JSON.stringify({ url: 'http://evil.example', token: newToken() }), JSON.stringify({ url: URL, token: 'short' })]) {
      await writeFile(file, junk);
      expect(await readConnection(file)).toBeNull();
    }
    // a setting that is not one is as if never set
    await writeFile(join(dir, 'settings.json'), '{"terminal":"yes"}');
    expect((await createAccess({ folder: dir, url: URL })).terminalOpen).toBe(false);
    expect(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))).toEqual({ terminal: 'yes' });
  });

  it('takes quick changes one after another, ending as asked last', async () => {
    const dir = await freshFolder();
    const access = await createAccess({ folder: dir, url: URL });
    const file = join(dir, CONNECTION_FILE);
    await Promise.all([access.setTerminal(true), access.setTerminal(false), access.setTerminal(true)]);
    expect(access.terminalOpen).toBe(true);
    expect(access.allows(showing((await readConnection(file))?.token ?? null))).toBe(true);
    await Promise.all([access.setTerminal(true), access.setTerminal(false)]);
    expect(access.terminalOpen).toBe(false);
    expect(await readConnection(file)).toBeNull();
  });

  it('lets agents out even when the setting cannot be kept, and lets nobody in then', async () => {
    const dir = await freshFolder();
    const access = await createAccess({ folder: dir, url: URL });
    await access.setTerminal(true);
    const token = (await readConnection(join(dir, CONNECTION_FILE)))?.token ?? null;
    // a folder where the setting goes: it cannot be written
    await rm(join(dir, 'settings.json'), { force: true });
    await mkdir(join(dir, 'settings.json'));
    await expect(access.setTerminal(false)).rejects.toThrow();
    expect(access.terminalOpen).toBe(false);
    expect(access.allows(showing(token))).toBe(false);
    expect(await readConnection(join(dir, CONNECTION_FILE))).toBeNull();
    await expect(access.setTerminal(true)).rejects.toThrow();
    expect(access.terminalOpen).toBe(false);
  });

  it('reads the token a request shows', () => {
    const token = newToken();
    expect(bearer(showing(token))).toBe(token);
    expect(bearer(showing('short'))).toBeNull();
    expect(bearer(new Request(URL, { headers: { authorization: `Bearer ${token} extra` } }))).toBeNull();
    expect(bearer(showing(null))).toBeNull();
  });
});
