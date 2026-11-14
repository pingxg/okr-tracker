/**
 * Group overview and "to update" lists, computed on the server for the web
 * app (/api/v1/overview) and the MCP tools. Uses the status rules shared
 * with the browser (common/okr/status.js). Read-only; everyone signed in may
 * read everything.
 */
import {
  KEY_RESULT_UPDATE_DAYS,
  keyResultStatus,
  latestCachedKpiDate,
  measurementUpdateDays,
  periodRunning,
  timeElapsed,
  toDate,
  updateDue,
} from '../../../common/okr/status.js';
import {
  REF,
  collectionOf,
  idOf,
  isTaggedRef,
} from '../../../common/docstore/encoding.js';
import { assertCanRead } from '../policy/rules.js';
import { getDocument, queryDocuments } from '../store/docstore.js';

const refPath = (value) => (isTaggedRef(value) ? value[REF] : null);
const ref = (path) => ({ [REF]: path });
const where = (field, op, value) => ({ type: 'where', field, op, value });
const ACTIVE = where('archived', '==', false);
const KIND = {
  organizations: 'organization',
  departments: 'department',
  products: 'team',
};

/** Firestore-style `in` takes at most 30 values: query in chunks. */
async function queryIn(collection, field, values, extra = []) {
  const out = [];
  for (let i = 0; i < values.length; i += 30) {
    // eslint-disable-next-line no-await-in-loop
    out.push(
      ...(await queryDocuments(collection, [
        where(field, 'in', values.slice(i, i + 30)),
        ...extra,
      ]))
    );
  }
  return out;
}

function periodOf(objective) {
  return { start: objective.startDate || null, end: objective.endDate || null };
}

const iso = (value) => toDate(value)?.toISOString() || null;

/** The items (organization, departments, teams) of an organization, in tree order. */
async function itemsOf(orgPath) {
  const org = await getDocument(orgPath);
  if (!org.exists || org.data.archived) {
    return [];
  }
  const orgRef = ref(orgPath);
  const [departments, teams] = await Promise.all([
    queryDocuments('departments', [where('organization', '==', orgRef), ACTIVE]),
    queryDocuments('products', [where('organization', '==', orgRef), ACTIVE]),
  ]);
  const byName = (a, b) => String(a.data.name).localeCompare(String(b.data.name));
  const items = [{ ...org, depth: 0 }];
  departments.sort(byName).forEach((dep) => {
    items.push({ ...dep, depth: 1 });
    teams
      .filter((t) => refPath(t.data.department) === dep.path)
      .sort(byName)
      .forEach((t) => items.push({ ...t, depth: 2 }));
  });
  return items;
}

/** Key results with status and due state, for running objectives of `items`. */
async function keyResultsFor(itemPaths, now) {
  const objectives = (
    await queryIn('objectives', 'parent', itemPaths.map(ref), [ACTIVE])
  ).filter((o) => periodRunning(o.data.startDate, o.data.endDate, now));
  const objectiveByPath = new Map(objectives.map((o) => [o.path, o]));
  const keyResults = objectives.length
    ? await queryIn(
        'keyResults',
        'objective',
        objectives.map((o) => ref(o.path)),
        [ACTIVE]
      )
    : [];
  const enriched = keyResults.map((kr) => {
    const objective = objectiveByPath.get(refPath(kr.data.objective));
    const { start, end } = periodOf(objective.data);
    const status = keyResultStatus(kr.data, start, end, now);
    const due = updateDue(
      {
        lastUpdate: kr.data.lastProgressAt,
        since: kr.data.created,
        days: KEY_RESULT_UPDATE_DAYS,
      },
      now
    );
    return { kr, objective, status, due };
  });
  return { objectives, keyResults: enriched };
}

function measurementState(kpi, now) {
  return updateDue(
    {
      lastUpdate: latestCachedKpiDate(kpi.data),
      since: kpi.data.created,
      days: measurementUpdateDays(kpi.data),
    },
    now
  );
}

/**
 * Overview of one organization: per item (organization, departments, teams)
 * the running objectives' progress against time, key results by status, and
 * updates that are due; plus the key results needing attention.
 */
