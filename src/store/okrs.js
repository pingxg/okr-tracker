import { computed, ref } from 'vue';
import { defineStore, storeToRefs } from 'pinia';
import { useCollection } from '@/backend/vuefire';
import { useRoute } from 'vue-router';
import { collection, doc, query, where } from '@/backend/firestore';
import { authUser } from '@/backend/auth';
import { onlyMine } from '@/composables/onlyMine';
import { userIdOf } from '@/util/assignees';
import { useLocalStorage } from '@vueuse/core';
import { useActiveObjectiveStore } from '@/store/activeObjective';
import { db } from '@/config/backend';
import { DEFAULT_OKR_PERIOD, getPeriods } from '@/config/periods';
import { PeriodSerializer } from '@/util/period';
import { useActiveItemStore } from '@/store/activeItem';

export const useOkrsStore = defineStore('okrs', () => {
  const route = useRoute();
  const itemStore = useActiveItemStore();

  // Period
  const period = useLocalStorage('okr-period', getPeriods()[DEFAULT_OKR_PERIOD], {
    serializer: PeriodSerializer,
  });

  // Objectives
  const { objective: activeObjective } = storeToRefs(useActiveObjectiveStore());

  const isOkrsView = computed(() =>
    ['ItemHome', 'ObjectiveHome', 'KeyResultHome'].includes(route.name)
  );

  const { data: _objectives, pending: _objectivesIsLoading } = useCollection(
    computed(
      () =>
        isOkrsView.value &&
        itemStore.itemRef &&
        query(
          collection(db, 'objectives'),
          where('parent', '==', itemStore.itemRef),
          where('archived', '==', false)
        )
    ),
    { maxRefDepth: 1, ssrKey: 'objectives' }
  );

  const { data: _objectiveContributions, pending: _objectiveContributionsIsLoading } =
    useCollection(
      computed(
        () =>
          isOkrsView.value &&
          itemStore.itemRef &&
          query(
            collection(db, 'objectiveContributors'),
            where('item', '==', itemStore.itemRef)
          )
      ),
      { maxRefDepth: 1, ssrKey: 'objectiveContributions' }
    );

  // Key results assigned to the signed-in user, for "Only mine".
  const myUserRef = computed(
    () => authUser.value?.email && doc(db, 'users', authUser.value.email)
  );
  const { data: _myKeyResults, pending: _myKeyResultsIsLoading } = useCollection(
    computed(
      () =>
        isOkrsView.value &&
        onlyMine.value &&
        myUserRef.value &&
        query(
          collection(db, 'keyResults'),
          where('assignees', 'array-contains', myUserRef.value),
          where('archived', '==', false)
        )
    ),
    { maxRefDepth: 0, ssrKey: 'myKeyResults' }
  );
  /** Ids of objectives that have a key result assigned to the user. */
  const myObjectiveIds = computed(
    () => new Set(_myKeyResults.value.map((kr) => userIdOf(kr.objective)))
  );

  const isLoading = computed(
    () =>
      _objectivesIsLoading.value ||
      _objectiveContributionsIsLoading.value ||
      (onlyMine.value && _myKeyResultsIsLoading.value)
  );

  const allObjectives = computed(() => [
    // Objectives where the currently active item is parent
    ..._objectives.value,
    // Also include external objectives
    ..._objectiveContributions.value
      .filter((oc) => {
        return (
          // Filter out archived objectives ...
          !oc.objective.archived &&
          // ... and those that aren't external.
          !_objectives.value.map((o) => o.id).includes(oc.objective.id)
        );
      })
      .map((oc) => oc.objective),
  ]);

  /** Number of objectives before the "Only mine" filter. */
  const allObjectivesCount = computed(() => allObjectives.value.length);

  const objectives = computed(() => {
    const shown = onlyMine.value
      ? allObjectives.value.filter((o) => myObjectiveIds.value.has(o.id))
      : [...allObjectives.value];

    // Include any active objective - either lifted or archived - as ghost until dismissed
    if (activeObjective.value && !shown.find((o) => o.id === activeObjective.value.id)) {
      shown.push(activeObjective.value);
    }

    return shown;
  });

  // Workbench
  const _workbenchObjectivesIds = ref([]);
  const workbenchObjectives = computed(() =>
    objectives.value
      .filter((o) => _workbenchObjectivesIds.value.includes(o.id))
      .sort(
        (a, b) =>
          (a.startDate || a.period.startDate) - (b.startDate || b.period.startDate)
      )
  );

  function addWorkbenchObjective(objectiveId) {
    if (!_workbenchObjectivesIds.value.includes(objectiveId)) {
      _workbenchObjectivesIds.value.push(objectiveId);
    }
  }

  function removeWorkbenchObjective(objectiveId) {
    _workbenchObjectivesIds.value = _workbenchObjectivesIds.value.filter(
      (oid) => oid !== objectiveId
    );
  }

  function clearWorkbenchObjectives() {
    _workbenchObjectivesIds.value = [];
  }

  return {
    period,
    objectives,
    allObjectivesCount,
    isLoading,
    workbenchObjectives,
    addWorkbenchObjective,
    removeWorkbenchObjective,
    clearWorkbenchObjectives,
  };
});

export default useOkrsStore;
