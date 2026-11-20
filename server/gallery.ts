/** The gallery: published models, the latest first, and reporting one that should not be there. */
import { cleanName, GALLERY_PAGE_SIZE, MAX_REPORT_NOTE, MAX_SEARCH, reportRequestSchema, type GalleryPage } from '../src/core/cloud/protocol';
import { activeAccount, type Context } from './context';
import type { D1Value } from './db';
import { HttpError, json, noContent, readJson } from './http';
import { LIMITS, spend } from './limits';
import { FROM_MODELS, INFO_COLUMNS, infoOf, isPublic, type InfoRow } from './models';

const MAX_REPORT_BODY = 2_048;
/** Where a page ends: the last model's publishing time and id, as "1700000000000.abc…". */
const CURSOR = /^(\d{1,16})\.([0-9a-z]{16})$/;

/** LIKE treats % and _ as wildcards; a search means them literally. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** GET /api/gallery?q=castle&after=… — a page of the gallery, or of the models whose names hold `q`. */
export async function listGallery(context: Context): Promise<Response> {
  const params = context.url.searchParams;
  const conditions = ['m.published_at IS NOT NULL', 'm.hidden = 0', 'u.banned = 0'];
  const values: D1Value[] = [];
  const search = cleanName(params.get('q') ?? '', MAX_SEARCH);
  if (search) {
    conditions.push(`m.name LIKE ? ESCAPE '\\'`);
    values.push(likePattern(search));
  }
  const after = params.get('after');
  if (after) {
    const cursor = CURSOR.exec(after);
    if (!cursor) throw new HttpError(400, 'That page of the gallery is not one there is.');
    conditions.push('(m.published_at < ? OR (m.published_at = ? AND m.id < ?))');
    values.push(Number(cursor[1]), Number(cursor[1]), cursor[2] ?? '');
  }
  const { results } = await context.db
    .prepare(`SELECT ${INFO_COLUMNS} ${FROM_MODELS} WHERE ${conditions.join(' AND ')} ORDER BY m.published_at DESC, m.id DESC LIMIT ?`)
    .bind(...values, GALLERY_PAGE_SIZE + 1)
    .all<InfoRow>();
  const shown = results.slice(0, GALLERY_PAGE_SIZE);
  const last = shown.at(-1);
  const page: GalleryPage = {
    models: shown.map(infoOf),
    next: results.length > GALLERY_PAGE_SIZE && last ? `${last.published_at}.${last.id}` : null,
  };
  return json(page);
}

/** POST /api/models/:id/report — tells the moderators about a model in the gallery; one report per person per model. */
export async function reportModel(context: Context, id: string): Promise<Response> {
  const account = await activeAccount(context);
  await spend(context.db, LIMITS.report, account.id, context.now);
  const { reason, note } = await readJson(context.request, reportRequestSchema, MAX_REPORT_BODY);
  const row = await context.db.prepare(`SELECT ${INFO_COLUMNS} ${FROM_MODELS} WHERE m.id = ?`).bind(id).first<InfoRow>();
  if (!row || !isPublic(row)) throw new HttpError(404, 'That model is not in the gallery.');
  if (row.owner_id === account.id) throw new HttpError(400, 'That model is yours: take it out of the gallery instead.');
  await context.db
    .prepare(
      `INSERT INTO reports (model_id, reporter_id, reason, note, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (model_id, reporter_id) DO UPDATE SET reason = excluded.reason, note = excluded.note, created_at = excluded.created_at`,
    )
    .bind(id, account.id, reason, cleanName(note, MAX_REPORT_NOTE), context.now)
    .run();
  return noContent();
}