export async function organizationOverview(actor, orgPath, now = new Date()) {
  [
    'organizations',
    'departments',
    'products',
    'objectives',
    'keyResults',
    'kpis',
  ].forEach((c) => assertCanRead(actor, c));
  const items = await itemsOf(orgPath);
  if (!items.length) {
    return null;
  }
  const itemPaths = items.map((i) => i.path);
  const [{ objectives, keyResults }, kpis] = await Promise.all([
    keyResultsFor(itemPaths, now),
    queryIn('kpis', 'parent', itemPaths.map(ref), [ACTIVE]),
  ]);

  const rows = items.map((item) => {
    const own = objectives.filter((o) => refPath(o.data.parent) === item.path);
    const totalWeight = own.reduce((s, o) => s + (Number(o.data.weight) || 1), 0);
    const weighted = (pick) =>
      own.length
        ? own.reduce((s, o) => s + pick(o) * (Number(o.data.weight) || 1), 0) /
          totalWeight
        : null;
    // Key results owned by this item (they may sit under a parent's objective).
    const krs = keyResults.filter((k) => refPath(k.kr.data.parent) === item.path);
    const count = (status) => krs.filter((k) => k.status.status === status).length;
    const itemKpis = kpis.filter((k) => refPath(k.data.parent) === item.path);
    const lastDates = [
      ...krs.map((k) => toDate(k.kr.data.lastProgressAt)),
      ...itemKpis.map((k) => latestCachedKpiDate(k.data)),
    ].filter(Boolean);
    return {
      ref: item.path,
      kind: KIND[collectionOf(item.path)],
      name: item.data.name,
      slug: item.data.slug,
      depth: item.depth,
      objectives: own.length,
      progress: weighted((o) => Number(o.data.progression) || 0),
      expected: weighted((o) => timeElapsed(o.data.startDate, o.data.endDate, now) ?? 0),
      keyResults: {
        total: krs.length,
        onTrack: count('onTrack'),
        atRisk: count('atRisk'),
        behind: count('behind'),
      },
      updatesDue: {
        keyResults: krs.filter((k) => k.due.due).length,
        measurements: itemKpis.filter((k) => measurementState(k, now).due).length,
      },
      lastUpdate: lastDates.length
        ? new Date(Math.max(...lastDates)).toISOString()
        : null,
    };
  });

  const itemByPath = new Map(items.map((i) => [i.path, i]));
  const attention = keyResults
    .filter((k) => k.status.status !== 'onTrack')
    .sort(
      (a, b) =>
        (a.status.status === 'behind' ? -1 : 1) - (b.status.status === 'behind' ? -1 : 1)
    )
    .map((k) => ({
      id: k.kr.id,
      name: k.kr.data.name,
      status: k.status.status,
      statusSetByHand: Boolean(k.status.manual),
      statusNote: k.status.note,
      progress: Number(k.kr.data.progression) || 0,
      expected: timeElapsed(k.objective.data.startDate, k.objective.data.endDate, now),
      owner: {
        ref: refPath(k.kr.data.parent),
        name: itemByPath.get(refPath(k.kr.data.parent))?.data.name,
      },
      ownerSlug: itemByPath.get(refPath(k.kr.data.parent))?.data.slug,
      objective: { id: k.objective.id, name: k.objective.data.name },
      objectiveOwnerSlug: itemByPath.get(refPath(k.objective.data.parent))?.data.slug,
      assignees: (k.kr.data.assignees || []).map(refPath).filter(Boolean).map(idOf),
      lastUpdate: iso(k.kr.data.lastProgressAt),
    }));

  return {
    organization: { ref: orgPath, name: items[0].data.name },
    asOf: now.toISOString(),
    rows,
    attention,
  };
}

/**
 * What the actor should update: key results (of running objectives) and
 * measurements that are due and are assigned to them, or assigned to nobody
 * in a team where they have a role.
 */
