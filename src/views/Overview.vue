<script setup>
/**
 * Group overview for the active organization: per organization, department
 * and team the running objectives' progress against time, key results by
 * status and updates that are due, plus the key results needing attention.
 * Computed on the server (GET /api/v1/overview).
 */
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useHead } from '@unhead/vue';
import { request } from '@/backend/client';
import { useActiveOrganizationStore } from '@/store/activeOrganization';
import { useTrackerStore } from '@/store/tracker';
import '@oslokommune/punkt-elements/dist/pkt-button.js';
import { dateShort } from '@/util/format';
import '@oslokommune/punkt-elements/dist/pkt-loader.js';
import '@oslokommune/punkt-elements/dist/pkt-alert.js';
import ProgressBar from '@/components/ProgressBar.vue';
import StatusTag from '@/components/StatusTag.vue';

const i18n = useI18n();
useHead({ title: () => i18n.t('overview.title') });

const activeOrganizationStore = useActiveOrganizationStore();
const { organization } = storeToRefs(activeOrganizationStore);
const { organizations } = storeToRefs(useTrackerStore());

// Opened directly (no organization chosen yet): with a single organization
// use it; with several, let the person choose below.
watch(
  () => [organization.value, organizations.value.length],
  () => {
    if (!organization.value && organizations.value.length === 1) {
      activeOrganizationStore.setOrganization(organizations.value[0].id);
    }
  },
  { immediate: true }
);

const data = ref(null);
const isLoading = ref(false);
const failed = ref(false);

async function load() {
  if (!organization.value) {
    return;
  }
  isLoading.value = true;
  failed.value = false;
  try {
    data.value = await request(`/overview?organization=${organization.value.id}`, {
      method: 'GET',
    });
  } catch {
    failed.value = true;
  } finally {
    isLoading.value = false;
  }
}

watch(() => organization.value?.id, load, { immediate: true });

const percent = (value) =>
  value === null || value === undefined ? '–' : `${Math.round(value * 100)}%`;
const formatDate = (value) => (value ? dateShort(new Date(value)) : '–');

// Rows with something to show first in each level; empty ones stay listed.
const rows = computed(() => data.value?.rows || []);
const attention = computed(() => data.value?.attention || []);

const keyResultRoute = (kr) =>
  kr.objectiveOwnerSlug
    ? {
        name: 'KeyResultHome',
        params: {
          slug: kr.objectiveOwnerSlug,
          objectiveId: kr.objective.id,
          keyResultId: kr.id,
        },
      }
    : null;
</script>

