/**
 * Moderators (the ADMINS setting) see what has been reported, take models
 * out of the gallery or put them back, delete them outright, and stop
 * accounts saving, publishing and reporting. A stopped account's models
 * leave the gallery with it.
 */
import { moderateModelSchema, moderateUserSchema, REPORT_REASONS, type ReportedModel, type ReportReason } from '../src/core/cloud/protocol';
import { adminAccount, type Context } from './context';
import { HttpError, json, noContent, readJson } from './http';
import { FROM_MODELS, INFO_COLUMNS, infoOf, type InfoRow } from './models';

const MAX_BODY = 1_024;
/** Reported models listed at once: the most reported first. */
const MAX_LISTED = 50;
const MAX_NOTES = 10;
const MAX_STOPPED = 200;

type ReasonCounts = Readonly<Record<ReportReason, number>>;

interface ReportedRow extends InfoRow, ReasonCounts {
  readonly count: number;
  readonly latest: number;
}

/**
 * GET /api/admin/reports — reported models, the most reported first, then
 * the most recently reported, so a few accounts reporting many models
 * cannot bury the ones many people report.
 */
export async function listReports(context: Context): Promise<Response> {
  await adminAccount(context);
  const counts = REPORT_REASONS.map((reason) => `SUM(r.reason = '${reason}') AS ${reason}`).join(', ');
  const { results } = await context.db
    .prepare(
      `SELECT ${INFO_COLUMNS}, COUNT(*) AS count, MAX(r.created_at) AS latest, ${counts}
       FROM reports r JOIN models m ON m.id = r.model_id JOIN users u ON u.id = m.owner_id
       GROUP BY m.id ORDER BY count DESC, latest DESC LIMIT ?`,
    )
    .bind(MAX_LISTED)
    .all<ReportedRow>();
  const notes = new Map<string, string[]>();
  if (results.length > 0) {
    const ids = results.map((row) => row.id);
    const { results: written } = await context.db
      .prepare(`SELECT model_id, note FROM reports WHERE note <> '' AND model_id IN (${ids.map(() => '?').join(', ')}) ORDER BY created_at DESC`)
      .bind(...ids)
      .all<{ model_id: string; note: string }>();
    for (const { model_id: id, note } of written) {
      const kept = notes.get(id) ?? [];
      if (kept.length < MAX_NOTES) notes.set(id, [...kept, note]);
    }
  }
  const reports: ReportedModel[] = results.map((row) => ({
    model: infoOf(row),
    ownerBanned: row.owner_banned === 1,
    count: row.count,
    reasons: Object.fromEntries(REPORT_REASONS.filter((reason) => row[reason] > 0).map((reason) => [reason, row[reason]])),
    notes: notes.get(row.id) ?? [],
    latestAt: row.latest,
  }));
  return json({ reports });
}

/** POST /api/admin/models/:id — out of the gallery, back in, or left as it is; its reports are settled either way. */
export async function moderateModel(context: Context, id: string): Promise<Response> {
  await adminAccount(context);
  const action = await readJson(context.request, moderateModelSchema, MAX_BODY);
  const statements = [context.db.prepare('DELETE FROM reports WHERE model_id = ?').bind(id)];
  if (action.hidden !== undefined) statements.push(context.db.prepare('UPDATE models SET hidden = ? WHERE id = ?').bind(action.hidden ? 1 : 0, id));
  await context.db.batch(statements);
  const row = await context.db.prepare(`SELECT ${INFO_COLUMNS} ${FROM_MODELS} WHERE m.id = ?`).bind(id).first<InfoRow>();
  if (!row) throw new HttpError(404, 'That model is not online.');
  return json({ model: infoOf(row) });
}

/** DELETE /api/admin/models/:id — deletes a model outright, as its owner could, to clear out what should not be kept at all. */
export async function deleteAsModerator(context: Context, id: string): Promise<Response> {
  await adminAccount(context);
  const { meta } = await context.db.prepare('DELETE FROM models WHERE id = ?').bind(id).run();
  if (meta.changes === 0) throw new HttpError(404, 'That model is not online.');
  return noContent();
}

/** GET /api/admin/users — the accounts stopped from saving, publishing and reporting, to let them back. */
export async function listStopped(context: Context): Promise<Response> {
  await adminAccount(context);
  const { results } = await context.db
    .prepare('SELECT id, name FROM users WHERE banned = 1 ORDER BY name COLLATE NOCASE LIMIT ?')
    .bind(MAX_STOPPED)
    .all<{ id: string; name: string }>();
  return json({ users: results });
}

/** POST /api/admin/users/:id — stops an account saving, publishing and reporting, or lets it again. */
export async function moderateUser(context: Context, id: string): Promise<Response> {
  await adminAccount(context);
  const { banned } = await readJson(context.request, moderateUserSchema, MAX_BODY);
  const { meta } = await context.db.prepare('UPDATE users SET banned = ? WHERE id = ?').bind(banned ? 1 : 0, id).run();
  if (meta.changes === 0) throw new HttpError(404, 'There is no such account.');
  return noContent();
}
