<script setup>
/**
 * A node of the organisation structure (spec §17 团队页/公司页): where it sits,
 * its owner, the units below it and its members. Data from API v1; layout and
 * components follow the current "about" pages.
 */
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useHead } from '@unhead/vue';
import '@oslokommune/punkt-elements/dist/pkt-button.js';
import { getOrgNode } from '@/api/org';
import { useAuthStore } from '@/store/auth';
import { dateLong } from '@/util';
import { nodeIcon, nodeName } from '@/util/orgStructure';
import ItemLinkCard from '@/components/ItemLinkCard.vue';

const route = useRoute();
const i18n = useI18n();
const { isAdmin } = storeToRefs(useAuthStore());

const data = ref(null);
const failed = ref(false);

const name = (node) => nodeName(node, i18n.locale.value);
const node = computed(() => data.value?.node || null);

const owner = computed(
  () =>
    data.value?.memberships.find(
      (m) => m.role === 'entity_lead' || m.role === 'team_lead'
    ) || null
);

/** People on this node, one row per person with all their roles here. */
const people = computed(() => {
  const byUser = new Map();
  (data.value?.memberships || []).forEach((m) => {
    if (!byUser.has(m.userId)) {
      byUser.set(m.userId, { user: m.user, roles: [], reportsTo: m.reportsToUser });
    }
    const entry = byUser.get(m.userId);
    entry.roles.push(i18n.t(`org.roles.${m.role}`));
    entry.reportsTo = entry.reportsTo || m.reportsToUser;
  });
  return [...byUser.values()].sort((a, b) =>
    (a.user.name || a.user.email).localeCompare(b.user.name || b.user.email)
  );
});

const typeLabel = (type) =>
  i18n.te(`org.nodeTypes.${type}`) ? i18n.t(`org.nodeTypes.${type}`) : type;

useHead({ title: () => name(node.value) || i18n.t('org.title') });

watch(
  () => route.params.id,
  async (id) => {
    if (!id) {
      return;
    }
    failed.value = false;
    try {
      data.value = await getOrgNode(id);
    } catch {
      data.value = null;
      failed.value = true;
    }
  },
  { immediate: true }
);
</script>

<template>
  <PageLayout breakpoint="tablet-big" class="org-node">
    <p v-if="failed" class="pkt-txt-18">{{ $t('org.notFound') }}</p>

    <template v-else-if="node">
      <nav v-if="data.ancestors.length" class="org-node__path pkt-txt-16">
        <template v-for="(a, i) in data.ancestors" :key="a.id">
          <span v-if="i > 0" aria-hidden="true"> / </span>
          <RouterLink :to="{ name: 'OrgNode', params: { id: a.id } }">{{
            name(a)
          }}</RouterLink>
        </template>
      </nav>

      <header class="org-node__header">
        <h1 class="pkt-txt-54">{{ name(node) }}</h1>
        <RouterLink
          v-if="isAdmin"
          v-tooltip="$t('org.edit')"
          :to="{ name: 'AdminOrgStructure', query: { node: node.id } }"
          class="pkt-btn pkt-btn--tertiary pkt-btn--small pkt-btn--icon-only"
        >
          <pkt-icon name="edit" class="pkt-btn__icon" />
          <span class="pkt-btn__text">{{ $t('org.edit') }}</span>
        </RouterLink>
      </header>

      <section>
        <dl class="org-node__facts pkt-txt-18">
          <dt>{{ $t('org.type') }}</dt>
          <dd>{{ typeLabel(node.type) }}</dd>
          <dt>{{ $t('org.owner') }}</dt>
          <dd>{{ owner ? owner.user.name || owner.user.email : $t('org.none') }}</dd>
          <!-- The group node's start date is technical (always 2000-01-01). -->
          <template v-if="node.parentId">
            <dt>{{ $t('org.effective') }}</dt>
            <dd>{{ dateLong(new Date(`${node.validFrom}T00:00:00`)) }}</dd>
          </template>
        </dl>
      </section>

      <section v-if="data.children.length">
        <h2 class="pkt-txt-30">{{ $t('org.units') }}</h2>
        <div class="org-node__units">
          <ItemLinkCard
            v-for="child in [...data.children].sort((a, b) =>
              name(a).localeCompare(name(b))
            )"
            :key="child.id"
            :route="{ name: 'OrgNode', params: { id: child.id } }"
            :title="name(child)"
            :text="typeLabel(child.type)"
            :icon-name="nodeIcon(child.type)"
          />
        </div>
      </section>

      <section>
        <h2 class="pkt-txt-30">{{ $t('org.members') }}</h2>
        <p v-if="!people.length" class="pkt-txt-18">{{ $t('org.noMembers') }}</p>
        <ul v-else class="org-node__people">
          <li v-for="p in people" :key="p.user.id" class="pkt-txt-18">
            <span class="org-node__person">{{ p.user.name || p.user.email }}</span>
            <span>{{ p.roles.join(', ') }}</span>
            <span v-if="p.reportsTo" class="org-node__muted">
              {{ $t('org.reportsTo') }} {{ p.reportsTo.name || p.reportsTo.email }}
            </span>
          </li>
        </ul>
      </section>
    </template>
  </PageLayout>
</template>

<style lang="scss" scoped>
.org-node {
  padding: 2rem;

  &__path a {
    color: var(--color-text);
  }

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.5rem 2rem;
    margin: 0;

    dt {
      color: var(--color-grayscale-60);
    }

    dd {
      margin: 0;
    }
  }

  &__units {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  &__people {
    padding: 0;
    margin: 0;
    list-style: none;

    li {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 1rem;
      padding: 0.75rem 0;
      border-bottom: 1px solid var(--color-border);
    }
  }

  &__person {
    font-weight: 500;
  }

  &__muted {
    color: var(--color-grayscale-60);
  }
}

section {
  margin: 2.75rem 0 3.625rem 0;
}

h2 {
  margin: 1.25rem 0;
}
</style>
