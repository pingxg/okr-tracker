<script setup>
/**
 * 成员与角色 (spec §17): everyone who has signed in, with their teams and
 * roles. Assign a person to a node with a role and reporting line, or end a
 * role. Laid out like the current user administration.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useToast } from 'vue-toast-notification';
import { useFuse } from '@vueuse/integrations/useFuse';
import '@oslokommune/punkt-elements/dist/pkt-button.js';
import '@oslokommune/punkt-elements/dist/pkt-alert.js';
import { createMembership, getOrgTree, searchUsers, updateMembership } from '@/api/org';
import { dateShort, formatISOShort } from '@/util';
import { indexTree, nodeName, orgErrorMessage } from '@/util/orgStructure';
import { BtnSave, BtnDelete } from '@/components/generic/form';

const ROLES = ['group_admin', 'entity_lead', 'team_lead', 'member', 'observer'];

const i18n = useI18n();
const router = useRouter();
const toast = useToast();

const tree = ref(null);
const users = ref([]);
const unassignedTotal = ref(0);
const selectedId = ref(null);
const query = ref('');
const busy = ref(false);
const formData = ref(null);
const formKey = ref(0);

const locale = computed(() => i18n.locale.value);
const index = computed(() => indexTree(tree.value?.nodes || [], locale.value));
const label = (person) => person.name || person.email;
const selected = computed(
  () => users.value.find((u) => u.id === selectedId.value) || null
);

const pathLabel = (nodeId) => {
  const node = index.value.byId.get(nodeId);
  if (!node) {
    return '';
  }
  return [...index.value.ancestors(nodeId).slice(1), node]
    .map((n) => nodeName(n, locale.value))
    .join(' / ');
};

const { results } = useFuse(query, users, {
  fuseOptions: { threshold: 0.4, keys: ['name', 'email'] },
  matchAllWhenSearchEmpty: true,
});

const nodeOptions = computed(() =>
  (tree.value?.nodes || [])
    .map((n) => ({ value: n.id, label: pathLabel(n.id) || nodeName(n, locale.value) }))
    .sort((a, b) => a.label.localeCompare(b.label, locale.value))
);
const roleOptions = computed(() => {
  const isRoot = index.value.byId.get(formData.value?.nodeId)?.parentId === null;
  return ROLES.filter((r) =>
    isRoot ? !['entity_lead', 'team_lead'].includes(r) : r !== 'group_admin'
  ).map((r) => ({ value: r, label: i18n.t(`org.roles.${r}`) }));
});
const peopleOptions = computed(() =>
  users.value
    .filter((u) => u.id !== selectedId.value)
    .map((u) => ({ value: u.id, label: label(u) }))
);

function resetForm() {
  formKey.value += 1;
  const person = selected.value;
  const primary = person?.memberships.find((m) => m.isPrimary) || person?.memberships[0];
  formData.value = {
    nodeId: null,
    role: 'member',
    reportsTo: primary?.reportsTo?.id || null,
    effectiveDate: new Date(),
  };
}

function select(person) {
  selectedId.value = person.id;
  resetForm();
}

async function load() {
  const [t, list] = await Promise.all([getOrgTree(), searchUsers({ limit: 200 })]);
  tree.value = t;
  users.value = list.items;
  unassignedTotal.value = list.unassignedTotal;
}

async function assign() {
  busy.value = true;
  try {
    await createMembership({
      userId: selected.value.id,
      nodeId: formData.value.nodeId,
      role: formData.value.role,
      reportsTo: formData.value.reportsTo || null,
      isPrimary: selected.value.memberships.length === 0,
      effectiveDate: formatISOShort(formData.value.effectiveDate),
    });
    await load();
    resetForm();
    toast.success(i18n.t('org.people.assigned'));
  } catch (error) {
    toast.error(orgErrorMessage(error, i18n));
  } finally {
    busy.value = false;
  }
}

async function end(membership) {
  busy.value = true;
  try {
    await updateMembership(membership.id, { end: true });
    await load();
    toast.success(i18n.t('org.people.ended'));
  } catch (error) {
    toast.error(orgErrorMessage(error, i18n));
  } finally {
    busy.value = false;
  }
}

onMounted(load);
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

    <pkt-alert v-if="unassignedTotal" skin="warning" class="mb-size-24">
      <span>{{ $t('org.people.unassigned', { n: unassignedTotal }) }}</span>
    </pkt-alert>

    <div class="pkt-grid">
      <div class="people-list pkt-cell pkt-cell--span12 pkt-cell--span5-laptop-up">
        <h2 class="people-list__title">{{ $t('org.admin.members') }}</h2>
        <div class="people-list__body">
          <div>
            <input
              v-model="query"
              class="pkt-input pkt-input--fullwidth"
              type="text"
              :placeholder="$t('org.people.search', { count: users.length })"
            />
          </div>
          <div class="people-list__list">
            <button
              v-for="{ item: person } in results"
              :key="person.id"
              type="button"
              :class="[
                'people-list__row',
                'pkt-txt-16-medium',
                { 'people-list__row--active': person.id === selectedId },
              ]"
              @click="select(person)"
            >
              <pkt-icon :name="person.memberships.length ? 'user' : 'alert-warning'" />
              <span class="people-list__name">{{ label(person) }}</span>
              <span
                v-if="!person.memberships.length"
                class="people-list__meta pkt-txt-14"
              >
                {{ $t('org.people.notAssigned') }}
              </span>
              <pkt-icon name="chevron-right" />
            </button>
          </div>
        </div>
      </div>

      <div class="pkt-cell pkt-cell--span12 pkt-cell--span7-laptop-up">
        <p v-if="!selected" class="pkt-txt-18">{{ $t('org.people.choose') }}</p>

        <template v-else>
          <h2 class="pkt-txt-22">{{ label(selected) }}</h2>
          <p class="person__muted pkt-txt-16 mb-size-24">
            {{ selected.email }} · {{ $t('org.people.lastLogin') }}
            {{ selected.lastLoginAt ? dateShort(new Date(selected.lastLoginAt)) : '–' }}
          </p>

          <h3 class="pkt-txt-18-medium mb-size-8">{{ $t('org.people.current') }}</h3>
          <p v-if="!selected.memberships.length" class="pkt-txt-16 mb-size-24">
            {{ $t('org.people.notAssigned') }}
          </p>
          <ul v-else class="person__roles mb-size-24">
            <li v-for="m in selected.memberships" :key="m.id" class="pkt-txt-16">
              <div>
                <div class="person__node">{{ pathLabel(m.node.id) }}</div>
                <div class="person__muted">
                  {{ $t(`org.roles.${m.role}`) }}
                  <template v-if="m.reportsTo">
                    · {{ $t('org.reportsTo') }}
                    {{ m.reportsTo.name || m.reportsTo.email }}
                  </template>
                  <template v-if="m.isPrimary">
                    · {{ $t('org.people.primary') }}</template
                  >
                </div>
              </div>
              <BtnDelete
                :text="$t('org.people.end')"
                variant="label-only"
                :disabled="busy"
                @confirm="end(m)"
              />
            </li>
          </ul>

          <h3 class="pkt-txt-18-medium mb-size-8">{{ $t('org.people.add') }}</h3>
          <FormSection v-if="formData" :key="formKey">
            <FormComponent
              v-model="formData.nodeId"
              input-type="custom-select"
              name="nodeId"
              :label="$t('org.people.node')"
              :options="nodeOptions"
              :searchable="true"
              rules="required"
            />
            <FormComponent
              v-model="formData.role"
              input-type="custom-select"
              name="role"
              :label="$t('org.people.role')"
              :options="roleOptions"
              :can-clear="false"
              rules="required"
            />
            <FormComponent
              v-model="formData.reportsTo"
              input-type="custom-select"
              name="reportsTo"
              :label="$t('org.reportsTo')"
              :options="peopleOptions"
              :searchable="true"
            />
            <FormComponent
              v-model="formData.effectiveDate"
              input-type="date"
              name="effectiveDate"
              :label="$t('org.effective')"
              rules="required"
            />

            <template #actions="{ submit, disabled }">
              <BtnSave
                :text="$t('org.people.assign')"
                :disabled="disabled || busy"
                @click="submit(assign)"
              />
            </template>
          </FormSection>
        </template>
      </div>
    </div>
  </PageLayout>
</template>

<style lang="scss" scoped>
@use '@oslokommune/punkt-css/dist/scss/abstracts/mixins/breakpoints' as *;
@use '@oslokommune/punkt-css/dist/scss/abstracts/mixins/typography' as *;

.people-list {
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

    &:hover .people-list__name {
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
}

.person {
  &__muted {
    color: var(--color-grayscale-60);
  }

  &__node {
    font-weight: 500;
  }

  &__roles {
    padding: 0;
    margin: 0;
    list-style: none;

    li {
      display: flex;
      gap: 1rem;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 0;
      border-bottom: 1px solid var(--color-border);
    }
  }
}
</style>
