/** Who is signed in, signing out, and an account's name and deletion. */
import { accountChangeSchema, type Session, type User } from '../src/core/cloud/protocol';
import { isAdmin, signedIn, type Context } from './context';
import { json, noContent, readJson } from './http';
import { LIMITS, spend } from './limits';
import { endedSessionCookie, endSession, type Account } from './sessions';
import { availableProviders } from './signIn';

const SMALL_BODY = 4_096;

function userOf(context: Context, account: Account, name = account.name): User {
  return { id: account.id, name, admin: isAdmin(context.env, account), banned: account.banned };
}

/** GET /api/session — who is signed in, and the ways in. */
export async function session(context: Context): Promise<Response> {
  const account = await context.account();
  const body: Session = {
    user: account ? userOf(context, account) : null,
    providers: availableProviders(context.env, context.request),
  };
  return json(body);
}

/** POST /api/auth/sign-out */
export async function signOut(context: Context): Promise<Response> {
  await endSession(context.db, context.request);
  return noContent({ 'Set-Cookie': endedSessionCookie(context.request) });
}

/** PATCH /api/account — the name the gallery shows. */
export async function renameAccount(context: Context): Promise<Response> {
  const account = await signedIn(context);
  await spend(context.db, LIMITS.account, account.id, context.now);
  const { name } = await readJson(context.request, accountChangeSchema, SMALL_BODY);
  await context.db.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, account.id).run();
  return json({ user: userOf(context, account, name) });
}

/** What a stopped account is called once it has deleted itself. */
export const DELETED_NAME = 'Deleted account';

/**
 * DELETE /api/account — the account, its models, its reports and its
 * sessions, everywhere. An account a moderator has stopped keeps only its
 * provider's account number, under no name, so signing in again does not
 * start it afresh.
 */
export async function deleteAccount(context: Context): Promise<Response> {
  const account = await signedIn(context);
  const { db } = context;
  if (account.banned) {
    await db.batch([
      db.prepare('DELETE FROM models WHERE owner_id = ?').bind(account.id),
      db.prepare('DELETE FROM reports WHERE reporter_id = ?').bind(account.id),
      db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(account.id),
      db.prepare('UPDATE users SET name = ? WHERE id = ?').bind(DELETED_NAME, account.id),
    ]);
  } else {
    await db.prepare('DELETE FROM users WHERE id = ?').bind(account.id).run();
  }
  return noContent({ 'Set-Cookie': endedSessionCookie(context.request) });
}
