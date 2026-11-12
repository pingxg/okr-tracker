/**
 * Translate Firestore-style structured queries into SQL over the `documents`
 * table.
 *
 * A query is a collection path plus a list of constraints:
 *   { type: 'where', field: 'archived', op: '==', value: false }
 *   { type: 'orderBy', field: 'timestamp', direction: 'desc' }
 *   { type: 'limit', limit: 10 }
 *
 * Values are already in wire encoding (tagged JSON, see encoding.js).
 *
 * Semantics follow Firestore where it matters for this app:
 *  - `orderBy` on a field excludes documents that lack the field.
 *  - Range comparisons only match values of the same type.
 *  - `!=` / `not-in` exclude documents that lack the field (and null values).
 *  - Results are ordered by document id after any explicit ordering.
 */
import {
  isTaggedTimestamp,
  isTaggedRef,
  TS,
  REF,
} from '../../../common/docstore/encoding.js';

const OPS = new Set([
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'in',
  'not-in',
  'array-contains',
  'array-contains-any',
]);

const MAX_LIMIT = 5000;

function fieldSegments(field) {
  if (typeof field !== 'string' || !field.length || field.length > 200) {
    throw new QueryError(`Invalid field path: ${field}`);
  }
  const segments = field.split('.');
  if (segments.some((s) => !s.length)) {
    throw new QueryError(`Invalid field path: ${field}`);
  }
  return segments;
}

export class QueryError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 400;
  }
}

/**
 * Build a SQL fragment for a JSON value type check, so that range operators
 * only compare like with like.
 */
function typeGuard(expr, value) {
  if (isTaggedTimestamp(value)) {
    return `(${expr} ? '${TS}')`;
  }
  if (isTaggedRef(value)) {
    return `(${expr} ? '${REF}')`;
  }
  if (value === null) {
    return `jsonb_typeof(${expr}) = 'null'`;
  }
  if (Array.isArray(value)) {
    return `jsonb_typeof(${expr}) = 'array'`;
  }
  switch (typeof value) {
    case 'number':
      return `jsonb_typeof(${expr}) = 'number'`;
    case 'string':
      return `jsonb_typeof(${expr}) = 'string'`;
    case 'boolean':
      return `jsonb_typeof(${expr}) = 'boolean'`;
    default:
      return `jsonb_typeof(${expr}) = 'object'`;
  }
}

/**
 * @param {string} collectionPath
 * @param {Array} constraints
 * @param {{ count?: boolean }} options
 * @returns {{ text: string, values: any[] }}
 */
export function buildQuery(collectionPath, constraints = [], { count = false } = {}) {
  const values = [collectionPath];
  const param = (v) => {
    values.push(v);
    return `$${values.length}`;
  };

  const where = ['collection = $1'];
  const order = [];
  let limit = null;
  let lastDirection = 'ASC';

  for (const c of constraints) {
    if (!c || typeof c !== 'object') {
      throw new QueryError('Invalid constraint');
    }

    if (c.type === 'where') {
      if (!OPS.has(c.op)) {
        throw new QueryError(`Unsupported operator: ${c.op}`);
      }
      const segments = fieldSegments(c.field);
      // The field path parameter is only added when the SQL actually uses it
      // (Postgres rejects parameters it cannot type).
      let exprSql = null;
      const fieldExpr = () => {
        if (!exprSql) {
          exprSql = `(data #> ${param(segments)}::text[])`;
        }
        return exprSql;
      };
      const topLevel = segments.length === 1;
      const v = c.value === undefined ? null : c.value;

      switch (c.op) {
        case '==': {
          const vp = param(JSON.stringify(v));
          if (topLevel && v !== null && !Array.isArray(v)) {
            // Containment lets Postgres use the GIN index; equality keeps exactness.
            const containment = param(JSON.stringify({ [segments[0]]: v }));
            where.push(`data @> ${containment}::jsonb AND ${fieldExpr()} = ${vp}::jsonb`);
          } else {
            where.push(`${fieldExpr()} = ${vp}::jsonb`);
          }
          break;
        }
        case '!=': {
          const vp = param(JSON.stringify(v));
          where.push(
            `${fieldExpr()} IS NOT NULL AND ${fieldExpr()} <> 'null'::jsonb AND ${fieldExpr()} <> ${vp}::jsonb`
          );
          break;
        }
        case '<':
        case '<=':
        case '>':
        case '>=': {
          const vp = param(JSON.stringify(v));
          where.push(
            `${fieldExpr()} IS NOT NULL AND ${typeGuard(
              fieldExpr(),
              v
            )} AND ${fieldExpr()} ${c.op} ${vp}::jsonb`
          );
          break;
        }
        case 'in':
        case 'not-in': {
          if (!Array.isArray(v)) {
            throw new QueryError(`"${c.op}" requires an array`);
          }
          const vp = param(JSON.stringify(v));
          const exists = `EXISTS (SELECT 1 FROM jsonb_array_elements(${vp}::jsonb) e WHERE e = ${fieldExpr()})`;
          where.push(
            c.op === 'in'
              ? exists
              : `${fieldExpr()} IS NOT NULL AND ${fieldExpr()} <> 'null'::jsonb AND NOT ${exists}`
          );
          break;
        }
        case 'array-contains': {
          if (topLevel) {
            const vp = param(JSON.stringify({ [segments[0]]: [v] }));
            where.push(`data @> ${vp}::jsonb`);
          } else {
            const vp = param(JSON.stringify([v]));
            where.push(
              `jsonb_typeof(${fieldExpr()}) = 'array' AND ${fieldExpr()} @> ${vp}::jsonb`
            );
          }
          break;
        }
        case 'array-contains-any': {
          if (!Array.isArray(v)) {
            throw new QueryError('"array-contains-any" requires an array');
          }
          const vp = param(JSON.stringify(v));
          where.push(
            `jsonb_typeof(${fieldExpr()}) = 'array' AND EXISTS (SELECT 1 FROM jsonb_array_elements(${vp}::jsonb) e WHERE ${fieldExpr()} @> jsonb_build_array(e))`
          );
          break;
        }
        default:
          throw new QueryError(`Unsupported operator: ${c.op}`);
      }
    } else if (c.type === 'orderBy') {
      const segments = fieldSegments(c.field);
      const pathParam = param(segments);
      const expr = `(data #> ${pathParam}::text[])`;
      const direction =
        String(c.direction || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
      lastDirection = direction;
      where.push(`${expr} IS NOT NULL`);
      order.push(`${expr} ${direction}`);
    } else if (c.type === 'limit') {
      const n = Number(c.limit);
      if (!Number.isInteger(n) || n < 0) {
        throw new QueryError('Invalid limit');
      }
      limit = Math.min(n, MAX_LIMIT);
    } else {
      throw new QueryError(`Unsupported constraint type: ${c.type}`);
    }
  }

  if (count) {
    return {
      text: `SELECT count(*)::int AS count FROM documents WHERE ${where.join(' AND ')}`,
      values,
    };
  }

  order.push(`id ${lastDirection}`);
  let text = `SELECT path, id, data, created_at, updated_at FROM documents WHERE ${where.join(
    ' AND '
  )} ORDER BY ${order.join(', ')}`;
  text += ` LIMIT ${limit === null ? MAX_LIMIT : limit}`;
  return { text, values };
}
