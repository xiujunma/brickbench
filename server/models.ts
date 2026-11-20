/**
 * Models kept online. Each is private to its owner until they publish it to
 * the gallery; a published model's latest save is what the gallery shows.
 * A save names the revision it follows on from, so a copy saved elsewhere
 * in the meantime is never overwritten unseen.
 */
import {
  MAX_ACCOUNT_BYTES,
  MAX_MODEL_DATA,
  MAX_MODELS_PER_ACCOUNT,
  MAX_THUMBNAIL,
  modelChangeSchema,
  saveRequestSchema,
  type ModelInfo,
} from '../src/core/cloud/protocol';
import { activeAccount, isAdmin, signedIn, type Context } from './context';
import { bytes, HttpError, json, noContent, readJson } from './http';
import { fromBase64Url, newId } from './ids';
import { LIMITS, spend } from './limits';

/** A save's body: the model, its thumbnail and a little JSON around them. */
const MAX_SAVE_BODY = MAX_MODEL_DATA + MAX_THUMBNAIL + 8_192;
const MAX_CHANGE_BODY = 1_024;

/**
 * What lists and pages show of a model. The thumbnail's type, not its
 * content, says whether there is one, and the file is never read here.
 */
export const INFO_COLUMNS = `m.id, m.name, m.bricks, m.revision, m.size, m.created_at, m.updated_at, m.published_at, m.hidden,
  typeof(m.thumbnail) = 'text' AS has_thumbnail, u.id AS owner_id, u.name AS owner_name, u.banned AS owner_banned`;
export const FROM_MODELS = 'FROM models m JOIN users u ON u.id = m.owner_id';

export interface InfoRow {
  readonly id: string;
  readonly name: string;
  readonly bricks: number;
  readonly revision: number;
  readonly size: number;
  readonly created_at: number;
  readonly updated_at: number;
  readonly published_at: number | null;
  readonly hidden: number;
  readonly has_thumbnail: number;
  readonly owner_id: string;
  readonly owner_name: string;
  readonly owner_banned: number;
}

export function infoOf(row: InfoRow): ModelInfo {
  return {
    id: row.id,
    name: row.name,
    bricks: row.bricks,
    revision: row.revision,
    size: row.size,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    hidden: row.hidden === 1,
    hasThumbnail: row.has_thumbnail === 1,
    owner: { id: row.owner_id, name: row.owner_name },
  };
}

/** In the gallery for everyone: published, not hidden by a moderator, and from an account still in good standing. */
export function isPublic(row: Pick<InfoRow, 'published_at' | 'hidden' | 'owner_banned'>): boolean {
  return row.published_at !== null && row.hidden === 0 && row.owner_banned === 0;
}

async function infoRow(context: Context, id: string): Promise<InfoRow | null> {
  return context.db.prepare(`SELECT ${INFO_COLUMNS} ${FROM_MODELS} WHERE m.id = ?`).bind(id).first<InfoRow>();
}

/** Whether the visitor may see a model: anyone, once it is public; its owner and moderators always. */
async function canSee(context: Context, row: Pick<InfoRow, 'published_at' | 'hidden' | 'owner_banned' | 'owner_id'>): Promise<boolean> {
  if (isPublic(row)) return true;
  const account = await context.account();
  return account !== null && (account.id === row.owner_id || isAdmin(context.env, account));
}

const NOT_FOUND = 'That model is not online, or is not yours to see.';
const NO_ROOM = `Your models online take up all the room an account has (${MAX_ACCOUNT_BYTES / 1_000_000} MB). Delete some to make room.`;
const TOO_MANY = `You have ${MAX_MODELS_PER_ACCOUNT} models online, as many as an account keeps. Delete some to make room.`;

/** What a save takes up: its file and its picture, base64url, a byte a character. */
function sizeOf(save: { readonly data: string; readonly thumbnail: string | null }): number {
  return save.data.length + (save.thumbnail?.length ?? 0);
}

