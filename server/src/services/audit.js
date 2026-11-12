/**
 * Audit log (spec §6 "改动管控", §13 "所有写操作在服务层统一写入审计日志").
 * Always called with the transaction's client, so the log row commits or rolls
 * back together with the change it describes.
 */
export async function recordRevision(
  client,
  { table, recordId, action, ctx, before = null, after = null, reason = null }
) {
  await client.query(
    `INSERT INTO revision (table_name, record_id, action, actor_id, source, reason, before, after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      table,
      String(recordId),
      action,
      ctx.actor?.id ?? null,
      ctx.source || 'web',
      reason ?? ctx.reason ?? null,
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
    ]
  );
}

/** Context for changes made by the system itself (bootstrap, jobs). */
export const systemContext = (actor = null) => ({ actor, source: 'system' });
