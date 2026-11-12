/**
 * Seed a demo organisation so the app is usable locally without any import.
 *
 *   SEED_ADMIN_EMAIL=you@example.com node scripts/seed.js
 *
 * Writes go through the same document store as the app, so triggers run:
 * slugs are created, the audit log is filled and progress is rolled up.
 * Safe to re-run: it does nothing when organisations already exist.
 */
import { startOfQuarter, endOfQuarter, subDays } from 'date-fns';
import { migrate } from '../src/db/migrate.js';
import pool from '../src/db/pool.js';
import { getFirestore } from '../src/compat/firestore-admin.js';
import '../src/functions/index.js'; // register triggers
import defaultPreferences from '../src/functions/util/defaultPreferences.js';

const adminEmail = (process.env.SEED_ADMIN_EMAIL || 'admin@example.com').toLowerCase();
const memberEmail = (process.env.SEED_MEMBER_EMAIL || 'member@example.com').toLowerCase();

await migrate();
const db = getFirestore();

const existing = await db.collection('organizations').limit(1).get();
if (!existing.empty) {
  console.log('Organisations already exist; nothing to seed.');
  await pool.end();
  process.exit(0);
}

const now = new Date();
const meta = (email) => ({
  archived: false,
  created: now,
  createdBy: db.doc(`users/${email}`),
});

const adminRef = db.doc(`users/${adminEmail}`);
const memberRef = db.doc(`users/${memberEmail}`);

await adminRef.set({
  id: adminEmail,
  email: adminEmail,
  displayName: 'Demo Admin',
  superAdmin: true,
  admin: [],
  preferences: defaultPreferences,
});
await memberRef.set({
  id: memberEmail,
  email: memberEmail,
  displayName: 'Demo Member',
  superAdmin: false,
  admin: [],
  preferences: defaultPreferences,
});

const org = await db.collection('organizations').add({
  ...meta(adminEmail),
  name: 'Spartao Group',
  missionStatement: 'Demo organisation created by the seed script.',
  team: [adminRef],
});
await adminRef.update({ admin: [org.id] });

const dept = await db.collection('departments').add({
  ...meta(adminEmail),
  name: 'Finance',
  missionStatement: 'Group finance and controlling.',
  organization: org,
  team: [adminRef, memberRef],
});

const product = await db.collection('products').add({
  ...meta(adminEmail),
  name: 'Sushibar',
  missionStatement: 'Retail sushi bars.',
  organization: org,
  department: dept,
  team: [memberRef],
});

const startDate = startOfQuarter(now);
const endDate = endOfQuarter(now);

async function objective(parent, name, krs) {
  const obj = await db.collection('objectives').add({
    ...meta(adminEmail),
    name,
    description: '',
    weight: 1,
    parent,
    startDate,
    endDate,
    progression: 0,
  });
  for (const kr of krs) {
    const krRef = await db.collection('keyResults').add({
      ...meta(adminEmail),
      name: kr.name,
      description: '',
      unit: kr.unit,
      startValue: kr.start,
      targetValue: kr.target,
      weight: 1,
      objective: obj,
      parent,
      progression: 0,
    });
    for (const [daysAgo, value] of kr.values) {
      await krRef.collection('progress').add({
        ...meta(adminEmail),
        value,
        timestamp: subDays(now, daysAgo),
        comment: '',
      });
    }
  }
  return obj;
}

await objective(org, 'Raise the OKR check-in rate across the group', [
  {
    name: 'Check-in rate from 7% to 80%',
    unit: '%',
    start: 7,
    target: 80,
    values: [
      [21, 12],
      [7, 35],
    ],
  },
  {
    name: 'Every team publishes its quarterly OKRs',
    unit: 'teams',
    start: 0,
    target: 13,
    values: [[10, 6]],
  },
]);
await objective(dept, 'Close the books faster', [
  {
    name: 'Monthly close in 5 working days',
    unit: 'days',
    start: 10,
    target: 5,
    values: [
      [14, 8],
      [3, 7],
    ],
  },
]);
await objective(product, 'Grow sushibar sales', [
  {
    name: 'Weekly sales from €150k to €175k',
    unit: '€k',
    start: 150,
    target: 175,
    values: [[7, 160]],
  },
]);

const kpi = await db.collection('kpis').add({
  ...meta(adminEmail),
  name: 'Salmon sales per week',
  description: '',
  type: 'keyfig',
  format: 'integer',
  updateFrequency: 'weekly',
  parent: product,
  order: 0,
});
for (const [daysAgo, value] of [
  [28, 158000],
  [21, 151000],
  [14, 173000],
  [7, 166000],
]) {
  await kpi.collection('progress').add({
    value,
    timestamp: subDays(now, daysAgo),
    created: now,
    createdBy: adminRef,
  });
}

console.log(`Seeded demo data. Super admin: ${adminEmail}, member: ${memberEmail}`);
await pool.end();