/** How many models an account has online. */
async function modelCount(context: Context, ownerId: string): Promise<number> {
  const row = await context.db.prepare('SELECT COUNT(*) AS count FROM models WHERE owner_id = ?').bind(ownerId).first<{ count: number }>();
  return row?.count ?? 0;
}

/** A thumbnail must be a JPEG, as the site makes them: nothing else is served from it. */
function checkThumbnail(thumbnail: string | null): void {
  if (thumbnail === null) return;
  const jpeg = fromBase64Url(thumbnail);
  const ok = jpeg !== null && jpeg.length > 4 && jpeg[0] === 0xff && jpeg[1] === 0xd8 && jpeg[2] === 0xff && jpeg.at(-2) === 0xff && jpeg.at(-1) === 0xd9;
  if (!ok) throw new HttpError(400, 'That thumbnail is not a JPEG picture.');
}

/** GET /api/models — the signed-in account's models, the latest saved first. */
export async function listModels(context: Context): Promise<Response> {
  const account = await signedIn(context);
  const { results } = await context.db
    .prepare(`SELECT ${INFO_COLUMNS} ${FROM_MODELS} WHERE m.owner_id = ? ORDER BY m.updated_at DESC LIMIT ?`)
    .bind(account.id, MAX_MODELS_PER_ACCOUNT)
    .all<InfoRow>();
  return json({ models: results.map(infoOf) });
}

/** POST /api/models — keeps a model online, as a new one. */
export async function createModel(context: Context): Promise<Response> {
  const account = await activeAccount(context);
  await spend(context.db, LIMITS.save, account.id, context.now);
  const save = await readJson(context.request, saveRequestSchema, MAX_SAVE_BODY);
  checkThumbnail(save.thumbnail);
  const id = newId();
  const size = sizeOf(save);
  // counted and added in one statement, so two saves at once cannot pass the limits together
  const { meta } = await context.db
    .prepare(
      `INSERT INTO models (id, owner_id, name, bricks, revision, size, created_at, updated_at, published_at, hidden, thumbnail, data)
       SELECT ?, ?, ?, ?, 1, ?, ?, ?, NULL, 0, ?, ?
       WHERE (SELECT COUNT(*) FROM models WHERE owner_id = ?) < ? AND (SELECT COALESCE(SUM(size), 0) FROM models WHERE owner_id = ?) + ? <= ?`,
    )
    .bind(id, account.id, save.name, save.bricks, size, context.now, context.now, save.thumbnail, save.data, account.id, MAX_MODELS_PER_ACCOUNT, account.id, size, MAX_ACCOUNT_BYTES)
    .run();
  if (meta.changes === 0) {
    throw new HttpError(409, (await modelCount(context, account.id)) >= MAX_MODELS_PER_ACCOUNT ? TOO_MANY : NO_ROOM);
  }
  const model: ModelInfo = {
    id,
    name: save.name,
    bricks: save.bricks,
    revision: 1,
    size,
    createdAt: context.now,
    updatedAt: context.now,
    publishedAt: null,
    hidden: false,
    hasThumbnail: save.thumbnail !== null,
    owner: { id: account.id, name: account.name },
  };
  return json({ model }, 201);
}

