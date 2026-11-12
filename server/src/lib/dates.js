/**
 * Calendar dates as ISO strings (YYYY-MM-DD). Effective dates, cycles and
 * deadlines are whole days, so they are kept as strings rather than Date
 * objects to avoid time-zone shifts.
 */
import config from '../config.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    return false;
  }
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

/** Today's date in the organisation's time zone (spec §18: Helsinki time). */
export function today(timeZone = config.timeZone) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** True when the effective-dated row [validFrom, validTo) covers `date`. */
export function inEffect(row, date) {
  return row.validFrom <= date && (row.validTo === null || date < row.validTo);
}