export async function myUpdates(actor, now = new Date()) {
  [
    'organizations',
    'departments',
    'products',
    'objectives',
    'keyResults',
    'kpis',
  ].forEach((c) => assertCanRead(actor, c));
  const me = ref(`users/${actor.email}`);
  const roles = actor.doc?.roles || {};
  const memberOf = (
    await Promise.all(
      ['organizations', 'departments', 'products'].map((c) =>
        queryDocuments(c, [where('team', 'array-contains', me), ACTIVE])
      )
    )
  )
    .flat()
    .filter((item) => {
      const orgId = item.data.organization
        ? idOf(refPath(item.data.organization))
        : item.id;
      return Boolean(roles[orgId]);
    });
  const teamPaths = memberOf.map((i) => i.path);
  const slugOf = new Map(memberOf.map((i) => [i.path, i.data.slug]));

  const [assignedKrs, assignedKpis, teamKrs, teamKpis] = await Promise.all([
    queryDocuments('keyResults', [where('assignees', 'array-contains', me), ACTIVE]),
    queryDocuments('kpis', [where('assignees', 'array-contains', me), ACTIVE]),
    teamPaths.length ? queryIn('keyResults', 'parent', teamPaths.map(ref), [ACTIVE]) : [],
    teamPaths.length ? queryIn('kpis', 'parent', teamPaths.map(ref), [ACTIVE]) : [],
  ]);
  const unassigned = (list) => list.filter((d) => !(d.data.assignees || []).length);
  const uniq = (list) => [...new Map(list.map((d) => [d.path, d])).values()];
  const krs = uniq([...assignedKrs, ...unassigned(teamKrs)]);
  const kpis = uniq([...assignedKpis, ...unassigned(teamKpis)]);

  const objectivePaths = [
    ...new Set(krs.map((k) => refPath(k.data.objective)).filter(Boolean)),
  ];
  const parentPaths = [
    ...new Set([...krs, ...kpis].map((d) => refPath(d.data.parent)).filter(Boolean)),
  ];
  const [objectives, parents] = await Promise.all([
    Promise.all(objectivePaths.map((p) => getDocument(p))),
    Promise.all(parentPaths.filter((p) => !slugOf.has(p)).map((p) => getDocument(p))),
  ]);
  const objectiveByPath = new Map(
    objectives.filter((o) => o.exists).map((o) => [o.path, o])
  );
  parents.filter((p) => p.exists).forEach((p) => slugOf.set(p.path, p.data.slug));
  const nameOf = new Map(
    [...memberOf, ...parents.filter((p) => p.exists)].map((i) => [i.path, i.data.name])
  );

  const keyResults = krs
    .map((kr) => {
      const objective = objectiveByPath.get(refPath(kr.data.objective));
      if (!objective || objective.data.archived) {
        return null;
      }
      const { start, end } = periodOf(objective.data);
      if (!periodRunning(start, end, now)) {
        return null;
      }
      const due = updateDue(
        {
          lastUpdate: kr.data.lastProgressAt,
          since: kr.data.created,
          days: KEY_RESULT_UPDATE_DAYS,
        },
        now
      );
      if (!due.due) {
        return null;
      }
      const parent = refPath(kr.data.parent);
      return {
        type: 'keyResult',
        id: kr.id,
        name: kr.data.name,
        status: keyResultStatus(kr.data, start, end, now).status,
        progress: Number(kr.data.progression) || 0,
        lastUpdate: iso(kr.data.lastProgressAt),
        everyDays: KEY_RESULT_UPDATE_DAYS,
        owner: { ref: parent, name: nameOf.get(parent) || null },
        objective: { id: objective.id, name: objective.data.name },
        // The OKR page of the objective's owner shows it.
        slug: slugOf.get(refPath(objective.data.parent)) || slugOf.get(parent) || null,
      };
    })
    .filter(Boolean);

  const measurements = kpis
    .map((kpi) => {
      const due = measurementState(kpi, now);
      if (!due.due) {
        return null;
      }
      const parent = refPath(kpi.data.parent);
      return {
        type: 'measurement',
        id: kpi.id,
        name: kpi.data.name,
        lastUpdate: iso(latestCachedKpiDate(kpi.data)),
        everyDays: due.days,
        owner: { ref: parent, name: nameOf.get(parent) || null },
        slug: slugOf.get(parent) || null,
      };
    })
    .filter(Boolean);

  // Objective parents may not be among the actor's teams: fetch their slugs.
  const missing = keyResults.filter((k) => !k.slug);
  if (missing.length) {
    await Promise.all(
      missing.map(async (k) => {
        const objective = objectiveByPath.get(`objectives/${k.objective.id}`);
        const parentDoc = await getDocument(refPath(objective.data.parent));
        k.slug = parentDoc.exists ? parentDoc.data.slug : null;
      })
    );
  }
  return { asOf: now.toISOString(), keyResults, measurements };
}
