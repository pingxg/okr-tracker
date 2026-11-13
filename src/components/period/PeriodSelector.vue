<script setup>
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

// Two calendars: start date and end date.
const start = ref(null);
const end = ref(null);

watch(
  () => props.modelValue,
  (period) => {
    start.value = period?.startDate || null;
    end.value = period?.endDate || null;
  },
  { immediate: true }
);

const startConfig = { inline: true };
const endConfig = computed(() => ({ inline: true, minDate: start.value || null }));

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
  // Keep the menu open: the end date may be changed next.
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
    <div class="period-selector__calendars">
      <DatePicker
        id="period-start"
        :model-value="start"
        :label="$t('fields.startDate')"
        :date-picker-config="startConfig"
        @update:model-value="onStart"
      />
      <DatePicker
        id="period-end"
        :model-value="end"
        :label="$t('fields.endDate')"
        :date-picker-config="endConfig"
        @update:model-value="onEnd"
      />
    </div>

    <div v-if="periodShortcuts.length">
      <h3 class="pkt-txt-16-medium">
        {{ $t('general.shortcuts') }}
      </h3>
      <div class="period-selector__options">
        <PeriodShortcut
          v-for="period in periodShortcuts"
          v-bind="period"
          :key="period.key"
          :active="modelValue?.key === period.key"
          @click="select(period)"
        />
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.period-selector {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  width: 100%;
  padding: 1rem;

  &__calendars {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem 2rem;
  }

  &__options {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  :deep(.flatpickr-calendar) {
    top: 0;
    margin: 0 auto;
    border: 0;
    border-radius: 0;
    box-shadow: none;

    svg {
      vertical-align: baseline;
    }
  }
}

:deep(.flatpickr-input) {
  display: none;
}
</style>
