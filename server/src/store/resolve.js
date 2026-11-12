/**
 * Server-side reference resolution, matching VueFire's `maxRefDepth`:
 * with depth 1, references inside a document are replaced by the referenced
 * documents (tagged `__doc`), and references inside those stay references.
 *
 * Doing this on the server turns VueFire's one-subscription-per-reference into
 * one query per depth level.
 */
import {
  DOC,
  REF,
  collectionOf,
  isPlainObject,
  isTaggedRef,
} from '../../../common/docstore/encoding.js';
import { getDocuments } from './docstore.js';

function collectRefs(value, out) {
  if (isTaggedRef(value)) {
    out.add(value[REF]);
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectRefs(v, out));
  } else if (isPlainObject(value) && !(DOC in value)) {
    Object.values(value).forEach((v) => collectRefs(v, out));
  }
}

function replaceRefs(value, resolved) {
  if (isTaggedRef(value)) {
    const doc = resolved.get(value[REF]);
    return doc ? { [DOC]: doc } : value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => replaceRefs(v, resolved));
  }
  if (isPlainObject(value) && !(DOC in value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = replaceRefs(v, resolved);
    }
    return out;
  }
  return value;
}

/**
 * @param {Array<{path, id, exists, data}>} docs  documents in wire encoding
 * @param {number} depth  how many levels of references to resolve (0-3)
 * @param {(collectionPath: string) => boolean} canRead  read policy
 * @returns {Promise<{docs: Array, deps: string[]}>} deps = resolved document paths
 */
export async function resolveReferences(docs, depth, canRead) {
  const deps = new Set();
  let level = docs.filter((d) => d.exists);
  const max = Math.max(0, Math.min(Number(depth) || 0, 3));

  for (let d = 0; d < max && level.length; d += 1) {
    const refs = new Set();
    level.forEach((doc) => collectRefs(doc.data, refs));
    const readable = [...refs].filter((p) => canRead(collectionOf(p)));
    if (!readable.length) {
      break;
    }

    const fetched = await getDocuments(readable);
    const resolved = new Map();
    for (const [p, doc] of fetched) {
      deps.add(p);
      resolved.set(p, { path: doc.path, id: doc.id, exists: doc.exists, data: doc.data });
    }

    level.forEach((doc) => {
      doc.data = replaceRefs(doc.data, resolved);
    });
    // Next level: the documents we just embedded.
    level = [...resolved.values()].filter((doc) => doc.exists);
  }

  return { docs, deps: [...deps] };
}
