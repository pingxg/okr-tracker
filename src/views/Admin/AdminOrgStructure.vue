<script setup>
/**
 * 组织架构维护 (spec §17 "架构维护"): the structure as a list on the left, the
 * selected node's form on the right. Changes go through API v1 with an
 * effective date, so the history is kept.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useToast } from 'vue-toast-notification';
import '@oslokommune/punkt-elements/dist/pkt-button.js';
import '@oslokommune/punkt-elements/dist/pkt-alert.js';
import { createOrgNode, getOrgTree, searchUsers, updateOrgNode } from '@/api/org';
import {
  indexTree,
  nodeIcon,
  nodeName,
  orgErrorMessage,
  ownerOf,
} from '@/util/orgStructure';
import { formatISOShort } from '@/util';
import { BtnSave, BtnDelete } from '@/components/generic/form';

const i18n = useI18n();
const route = useRoute();
const router = useRouter();
const toast = useToast();

const tree = ref(null);
const people = ref([]);
const selectedId = ref(null);
const creating = ref(false);
const busy = ref(false);
const formData = ref(null);
const formKey = ref(0);

const locale = computed(() => i18n.locale.value);
const name = (node) => nodeName(node, locale.value);
const index = computed(() => indexTree(tree.value?.nodes || [], locale.value));
const root = computed(() => index.value.root);
const selected = computed(() => index.value.byId.get(selectedId.value) || null);
const isRoot = computed(() => !creating.value && selected.value?.parentId === null);

const typeLabel = (type) =>
  i18n.te(`org.nodeTypes.${type}`) ? i18n.t(`org.nodeTypes.${type}`) : type;

/** The structure flattened depth-first for the list. */
const rows = computed(() => {
  const out = [];
  const walk = (node, depth) => {
    out.push({ node, depth });
    (index.value.children.get(node.id) || []).forEach((child) => walk(child, depth + 1));
  };
  if (root.value) {
    walk(root.value, 0);
  }
  return out;
});

const pathLabel = (node) =>
  [...index.value.ancestors(node.id).slice(1), node].map(name).join(' / ') || name(node);

const typeOptions = computed(() =>
  (tree.value?.nodeTypes || [])
    .filter((t) => t.key !== 'group')
    .map((t) => ({ value: t.key, label: typeLabel(t.key) }))
);

const parentOptions = computed(() => {
  const excluded = new Set();
  if (!creating.value && selected.value) {
    excluded.add(selected.value.id);
    index.value.descendants(selected.value.id).forEach((d) => excluded.add(d.id));
  }
  return (tree.value?.nodes || [])
    .filter((n) => !excluded.has(n.id))
    .map((n) => ({ value: n.id, label: pathLabel(n) }))
    .sort((a, b) => a.label.localeCompare(b.label, locale.value));
});

const ownerOptions = computed(() =>
  people.value.map((p) => ({ value: p.id, label: p.name || p.email }))
);

function resetForm() {
  formKey.value += 1;
  if (creating.value) {
    const parent = selected.value || root.value;
    formData.value = {
      nameZh: '',
      nameEn: '',
      type: parent?.parentId === null ? 'entity' : 'team',
      parentId: parent?.id || null,
      leadUserId: null,
      effectiveDate: new Date(),
    };
    return;
  }
  const node = selected.value;
  formData.value = node && {
    nameZh: node.nameZh || '',
    nameEn: node.nameEn || '',
    type: node.type,
    parentId: node.parentId,
    leadUserId: ownerOf(node.leads)?.userId || null,
    effectiveDate: new Date(),
  };
}

function select(node) {
  selectedId.value = node.id;
  creating.value = false;
  router.replace({ query: { node: node.id } });
  resetForm();
}

function startCreate() {
  creating.value = true;
  resetForm();
}

async function loadTree() {
  tree.value = await getOrgTree();
}

async function save() {
  busy.value = true;
  const f = formData.value;
  try {
    if (creating.value) {
      const created = await createOrgNode({
        parentId: f.parentId,
        type: f.type,
        nameZh: f.nameZh || undefined,
        nameEn: f.nameEn || undefined,
        leadUserId: f.leadUserId || undefined,
        effectiveDate: formatISOShort(f.effectiveDate),
      });
      await loadTree();
      creating.value = false;
      selectedId.value = created.id;
      toast.success(i18n.t('org.admin.created'));
    } else {
      const node = selected.value;
      const patch = { effectiveDate: formatISOShort(f.effectiveDate) };
      if ((f.nameZh || null) !== (node.nameZh || null)) {
        patch.nameZh = f.nameZh || null;
      }
      if ((f.nameEn || null) !== (node.nameEn || null)) {
        patch.nameEn = f.nameEn || null;
      }
      if (!isRoot.value) {
        if (f.type !== node.type) {
          patch.type = f.type;
        }
        if (f.parentId !== node.parentId) {
          patch.parentId = f.parentId;
        }
        if ((f.leadUserId || null) !== (ownerOf(node.leads)?.userId || null)) {
          patch.leadUserId = f.leadUserId || null;
        }
      }
      await updateOrgNode(node.id, patch);
      await loadTree();
      toast.success(i18n.t('org.admin.saved'));
    }
    resetForm();
  } catch (error) {
    toast.error(orgErrorMessage(error, i18n));
  } finally {
    busy.value = false;
  }
}

