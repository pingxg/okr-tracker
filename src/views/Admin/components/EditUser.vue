<script setup>
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { useAuthStore } from '@/store/auth';
import { useTrackerStore } from '@/store/tracker';
import { useTrackerUser } from '@/composables/user';
import User from '@/db/User';
import { BtnSave, BtnDelete } from '@/components/generic/form';
import { jobPositions, roleIn } from '@/config/jobPositions';

const toast = useToast();
const i18n = useI18n();

const props = defineProps({
  userId: {
    type: String,
    required: true,
  },
});

const emit = defineEmits(['close']);

const { organizations } = storeToRefs(useTrackerStore());
const { user: currentUser, isSuperAdmin } = storeToRefs(useAuthStore());
const { user } = useTrackerUser(props.userId);
const isCurrentUser = computed(
  () => user.value && currentUser.value && user.value.id === currentUser.value.id
);
const formData = ref(null);
const isLoading = ref(false);

// Organizations whose admin rights the current user may grant: all for super
// admins, otherwise only the organizations they are an admin of.
const manageableOrgs = computed(() =>
  organizations.value
    .filter((o) => isSuperAdmin.value || (currentUser.value?.admin || []).includes(o.id))
    .map(({ id, name }) => ({ id, name }))
);
const manageableIds = computed(() => manageableOrgs.value.map((o) => o.id));

// Admin rights in other organizations: shown, kept as they are on save.
const otherAdminOrgs = computed(() =>
  (user.value?.admin || [])
    .filter((oid) => !manageableIds.value.includes(oid))
    .map((oid) => organizations.value.find((o) => o.id === oid))
    .filter(Boolean)
);

watch(
  [user, manageableOrgs],
  () => {
    if (user.value) {
      const { id, displayName, admin, superAdmin } = user.value;

      formData.value = {
        id,
        displayName,
        admin: (admin || [])
          .filter((oid) => manageableIds.value.includes(oid))
          .map((oid) => manageableOrgs.value.find((o) => o.id === oid)),
        superAdmin: superAdmin || false,
        // Role per organization the editor manages.
        roles: Object.fromEntries(
          manageableIds.value.map((oid) => [oid, roleIn(user.value, oid)])
        ),
      };
    }
  },
  { immediate: true }
);

const roleOptions = computed(() =>
  jobPositions.map((role) => ({ value: role, label: i18n.t(`user.position.${role}`) }))
);

/** Roles to save: unchanged for other organizations, edited for managed ones. */
function rolesToSave() {
  const kept = Object.fromEntries(
    Object.entries(user.value.roles || {}).filter(
      ([oid]) => !manageableIds.value.includes(oid)
    )
  );
  const edited = Object.fromEntries(
    Object.entries(formData.value.roles).filter(([, role]) => role)
  );
  return { ...kept, ...edited };
}

async function update() {
  isLoading.value = true;
  try {
    const { superAdmin, roles, ...rest } = formData.value;
    await User.update(user.value, {
      ...rest,
      admin: [
        ...otherAdminOrgs.value.map((org) => org.id),
        ...formData.value.admin.map((org) => org.id),
      ],
      roles: rolesToSave(),
      // Only super admins grant super admin (the server checks this too).
      ...(isSuperAdmin.value ? { superAdmin } : {}),
    });
    toast.success(i18n.t('toaster.savedChanges'));
  } catch {
    toast.error(i18n.t('toaster.error.save'));
  }
  isLoading.value = false;
}

async function remove() {
  isLoading.value = true;
  const { displayName } = user.value;
  try {
    await User.remove(user.value);
    toast.success(i18n.t('toaster.delete.user', { user: displayName }));
    emit('close');
  } catch {
    toast.error(i18n.t('toaster.error.user', { user: displayName }));
  }
  isLoading.value = false;
}
</script>

<template>
  <slot name="back"></slot>

  <div class="edit-user mt-size-16">
    <h2 class="pkt-txt-22 mb-size-16">
      {{ $t('admin.users.edit') }}
    </h2>

    <FormSection v-if="user">
      <FormComponent
        v-model="formData.id"
        input-type="input"
        name="id"
        :label="$t('fields.email')"
        rules="required"
        type="email"
        :disabled="true"
      />

      <FormComponent
        v-model="formData.displayName"
        input-type="input"
        name="displayName"
        :label="$t('fields.displayName')"
        rules="required"
        type="text"
      />

      <FormComponent
        v-model="formData.admin"
        input-type="custom-select"
        select-mode="tags"
        name="admin"
        :disabled="!manageableOrgs.length"
        :label="$t('general.admin')"
        :helptext="
          otherAdminOrgs.length
            ? $t('admin.users.otherAdminOrgs', {
                names: otherAdminOrgs.map((o) => o.name).join(', '),
              })
            : isSuperAdmin
            ? null
            : $t('admin.users.ownOrgsOnly')
        "
        value-prop="id"
        label-prop="name"
        :store-object="true"
        :options="manageableOrgs"
      />

      <!-- Role per organization: decides what the person may do in its
           departments and teams. -->
      <FormComponent
        v-for="org in manageableOrgs"
        :key="org.id"
        v-model="formData.roles[org.id]"
        input-type="custom-select"
        :name="`role-${org.id}`"
        :label="$t('admin.users.roleIn', { org: org.name })"
        :helptext="$t('admin.users.roleHelp')"
        :options="roleOptions"
        :placeholder="$t('user.position.none')"
      />

      <FormComponent
        v-model="formData.superAdmin"
        input-type="switch"
        name="superadmin"
        :label="$t('general.superAdmin')"
        :disabled="isCurrentUser || !isSuperAdmin"
      />

      <template #actions="{ submit, disabled }">
        <BtnDelete
          v-if="isSuperAdmin"
          :disabled="isCurrentUser || isLoading"
          @confirm="remove"
        />
        <BtnSave :disabled="disabled || isLoading" @click="submit(update)" />
      </template>
    </FormSection>
  </div>
</template>

<style lang="scss" scoped>
.edit-user {
  padding: 1rem;
  background: var(--color-gray-light);
}
</style>
