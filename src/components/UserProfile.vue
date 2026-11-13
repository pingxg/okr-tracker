<script setup>
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useToast } from 'vue-toast-notification';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/store/auth';
import { useTrackerUser } from '@/composables/user';
import User from '@/db/User';
import { useTrackerStore } from '@/store/tracker';
import { positionGroup } from '@/config/jobPositions';
import UserProfileForm from '@/components/forms/UserProfileForm.vue';
import MembershipList from '@/components/MembershipList.vue';

const props = defineProps({
  userId: {
    type: String,
    required: true,
  },
  noTitle: {
    type: Boolean,
    required: false,
    default: false,
  },
});

const emit = defineEmits(['save']);

const i18n = useI18n();
const toast = useToast();

const { user: currentUser, isSuperAdmin } = storeToRefs(useAuthStore());
const { user, organizations, departments, products } = useTrackerUser(props.userId);
const { organizations: allOrganizations } = storeToRefs(useTrackerStore());

// "Organization: role" for every organization the person administers or has
// a role in.
const roleLines = computed(() => {
  if (!user.value) {
    return [];
  }
  if (user.value.superAdmin) {
    return [{ org: null, label: i18n.t('general.superAdmin') }];
  }
  return allOrganizations.value
    .map((org) => ({ org: org.name, group: positionGroup(user.value, org.id) }))
    .filter((line) => line.group !== 'others')
    .map((line) => ({ org: line.org, label: i18n.t(`user.position.${line.group}`) }));
});
const isCurrentUser = computed(
  () => user.value && currentUser.value && user.value.id === currentUser.value.id
);
const isLoading = ref(false);

async function save(data) {
  isLoading.value = true;
  try {
    const { displayName, lang } = data;
    const preferences = user.value.preferences;
    preferences.lang = lang;
    await User.update(user.value, {
      displayName,
      preferences,
    });
    toast.success(i18n.t('toaster.update.profile'));
    emit('save');
  } catch (e) {
    toast.error(i18n.t('toaster.error.save'));
  }
  isLoading.value = false;
}
</script>

<template>
  <div class="user-profile">
    <div>
      <h2 v-if="!noTitle" class="title-2 mb-size-16">
        {{ $t('user.profile') }}
      </h2>

      <template v-if="user">
        <UserProfileForm
          v-if="isCurrentUser || isSuperAdmin"
          :user="user"
          :loading="isLoading"
          @save="save"
        />

        <div v-else class="user-details">
          <div class="user-details__property">
            <span>{{ $t('fields.name') }}</span>
            <span>{{ user.displayName }}</span>
          </div>
        </div>

        <!-- Roles are set by admins per organization and carry rights. -->
        <div class="user-details mt-size-16">
          <div class="user-details__property">
            <span>{{ $t('user.position.title') }}</span>
            <span v-if="roleLines.length">
              <template v-for="line in roleLines" :key="line.org">
                {{ line.org ? `${line.org}: ${line.label}` : line.label }}<br />
              </template>
            </span>
            <span v-else>{{ $t('user.position.none') }}</span>
          </div>
        </div>
      </template>
    </div>

    <div>
      <h2 class="title-2 mb-size-16">
        {{ $t(isCurrentUser ? 'user.myProducts' : 'user.products') }}
      </h2>

      <MembershipList
        :organizations="organizations"
        :departments="departments"
        :products="products"
      />
    </div>
  </div>
</template>

<style lang="scss" scoped>
@use '@oslokommune/punkt-css/dist/scss/abstracts/mixins/typography' as *;

.user-profile {
  display: flex;
  flex-direction: column;
  gap: 1rem;

  > div {
    flex: 1 1 50%;
  }

  @include bp-up(36rem) {
    flex-direction: row;
    gap: 4rem;
  }
}

.user-details {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  @include get-text('pkt-txt-16');

  &__property {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;

    > span:first-child {
      @include get-text('pkt-txt-18-medium');
    }
  }
}
</style>
