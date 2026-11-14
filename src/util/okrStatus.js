/**
 * Status and "update due" for key results and measurements in the browser,
 * using the rules shared with the server (common/okr/status.js).
 */
import {
  KEY_RESULT_UPDATE_DAYS,
  keyResultStatus,
  latestCachedKpiDate,
  measurementUpdateDays,
  periodRunning,
  updateDue,
} from '../../common/okr/status.js';

/** Start and end of an objective (new fields or the old `period` reference). */
export function objectivePeriodOf(objective) {
  if (!objective) {
    return { startDate: null, endDate: null };
  }
  if (objective.startDate && objective.endDate) {
    return { startDate: objective.startDate, endDate: objective.endDate };
  }
  return {
    startDate: objective.period?.startDate || null,
    endDate: objective.period?.endDate || null,
  };
}

/** { status, auto, manual, note, due } for a key result in its objective. */
export function keyResultState(keyResult, objective, now = new Date()) {
  const { startDate, endDate } = objectivePeriodOf(objective);
  const status = keyResultStatus(keyResult, startDate, endDate, now);
  const due =
    periodRunning(startDate, endDate, now) &&
    updateDue(
      {
        lastUpdate: keyResult?.lastProgressAt,
        since: keyResult?.created,
        days: KEY_RESULT_UPDATE_DAYS,
      },
      now
    ).due;
  return { ...status, due };
}

/** Whether a measurement is due for a new value. */
export function measurementDue(kpi, now = new Date()) {
  return updateDue(
    {
      lastUpdate: latestCachedKpiDate(kpi),
      since: kpi?.created,
      days: measurementUpdateDays(kpi),
    },
    now
  ).due;
}