/** PUT /api/models/:id — saves over a model, if no other save came in since the revision this one follows on from. */
export async function updateModel(context: Context, id: string): Promise<Response> {
  const account = await activeAccount(context);
  await spend(context.db, LIMITS.save, account.id, context.now);
  const save = await readJson(context.request, saveRequestSchema, MAX_SAVE_BODY);
  if (save.revision === undefined) throw new HttpError(400, 'A save over a model must say which revision it follows on from.');
  checkThumbnail(save.thumbnail);
  const size = sizeOf(save);
  // only over the revision it follows on from, and only while the account's models still fit
  const { meta } = await context.db
    .prepare(
      `UPDATE models SET name = ?, bricks = ?, size = ?, thumbnail = ?, data = ?, revision = revision + 1, updated_at = ?
       WHERE id = ? AND owner_id = ? AND revision = ?
         AND (SELECT COALESCE(SUM(size), 0) FROM models WHERE owner_id = ? AND id <> ?) + ? <= ?`,
    )
    .bind(save.name, save.bricks, size, save.thumbnail, save.data, context.now, id, account.id, save.revision, account.id, id, size, MAX_ACCOUNT_BYTES)
    .run();
  const row = await infoRow(context, id);
  if (!row || row.owner_id !== account.id) throw new HttpError(404, NOT_FOUND);
  if (meta.changes === 0 && row.revision !== save.revision) {
    return json({ error: 'This model was saved from somewhere else since you opened it.', model: infoOf(row) }, 409);
  }
  if (meta.changes === 0) throw new HttpError(409, NO_ROOM);
  return json({ model: infoOf(row) });
}

/** PATCH /api/models/:id — into the gallery, or out of it. */
export async function changeModel(context: Context, id: string): Promise<Response> {
  const account = await activeAccount(context);
  await spend(context.db, LIMITS.publish, account.id, context.now);
  const { published } = await readJson(context.request, modelChangeSchema, MAX_CHANGE_BODY);
  const row = await infoRow(context, id);
  if (!row || row.owner_id !== account.id) throw new HttpError(404, NOT_FOUND);
  if (published && row.hidden === 1) throw new HttpError(403, 'A moderator took this model out of the gallery, so it cannot go back in.');
  if (published && row.bricks === 0) throw new HttpError(400, 'An empty model cannot go in the gallery: build something first.');
  // a model already in the gallery keeps its place there
  const publishedAt = published ? (row.published_at ?? context.now) : null;
  await context.db.prepare('UPDATE models SET published_at = ? WHERE id = ? AND owner_id = ?').bind(publishedAt, id, account.id).run();
  return json({ model: infoOf({ ...row, published_at: publishedAt }) });
}

/** DELETE /api/models/:id */
export async function deleteModel(context: Context, id: string): Promise<Response> {
  const account = await signedIn(context);
  const { meta } = await context.db.prepare('DELETE FROM models WHERE id = ? AND owner_id = ?').bind(id, account.id).run();
  if (meta.changes === 0) throw new HttpError(404, NOT_FOUND);
  return noContent();
}

/** GET /api/models/:id — a model and its file, to open. */
export async function readModel(context: Context, id: string): Promise<Response> {
  const row = await context.db
    .prepare(`SELECT ${INFO_COLUMNS}, m.data ${FROM_MODELS} WHERE m.id = ?`)
    .bind(id)
    .first<InfoRow & { readonly data: string }>();
  if (!row || !(await canSee(context, row))) throw new HttpError(404, NOT_FOUND);
  return json({ model: infoOf(row), data: row.data });
}

/**
 * GET /api/models/:id/thumbnail — its picture. Pages ask with the revision
 * in the address (?v=3), so a browser may keep a picture a while without
 * missing a newer save.
 */
export async function readThumbnail(context: Context, id: string): Promise<Response> {
  const row = await context.db
    .prepare(`SELECT m.owner_id, m.published_at, m.hidden, u.banned AS owner_banned, m.thumbnail ${FROM_MODELS} WHERE m.id = ?`)
    .bind(id)
    .first<Pick<InfoRow, 'owner_id' | 'published_at' | 'hidden' | 'owner_banned'> & { readonly thumbnail: string | null }>();
  if (!row || row.thumbnail === null || !(await canSee(context, row))) throw new HttpError(404, 'That model has no picture to show.');
  const jpeg = fromBase64Url(row.thumbnail);
  if (!jpeg) throw new Error(`the thumbnail of model ${id} is not base64url`);
  // a few minutes, so a picture taken out of the gallery is soon gone from browsers too
  return bytes(jpeg, 'image/jpeg', { 'Cache-Control': `${isPublic(row) ? 'public' : 'private'}, max-age=300` });
}
