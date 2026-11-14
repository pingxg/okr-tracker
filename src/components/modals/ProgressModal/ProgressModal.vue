<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import ProgressValueForm from '@/components/forms/ProgressValueForm.vue';
import ModalWrapper from '../ModalWrapper.vue';
import { useProgressModal } from './progressModal.js';

const props = defineProps({
  record: {
    type: Object,
    required: false,
    default: null,
  },
  unit: {
    type: String,
    required: false,
    default: null,
  },
  // The status computed from progress and time, shown on the "automatic"
  // option (onTrack | atRisk | behind).
  autoStatus: {
    type: String,
    required: false,
    default: null,
  },
});

const emit = defineEmits(['create-record', 'update-record', 'delete-record', 'close']);

const i18n = useI18n();

const { thisRecord, loading, saveRecord, deleteRecord, close } = useProgressModal(
  props,
  emit,
  { withStatus: true }
);

// 'auto' stands for "no manual status" (saved as '').
const statusChoice = computed({
  get: () => thisRecord.value.status || 'auto',
  set(value) {
    thisRecord.value.status = value === 'auto' ? '' : value;
  },
});

const statusOptions = computed(() => [
  {
    value: 'auto',
    label: props.autoStatus
      ? i18n.t('status.automaticNow', { status: i18n.t(`status.${props.autoStatus}`) })
      : i18n.t('status.automatic'),
  },
  ...['onTrack', 'atRisk', 'behind'].map((s) => ({
    value: s,
    label: i18n.t(`status.${s}`),
  })),
]);
</script>

<template>
  <ModalWrapper variant="wide" @close="close">
    <template #header>
      {{ $t(record ? 'keyResult.editValue' : 'keyResult.newValue') }}
    </template>

    <ProgressValueForm
      v-model:value="thisRecord.value"
      v-model:comment="thisRecord.comment"
      v-model:timestamp="thisRecord.timestamp"
      :loading="loading"
      :enable-delete="!!record"
      :enable-time="true"
      :value-suffix="unit"
      @submit="saveRecord"
      @delete="deleteRecord"
    >
      <div class="progress-status">
        <FormComponent
          v-model="statusChoice"
          input-type="custom-select"
          name="status"
          :label="$t('status.label')"
          :helptext="$t('status.help')"
          :options="statusOptions"
          :can-clear="false"
        />
        <FormComponent
          v-if="thisRecord.status"
          v-model="thisRecord.statusNote"
          input-type="textarea"
          name="statusNote"
          :rows="2"
          :label="$t('status.reason')"
          rules="required|max:500"
        />
      </div>
    </ProgressValueForm>
  </ModalWrapper>
</template>

<style lang="scss" scoped>
.progress-status {
  margin-top: 1rem;
}
</style>
