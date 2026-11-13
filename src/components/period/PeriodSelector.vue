<script setup>
/**
 * Period picker in the header: shortcuts first, then a custom period as two
 * date fields (start, end), each opening its own calendar.
 */
import { computed, ref, watch } from 'vue';
import { endOfDay, startOfDay } from 'date-fns';
import { periodObjectFromDates } from '@/util';
import DatePicker from '@/components/generic/form/DatePicker.vue';
import PeriodShortcut from './PeriodShortcut.vue';

const props = defineProps({
  modelValue: {
    type: Object,
    required: false,
    default: null,
  },
  periodShortcuts: {
    type: Array,
    required: false,
    default: () => [],
  },
});

const emit = defineEmits(['update:modelValue', 'select']);

const start = ref(null);
const end = ref(null);

// The custom fields only show a custom period; a shortcut is shown as the
// highlighted button instead.
watch(
  () => props.modelValue,
  (period) => {
    const custom = period && !period.key;
    start.value = (custom && period.startDate) || null;
    end.value = (custom && period.endDate) || null;
  },
  { immediate: true }
);

// The calendars open outside the menu; clicks in them must not close it.
const keepMenuOpen = (_dates, _str, instance) =>
  instance.calendarContainer.classList.add('ignore-click-outside');

const startConfig = { onReady: [keepMenuOpen] };
const endConfig = computed(() => ({
  onReady: [keepMenuOpen],
  minDate: start.value || null,
}));

const sameDay = (a, b) =>
  Boolean(a && b) && startOfDay(a).getTime() === startOfDay(b).getTime();

function emitPeriod(close) {
  if (!start.value || !end.value) {
    return;
  }
  const period = periodObjectFromDates(startOfDay(start.value), endOfDay(end.value));
  emit('update:modelValue', period);
  if (close) {
    emit('select', period);
  }
}

function onStart(value) {
  if (sameDay(value, start.value)) {
    return;
  }
  start.value = value;
  // An end date before the new start date has to be picked again.
  if (value && end.value && startOfDay(end.value) < startOfDay(value)) {
    end.value = null;
    return;
  }
  emitPeriod(false);
}

function onEnd(value) {
  if (sameDay(value, end.value)) {
    return;
  }
  end.value = value;
  emitPeriod(true);
}

function select(period) {
  emit('update:modelValue', period);
  emit('select', period);
}
</script>

<template>
  <div class="period-selector">
    <section v-if="periodShortcuts.length">
      <h3 class="pkt-txt-16-medium mb-size-8">{{ $t('general.shortcuts') }}</h3>
      <div class="period-selector__options">
        <PeriodShortcut
          v-for="period in periodShortcuts"
          v-bind="period"
          :key="period.key"
          :active="modelValue?.key === period.key"
          @click="select(period)"
        />
      </div>
    </section>

    <section>
      <h3 class="pkt-txt-16-medium mb-size-8">{{ $t('period.custom') }}</h3>
      <div class="period-selector__dates">
        <DatePicker
          id="period-start"
          :model-value="start"
          :label="$t('fields.startDate')"
          :placeholder="$t('general.selectDate')"
          :date-picker-config="startConfig"
          @update:model-value="onStart"
        />
        <DatePicker
          id="period-end"
          :model-value="end"
          :label="$t('fields.endDate')"
          :placeholder="$t('general.selectDate')"
          :date-picker-config="endConfig"
          @update:model-value="onEnd"
        />
      </div>
    </section>
  </div>
</template>

<style lang="scss" scoped>
.period-selector {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  width: 100%;
  padding: 1rem;

  &__options {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;

    :deep(.period-shortcut),
    :deep(.period-shortcut .pkt-btn) {
      width: 100%;
      height: 100%;
    }

    :deep(.period-shortcut .pkt-btn) {
      justify-content: flex-start;
      text-align: left;
      white-space: normal;
    }
  }

  &__dates {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }
}
</style>
