<script setup>
/**
 * Status of a key result (正常 / 有风险 / 落后) and, optionally, that an
 * update is due. Uses the design system's tag colours.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({
  // onTrack | atRisk | behind (null: not shown)
  status: {
    type: String,
    required: false,
    default: null,
  },
  // Set by hand at the latest check-in (shown with the reason as tooltip).
  manual: {
    type: Boolean,
    required: false,
    default: false,
  },
  note: {
    type: String,
    required: false,
    default: '',
  },
  due: {
    type: Boolean,
    required: false,
    default: false,
  },
});

const i18n = useI18n();

const SKINS = { onTrack: 'green', atRisk: 'yellow', behind: 'red' };

const tooltip = computed(() => {
  if (!props.status) {
    return null;
  }
  const how = i18n.t(props.manual ? 'status.setByHand' : 'status.computed');
  return props.note ? `${how}: ${props.note}` : how;
});
</script>

<template>
  <span class="status-tags">
    <span
      v-if="status"
      v-tooltip="tooltip"
      :class="['pkt-tag', 'pkt-tag--small', `pkt-tag--${SKINS[status]}`]"
    >
      {{ $t(`status.${status}`) }}{{ manual ? ' *' : '' }}
    </span>
    <span v-if="due" class="pkt-tag pkt-tag--small pkt-tag--gray">
      {{ $t('status.due') }}
    </span>
  </span>
</template>

<style lang="scss" scoped>
.status-tags {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  align-items: center;
}
</style>
