<script setup>
/**
 * Archived objectives, key results and measurements of the current item.
 * "Delete" in the drawers archives; this is where those records can be found
 * and restored.
 */
import { computed, ref, watchEffect } from 'vue';
import { storeToRefs } from 'pinia';
import { useRouter } from 'vue-router';
import { useToast } from 'vue-toast-notification';
import { useI18n } from 'vue-i18n';
import { useCollection } from '@/backend/vuefire';
import { collection, query, where } from '@/backend/firestore';
import { db } from '@/config/backend';
import { useAuthStore } from '@/store/auth';
import { useActiveItemStore } from '@/store/activeItem';
import { periodDates } from '@/util/format';
import Objective from '@/db/Objective';
import KeyResult from '@/db/KeyResult';
import Kpi from '@/db/Kpi';
import '@oslokommune/punkt-elements/dist/pkt-button.js';
import '@oslokommune/punkt-elements/dist/pkt-loader.js';
import EmptyState from '@/components/EmptyState.vue';

const router = useRouter();
const toast = useToast();
const i18n = useI18n();

const { hasEditRights } = storeToRefs(useAuthStore());
const { itemRef } = storeToRefs(useActiveItemStore());

watchEffect(async () => {
  if (!hasEditRights.value) {
    await router.replace({ name: 'ItemHome' });
  }
});

const archivedOf = (name) =>
  computed(
    () =>
      itemRef.value &&
      hasEditRights.value &&
      query(
        collection(db, name),
        where('parent', '==', itemRef.value),
        where('archived', '==', true)
      )
  );

const { data: objectives, pending: objectivesLoading } = useCollection(
  archivedOf('objectives'),
  { ssrKey: 'archivedObjectives' }
);
const { data: keyResults, pending: keyResultsLoading } = useCollection(
  archivedOf('keyResults'),
  { maxRefDepth: 1, ssrKey: 'archivedKeyResults' }
);
const { data: kpis, pending: kpisLoading } = useCollection(archivedOf('kpis'), {
  ssrKey: 'archivedKpis',
});

const byName = (list) =>
  [...(list || [])].sort((a, b) => String(a.name).localeCompare(String(b.name)));

function objectivePeriod(objective) {
  const period =
    objective.startDate && objective.endDate ? objective : objective.period || null;
  try {
    return period ? periodDates(period) : null;
  } catch {
    return null;
  }
}

const sections = computed(() => [
  {
    key: 'objectives',
    title: i18n.t('archivedPage.objectives'),
    model: Objective,
    rows: byName(objectives.value).map((o) => ({
      id: o.id,
      name: o.name,
      meta: objectivePeriod(o),
    })),
  },
  {
    key: 'keyResults',
    title: i18n.t('archivedPage.keyResults'),
    model: KeyResult,
    rows: byName(keyResults.value).map((k) => ({
      id: k.id,
      name: k.name,
      meta: k.objective?.name
        ? i18n.t(
            k.objective.archived
              ? 'archivedPage.inArchivedObjective'
              : 'archivedPage.inObjective',
            { name: k.objective.name }
          )
        : null,
    })),
  },
  {
    key: 'kpis',
    title: i18n.t('archivedPage.kpis'),
    model: Kpi,
    rows: byName(kpis.value).map((k) => ({ id: k.id, name: k.name, meta: null })),
  },
]);

const isLoading = computed(
  () => objectivesLoading.value || keyResultsLoading.value || kpisLoading.value
);
const isEmpty = computed(() => sections.value.every((s) => !s.rows.length));

const restoring = ref(null);

async function restore(section, row) {
  restoring.value = row.id;
  try {
    await section.model.restore(row.id);
    toast.success(`${i18n.t('toaster.restored')}: ${row.name}`);
  } catch {
    toast.error(i18n.t('toaster.error.restore', { document: row.name }));
  } finally {
    restoring.value = null;
  }
}
</script>

<template>
  <PageLayout breakpoint="tablet-big" class="archived-page">
    <h1 class="pkt-txt-24-medium mb-size-16">{{ $t('archivedPage.title') }}</h1>
    <p class="mb-size-32">{{ $t('archivedPage.intro') }}</p>

    <div v-if="isLoading" class="archived-page__loading">
      <pkt-loader :message="$t('general.loading')" size="large" :delay="250" inline />
    </div>

    <EmptyState
      v-else-if="isEmpty"
      :heading="$t('archivedPage.empty.heading')"
      :body="$t('archivedPage.empty.body')"
    />

    <template v-else>
      <section
        v-for="section in sections.filter((s) => s.rows.length)"
        :key="section.key"
        class="mb-size-40"
      >
        <h2 class="pkt-txt-20-medium mb-size-8">
          {{ section.title }} ({{ section.rows.length }})
        </h2>
        <ul class="archived-list">
          <li v-for="row in section.rows" :key="row.id" class="archived-list__row">
            <div class="archived-list__text">
              <span class="pkt-txt-16-medium">{{ row.name }}</span>
              <span v-if="row.meta" class="archived-list__meta pkt-txt-14">
                {{ row.meta }}
              </span>
            </div>
            <pkt-button
              skin="secondary"
              size="small"
              variant="icon-left"
              iconName="arrow-circle"
              :disabled="restoring === row.id"
              @click="restore(section, row)"
            >
              <span>{{ $t('btn.restore') }}</span>
            </pkt-button>
          </li>
        </ul>
      </section>
    </template>
  </PageLayout>
</template>

<style lang="scss" scoped>
.archived-page {
  padding: 2rem;

  &__loading {
    text-align: center;
  }
}

.archived-list {
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