async function deactivate() {
  busy.value = true;
  try {
    const { parentId } = selected.value;
    await updateOrgNode(selected.value.id, {
      active: false,
      effectiveDate: formatISOShort(formData.value.effectiveDate),
    });
    await loadTree();
    if (!index.value.byId.has(selectedId.value)) {
      selectedId.value = parentId;
    }
    resetForm();
    toast.success(i18n.t('org.admin.deactivated'));
  } catch (error) {
    toast.error(orgErrorMessage(error, i18n));
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  const [, list] = await Promise.all([loadTree(), searchUsers({ limit: 200 })]);
  people.value = list.items;
  selectedId.value = index.value.byId.has(route.query.node)
    ? route.query.node
    : root.value?.id || null;
  resetForm();
});
</script>

<template>
  <PageLayout>
    <div class="mb-size-16">
      <pkt-button
        skin="tertiary"
        iconName="chevron-left"
        variant="icon-left"
        @click="router.push({ name: 'Admin' })"
      >
        <span>{{ $t('org.admin.back') }}</span>
      </pkt-button>
    </div>

    <div class="pkt-grid">
      <div class="org-list pkt-cell pkt-cell--span12 pkt-cell--span7-laptop-up">
        <h2 class="org-list__title">{{ $t('org.admin.structure') }}</h2>
        <div class="org-list__body">
          <div class="org-list__list">
            <button
              v-for="row in rows"
              :key="row.node.id"
              type="button"
              :class="[
                'org-list__row',
                'pkt-txt-16-medium',
                { 'org-list__row--active': row.node.id === selectedId && !creating },
              ]"
              :style="{ paddingLeft: `${1 + row.depth * 1.5}rem` }"
              @click="select(row.node)"
            >
              <pkt-icon :name="nodeIcon(row.node.type)" />
              <span class="org-list__name">{{ name(row.node) }}</span>
              <span class="org-list__meta pkt-txt-14">{{
                typeLabel(row.node.type)
              }}</span>
            </button>
          </div>
          <div class="org-list__footer">
            <pkt-button
              full-width
              skin="secondary"
              iconName="plus-sign"
              variant="icon-left"
              :disabled="!root"
              @click="startCreate"
            >
              <span>{{ $t('org.admin.add') }}</span>
            </pkt-button>
          </div>
        </div>
      </div>

      <div class="pkt-cell pkt-cell--span12 pkt-cell--span5-laptop-up">
        <h2 class="pkt-txt-22 mb-size-16">
          {{ creating ? $t('org.admin.new') : $t('org.admin.edit') }}
        </h2>

        <FormSection v-if="formData" :key="formKey">
          <FormComponent
            v-model="formData.nameZh"
            input-type="input"
            name="nameZh"
            :label="$t('org.admin.nameZh')"
            type="text"
          />
          <FormComponent
            v-model="formData.nameEn"
            input-type="input"
            name="nameEn"
            :label="$t('org.admin.nameEn')"
            type="text"
          />

          <template v-if="!isRoot">
            <FormComponent
              v-model="formData.type"
              input-type="custom-select"
              name="type"
              :label="$t('org.type')"
              :options="typeOptions"
              :can-clear="false"
              rules="required"
            />
            <FormComponent
              v-model="formData.parentId"
              input-type="custom-select"
              name="parentId"
              :label="$t('org.admin.parent')"
              :options="parentOptions"
              :can-clear="false"
              :searchable="true"
              rules="required"
            />
            <FormComponent
              v-model="formData.leadUserId"
              input-type="custom-select"
              name="leadUserId"
              :label="$t('org.owner')"
              :options="ownerOptions"
              :searchable="true"
            />
            <FormComponent
              v-model="formData.effectiveDate"
              input-type="date"
              name="effectiveDate"
              :label="$t('org.effective')"
              rules="required"
            />
          </template>

          <pkt-alert skin="info" class="mb-size-16">
            <span>{{ isRoot ? $t('org.admin.groupNote') : $t('org.admin.note') }}</span>
          </pkt-alert>

          <template #actions="{ submit, disabled }">
            <BtnDelete
              v-if="!creating && !isRoot"
              :text="$t('org.admin.deactivate')"
              :disabled="busy"
              @confirm="deactivate"
            />
            <BtnSave
              :text="creating ? $t('btn.create') : $t('btn.save')"
              :disabled="disabled || busy"
              @click="submit(save)"
            />
          </template>
        </FormSection>
      </div>
    </div>
  </PageLayout>
</template>

<style lang="scss" scoped>
@use '@oslokommune/punkt-css/dist/scss/abstracts/mixins/breakpoints' as *;
@use '@oslokommune/punkt-css/dist/scss/abstracts/mixins/typography' as *;

.org-list {
  &__title {
    @include get-text('pkt-txt-18-medium');
    margin-bottom: 0.75rem;

    @include bp('tablet-up') {
      @include get-text('pkt-txt-20-medium');
    }
  }

  &__body {
    display: flex;
    flex-direction: column;
    min-height: 32rem;
    background: var(--color-gray-light);
  }

  &__list {
    flex: 1;
    overflow: auto;
  }

  &__row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    width: 100%;
    padding: 0.5rem 1rem;
    color: var(--color-text);
    text-align: left;
    cursor: pointer;
    background: none;
    border: none;
    border-bottom: 2px solid var(--color-border);

    &:hover .org-list__name {
      text-decoration: underline;
      text-decoration-thickness: 1px;
      text-underline-offset: 0.3em;
    }

    &--active {
      background: var(--color-blue-light);
    }

    .pkt-icon {
      flex-shrink: 0;
      height: 1rem;
    }
  }

  &__name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__meta {
    color: var(--color-grayscale-60);
  }

  &__footer {
    padding: 1rem;
  }
}
</style>
