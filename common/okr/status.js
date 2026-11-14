/**
 * Status of key results and when key results and measurements are due for
 * an update. Shared by the browser, the server and the MCP tools, so they
 * all agree. No dependencies.
 *
 * Status (key results):
 *   computed from progress against the time elapsed in the objective's
 *   period, unless the person who recorded the latest progress set it by
 *   hand ("override").
 *     onTrack  progress at most 10 points behind the time elapsed
 *     atRisk   10–25 points behind
 *     behind   more than 25 points behind
 *
 * Due for an update:
 *   key results: no progress recorded for 7 days (while their objective's
 *   period is running);
 *   measurements: none recorded within their update frequency (daily 1 day,
 *   weekly 7, monthly 31, quarterly 92, annual 366; "irregular" never).
 */

export const STATUSES = ['onTrack', 'atRisk', 'behind'];

export const KEY_RESULT_UPDATE_DAYS = 7;

export const FREQUENCY_DAYS = {
  daily: 1,
  weekly: 7,
  monthly: 31,
  quarterly: 92,
  annual: 366,
  irregular: null,
};

const DAY = 24 * 60 * 60 * 1000;

/** Accepts Date, ISO string, Firestore-like Timestamp or { __ts }. */
export function toDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value.toDate === 'function') {
    return value.toDate();
  }
  if (typeof value === 'object' && value.__ts) {
    return new Date(value.__ts);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Share of the period elapsed at `now`, 0–1. */
export function timeElapsed(startDate, endDate, now = new Date()) {
  const start = toDate(startDate);
  const end = toDate(endDate);
  if (!start || !end || end <= start) {
    return null;
  }
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

/** Status from progress (0–1) and the objective period alone. */
export function autoStatus(progression, startDate, endDate, now = new Date()) {
  const elapsed = timeElapsed(startDate, endDate, now);
  const progress = Number(progression) || 0;
  if (elapsed === null || progress >= 1) {
    return 'onTrack';
  }
  const gap = elapsed - progress;
  if (gap <= 0.1) {
    return 'onTrack';
  }
  if (gap <= 0.25) {
    return 'atRisk';
  }
  return 'behind';
}

/**
 * A key result's status: the manual one recorded with its latest progress,
 * else the computed one. Returns { status, auto, manual, note }.
 */
export function keyResultStatus(keyResult, startDate, endDate, now = new Date()) {
  const auto = autoStatus(keyResult?.progression, startDate, endDate, now);
  const manual = STATUSES.includes(keyResult?.status) ? keyResult.status : null;
  return {
    status: manual || auto,
    auto,
    manual,
    note: manual ? keyResult?.statusNote || '' : '',
  };
}

/**
 * Whether an update is due. `lastUpdate` is the latest progress (or null),
 * `since` when the item was created (counts as the start when nothing has
 * been recorded yet). Returns { due, days, lastUpdate } where `days` is the
 * expected interval (null: never due).
 */
export function updateDue({ lastUpdate, since, days }, now = new Date()) {
  const last = toDate(lastUpdate) || toDate(since);
  if (!days) {
    return { due: false, days: null, lastUpdate: toDate(lastUpdate) };
  }
  const due = !last || now - last > days * DAY;
  return { due, days, lastUpdate: toDate(lastUpdate) };
}

export const measurementUpdateDays = (kpi) =>
  kpi?.updateFrequency in FREQUENCY_DAYS ? FREQUENCY_DAYS[kpi.updateFrequency] : 7;

/** Key results are only due while their objective's period is running. */
export function periodRunning(startDate, endDate, now = new Date()) {
  const start = toDate(startDate);
  const end = toDate(endDate);
  if (!start || !end) {
    return true;
  }
  return start <= now && now <= new Date(end.getTime() + DAY);
}

/** Latest date in a KPI's cached progress (JSON of [date, value, comment]). */
export function latestCachedKpiDate(kpi) {
  if (!kpi?.progress || typeof kpi.progress !== 'string') {
    return null;
  }
  try {
    const rows = JSON.parse(kpi.progress);
    return rows.length ? new Date(`${rows[0][0]}T12:00:00`) : null;
  } catch {
    return null;
  }
}
