import { formatLocale } from 'd3-format';
import { format, parseISO, formatISO, getDefaultOptions } from 'date-fns';

// date-fns' Chinese short formats use two-digit years (26-10-01), which are easy
// to misread, so Chinese gets full years.
const isChinese = () => getDefaultOptions().locale?.code === 'zh-CN';

export const dateLong = (d) => format(d, 'PPP');
export const dateLongCompact = (d) => format(d, 'PP');
export const dateShort = (d) => format(d, isChinese() ? 'yyyy-MM-dd' : 'P');
export const dateExtraShort = (d) => format(d, 'dd.MM.yy');
export const dateTimeShort = (d) => format(d, isChinese() ? 'yyyy-MM-dd HH:mm' : 'Pp');
export const dateTimeLong = (d) => format(d, 'PPPp');

export function periodDates({ startDate, endDate }, strategy = dateLong) {
  if (!startDate || !endDate) {
    throw new Error('Invalid period object');
  }
  return [
    startDate instanceof Date ? startDate : startDate.toDate(),
    endDate instanceof Date ? endDate : endDate.toDate(),
  ]
    .map(strategy)
    .join('​–​');
}

export const parseDate = (d) => parseISO(d);
export const formatISOShort = (d) => formatISO(d, { representation: 'date' });

// English and Chinese both use '.' for decimals and ',' for thousands.
export const numberLocale = formatLocale({
  decimal: '.',
  thousands: ',',
  grouping: [3],
});

export const formatLargeNumber = (value) => numberLocale.format(',')(value);
