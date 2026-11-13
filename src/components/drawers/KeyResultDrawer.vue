<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { doc } from '@/backend/firestore';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { useAuthStore } from '@/store/auth';
import { useActiveItemStore } from '@/store/activeItem';
import { useActiveOrganizationStore } from '@/store/activeOrganization';
import { useActiveObjectiveStore } from '@/store/activeObjective';
import { useKeyResult } from '@/composables/keyResult';
import KeyResult from '@/db/KeyResult';
import { db } from '@/config/backend';
import '@oslokommune/punkt-elements/dist/pkt-button.js';
import { BtnSave, BtnDelete, BtnCancel } from '@/components/generic/form';
import ArchivedRestore from '@/components/ArchivedRestore.vue';
import PagedDrawerWrapper from '@/components/drawers/PagedDrawerWrapper.vue';
import syncObjectiveContributors from '@/util/objectiveContributors';
import { assigneeIds, teamIds } from '@/util/assignees';
import AssigneesField from '@/components/forms/AssigneesField.vue';

const i18n = useI18n();
const toast = useToast();

const props = defineProps({
  keyResultId: {
    type: String,
    required: false,
    default: null,
  },
});

const emit = defineEmits(['create', 'update', 'archive', 'restore', 'add-key-result']);

const authStore = useAuthStore();
const { isAdminOfCurrentItemOrganization, isSuperAdmin } = storeToRefs(authStore);
const { organizationTree, organization, departments, products } = storeToRefs(
  useActiveOrganizationStore()
);
const { item: activeItem } = storeToRefs(useActiveItemStore());
const { objective: activeObjective, objectiveRef: activeObjectiveRef } = storeToRefs(
  useActiveObjectiveStore()
);
const { keyResult, keyResultRef, keyResultPromise } = useKeyResult(props.keyResultId);

const drawer = ref(null);
const pageCount = ref(2);
const isEditMode = computed(() => !!props.keyResultId);
const isLoading = ref(false);
const isArchived = computed(() => keyResult.value && keyResult.value.archived);

const formData = ref({});
const objectiveParent = computed(() => activeObjective.value.parent);

const ownerOptions = computed(() => {
  const options = [];

  if (canSelectOwner(objectiveParent.value)) {
    options.push({
      label: objectiveParent.value.name,
      value: objectiveParent.value.path,
    });
  }

  let children = [];

  if (objectiveParent.value.path.startsWith('organizations')) {
    children = organizationTree.value.children;
  } else if (objectiveParent.value.path.startsWith('departments')) {
    children = organizationTree.value.children.find(
      (d) => d.id === objectiveParent.value.id
    )?.children;
  }

  children
    .filter(canSelectOwner)
    .map(({ name, path }) => ({ label: name, value: path }))
    .forEach((option) => options.push(option));

  return options;
});

// Reassigning, moving and archiving an assigned key result is for admins;
// while nobody is assigned, every team member may do it.
const canManage = computed(
  () =>
    !isEditMode.value || !keyResult.value || authStore.canManageRecord(keyResult.value)
);

// The selected owner (organization, department or team) with its members.
const selectedParent = computed(() => {
  const id = formData.value.parent?.value?.split('/').pop();
  return (
    [organization.value, ...departments.value, ...products.value].find(
      (node) => node?.id === id
    ) || null
  );
});

// Assignees must belong to the owner's team.
watch(selectedParent, (parent) => {
  if (parent && formData.value.assignees?.length) {
    const members = teamIds(parent);
    formData.value.assignees = formData.value.assignees.filter((id) =>
      members.includes(id)
    );
  }
});

onMounted(async () => {
  formData.value = {
    unit: i18n.t('keyResult.defaultUnit'),
    parent: { label: activeItem.value.name, value: activeItem.value.path },
    weight: 1,
    startValue: 0,
    targetValue: 100,
    assignees: [],
  };

  await keyResultPromise.value;

  if (keyResult.value) {
    const { name, description, parent, unit, startValue, targetValue, weight } =
      keyResult.value;

    formData.value.name = name;
    formData.value.description = description;
    formData.value.parent = {
      label: parent.name,
      value: parent.path,
    };
    formData.value.unit = unit;
    formData.value.startValue = startValue;
    formData.value.targetValue = targetValue;
    formData.value.weight = weight;
    formData.value.assignees = assigneeIds(keyResult.value);
  }
});

// Owners to choose from: items the user manages (project manager there), or
// any item for admins.
function canSelectOwner(item) {
  return (
    isAdminOfCurrentItemOrganization.value ||
    isSuperAdmin.value ||
    authStore.isManagerOf(item)
  );
}

