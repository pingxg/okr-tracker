/**
 * Entry point for the ported Cloud Functions.
 *
 * Importing this module registers all document triggers (audit log, slugs,
 * key result progress roll-up, KPI caches) with the local trigger registry,
 * and exports the two former HTTPS functions as Express apps:
 *   api       external API for KPIs and key results  -> mounted at /api/external
 *   internal  access requests                         -> mounted at /api/internal
 *
 * The scheduled Firestore backup/restore functions are replaced by
 * `scripts/backup.js` (pg_dump).
 */
import handleKpiProgress from './kpi/progress/index.js';
import handleKpiGoals from './kpi/goals/index.js';

import api from './api/index.js';
import internal from './backend/index.js';

import './slug/index.js';
import './audit/index.js';
import './progress/index.js';

export { handleKpiProgress, handleKpiGoals, api, internal };
