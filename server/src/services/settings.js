/**
 * Admin settings (spec §14 "setting"). Each key has a default here, so the
 * table only holds values an admin has changed. Editing settings is M3
 * (`/settings` and the admin page); M2 only reads them.
 */
import { db } from '../db/tx.js';

export const DEFAULTS = {
  // Spec §3: "层级数量和名称可配置". The group (root) type is fixed.
  'org.nodeTypes': [
    { key: 'group', nameZh: '集团', nameEn: 'Group' },
    { key: 'entity', nameZh: '法人实体', nameEn: 'Legal entity' },
    { key: 'brand', nameZh: '品牌或事业线', nameEn: 'Brand or business line' },
    { key: 'department', nameZh: '部门', nameEn: 'Department' },
    { key: 'team', nameZh: '团队', nameEn: 'Team' },
  ],
};

export async function getSetting(key, client) {
  const { rows } = await db(client).query('SELECT value FROM setting WHERE key = $1', [
    key,
  ]);
  return rows.length ? rows[0].value : DEFAULTS[key];
}

export const getNodeTypes = (client) => getSetting('org.nodeTypes', client);