async function save() {
  const { pageIndex, next } = drawer.value;

  if (pageIndex < pageCount.value) {
    next();
    return;
  }

  isLoading.value = true;

  try {
    const { name, description, unit, weight, startValue, targetValue, parent } =
      formData.value;

    const data = {
      name,
      description: description || '',
      unit: unit || 1,
      startValue,
      targetValue,
      weight: weight || 1,
      parent: doc(db, parent.value),
    };

    // Only sent by those who may change it (the server checks this too).
    if (canManage.value) {
      data.assignees = (formData.value.assignees || []).map((id) => doc(db, 'users', id));
    }

    if (keyResult.value) {
      // Update existing key result
      await KeyResult.update(keyResult.value.id, data);
      emit('update', keyResultRef.value);
    } else {
      // Create new key result
      const createdKeyResultRef = await KeyResult.create({
        ...data,
        objective: activeObjectiveRef.value,
      });
      keyResultRef.value = createdKeyResultRef;
      emit('create', keyResultRef.value);
    }

    await syncObjectiveContributors(activeObjective.value.id);

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
    await KeyResult.archive(keyResult.value.id);
    await syncObjectiveContributors(activeObjective.value.id);
    emit('archive', keyResultRef.value);
  } catch (error) {
    toast.error(i18n.t('toaster.error.archive', { document: keyResult.value.name }));
  }
  isLoading.value = false;
}

async function restore() {
  try {
    await KeyResult.restore(keyResult.value.id);
    await syncObjectiveContributors(activeObjective.value.id);
    emit('restore', keyResult.value.id);
  } catch {
    toast.error(i18n.t('toaster.error.restore', { document: keyResult.value.name }));
  }
}
</script>

<template>
  <PagedDrawerWrapper ref="drawer" :visible="!!drawer" :page-count="pageCount">
    <template #title="{ isDone, isSuccess }">
      <template v-if="!isDone">
        {{ $t(isEditMode ? 'admin.keyResult.change' : 'admin.keyResult.new') }}
      </template>
      <template v-else-if="isSuccess">
        {{ $t(isEditMode ? 'keyResult.updated' : 'keyResult.created') }}
      </template>
      <template v-else>{{ $t('toaster.error.save') }}</template>
    </template>

    <template #page="{ pageIndex, prev, cancel }">
      <FormSection>
        <template v-if="pageIndex === 1">
          <FormComponent
            v-model="formData.name"
            input-type="textarea"
            name="name"
            :disabled="isArchived"
            :rows="2"
            :label="$t('fields.name')"
            rules="required"
          />

          <FormComponent
            v-model="formData.description"
            input-type="textarea"
            name="description"
            :disabled="isArchived"
            :rows="2"
            :label="$t('fields.description')"
          />

          <FormComponent
            v-model="formData.parent"
            input-type="custom-select"
            name="owner"
            :disabled="ownerOptions.length === 1 || isArchived || !canManage"
            :options="ownerOptions"
            :label="$t('admin.keyResult.owner.label')"
            :store-object="true"
            :helptext="$t('admin.keyResult.owner.help')"
            :can-clear="false"
            rules="required"
          />

          <AssigneesField
            v-model="formData.assignees"
            :parent="selectedParent"
            :disabled="isArchived || !canManage"
            :helptext="canManage ? null : $t('assignees.locked')"
          />
        </template>

        <template v-else-if="pageIndex === 2">
          <FormComponent
            v-model="formData.unit"
            input-type="input"
            name="unit"
            :label="$t('keyResult.unit')"
            rules="required|max:25"
          />

          <div class="pkt-grid">
            <FormComponent
              v-model="formData.startValue"
              input-type="input"
              name="startValue"
              :label="$t('keyResult.startValue')"
              rules="required"
              type="number"
              class="pkt-cell pkt-cell--span6"
            />

            <FormComponent
              v-model="formData.targetValue"
              input-type="input"
              name="targetValue"
              :label="$t('keyResult.targetValue')"
              rules="required"
              type="number"
              class="pkt-cell pkt-cell--span6"
            />
          </div>

          <FormComponent
            v-model="formData.weight"
            input-type="input"
            name="weight"
            :label="$t('keyResult.weight.label')"
            :helptext="$t('keyResult.weight.help')"
            rules="required|positiveNotZero"
            type="number"
          />
        </template>

        <template #actions="{ submit, disabled }">
          <BtnCancel
            v-if="pageIndex === 1"
            :disabled="isLoading || isArchived"
            @click="cancel"
          />
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

    <template #done="{ isSuccess, reset, close }">
      <div class="button-row button-row--left">
        <template v-if="!isSuccess">
          <pkt-button skin="secondary" @click="reset">
            <span>{{ $t('btn.back') }}</span>
          </pkt-button>
        </template>
        <template v-else>
          <pkt-button skin="tertiary" @click="close">
            <span>{{ $t('btn.close') }}</span>
          </pkt-button>
          <pkt-button
            v-if="!isEditMode"
            skin="secondary"
            @click="$emit('add-key-result')"
          >
            <span>{{ $t('btn.createAnotherKeyResult') }}</span>
          </pkt-button>
        </template>
      </div>
    </template>

    <template #footer="{ isDone }">
      <template v-if="isEditMode && !isDone">
        <ArchivedRestore
          v-if="isArchived && canManage"
          :restore="restore"
          object-type="keyResult"
        />
        <div v-else-if="!isArchived && canManage" class="button-row">
          <BtnDelete
            :disabled="isLoading"
            :text="$t('admin.keyResult.delete')"
            @confirm="archive"
          />
        </div>
      </template>
    </template>
  </PagedDrawerWrapper>
</template>
