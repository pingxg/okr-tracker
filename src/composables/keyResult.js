import { computed, toRef } from 'vue';
import { storeToRefs } from 'pinia';
import { globalFirestoreOptions, useCollection, useDocument } from '@/backend/vuefire';
import { doc, collection, query, orderBy } from '@/backend/firestore';
import { db } from '@/config/backend';
import { useAuthStore } from '@/store/auth';
import { useActiveItemStore } from '@/store/activeItem';
import { useActiveObjectiveStore } from '@/store/activeObjective';

export function useKeyResult(keyResultId) {
  const { item } = storeToRefs(useActiveItemStore());
  const { hasEditRights } = storeToRefs(useAuthStore());
  const { objective } = storeToRefs(useActiveObjectiveStore());

  const itemPath = computed(() => item.value?.path);
  const objectivePath = computed(() => objective.value?.path);

  // Key result
  const _keyResultId = toRef(keyResultId);

  const keyResultRef = computed({
    get() {
      // Wait for the objective: the key result is checked against it below.
      // Loading both at once (opening a key result by its link) could
      // otherwise reject the key result as "not found" when it arrived first.
      return (
        _keyResultId.value &&
        itemPath.value &&
        objectivePath.value &&
        doc(db, 'keyResults', _keyResultId.value).withConverter({
          fromFirestore: (snapshot, options) => {
            const keyResult = globalFirestoreOptions.converter.fromFirestore(
              snapshot,
              options
            );

            // Ensure that the key result belongs to the currently active objective
            if (keyResult.objective.path !== objective.value?.path) {
              return null;
            }

            return keyResult.archived && !hasEditRights.value ? null : keyResult;
          },
        })
      );
    },
    set(ref) {
      _keyResultId.value = ref.id;
    },
  });

  const {
    data: keyResult,
    pending: isLoading,
    promise: keyResultPromise,
  } = useDocument(keyResultRef, {
    maxRefDepth: 1,
    ssrKey: `keyResult_${keyResultId}`,
  });

  // Progress
  const { data: progress, pending: progressIsLoading } = useCollection(
    computed(
      () =>
        keyResultRef.value &&
        query(
          collection(db, keyResultRef.value.path, 'progress'),
          orderBy('timestamp', 'asc')
        )
    ),
    { ssrKey: `progress_${keyResultId}` }
  );

  return {
    keyResultRef,
    keyResult,
    keyResultPromise,
    isLoading,
    progress,
    progressIsLoading,
  };
}

export default useKeyResult;
