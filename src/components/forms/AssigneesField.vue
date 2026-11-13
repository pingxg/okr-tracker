<script setup>
/**
 * "Assigned to" for a key result or measurement: one or more members of the
 * team it belongs to. v-model is a list of user ids.
 */
import { computed } from 'vue';
import { useCollection } from '@/backend/vuefire';
import { collection } from '@/backend/firestore';
import { db } from '@/config/backend';
import { teamIds } from '@/util/assignees';

const props = defineProps({
  // The organization, department or team whose members can be assigned.
  parent: {
    type: Object,
    required: false,
    default: null,
  },
  disabled: {
    type: Boolean,
    required: false,
    default: false,
  },
  helptext: {
    type: String,
    required: false,
    default: null,
  },
});

const model = defineModel({ type: Array, default: () => [] });

const users = useCollection(collection(db, 'users'));

const options = computed(() => {
  const members = teamIds(props.parent);
  return users.value
    .filter((u) => members.includes(u.id))
    .map((u) => ({ id: u.id, displayName: u.displayName || null }))
    .sort((a, b) => (a.displayName || a.id).localeCompare(b.displayName || b.id));
});
</script>

<template>
  <FormComponent
    v-model="model"
    input-type="custom-select"
    select-mode="tags"
    name="assignees"
    :disabled="disabled"
    :label="$t('assignees.label')"
    :helptext="helptext || $t('assignees.help')"
    value-prop="id"
    :tag-label="(o) => o.displayName || o.id"
    :option-label="(o) => (o.displayName ? `${o.displayName} (${o.id})` : o.id)"
    :track-by="['displayName', 'id']"
    :options="options"
  />
</template>
