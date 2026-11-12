<script setup>
import { computed, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useHead } from '@unhead/vue';
import { useTrackerStore } from '@/store/tracker';
import { useActiveOrganizationStore } from '@/store/activeOrganization';
import { getOrgTree } from '@/api/org';
import { indexTree, nodeName } from '@/util/orgStructure';
import OrganizationCard from '@/components/Navigation/header/OrganizationCard.vue';
import ItemLinkCard from '@/components/ItemLinkCard.vue';

const i18n = useI18n();

const { owner, organizations } = storeToRefs(useTrackerStore());
const activeOrganizationStore = useActiveOrganizationStore();
const { organization, organizationTree } = storeToRefs(activeOrganizationStore);

// Organisation structure (API v1). Shown once it has companies; until then
// the front page works as before.
const orgNodes = ref([]);
const orgIndex = computed(() => indexTree(orgNodes.value, i18n.locale.value));
const orgRoot = computed(() => orgIndex.value.root);
const orgCompanies = computed(() =>
  orgRoot.value ? orgIndex.value.children.get(orgRoot.value.id) : []
);
const hasStructure = computed(() => orgCompanies.value.length > 0);
const orgName = (node) => nodeName(node, i18n.locale.value);
const orgRoute = (node) => ({ name: 'OrgNode', params: { id: node.id } });
const orgSummary = computed(() => {
  if (!orgRoot.value) {
    return '';
  }
  const companies = orgIndex.value.countType(orgRoot.value.id, 'entity');
  const teams = orgIndex.value.countType(orgRoot.value.id, 'team');
  return [
    companies && i18n.t('org.count.companies', { n: companies }, companies),
    teams && i18n.t('org.count.teams', { n: teams }, teams),
  ]
    .filter(Boolean)
    .join(i18n.locale.value === 'zh-CN' ? '，' : ', ');
});

onMounted(async () => {
  try {
    orgNodes.value = (await getOrgTree()).nodes;
  } catch {
    orgNodes.value = [];
  }
});

useHead({
  title: () => (hasStructure.value ? orgName(orgRoot.value) : organization.value?.name),
});

function sortByLocale(arr) {
  return arr.sort((a, b) =>
    a.name
      .trim()
      .toUpperCase()
      .localeCompare(b.name.trim().toUpperCase(), i18n.locale.value)
  );
}
</script>

<template>
  <PageLayout :breakpoint="organization || hasStructure ? 'tablet-big' : 'phablet'">
    <template v-if="organization && !hasStructure" #header>
      <OrganizationCard />
    </template>

    <template #default>
      <div class="home-page">
        <template v-if="hasStructure">
          <div class="home-page__organization">
            <ItemLinkCard
              :route="orgRoute(orgRoot)"
              :title="orgName(orgRoot)"
              size="large"
              centered
            />
            <p>{{ orgSummary }}</p>
          </div>

          <div class="pkt-grid">
            <div
              v-for="company in orgCompanies"
              :key="company.id"
              :class="[
                'pkt-cell',
                'pkt-cell--span12',
                'pkt-cell--span6-tablet-up',
                'pkt-cell--span4-laptop-up',
              ]"
            >
              <div>
                <ItemLinkCard
                  :route="orgRoute(company)"
                  :title="orgName(company)"
                  size="medium"
                />

                <div
                  v-if="orgIndex.children.get(company.id).length"
                  class="py-size-8 px-size-16--tablet-up"
                >
                  <ItemLinkCard
                    v-for="unit in orgIndex.children.get(company.id)"
                    :key="unit.id"
                    :route="orgRoute(unit)"
                    :title="orgName(unit)"
                    transparent
                  />
                </div>
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="!organization">
          <div class="home-page__title">
            <h1>
              {{ $t('home.welcome', { appName: $t('general.appName') }) }}
            </h1>
            <span v-if="owner">{{ owner }}</span>
          </div>

          <div v-if="organizations.length" class="home-page__organizations">
            <ItemLinkCard
              v-for="item in sortByLocale(organizations)"
              :key="item.id"
              :title="item.name"
              :text="item.missionStatement"
              icon-name="organization"
              size="medium"
              @click="activeOrganizationStore.setOrganization(item.id)"
            />
          </div>
        </template>

        <template v-else>
          <div class="home-page__organization">
            <ItemLinkCard
              :route="{ name: 'ItemHome', params: { slug: organization.slug } }"
              :title="organization.name"
              size="large"
              centered
            />
            <p>{{ organization.missionStatement }}</p>
          </div>

          <div
            v-if="organizationTree && organizationTree.children.length"
            class="pkt-grid"
          >
            <div
              v-for="department in sortByLocale(organizationTree.children)"
              :key="department.id"
              :class="[
                'pkt-cell',
                'pkt-cell--span12',
                'pkt-cell--span6-tablet-up',
                'pkt-cell--span4-laptop-up',
              ]"
            >
              <div>
                <ItemLinkCard
                  :route="{ name: 'ItemHome', params: { slug: department.slug } }"
                  :title="department.name"
                  size="medium"
                />

                <div
                  v-if="department.children.length"
                  class="py-size-8 px-size-16--tablet-up"
                >
                  <ItemLinkCard
                    v-for="product in sortByLocale(department.children)"
                    :key="product.id"
                    :route="{ name: 'ItemHome', params: { slug: product.slug } }"
                    :title="product.name"
                    transparent
                  />
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </PageLayout>
</template>

<style lang="scss" scoped>
@use 'sass:map';
@use '@oslokommune/punkt-css/dist/scss/abstracts/mixins/breakpoints' as *;
@use '@oslokommune/punkt-css/dist/scss/abstracts/mixins/typography' as *;
@use '@oslokommune/punkt-css/dist/scss/abstracts/variables';

.page {
  background-color: var(--color-blue-light);

  :deep(.page__header) {
    padding-bottom: 0;
  }

  :deep(.page__container) {
    padding: 1.5rem 1rem;

    @include bp('tablet-up') {
      padding: 3rem;
    }
  }
}

.home-page {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  align-items: center;

  @include bp('tablet-up') {
    gap: 2rem;
  }

  &__title {
    text-align: center;

    h1 {
      margin-bottom: 0.5rem;

      @include get-text('pkt-txt-20-medium');

      @include bp-up(36rem) {
        @include get-text('pkt-txt-28-medium');
      }

      @include bp('tablet-up') {
        @include get-text('pkt-txt-30-medium');
      }
    }

    span {
      @include get-text('pkt-txt-16');

      @include bp-up(36rem) {
        @include get-text('pkt-txt-20');
      }
    }
  }

  &__text {
    @include get-text('pkt-txt-16');

    @include bp('tablet-up') {
      @include get-text('pkt-txt-18');
    }
  }

  &__organizations {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 100%;
  }

  &__organization {
    @include bp-up(36rem) {
      width: 80%;
      margin-bottom: 1rem;
    }

    @include bp('tablet-up') {
      width: 60%;
    }

    p {
      @include get-text('pkt-txt-14');
      margin-top: 1rem;
      text-align: center;

      @include bp-up(36rem) {
        @include get-text('pkt-txt-16');
      }
    }
  }
}

.organization-card {
  margin: -0.5rem -0.45rem 0 -0.45rem;
  background-color: var(--pkt-color-surface-subtle-light-blue);

  @include bp-up(36rem) {
    width: 20rem;
  }
}
</style>
