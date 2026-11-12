<script setup>
import '@oslokommune/punkt-elements/dist/pkt-button.js';

defineProps({
  text: {
    type: String,
    required: false,
    default: null,
  },
  skin: {
    type: String,
    required: false,
    default: 'tertiary',
  },
});
</script>

<template>
  <pkt-button v-bind="$attrs" :skin="skin" type="button">
    <span>{{ text ?? $t('btn.cancel') }}</span>
  </pkt-button>
</template>
