import { useLocalStorage } from '@vueuse/core';

/**
 * "Only mine": show only key results and measurements assigned to the
 * signed-in user. One switch for the OKR and measurement pages, remembered in
 * this browser.
 */
export const onlyMine = useLocalStorage('okr-only-mine', false);

export default onlyMine;
