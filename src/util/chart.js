export const DEFAULT_SERIES_OPTIONS = {
  type: 'line',
  showSymbol: true,
  symbolSize: 6,
  emphasis: { disabled: true },
  lineStyle: { width: 3 },
};

export function getComputedStyleVariable(cssVar) {
  return getComputedStyle(document.documentElement).getPropertyValue(cssVar);
}
