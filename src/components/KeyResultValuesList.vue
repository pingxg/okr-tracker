<script setup>
import { computed } from 'vue';
import { dateTimeShort } from '@/util';
import { formatValue } from '@/util/keyResultProgress';
import '@oslokommune/punkt-elements/dist/pkt-button.js';
import ListTransition from '@/components/generic/transitions/ListTransition.vue';

const props = defineProps({
  progress: {
    type: Array,
    required: true,
  },

  canEdit: {
    type: Boolean,
    required: false,
    default: false,
  },
});

const orderedProgress = computed(() => {
  return [...props.progress].sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1));
});

function addedBy(record) {
  const user = record.editedBy || record.createdBy;
  return user ? user.displayName || user.id : null;
}
</script>

<template>
  <div class="key-result-values-list">
    <table class="key-result-values-list__table">
      <thead>
        <tr>
          <th>{{ $t('widget.history.value') }}</th>
          <th>{{ $t('widget.history.time') }}</th>
          <th>{{ $t('widget.history.comment') }}</th>
          <th v-if="canEdit" class="key-result-values-list__actions">
            <span class="pkt-sr-only">{{ $t('widget.history.actions') }}</span>
          </th>
        </tr>
      </thead>
      <ListTransition tag="tbody">
        <tr v-for="record in orderedProgress" :key="record.id">
          <td>
            {{ formatValue(record.value) }}
          </td>
          <td>
            <span>
              {{ dateTimeShort(record.timestamp.toDate()) }}
            </span>
            <div v-if="addedBy(record)" class="mt-size-8">
              {{ addedBy(record) }}
            </div>
          </td>
          <td class="key-result-values-list__comment">
            {{ record.comment || '' }}
          </td>
          <td v-if="canEdit" class="key-result-values-list__actions">
            <pkt-button
              v-tooltip.left="$t('tooltip.editProgress')"
              size="small"
              skin="tertiary"
              variant="icon-only"
              iconName="edit"
              @click="$emit('edit-value', record)"
            >
              <span>{{ $t('tooltip.editProgress') }}</span>
            </pkt-button>
          </td>
        </tr>
      </ListTransition>
    </table>
  </div>
</template>

<style lang="scss" scoped>
@use '@oslokommune/punkt-css/dist/scss/abstracts/mixins/breakpoints' as *;
@use '@oslokommune/punkt-css/dist/scss/abstracts/mixins/typography' as *;

.key-result-values-list__table {
  width: 100%;
  border-spacing: 0 0.5rem;

  th {
    padding: 0 1rem;
    text-align: left;
    white-space: nowrap;
    @include get-text('pkt-txt-12-medium');
  }

  td {
    padding: 1rem;
    vertical-align: top;
    text-align: left;
    text-wrap: balance;
    background-color: var(--color-white);
    @include get-text('pkt-txt-14-light');

    &:nth-child(1) {
      text-wrap: nowrap;
      border-left: 0.25rem solid var(--color-blue-dark);
    }

    &:nth-child(2) {
      @include bp-up(36rem) {
        min-width: 10rem;
      }
    }
  }
}

.key-result-values-list__comment {
  width: 100%;
  white-space: pre-line;
}

// Its own narrow column, so the button stays in its row.
.key-result-values-list__actions {
  width: 1%;
  padding: 0.5rem !important;
  white-space: nowrap;
  vertical-align: middle !important;
}
</style>
