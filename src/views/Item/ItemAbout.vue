<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { displayOrder, organizationIdOf, positionGroup } from '@/config/jobPositions';
import { cleanDetails } from '@/util/itemDetails';
import { useActiveOrganizationStore } from '@/store/activeOrganization';
import { useActiveItemStore } from '@/store/activeItem';
import { useAuthStore } from '@/store/auth';
import '@oslokommune/punkt-elements/dist/pkt-button.js';
import HTMLOutput from '@/components/HTMLOutput.vue';
import ItemDrawer from '@/components/drawers/ItemDrawer.vue';
import ProfileModal from '@/components/modals/ProfileModal.vue';
import RoleMembers from '@/components/RoleMembers.vue';

const router = useRouter();
const route = useRoute();
const i18n = useI18n();

const { organizationTree } = storeToRefs(useActiveOrganizationStore());
const { item, isDepartment, isOrganization } = storeToRefs(useActiveItemStore());
const { hasEditRights, isMemberOfCurrentItemOrganization } = storeToRefs(useAuthStore());

const showItemDrawer = ref(false);
const chosenProfileId = ref(null);

const childrenTitle = computed(() => {
  /**
   * Return a fitting title for the list of sub-items under the current item.
   */

  if (isOrganization.value) {
    return i18n.t('about.organizationChildren');
  }
  if (isDepartment.value) {
    return i18n.t('about.departmentChildren');
  }

  return null;
});

const children = computed(() => {
  if (isOrganization.value) {
    return organizationTree.value?.children || [];
  }

  if (isDepartment) {
    return (
      organizationTree.value?.children.find((d) => d.slug === item.value.slug)
        ?.children || []
    );
  }

  return [];
});

const teamMembers = computed(() => {
  const members = {};

  // Grouped by what they are in this organization: administrators, project
  // managers, coordinators, and everyone else (see positionGroup).
  const orgId = organizationIdOf(item.value);
  item.value.team.forEach((employee) => {
    const group = positionGroup(employee, orgId);
    if (!members[group]) {
      members[group] = [];
    }
    members[group].push(employee);
  });

  return members;
});

const details = computed(() => cleanDetails(item.value.details));

watch(showItemDrawer, (show) => {
  if (!show && route.query.edit) {
    router.replace({ query: null });
  }
});

onMounted(() => {
  showItemDrawer.value = String(route.query.edit).toLowerCase() === 'true';
});

function sortByDisplayOrder(roles) {
  return displayOrder.filter((role) => roles.includes(role));
}
</script>

<template>
  <PageLayout breakpoint="tablet-big" class="about-page">
    <header class="about-page__header">
      <h1 class="pkt-txt-54">{{ item.name }}</h1>
      <pkt-button
        v-if="hasEditRights"
        v-tooltip="$t('admin.item.change', { name: item.name })"
        skin="tertiary"
        size="small"
        variant="icon-only"
        iconName="edit"
        @click="showItemDrawer = true"
      >
        <span>{{ $t('admin.item.change', { name: item.name }) }}</span>
      </pkt-button>
    </header>

    <section>
      <HTMLOutput class="pkt-txt-24-light" :html="item.missionStatement" />
    </section>

    <section v-if="item.targetAudience">
      <h2 class="pkt-txt-30">{{ $t('dashboard.targetAudience') }}</h2>
      <HTMLOutput class="pkt-txt-18" :html="item.targetAudience" />
    </section>

    <section v-for="(group, gi) in details" :key="`details-${gi}`">
      <h2 v-if="group.title" class="pkt-txt-30">{{ group.title }}</h2>
      <dl v-if="group.fields.length" class="item-details pkt-txt-18">
        <template v-for="(field, fi) in group.fields" :key="fi">
          <dt>{{ field.label }}</dt>
          <dd>{{ field.value }}</dd>
        </template>
      </dl>
    </section>

    <section v-if="children.length">
      <h2 class="pkt-txt-30">{{ childrenTitle }}</h2>
      <div
        v-for="child in children"
        :key="child.id"
        class="item-info__box item-info__box--link"
      >
        <h3 class="pkt-txt-24">{{ child.name }}</h3>
        <HTMLOutput class="pkt-txt-18" :html="child.missionStatement" />
      </div>
    </section>

    <template v-if="hasEditRights || isMemberOfCurrentItemOrganization">
      <h2 class="pkt-txt-30">{{ $t('about.members') }}</h2>
      <RoleMembers
        v-for="role in sortByDisplayOrder(Object.keys(teamMembers))"
        :key="role"
        :role="role"
        :members-with-role="teamMembers[role]"
        @open-modal="chosenProfileId = $event"
      />
    </template>

    <ItemDrawer v-if="hasEditRights && showItemDrawer" @close="showItemDrawer = false" />

    <ProfileModal
      v-if="!!chosenProfileId"
      :user-id="chosenProfileId"
      @close="chosenProfileId = null"
    />
  </PageLayout>
</template>

<style lang="scss" scoped>
.about-page {
  padding: 2rem;

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
}

section {
  margin: 2.75rem 0 3.625rem 0;

  .item-info__box:first-of-type h3 {
    margin-top: 1.5rem;
  }
}

h2 {
  margin: 1.25rem 0;
}

.item-details {
  display: grid;
  grid-template-columns: minmax(8rem, max-content) 1fr;
  gap: 0.5rem 2rem;
  margin: 0;

  dt {
    color: var(--color-grayscale-60);
  }

  dd {
    margin: 0;
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
}

h3 {
  margin: 2rem 0 0.5rem;
}
</style>
