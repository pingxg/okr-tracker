/**
 * MCP tools for OKR. One server instance per request, bound to the caller
 * (`actor`); every write is checked by the same policy as the web app.
 */
import { z } from 'zod';
import { endOfDay, startOfDay, setHours } from 'date-fns';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  KIND_OF_COLLECTION,
  ToolError,
  assertItemRef,
  autoId,
  created,
  dateValue,
  deleteField,
  edited,
  emailOf,
  itemRights,
  okrRefusal,
  roleIn,
  limit,
  orderBy,
  plain,
  readDoc,
  readMany,
  readQuery,
  recordRights,
  refList,
  refPath,
  syncObjectiveContributors,
  tagRef,
  tagTimestamp,
  where,
  write,
} from './okr.js';
import { queryDocuments } from '../store/docstore.js';

const INSTRUCTIONS = `OKR tracker of the organization. You act as the signed-in person and can do exactly what they can do in the web app, nothing more.

Start with get_my_permissions to learn who the person is and what they may change, then list_structure for the organizations, departments and teams ("items"; a team's reference is "products/<id>").

Rules the server enforces on every change:
- Super admins may do everything; organization admins everything inside their organization.
- Roles are set per organization by its admins. In the departments and teams a person is a member of:
  - project manager: creates, edits and archives objectives, key results and measurements, assigns people (also changes existing assignees), records progress, and edits the item's texts and member list;
  - project coordinator: records progress and edits key results and measurements assigned to them or to nobody; cannot create, assign, move or archive;
  - member without a role: reads only.
- Assignees must be members of the item's team.
- Everyone signed in can read everything.
Every read result says, per key result and measurement, whether the person may edit it and why. If a change is refused, explain the reason to the person instead of retrying. Nothing is deleted permanently: "archive" can be undone with set_archived.`;

const json = (value) => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
});

function tool(handler) {
  return async (args) => {
    try {
      return json(await handler(args));
    } catch (error) {
      if (
        error instanceof ToolError ||
        error.statusCode === 403 ||
        error.statusCode === 400
      ) {
        return { isError: true, content: [{ type: 'text', text: error.message }] };
      }
      throw error;
    }
  };
}

const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

const optionalText = (max) => z.string().max(max).optional();
const dateString = z.string().describe('Date, e.g. 2026-12-31');
const emails = z
  .array(z.string().email())
  .max(20)
  .optional()
  .describe('Emails of team members responsible for it. [] removes all assignees.');

const assigneeRefs = (list) =>
  list.map((email) => tagRef(`users/${email.toLowerCase()}`));

function itemSummary(path, data, actor) {
  return {
    ref: path,
    kind: KIND_OF_COLLECTION[path.split('/')[0]],
    name: data.name,
    slug: data.slug,
    yourRights: itemRights(actor, path, data),
  };
}

async function parentsOf(actor, records) {
  const paths = [...new Set(records.map((r) => refPath(r.data.parent)).filter(Boolean))];
  return readMany(actor, paths);
}

function keyResultView(actor, kr, parents) {
  const parentPath = refPath(kr.data.parent);
  const parent = parents.get(parentPath)?.data;
  return {
    id: kr.id,
    name: kr.data.name,
    description: kr.data.description || '',
    owner: { ref: parentPath, name: parent?.name },
    unit: kr.data.unit,
    startValue: kr.data.startValue,
    targetValue: kr.data.targetValue,
    currentValue: kr.data.currentValue ?? null,
    progression: kr.data.progression ?? null,
    weight: kr.data.weight ?? 1,
    archived: kr.data.archived === true,
    assignees: refList(kr.data.assignees).map(emailOf),
    yourRights: recordRights(actor, kr.data, parentPath, parent),
  };
}

function kpiView(actor, kpi, parents) {
  const parentPath = refPath(kpi.data.parent);
  const parent = parents.get(parentPath)?.data;
  return {
    id: kpi.id,
    name: kpi.data.name,
    description: kpi.data.description || '',
    owner: { ref: parentPath, name: parent?.name },
    type: kpi.data.kpiType,
    format: kpi.data.format,
    preferredTrend: kpi.data.preferredTrend,
    updateFrequency: kpi.data.updateFrequency,
    currentValue: kpi.data.currentValue ?? null,
    archived: kpi.data.archived === true,
    assignees: refList(kpi.data.assignees).map(emailOf),
    yourRights: recordRights(actor, kpi.data, parentPath, parent),
  };
}

