<script setup>
/**
 * "Needs your update": key results and measurements the signed-in person
 * should update now (assigned to them, or to nobody in a team where they
 * have a role, and without a new value for too long). From the server
 * (GET /api/v1/overview/mine), so the web app and the AI assistant agree.
 */
import { onMounted, ref } from 'vue';
import { request } from '@/backend/client';
import { dateShort } from '@/util/format';
import StatusTag from '@/components/StatusTag.vue';

const data = ref(null);

onMounted(async () => {
  try {
    data.value = await request('/overview/mine', { method: 'GET' });
  } catch {
    data.value = null;
  }
});

const routeOf = (item) => {
  if (!item.slug) {
    return null;
  }
  return item.type === 'keyResult'
    ? {
        name: 'KeyResultHome',
        params: { slug: item.slug, objectiveId: item.objective.id, keyResultId: item.id },
      }
    : { name: 'ItemMeasurements', params: { slug: item.slug, kpiId: item.id } };
};
</script>

<template>
  <section v-if="data" class="my-updates">
    <h2 class="pkt-txt-20-medium mb-size-8">{{ $t('myUpdates.title') }}</h2>
    <p
      v-if="!data.keyResults.length && !data.measurements.length"
      class="my-updates__meta pkt-txt-14"
    >
      {{ $t('myUpdates.none') }}
    </p>
    <ul v-else class="my-updates__list">
      <li
        v-for="item in [...data.keyResults, ...data.measurements]"
        :key="`${item.type}-${item.id}`"
        class="my-updates__row"
      >
        <div class="my-updates__text">
          <RouterLink v-if="routeOf(item)" :to="routeOf(item)" class="pkt-txt-16-medium">
            {{ item.name }}
          </RouterLink>
          <span v-else class="pkt-txt-16-medium">{{ item.name }}</span>
          <span class="my-updates__meta pkt-txt-14">
            {{ $t(item.type === 'keyResult' ? 'general.keyResult' : 'general.KPI') }} ·
            {{ item.owner.name }}
            <template v-if="item.objective"> · {{ item.objective.name }}</template>
            ·
            {{
              item.lastUpdate
                ? $t('myUpdates.lastUpdate', {
                    date: dateShort(new Date(item.lastUpdate)),
                  })
                : $t('myUpdates.never')
            }}
          </span>
        </div>
        <StatusTag :status="item.status || null" :due="true" />
      </li>
    </ul>
  </section>
</template>

<style lang="scss" scoped>
.my-updates {
  &__list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__row {
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    margin-bottom: 0.5rem;
    background: var(--color-white);
    border-left: 0.25rem solid var(--color-blue-dark);
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
