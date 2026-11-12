<script setup>
import '@oslokommune/punkt-elements/dist/pkt-button.js';

defineProps({
  text: {
    type: String,
    required: false,
    default: null,
  },
  variant: {
    type: String,
    required: false,
    default: 'icon-left',
  },
});
</script>

<template>
  <pkt-button v-bind="$attrs" skin="primary" :variant="variant" iconName="save">
    <span>{{ text ?? $t('btn.save') }}</span>
  </pkt-button>
</template>
