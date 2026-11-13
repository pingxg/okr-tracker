<script setup>
/**
 * A period as two calendars, start date and end date, built from the regular
 * date field. v-model is [start, end] like the former range picker, so the
 * forms using it save exactly as before.
 */
import { computed } from 'vue';
import { startOfDay } from 'date-fns';
import FormComponent from '@/components/generic/form/FormComponent.vue';

const props = defineProps({
  name: {
    type: String,
    required: true,
  },
  disabled: {
    type: Boolean,
    required: false,
    default: false,
  },
  rules: {
    type: String,
    required: false,
    default: null,
  },
});

const model = defineModel({ type: Array, default: null });

const start = computed({
  get: () => model.value?.[0] || null,
  set(value) {
    let end = model.value?.[1] || null;
    // An end date before the new start date is cleared so it is picked again.
    if (value && end && startOfDay(end) < startOfDay(value)) {
      end = null;
    }
    model.value = value || end ? [value, end] : null;
  },
});

const end = computed({
  get: () => model.value?.[1] || null,
  set(value) {
    const begin = model.value?.[0] || null;
    model.value = begin || value ? [begin, value] : null;
  },
});

// The end calendar cannot go before the start date.
const endConfig = computed(() => ({ minDate: start.value || null }));
</script>

<template>
  <div class="date-range-fields">
    <FormComponent
      v-model="start"
      input-type="date"
      :name="`${props.name}Start`"
      :disabled="disabled"
      :label="$t('fields.startDate')"
      :placeholder="$t('general.selectDate')"
      :rules="rules"
    />
    <FormComponent
      v-model="end"
      input-type="date"
      :name="`${props.name}End`"
      :disabled="disabled"
      :label="$t('fields.endDate')"
      :placeholder="$t('general.selectDate')"
      :date-picker-config="endConfig"
      :rules="rules"
    />
  </div>
</template>

<style lang="scss" scoped>
.date-range-fields {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0 1rem;

  @include bp('tablet-up') {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
