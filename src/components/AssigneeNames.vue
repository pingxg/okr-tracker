<script setup>
/**
 * "Assigned to: A, B" for a key result or measurement. Shows nothing when
 * nobody is assigned. Assignees come loaded with the record (user documents);
 * the email is shown when a name is not available.
 */
import { computed } from 'vue';
import { userIdOf } from '@/util/assignees';

const props = defineProps({
  record: {
    type: Object,
    required: true,
  },
});

const names = computed(() =>
  (props.record?.assignees || [])
    .map((a) => (a && typeof a === 'object' && a.displayName) || userIdOf(a))
    .filter(Boolean)
);
</script>

<template>
  <p v-if="names.length" class="assignee-names pkt-txt-14">
    <pkt-icon name="user" class="assignee-names__icon" />
    <span>{{ $t('assignees.shown', { names: names.join(', ') }) }}</span>
  </p>
</template>

<style lang="scss" scoped>
.assignee-names {
  display: flex;
  gap: 0.375rem;
  align-items: center;
  margin: 0;
  color: var(--color-grayscale-60);

  &__icon {
    flex-shrink: 0;
    width: 1rem;
    height: 1rem;
  }
}
</style>