<template>
  <PageLayout breakpoint="desktop" class="overview-page">
    <header class="overview-page__header mb-size-24">
      <h1 class="pkt-txt-24-medium">
        {{ $t('overview.title')
        }}<template v-if="organization">: {{ organization.name }}</template>
      </h1>
      <p v-if="data" class="overview-page__meta pkt-txt-14">
        {{ $t('overview.explain', { date: formatDate(data.asOf) }) }}
      </p>
    </header>

    <section v-if="!organization" class="overview-page__choose">
      <p class="mb-size-16">{{ $t('overview.noOrganization.body') }}</p>
      <div class="overview-page__orgs">
        <pkt-button
          v-for="org in organizations"
          :key="org.id"
          skin="secondary"
          size="small"
          @click="activeOrganizationStore.setOrganization(org.id)"
        >
          <span>{{ org.name }}</span>
        </pkt-button>
      </div>
    </section>

    <div v-else-if="isLoading && !data" class="overview-page__loading">
      <pkt-loader :message="$t('general.loading')" size="large" inline />
    </div>

    <pkt-alert v-else-if="failed" skin="error">
      <div>{{ $t('overview.failed') }}</div>
    </pkt-alert>

    <template v-else-if="data">
      <section class="mb-size-40">
        <div class="overview-table__scroll">
          <table class="overview-table">
            <thead>
              <tr>
                <th>{{ $t('overview.columns.item') }}</th>
                <th>{{ $t('overview.columns.objectives') }}</th>
                <th class="overview-table__progress">
                  {{ $t('overview.columns.progress') }}
                </th>
                <th>{{ $t('overview.columns.status') }}</th>
                <th>{{ $t('overview.columns.due') }}</th>
                <th>{{ $t('overview.columns.lastUpdate') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in rows"
                :key="row.ref"
                :class="`overview-table__row--depth-${row.depth}`"
              >
                <td>
                  <RouterLink
                    class="overview-table__name"
                    :to="{ name: 'ItemHome', params: { slug: row.slug } }"
                  >
                    {{ row.name }}
                  </RouterLink>
                </td>
                <td>{{ row.objectives || '–' }}</td>
                <td class="overview-table__progress">
                  <template v-if="row.objectives">
                    <ProgressBar
                      :progression="row.progress || 0"
                      :secondary-progression="row.expected"
                      compact
                    />
                  </template>
                  <span v-else class="overview-table__none">–</span>
                </td>
                <td>
                  <span v-if="row.keyResults.total" class="overview-table__statuses">
                    <span
                      v-if="row.keyResults.onTrack"
                      class="pkt-tag pkt-tag--small pkt-tag--green"
                    >
                      {{ $t('status.onTrack') }} {{ row.keyResults.onTrack }}
                    </span>
                    <span
                      v-if="row.keyResults.atRisk"
                      class="pkt-tag pkt-tag--small pkt-tag--yellow"
                    >
                      {{ $t('status.atRisk') }} {{ row.keyResults.atRisk }}
                    </span>
                    <span
                      v-if="row.keyResults.behind"
                      class="pkt-tag pkt-tag--small pkt-tag--red"
                    >
                      {{ $t('status.behind') }} {{ row.keyResults.behind }}
                    </span>
                  </span>
                  <span v-else class="overview-table__none">–</span>
                </td>
                <td>
                  <span
                    v-if="row.updatesDue.keyResults + row.updatesDue.measurements"
                    class="pkt-tag pkt-tag--small pkt-tag--gray"
                  >
                    {{
                      $t('overview.dueCounts', {
                        keyResults: row.updatesDue.keyResults,
                        measurements: row.updatesDue.measurements,
                      })
                    }}
                  </span>
                  <span v-else class="overview-table__none">–</span>
                </td>
                <td class="pkt-txt-14">{{ formatDate(row.lastUpdate) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 class="pkt-txt-20-medium mb-size-8">{{ $t('overview.attention') }}</h2>
        <p v-if="!attention.length" class="overview-page__meta pkt-txt-14">
          {{ $t('overview.allOnTrack') }}
        </p>
        <ul v-else class="attention-list">
          <li v-for="kr in attention" :key="kr.id" class="attention-list__row">
            <div class="attention-list__text">
              <RouterLink
                v-if="keyResultRoute(kr)"
                :to="keyResultRoute(kr)"
                class="pkt-txt-16-medium"
              >
                {{ kr.name }}
              </RouterLink>
              <span v-else class="pkt-txt-16-medium">{{ kr.name }}</span>
              <span class="attention-list__meta pkt-txt-14">
                {{ kr.owner.name }} · {{ kr.objective.name }} ·
                {{
                  $t('overview.progressVsTime', {
                    progress: percent(kr.progress),
                    time: percent(kr.expected),
                  })
                }}
                <template v-if="kr.assignees.length">
                  ·
                  {{
                    $t('assignees.shown', { names: kr.assignees.join(', ') })
                  }}</template
                >
              </span>
            </div>
            <StatusTag
              :status="kr.status"
              :manual="kr.statusSetByHand"
              :note="kr.statusNote"
            />
          </li>
        </ul>
      </section>
    </template>
  </PageLayout>
</template>

<style lang="scss" scoped>
.overview-page {
  padding: 2rem;

  &__meta {
    color: var(--color-grayscale-60);
  }

  &__loading {
    text-align: center;
  }

  &__orgs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
}

.overview-table__scroll {
  overflow-x: auto;
}

.overview-table {
  width: 100%;
  min-width: 48rem;
  border-collapse: collapse;

  th,
  td {
    padding: 0.75rem 0.5rem;
    text-align: left;
    vertical-align: middle;
    border-bottom: 1px solid var(--color-grayscale-10);
  }

  th {
    font-weight: 500;
    font-size: 0.875rem;
    white-space: nowrap;
  }

  &__progress {
    width: 30%;
    min-width: 12rem;
  }

  &__statuses {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  &__none {
    color: var(--color-grayscale-40);
  }

  &__name {
    font-weight: 500;
  }

  &__row--depth-1 .overview-table__name {
    padding-left: 1.25rem;
  }

  &__row--depth-2 .overview-table__name {
    padding-left: 2.5rem;
    font-weight: 400;
  }

  &__row--depth-0 td {
    background: var(--color-gray-light);
  }
}

.attention-list {
  margin: 0;
  padding: 0;
  list-style: none;

  &__row {
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 0;
    border-bottom: 1px solid var(--color-grayscale-10);
  }

  &__text {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  &__meta {
    color: var(--color-grayscale-60);
  }
}
</style>
