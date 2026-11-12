/**
 * English and Chinese texts for the Punkt web components (pkt-*).
 *
 * Punkt ships with Norwegian texts only (e.g. «Valgfritt», «Må fylles ut»).
 * It reads overrides from a store shared on `window` (globalThis) under
 * `Symbol.for('@oslokommune/punkt-strings')` — the same store its exported
 * `setPktStrings()` writes to. We write to it directly so we don't have to
 * import the package entry, which would bundle every Punkt component.
 */

const en = {
  generic: { from: 'From', to: 'To', close: 'Close' },
  forms: {
    optional: 'Optional',
    required: 'Required',
    readMore: "Read more <span class='pkt-sr-only'>about the field</span>",
  },
  validation: {
    valueMissing: 'This field is required',
    typeMismatch: 'Invalid value',
    patternMismatch: 'Invalid format',
    tooShort: 'Too short',
    tooLong: 'Too long',
    rangeUnderflow: 'Value too low',
    rangeOverflow: 'Value too high',
    rangeUnderflowMin: 'The value must be greater than or equal to {min}.',
    rangeOverflowMax: 'The value must be less than or equal to {max}.',
    stepMismatch: 'Must match the step defined for the field',
    timeStepMismatch: 'Must match a step, for example 0, {step} minutes',
    timeStepMismatchHour: 'Must be on the hour',
    timeStepMismatchHalfHour: 'Must be on the hour or half hour',
    dateUnderflow: 'Date too early',
    dateOverflow: 'Date too late',
    counterExceeded: 'You have used {current} of {max}',
  },
  dates: {
    month: 'Month',
    year: 'Year',
    week: 'Week',
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    daysShort: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    months: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
    monthsShort: [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ],
  },
  calendar: { prevMonth: 'Previous month', nextMonth: 'Next month' },
  datepicker: { openPicker: 'Open calendar', deleteDate: 'Clear date' },
  searchinput: { placeholder: 'Search…', submit: 'Search' },
  backlink: { label: 'Go back to the previous page' },
  breadcrumbs: { ariaLabel: 'Breadcrumbs' },
  linkcard: { openInNewTab: 'Opens in a new tab' },
  alert: { lastUpdated: 'Last updated: {date}' },
  tag: { remove: 'Click to remove {label}' },
  listbox: { searchLabel: 'Search the list', searchPlaceholder: 'Search…' },
  combobox: {
    noResults: 'No results',
    maxSelected: 'Maximum number of selections reached',
    tooManySelected: 'Too many selected',
    alreadySelected: 'The value is already selected',
    valueAdded: 'New value added',
    valueSelected: '{value} is selected',
    noValidValue: 'No valid value selected',
  },
};

const zh = {
  generic: { from: '从', to: '至', close: '关闭' },
  forms: {
    optional: '可选',
    required: '必填',
    readMore: "了解更多<span class='pkt-sr-only'>关于此字段</span>",
  },
  validation: {
    valueMissing: '此项为必填',
    typeMismatch: '无效的值',
    patternMismatch: '格式无效',
    tooShort: '太短',
    tooLong: '太长',
    rangeUnderflow: '数值太小',
    rangeOverflow: '数值太大',
    rangeUnderflowMin: '数值必须大于或等于 {min}。',
    rangeOverflowMax: '数值必须小于或等于 {max}。',
    stepMismatch: '必须符合字段规定的步长',
    timeStepMismatch: '必须符合步长，例如 0、{step} 分钟',
    timeStepMismatchHour: '必须是整点',
    timeStepMismatchHalfHour: '必须是整点或半点',
    dateUnderflow: '日期太早',
    dateOverflow: '日期太晚',
    counterExceeded: '已使用 {current}/{max}',
  },
  dates: {
    month: '月',
    year: '年',
    week: '周',
    days: ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'],
    daysShort: ['一', '二', '三', '四', '五', '六', '日'],
    months: [
      '一月',
      '二月',
      '三月',
      '四月',
      '五月',
      '六月',
      '七月',
      '八月',
      '九月',
      '十月',
      '十一月',
      '十二月',
    ],
    monthsShort: [
      '1月',
      '2月',
      '3月',
      '4月',
      '5月',
      '6月',
      '7月',
      '8月',
      '9月',
      '10月',
      '11月',
      '12月',
    ],
  },
  calendar: { prevMonth: '上个月', nextMonth: '下个月' },
  datepicker: { openPicker: '打开日历', deleteDate: '清除日期' },
  searchinput: { placeholder: '搜索…', submit: '搜索' },
  backlink: { label: '返回上一页' },
  breadcrumbs: { ariaLabel: '面包屑导航' },
  linkcard: { openInNewTab: '在新标签页中打开' },
  alert: { lastUpdated: '最后更新：{date}' },
  tag: { remove: '点击移除 {label}' },
  listbox: { searchLabel: '在列表中搜索', searchPlaceholder: '搜索…' },
  combobox: {
    noResults: '没有找到结果',
    maxSelected: '已达到最多可选数量',
    tooManySelected: '选择的项目过多',
    alreadySelected: '该值已被选择',
    valueAdded: '已添加新值',
    valueSelected: '已选择 {value}',
    noValidValue: '没有选择有效的值',
  },
};

const STRINGS = { 'en-US': en, 'zh-CN': zh };
const STORE_KEY = Symbol.for('@oslokommune/punkt-strings');

export default function setPunktLanguage(lang) {
  if (!window[STORE_KEY]) {
    window[STORE_KEY] = { overrides: {}, listeners: new Set() };
  }
  const store = window[STORE_KEY];
  // A new object identity also invalidates Punkt's resolved-strings cache.
  store.overrides = { ...(STRINGS[lang] || en) };
  store.listeners.forEach((listener) => listener());
}