async function loadRecord(actor, collection, id) {
  const path = `${collection}/${id}`;
  const data = await readDoc(actor, path);
  const parentPath = refPath(data.parent);
  const parent = parentPath
    ? (await readMany(actor, [parentPath])).get(parentPath)?.data
    : null;
  return {
    path,
    data,
    parentPath,
    parent,
    rights: recordRights(actor, data, parentPath, parent),
  };
}

const pickDefined = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

export function buildMcpServer(actor) {
  const server = new McpServer(
    { name: 'okr-tracker', title: 'OKR', version: '1.0.0' },
    { instructions: INSTRUCTIONS }
  );
  const me = tagRef(`users/${actor.email}`);

  // --- who am I --------------------------------------------------------------

  server.registerTool(
    'get_my_permissions',
    {
      title: 'Who am I and what may I change',
      description:
        'The signed-in person, their admin rights, the items they belong to, what is assigned to them, and the rules that decide what they may change. Call this first.',
      inputSchema: {},
      annotations: READ,
    },
    tool(async () => {
      const superAdmin = actor.doc.superAdmin === true;
      const adminOrgIds = actor.doc.admin || [];
      const adminOrgs = await readMany(
        actor,
        adminOrgIds.map((id) => `organizations/${id}`)
      );
      const memberships = [];
      for (const collection of Object.keys(KIND_OF_COLLECTION)) {
        // eslint-disable-next-line no-await-in-loop
        const docs = await readQuery(actor, collection, [
          where('team', 'array-contains', me),
          where('archived', '==', false),
        ]);
        docs.forEach((d) => memberships.push(itemSummary(d.path, d.data, actor)));
      }
      const [krs, kpis] = await Promise.all(
        ['keyResults', 'kpis'].map((c) =>
          readQuery(actor, c, [
            where('assignees', 'array-contains', me),
            where('archived', '==', false),
          ])
        )
      );
      return {
        you: { email: actor.email, name: actor.doc.displayName || null },
        superAdmin,
        adminOfOrganizations: [...adminOrgs.values()]
          .filter((d) => d.exists)
          .map((d) => ({ ref: d.path, name: d.data.name })),
        rolesByOrganization: await (async () => {
          const ids = Object.keys(actor.doc.roles || {}).filter((id) =>
            roleIn(actor, id)
          );
          const orgs = await readMany(
            actor,
            ids.map((id) => `organizations/${id}`)
          );
          return ids.map((id) => ({
            organization: `organizations/${id}`,
            name: orgs.get(`organizations/${id}`)?.data?.name || null,
            role: roleIn(actor, id),
          }));
        })(),
        memberOf: memberships,
        assignedToYou: {
          keyResults: krs.map((k) => ({
            id: k.id,
            name: k.data.name,
            objective: refPath(k.data.objective),
          })),
          measurements: kpis.map((k) => ({ id: k.id, name: k.data.name })),
        },
        rules: INSTRUCTIONS.split('Rules the server enforces on every change:\n')[1],
      };
    })
  );

  // --- structure -------------------------------------------------------------

  server.registerTool(
    'list_structure',
    {
      title: 'Organizations, departments and teams',
      description:
        'All active organizations with their departments and teams, with item references to use in other tools and your rights on each.',
      inputSchema: {},
      annotations: READ,
    },
    tool(async () => {
      const active = [where('archived', '==', false)];
      const [orgs, deps, teams] = await Promise.all(
        ['organizations', 'departments', 'products'].map((c) =>
          readQuery(actor, c, active)
        )
      );
      return orgs.map((org) => ({
        ...itemSummary(org.path, org.data, actor),
        departments: deps
          .filter((d) => refPath(d.data.organization) === org.path)
          .map((dep) => ({
            ...itemSummary(dep.path, dep.data, actor),
            teams: teams
              .filter((t) => refPath(t.data.department) === dep.path)
              .map((t) => itemSummary(t.path, t.data, actor)),
          })),
      }));
    })
  );

  // --- OKRs ------------------------------------------------------------------

  server.registerTool(
    'get_okrs',
    {
      title: 'Objectives and key results of an item',
      description:
        'Objectives of an organization, department or team with their key results, progress, assignees and your rights on each. Optionally only objectives overlapping a period.',
      inputSchema: {
        item_ref: z.string().describe('Item reference from list_structure'),
        from: dateString.optional(),
        to: dateString.optional(),
        include_archived: z.boolean().optional(),
      },
      annotations: READ,
    },
    tool(async ({ item_ref: itemRef, from, to, include_archived: includeArchived }) => {
      const itemPath = assertItemRef(itemRef);
      const item = await readDoc(actor, itemPath);
      const filters = [where('parent', '==', tagRef(itemPath))];
      if (!includeArchived) {
        filters.push(where('archived', '==', false));
      }
      let objectives = await readQuery(actor, 'objectives', filters);
      const fromDate = from ? dateValue(from, 'from') : null;
      const toDate = to ? dateValue(to, 'to') : null;
      objectives = objectives.filter((o) => {
        const start = o.data.startDate ? new Date(o.data.startDate.__ts) : null;
        const end = o.data.endDate ? new Date(o.data.endDate.__ts) : null;
        return (
          (!fromDate || !end || end >= fromDate) && (!toDate || !start || start <= toDate)
        );
      });

      const krFilters = (o) => {
        const f = [where('objective', '==', tagRef(o.path))];
        if (!includeArchived) {
          f.push(where('archived', '==', false));
        }
        return f;
      };
      const krLists = await Promise.all(
        objectives.map((o) => readQuery(actor, 'keyResults', krFilters(o)))
      );
      const parents = await parentsOf(actor, krLists.flat());

      return {
        item: itemSummary(itemPath, item, actor),
        objectives: objectives.map((o, i) => ({
          id: o.id,
          name: o.data.name,
          description: o.data.description || '',
          startDate: plain(o.data.startDate) || null,
          endDate: plain(o.data.endDate) || null,
          weight: o.data.weight ?? 1,
          progression: o.data.progression ?? null,
          archived: o.data.archived === true,
          yourRights: { canEdit: itemRights(actor, itemPath, item).canEditOkrs },
          keyResults: krLists[i].map((kr) => keyResultView(actor, kr, parents)),
        })),
      };
    })
  );

  server.registerTool(
    'get_key_result',
    {
      title: 'One key result with its progress history',
      description:
        'Details of a key result, its recent progress values and your rights on it.',
      inputSchema: {
        key_result_id: z.string(),
        history_limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: READ,
    },
    tool(async ({ key_result_id: id, history_limit: n }) => {
      const record = await loadRecord(actor, 'keyResults', id);
      const progress = await readQuery(actor, `keyResults/${id}/progress`, [
        orderBy('timestamp', 'desc'),
        limit(n || 20),
      ]);
      const parents = new Map([[record.parentPath, { data: record.parent }]]);
      return {
        ...keyResultView(actor, { id, data: record.data }, parents),
        objective: refPath(record.data.objective),
        progress: progress.map((p) => ({
          id: p.id,
          value: p.data.value,
          date: plain(p.data.timestamp),
          comment: p.data.comment || '',
          by: emailOf(refPath(p.data.createdBy)),
        })),
      };
    })
  );

  server.registerTool(
    'record_key_result_progress',
    {
      title: 'Record progress on a key result',
      description:
        'Add a progress value to a key result. Allowed for admins, the assignees, or any team member when nobody is assigned.',
      inputSchema: {
        key_result_id: z.string(),
        value: z.number(),
        date: dateString.optional().describe('Defaults to now; cannot be in the future'),
        comment: optionalText(1000),
      },
      annotations: WRITE,
    },
    tool(async ({ key_result_id: id, value, date, comment }) => {
      const record = await loadRecord(actor, 'keyResults', id);
      const timestamp = date ? dateValue(date, 'date') : new Date();
      if (timestamp.getTime() > Date.now() + 60 * 1000) {
        throw new ToolError('The date cannot be in the future.');
      }
      const path = `keyResults/${id}/progress/${autoId()}`;
      await write(
        actor,
        [
          {
            type: 'create',
            path,
            data: {
              value,
              ...(comment ? { comment } : {}),
              timestamp: tagTimestamp(timestamp),
              ...created(actor),
            },
          },
        ],
        record.rights.reason
      );
      return {
        ok: true,
        keyResult: record.data.name,
        value,
        date: timestamp.toISOString(),
      };
    })
  );

  server.registerTool(
    'create_objective',
    {
      title: 'Create an objective',
      description:
        'Create an objective for an item. Allowed for members of the item and admins.',
      inputSchema: {
        item_ref: z.string(),
        name: z.string().min(1).max(500),
        description: optionalText(5000),
        start_date: dateString,
        end_date: dateString,
        weight: z.number().positive().optional(),
      },
      annotations: WRITE,
    },
    tool(async (args) => {
      const itemPath = assertItemRef(args.item_ref);
      const item = await readDoc(actor, itemPath);
      const start = startOfDay(dateValue(args.start_date, 'start_date'));
      const end = startOfDay(dateValue(args.end_date, 'end_date'));
      if (end < start) {
        throw new ToolError('end_date must not be before start_date.');
      }
      const path = `objectives/${autoId()}`;
      await write(
        actor,
        [
          {
            type: 'create',
            path,
            data: {
              name: args.name,
              description: args.description || '',
              weight: args.weight || 1,
              parent: tagRef(itemPath),
              startDate: tagTimestamp(start),
              endDate: tagTimestamp(end),
              ...created(actor),
            },
          },
        ],
        itemRights(actor, itemPath, item).canEditOkrs
          ? null
          : okrRefusal(itemRights(actor, itemPath, item), item.name)
      );
      return { ok: true, objectiveId: path.split('/')[1] };
    })
  );

  server.registerTool(
    'update_objective',
    {
      title: 'Edit an objective',
      description: 'Change name, description, period or weight of an objective.',
      inputSchema: {
        objective_id: z.string(),
        name: z.string().min(1).max(500).optional(),
        description: optionalText(5000),
        start_date: dateString.optional(),
        end_date: dateString.optional(),
        weight: z.number().positive().optional(),
      },
      annotations: WRITE,
    },
    tool(async (args) => {
      const path = `objectives/${args.objective_id}`;
      const objective = await readDoc(actor, path);
      const changes = pickDefined({
        name: args.name,
        description: args.description,
        weight: args.weight,
        startDate: args.start_date
          ? tagTimestamp(startOfDay(dateValue(args.start_date, 'start_date')))
          : undefined,
        endDate: args.end_date
          ? tagTimestamp(startOfDay(dateValue(args.end_date, 'end_date')))
          : undefined,
      });
      if (!Object.keys(changes).length) {
        throw new ToolError('Nothing to change.');
      }
      if (changes.startDate || changes.endDate) {
        changes.period = deleteField;
      }
      const parentPath = refPath(objective.parent);
      const parent = (await readMany(actor, [parentPath])).get(parentPath)?.data;
      await write(
        actor,
        [{ type: 'update', path, data: { ...changes, ...edited(actor) } }],
        itemRights(actor, parentPath, parent).canEditOkrs
          ? null
          : okrRefusal(itemRights(actor, parentPath, parent), parent?.name)
      );
      return { ok: true };
    })
  );

  server.registerTool(
    'create_key_result',
    {
      title: 'Create a key result',
      description:
        "Add a key result to an objective. The owner defaults to the objective's item; assignees must be members of the owner's team.",
      inputSchema: {
        objective_id: z.string(),
        name: z.string().min(1).max(500),
        description: optionalText(5000),
        owner_item_ref: z.string().optional(),
        unit: z.string().min(1).max(25),
        start_value: z.number(),
        target_value: z.number(),
        weight: z.number().positive().optional(),
        assignee_emails: emails,
      },
      annotations: WRITE,
    },
    tool(async (args) => {
      const objectivePath = `objectives/${args.objective_id}`;
      const objective = await readDoc(actor, objectivePath);
      const ownerPath = args.owner_item_ref
        ? assertItemRef(args.owner_item_ref)
        : refPath(objective.parent);
      const owner = await readDoc(actor, ownerPath);
      const path = `keyResults/${autoId()}`;
      await write(
        actor,
        [
          {
            type: 'create',
            path,
            data: {
              name: args.name,
              description: args.description || '',
              unit: args.unit,
              startValue: args.start_value,
              targetValue: args.target_value,
              weight: args.weight || 1,
              parent: tagRef(ownerPath),
              objective: tagRef(objectivePath),
              assignees: assigneeRefs(args.assignee_emails || []),
              ...created(actor),
            },
          },
        ],
        itemRights(actor, ownerPath, owner).canEditOkrs
          ? `every assignee must be a member of ${owner.name}.`
          : okrRefusal(itemRights(actor, ownerPath, owner), owner.name)
      );
      await syncObjectiveContributors(actor, objectivePath);
      return { ok: true, keyResultId: path.split('/')[1] };
    })
  );

  server.registerTool(
    'update_key_result',
    {
      title: 'Edit a key result',
      description:
        'Change a key result. Assignees may edit the content; changing assignees or owner is for admins (or any team member while nobody is assigned).',
      inputSchema: {
        key_result_id: z.string(),
        name: z.string().min(1).max(500).optional(),
        description: optionalText(5000),
        unit: z.string().min(1).max(25).optional(),
        start_value: z.number().optional(),
        target_value: z.number().optional(),
        weight: z.number().positive().optional(),
        owner_item_ref: z.string().optional(),
        assignee_emails: emails,
      },
      annotations: WRITE,
    },
    tool(async (args) => {
      const record = await loadRecord(actor, 'keyResults', args.key_result_id);
      const changes = pickDefined({
        name: args.name,
        description: args.description,
        unit: args.unit,
        startValue: args.start_value,
        targetValue: args.target_value,
        weight: args.weight,
        parent: args.owner_item_ref
          ? tagRef(assertItemRef(args.owner_item_ref))
          : undefined,
        assignees: args.assignee_emails ? assigneeRefs(args.assignee_emails) : undefined,
      });
      if (!Object.keys(changes).length) {
        throw new ToolError('Nothing to change.');
      }
      const managing = 'parent' in changes || 'assignees' in changes;
      let reason = record.rights.reason;
      if (managing && record.rights.canManage) {
        reason = 'assignees must be members of the owning team.';
      }
      await write(
        actor,
        [{ type: 'update', path: record.path, data: { ...changes, ...edited(actor) } }],
        reason
      );
      if ('parent' in changes) {
        await syncObjectiveContributors(actor, refPath(record.data.objective));
      }
      return { ok: true };
    })
  );

  // --- measurements ----------------------------------------------------------

  server.registerTool(
    'get_measurements',
    {
      title: 'Measurements (KPIs) of an item',
      description:
        'Measurements of an organization, department or team, with assignees and your rights on each.',
      inputSchema: {
        item_ref: z.string(),
        include_archived: z.boolean().optional(),
      },
      annotations: READ,
    },
    tool(async ({ item_ref: itemRef, include_archived: includeArchived }) => {
      const itemPath = assertItemRef(itemRef);
      const item = await readDoc(actor, itemPath);
      const filters = [where('parent', '==', tagRef(itemPath))];
      if (!includeArchived) {
        filters.push(where('archived', '==', false));
      }
      const kpis = await readQuery(actor, 'kpis', filters);
      const parents = new Map([[itemPath, { data: item }]]);
      return {
        item: itemSummary(itemPath, item, actor),
        measurements: kpis.map((k) => kpiView(actor, k, parents)),
      };
    })
  );

  server.registerTool(
    'get_measurement',
    {
      title: 'One measurement with values and goals',
      description:
        'Details of a measurement, its recent values, its goals and your rights on it.',
      inputSchema: {
        measurement_id: z.string(),
        history_limit: z.number().int().min(1).max(365).optional(),
      },
      annotations: READ,
    },
    tool(async ({ measurement_id: id, history_limit: n }) => {
      const record = await loadRecord(actor, 'kpis', id);
      const [progress, goals] = await Promise.all([
        readQuery(actor, `kpis/${id}/progress`, [
          orderBy('timestamp', 'desc'),
          limit(n || 30),
        ]),
        readQuery(actor, `kpis/${id}/goals`, [where('archived', '==', false)]),
      ]);
      const parents = new Map([[record.parentPath, { data: record.parent }]]);
      return {
        ...kpiView(actor, { id, data: record.data }, parents),
        values: progress.map((p) => ({
          date: plain(p.data.timestamp)?.slice(0, 10),
          value: p.data.value,
          comment: p.data.comment || '',
        })),
        goals: goals.map((g) => ({
          id: g.id,
          name: g.data.name,
          from: plain(g.data.fromDate),
          to: plain(g.data.toDate),
          value: g.data.value,
        })),
      };
    })
  );

  server.registerTool(
    'record_measurement_value',
    {
      title: 'Record a measurement value',
      description:
        'Set the value of a measurement for a day (one value per day; an existing value that day is replaced). Allowed for admins, the assignees, or any team member when nobody is assigned.',
      inputSchema: {
        measurement_id: z.string(),
        value: z.number(),
        date: dateString
          .optional()
          .describe('Defaults to today; cannot be in the future'),
        comment: optionalText(1000),
      },
      annotations: WRITE,
    },
    tool(async ({ measurement_id: id, value, date, comment }) => {
      const record = await loadRecord(actor, 'kpis', id);
      const day = startOfDay(date ? dateValue(date, 'date') : new Date());
      if (day > new Date()) {
        throw new ToolError('The date cannot be in the future.');
      }
      const sameDay = await queryDocuments(`kpis/${id}/progress`, [
        where('timestamp', '>=', tagTimestamp(day)),
        where('timestamp', '<=', tagTimestamp(endOfDay(day))),
      ]);
      const first = sameDay[0]?.data;
      const data = {
        value,
        ...(comment ? { comment } : {}),
        timestamp: tagTimestamp(setHours(day, 12)),
        ...(first
          ? {
              created: first.created || null,
              createdBy: first.createdBy || null,
              ...edited(actor),
            }
          : created(actor)),
      };
      delete data.archived;
      await write(
        actor,
        [
          ...sameDay.map((p) => ({ type: 'delete', path: p.path })),
          { type: 'create', path: `kpis/${id}/progress/${autoId()}`, data },
        ],
        record.rights.reason
      );
      // Latest value on the measurement itself, as the web app keeps it.
      const latest = await queryDocuments(`kpis/${id}/progress`, [
        orderBy('timestamp', 'desc'),
        limit(1),
      ]);
      if (latest[0]) {
        await write(
          actor,
          [
            {
              type: 'update',
              path: record.path,
              data: {
                currentValue: latest[0].data.value,
                valid: true,
                error: deleteField,
              },
            },
          ],
          record.rights.reason
        );
      }
      return {
        ok: true,
        measurement: record.data.name,
        value,
        date: day.toISOString().slice(0, 10),
      };
    })
  );

  const kpiFields = {
    name: z.string().min(1).max(500),
    description: optionalText(5000),
    type: z
      .enum(['plain', 'keyfig', 'ri'])
      .describe('plain, keyfig (key figure) or ri (result indicator)'),
    format: z.enum(['integer', 'percentage']),
    start_value: z.enum(['zero', 'min']),
    preferred_trend: z.enum(['increase', 'decrease', 'neutral']),
    update_frequency: z.enum([
      'daily',
      'weekly',
      'monthly',
      'quarterly',
      'annual',
      'irregular',
    ]),
  };
  const kpiData = (args) =>
    pickDefined({
      name: args.name,
      description: args.description,
      kpiType: args.type,
      format: args.format,
      startValue: args.start_value,
      preferredTrend: args.preferred_trend,
      updateFrequency: args.update_frequency,
      assignees: args.assignee_emails ? assigneeRefs(args.assignee_emails) : undefined,
    });

  server.registerTool(
    'create_measurement',
    {
      title: 'Create a measurement',
      description:
        'Create a measurement (KPI) for an item. Allowed for members of the item and admins.',
      inputSchema: { item_ref: z.string(), ...kpiFields, assignee_emails: emails },
      annotations: WRITE,
    },
    tool(async (args) => {
      const itemPath = assertItemRef(args.item_ref);
      const item = await readDoc(actor, itemPath);
      const path = `kpis/${autoId()}`;
      await write(
        actor,
        [
          {
            type: 'create',
            path,
            data: {
              description: '',
              assignees: [],
              ...kpiData(args),
              api: true,
              parent: tagRef(itemPath),
              ...created(actor),
            },
          },
        ],
        itemRights(actor, itemPath, item).canEditOkrs
          ? `every assignee must be a member of ${item.name}.`
          : okrRefusal(itemRights(actor, itemPath, item), item.name)
      );
      return { ok: true, measurementId: path.split('/')[1] };
    })
  );

  server.registerTool(
    'update_measurement',
    {
      title: 'Edit a measurement',
      description:
        'Change a measurement. Assignees may edit the content; changing assignees is for admins (or any team member while nobody is assigned).',
      inputSchema: {
        measurement_id: z.string(),
        name: kpiFields.name.optional(),
        description: kpiFields.description,
        type: kpiFields.type.optional(),
        format: kpiFields.format.optional(),
        start_value: kpiFields.start_value.optional(),
        preferred_trend: kpiFields.preferred_trend.optional(),
        update_frequency: kpiFields.update_frequency.optional(),
        assignee_emails: emails,
      },
      annotations: WRITE,
    },
    tool(async (args) => {
      const record = await loadRecord(actor, 'kpis', args.measurement_id);
      const changes = kpiData(args);
      if (!Object.keys(changes).length) {
        throw new ToolError('Nothing to change.');
      }
      let reason = record.rights.reason;
      if ('assignees' in changes && record.rights.canManage) {
        reason = 'assignees must be members of the owning team.';
      }
      await write(
        actor,
        [{ type: 'update', path: record.path, data: { ...changes, ...edited(actor) } }],
        reason
      );
      return { ok: true };
    })
  );

  // --- archive / restore -----------------------------------------------------

  const COLLECTION_OF_KIND = {
    objective: 'objectives',
    key_result: 'keyResults',
    measurement: 'kpis',
  };

  server.registerTool(
    'set_archived',
    {
      title: 'Archive or restore',
      description:
        'Archive (hide, what "delete" does in the web app) or restore an objective, key result or measurement. Nothing is deleted permanently.',
      inputSchema: {
        kind: z.enum(['objective', 'key_result', 'measurement']),
        id: z.string(),
        archived: z.boolean().describe('true to archive, false to restore'),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    tool(async ({ kind, id, archived }) => {
      const collection = COLLECTION_OF_KIND[kind];
      let reason;
      let objectivePath = null;
      if (kind === 'objective') {
        const data = await readDoc(actor, `objectives/${id}`);
        const parentPath = refPath(data.parent);
        const parent = (await readMany(actor, [parentPath])).get(parentPath)?.data;
        reason = okrRefusal(itemRights(actor, parentPath, parent), parent?.name);
      } else {
        const record = await loadRecord(actor, collection, id);
        if (record.rights.canManage) {
          reason = null;
        } else if (record.rights.canEdit) {
          reason =
            'project coordinators cannot archive or restore; ask a project manager or an admin.';
        } else {
          reason = record.rights.reason;
        }
        objectivePath = kind === 'key_result' ? refPath(record.data.objective) : null;
      }
      await write(
        actor,
        [
          {
            type: 'update',
            path: `${collection}/${id}`,
            data: { archived, ...edited(actor) },
          },
        ],
        reason
      );
      if (objectivePath) {
        await syncObjectiveContributors(actor, objectivePath);
      }
      return { ok: true, kind, id, archived };
    })
  );

  return server;
}
