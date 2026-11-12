/**
 * Helpers for the organisation structure from API v1 (GET /org/tree).
 */
import { dateLong } from './format';

/** A node's name in the current language, falling back to the other one. */
export function nodeName(node, locale) {
  if (!node) {
    return '';
  }
  return locale === 'zh-CN'
    ? node.nameZh || node.nameEn || ''
    : node.nameEn || node.nameZh || '';
}

/** Index over the flat node list: children (sorted by name), ancestors, descendants. */
export function indexTree(nodes, locale) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map(nodes.map((n) => [n.id, []]));
  nodes.forEach((n) => {
    if (n.parentId && children.has(n.parentId)) {
      children.get(n.parentId).push(n);
    }
  });
  children.forEach((list) =>
    list.sort((a, b) => nodeName(a, locale).localeCompare(nodeName(b, locale), locale))
  );

  const descendants = (id) => {
    const out = [];
    const walk = (nodeId) => {
      (children.get(nodeId) || []).forEach((child) => {
        out.push(child);
        walk(child.id);
      });
    };
    walk(id);
    return out;
  };
  const ancestors = (id) => {
    const out = [];
    let current = byId.get(id);
    while (current && current.parentId) {
      current = byId.get(current.parentId);
      if (current) {
        out.unshift(current);
      }
    }
    return out;
  };

  return {
    byId,
    children,
    root: nodes.find((n) => n.parentId === null) || null,
    descendants,
    ancestors,
    countType: (id, type) => descendants(id).filter((n) => n.type === type).length,
  };
}

/** The node's owner (负责人): its company or team lead. */
export const ownerOf = (leads) =>
  (leads || []).find((l) => l.role === 'entity_lead' || l.role === 'team_lead') || null;

/** Icons from the current design, by node type. */
export const nodeIcon = (type) =>
  ({
    group: 'organization',
    entity: 'organization',
    brand: 'district',
    department: 'district',
    team: 'house-heart',
  }[type] || 'district');

/**
 * Translated message for an API v1 error. Dates the API sends back (when a
 * parent or node starts, the last change) are shown as {date}.
 */
export function orgErrorMessage(error, i18n) {
  const key = `org.errors.${error?.code}`;
  if (error?.code && i18n.te(key)) {
    const details = error.details && !Array.isArray(error.details) ? error.details : {};
    const iso = details.parentFrom || details.nodeFrom || details.from;
    const date = iso ? dateLong(new Date(`${iso}T00:00:00`)) : '';
    return i18n.t(key, { date });
  }
  return i18n.t(error?.status === 403 ? 'org.errors.forbidden' : 'toaster.error.save');
}
