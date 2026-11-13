<script setup>
import { computed, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { useActiveItemStore } from '@/store/activeItem';
import { useAuthStore } from '@/store/auth';
import { doc } from '@/backend/firestore';
import { db } from '@/config/backend';
import { assigneeIds } from '@/util/assignees';
import AssigneesField from '@/components/forms/AssigneesField.vue';
import { useKpi } from '@/composables/kpi';
import {
  kpiFormats,
  kpiStartValues,
  kpiTypes,
  kpiTrendOptions,
  kpiUpdateFrequencies,
} from '@/util/kpiHelpers';
import Kpi from '@/db/Kpi';
import '@oslokommune/punkt-elements/dist/pkt-button.js';
import '@oslokommune/punkt-elements/dist/pkt-alert.js';
import { BtnSave, BtnDelete } from '@/components/generic/form';
import ArchivedRestore from '@/components/ArchivedRestore.vue';
import PagedDrawerWrapper from '@/components/drawers/PagedDrawerWrapper.vue';
import FadeTransition from '@/components/generic/transitions/FadeTransition.vue';

const i18n = useI18n();
const toast = useToast();

const props = defineProps({
  kpiId: {
    type: String,
    required: false,
    default: null,
  },
});

const emit = defineEmits(['create', 'update', 'archive', 'restore']);

const { item: activeItem, itemRef: activeItemRef } = storeToRefs(useActiveItemStore());
const authStore = useAuthStore();
const { kpi, kpiRef, kpiPromise } = useKpi(props.kpiId);

const drawer = ref(null);
const pageCount = ref(3);
const isEditMode = computed(() => !!props.kpiId);
const isLoading = ref(false);
const isArchived = computed(() => kpi.value && kpi.value.archived);

const formData = ref({});
// User ids of the people the measurement is assigned to.
const assignees = ref([]);
// Reassigning and archiving an assigned measurement is for admins; while
// nobody is assigned, every team member may do it.
const canManage = computed(
  () => !isEditMode.value || !kpi.value || authStore.canManageRecord(kpi.value)
);

const formatOptions = kpiFormats();
const startValueOptions = kpiStartValues();
const trendOptions = kpiTrendOptions();
const updateFrequencyOptions = kpiUpdateFrequencies();
const typeOptions = kpiTypes().map(({ id, label, description }) => ({
  id,
  label,
  helptext: description,
}));

onMounted(async () => {
  formData.value = {
    name: '',
    description: '',
    format: 'integer',
    startValue: 'zero',
    preferredTrend: 'increase',
    kpiType: 'plain',
    updateFrequency: 'daily',
    api: true,
  };

  await kpiPromise.value;

  if (kpi.value) {
    formData.value = Object.fromEntries(
      Object.entries(formData.value).map(([key]) => [
        key,
        key in kpi.value ? kpi.value[key] : formData.value[key],
      ])
    );
    assignees.value = assigneeIds(kpi.value);
  }
});

async function save() {
  const { pageIndex, next } = drawer.value;

  if (pageIndex < pageCount.value) {
    next();
    return;
  }

  isLoading.value = true;

  try {
    const data = { ...formData.value };
    // Only sent by those who may change it (the server checks this too).
    if (canManage.value) {
      data.assignees = assignees.value.map((id) => doc(db, 'users', id));
    }

    if (kpi.value) {
      // Update existing KPI
      await Kpi.update(kpi.value.id, data);
      emit('update', kpiRef.value);
    } else {
      // Create new KPI
      const createdKpiRef = await Kpi.create({
        ...data,
        parent: activeItemRef.value,
      });
      kpiRef.value = createdKpiRef;
      emit('create', kpiRef.value);
    }
    next();
  } catch (error) {
    next(false);
    toast.error(i18n.t('toaster.error.save'));
  }

  isLoading.value = false;
}

async function archive() {
  isLoading.value = true;
  try {
    await Kpi.archive(kpi.value.id);
    emit('archive', kpiRef.value);
  } catch {
    toast.error(i18n.t('toaster.error.archive', { document: kpi.value.name }));
  }
  isLoading.value = false;
}

async function restore() {
  isLoading.value = true;
  try {
    await Kpi.restore(kpi.value.id);
    emit('restore', kpiRef.value);
  } catch {
    toast.error(i18n.t('toaster.error.restore', { document: kpi.value.name }));
  }
  isLoading.value = false;
}
</script>

<template>
  <PagedDrawerWrapper ref="drawer" :visible="!!drawer" :page-count="pageCount">
    <template #title="{ isDone, isSuccess }">
      <template v-if="!isDone">
        {{ $t(isEditMode ? 'admin.measurement.change' : 'admin.measurement.new') }}
      </template>
      <template v-else-if="isSuccess">
        {{ $t(isEditMode ? 'admin.measurement.updated' : 'admin.measurement.created') }}
      </template>
      <template v-else>{{ $t('toaster.error.save') }}</template>
    </template>

    <template #page="{ pageIndex, prev, cancel }">
      <FormSection>
        <template v-if="pageIndex === 1">
          <FormComponent
            v-model="formData.name"
            input-type="input"
            name="name"
            :label="$t('fields.name')"
            :disabled="isArchived"
            rules="required"
          />

          <FormComponent
            v-model="formData.description"
            input-type="textarea"
            :rows="8"
            name="description"
            :disabled="isArchived"
            :label="$t('fields.description')"
          />

          <AssigneesField
            v-model="assignees"
            :parent="
              kpi?.parent && typeof kpi.parent === 'object' ? kpi.parent : activeItem
            "
            :disabled="isArchived || !canManage"
            :helptext="canManage ? null : $t('assignees.locked')"
          />
        </template>

        <template v-else-if="pageIndex === 2">
          <FormComponent
            v-model="formData.kpiType"
            input-type="radio-group"
            name="kpiType"
            :label="$t('fields.kpitype')"
            rules="required"
            :options="typeOptions"
          />

          <FadeTransition>
            <pkt-alert v-if="formData.kpiType === 'ri'">
              {{ $t('kpi.help.resultIndicatorWarning') }}
            </pkt-alert>
          </FadeTransition>
        </template>

        <template v-else-if="pageIndex === 3">
          <FormComponent
            v-model="formData.format"
            input-type="custom-select"
            name="format"
            :label="$t('kpi.format')"
            rules="required"
            select-label="label"
            :options="formatOptions"
            :can-clear="false"
            value-prop="id"
          />

          <FormComponent
            v-model="formData.startValue"
            input-type="custom-select"
            name="startValue"
            :label="$t('kpi.startValue')"
            rules="required"
            :options="startValueOptions"
            :can-clear="false"
            value-prop="id"
          />

          <FormComponent
            v-model="formData.preferredTrend"
            input-type="custom-select"
            name="preferredTrend"
            :label="$t('kpi.preferredTrend')"
            rules="required"
            :options="trendOptions"
            :can-clear="false"
            value-prop="id"
          />

          <FormComponent
            v-model="formData.updateFrequency"
            input-type="custom-select"
            name="updateFrequency"
            :label="$t('kpi.updateFrequency.label')"
            rules="required"
            :options="updateFrequencyOptions"
            :can-clear="false"
            value-prop="id"
            :helptext="$t('kpi.updateFrequency.help')"
          />
        </template>

        <template #actions="{ submit, disabled }">
          <pkt-button
            v-if="pageIndex === 1"
            skin="tertiary"
            :disabled="isLoading || isArchived"
            @click="cancel"
          >
            <span>{{ $t('btn.cancel') }}</span>
          </pkt-button>
          <pkt-button
            v-else
            skin="tertiary"
            :disabled="isLoading || isArchived"
            @click="prev"
          >
            <span>{{ $t('btn.back') }}</span>
          </pkt-button>
          <BtnSave
            :text="pageIndex === pageCount ? $t('btn.complete') : $t('btn.continue')"
            :disabled="disabled || isLoading || isArchived"
            variant="label-only"
            @click="submit(save)"
          />
        </template>
      </FormSection>
    </template>

    <template #footer="{ isDone }">
      <template v-if="isEditMode && !isDone">
        <ArchivedRestore
          v-if="isArchived && canManage"
          :restore="restore"
          :text="$t('kpi.archived')"
        />
        <div v-else-if="!isArchived && canManage" class="button-row">
          <BtnDelete
            :disabled="isLoading"
            :text="$t('admin.measurement.delete')"
            @confirm="archive"
          />
        </div>
      </template>
    </template>
  </PagedDrawerWrapper>
</template>
