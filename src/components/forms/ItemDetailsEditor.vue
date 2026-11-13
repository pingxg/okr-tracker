<script setup>
/**
 * Editor for an item's own information fields: groups (e.g. "Company
 * details") holding "field name: value" rows, both named by the user.
 * v-model is an array of { title, fields: [{ label, value }] }.
 */
import { ref, watch } from 'vue';
import '@oslokommune/punkt-elements/dist/pkt-button.js';

defineProps({
  disabled: {
    type: Boolean,
    required: false,
    default: false,
  },
});

const model = defineModel({ type: Array, default: () => [] });

const copy = (list) =>
  (list || []).map((g) => ({ ...g, fields: (g.fields || []).map((f) => ({ ...f })) }));

// Working copy. Every change is applied here first and then handed out as a
// fresh copy, so several changes before the parent re-renders (fast typing,
// autofill, paste) build on each other instead of overwriting each other.
const groups = ref(copy(model.value));
let lastEmitted = null;

watch(model, (value) => {
  if (value !== lastEmitted) {
    groups.value = copy(value);
  }
});

const emptyField = () => ({ label: '', value: '' });

function update(fn) {
  fn(groups.value);
  lastEmitted = copy(groups.value);
  model.value = lastEmitted;
}

const addGroup = () => update((g) => g.push({ title: '', fields: [emptyField()] }));
const removeGroup = (gi) => update((g) => g.splice(gi, 1));
const addField = (gi) => update((g) => g[gi].fields.push(emptyField()));
const removeField = (gi, fi) => update((g) => g[gi].fields.splice(fi, 1));

function move(list, from, to) {
  if (to < 0 || to >= list.length) {
    return;
  }
  const [entry] = list.splice(from, 1);
  list.splice(to, 0, entry);
}
const moveGroup = (gi, step) => update((g) => move(g, gi, gi + step));
const moveField = (gi, fi, step) => update((g) => move(g[gi].fields, fi, fi + step));

const setTitle = (gi, title) =>
  update((g) => {
    g[gi].title = title;
  });
const setField = (gi, fi, key, value) =>
  update((g) => {
    g[gi].fields[fi][key] = value;
  });
</script>

<template>
  <div class="details-editor">
    <p class="details-editor__help pkt-txt-16">{{ $t('details.help') }}</p>

    <div v-for="(group, gi) in groups" :key="gi" class="details-editor__group">
      <div class="details-editor__group-head">
        <div class="details-editor__field">
          <label :for="`details-group-${gi}`" class="pkt-inputwrapper__label">
            {{ $t('details.groupTitle') }}
          </label>
          <input
            :id="`details-group-${gi}`"
            class="pkt-input pkt-input--fullwidth"
            type="text"
            maxlength="100"
            :value="group.title"
            :disabled="disabled"
            @input="setTitle(gi, $event.target.value)"
          />
        </div>
        <div class="details-editor__tools">
          <pkt-button
            v-tooltip="$t('details.moveUp')"
            skin="tertiary"
            size="small"
            variant="icon-only"
            iconName="chevron-up"
            :disabled="disabled || gi === 0"
            @click="moveGroup(gi, -1)"
          >
            <span>{{ $t('details.moveUp') }}</span>
          </pkt-button>
          <pkt-button
            v-tooltip="$t('details.moveDown')"
            skin="tertiary"
            size="small"
            variant="icon-only"
            iconName="chevron-down"
            :disabled="disabled || gi === groups.length - 1"
            @click="moveGroup(gi, 1)"
          >
            <span>{{ $t('details.moveDown') }}</span>
          </pkt-button>
          <pkt-button
            v-tooltip="$t('details.removeGroup')"
            skin="tertiary"
            size="small"
            variant="icon-only"
            iconName="trash-can"
            :disabled="disabled"
            @click="removeGroup(gi)"
          >
            <span>{{ $t('details.removeGroup') }}</span>
          </pkt-button>
        </div>
      </div>

      <div v-for="(field, fi) in group.fields" :key="fi" class="details-editor__row">
        <div class="details-editor__field">
          <label
            :for="`details-${gi}-${fi}-label`"
            :class="fi === 0 ? 'pkt-inputwrapper__label' : 'pkt-sr-only'"
          >
            {{ $t('details.fieldName') }}
          </label>
          <input
            :id="`details-${gi}-${fi}-label`"
            class="pkt-input pkt-input--fullwidth"
            type="text"
            maxlength="100"
            :value="field.label"
            :disabled="disabled"
            @input="setField(gi, fi, 'label', $event.target.value)"
          />
        </div>
        <div class="details-editor__field details-editor__field--value">
          <label
            :for="`details-${gi}-${fi}-value`"
            :class="fi === 0 ? 'pkt-inputwrapper__label' : 'pkt-sr-only'"
          >
            {{ $t('details.fieldValue') }}
          </label>
          <input
            :id="`details-${gi}-${fi}-value`"
            class="pkt-input pkt-input--fullwidth"
            type="text"
            maxlength="1000"
            :value="field.value"
            :disabled="disabled"
            @input="setField(gi, fi, 'value', $event.target.value)"
          />
        </div>
        <div class="details-editor__tools">
          <pkt-button
            v-tooltip="$t('details.moveUp')"
            skin="tertiary"
            size="small"
            variant="icon-only"
            iconName="chevron-up"
            :disabled="disabled || fi === 0"
            @click="moveField(gi, fi, -1)"
          >
            <span>{{ $t('details.moveUp') }}</span>
          </pkt-button>
          <pkt-button
            v-tooltip="$t('details.removeField')"
            skin="tertiary"
            size="small"
            variant="icon-only"
            iconName="trash-can"
            :disabled="disabled"
            @click="removeField(gi, fi)"
          >
            <span>{{ $t('details.removeField') }}</span>
          </pkt-button>
        </div>
      </div>

      <pkt-button
        skin="tertiary"
        size="small"
        variant="icon-left"
        iconName="plus-sign"
        :disabled="disabled"
        @click="addField(gi)"
      >
        <span>{{ $t('details.addField') }}</span>
      </pkt-button>
    </div>

    <pkt-button
      skin="secondary"
      variant="icon-left"
      iconName="plus-sign"
      :disabled="disabled"
      @click="addGroup"
    >
      <span>{{ $t('details.addGroup') }}</span>
    </pkt-button>
  </div>
</template>

<style lang="scss" scoped>
.details-editor {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 1.5rem;

  &__help {
    margin: 0;
  }

  &__group {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    align-items: flex-start;
    padding: 1rem;
    background: var(--color-gray-light);
  }

  &__group-head,
  &__row {
    display: flex;
    gap: 0.5rem;
    align-items: flex-end;
    width: 100%;
  }

  &__field {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;

    &--value {
      flex: 1.4;
    }
  }

  &__tools {
    display: flex;
    flex-shrink: 0;
  }
}
</style>
