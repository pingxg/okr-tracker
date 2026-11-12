<script setup>
import EmptyPage from '@/components/pages/EmptyPage.vue';

defineProps({
  heading: {
    type: String,
    required: false,
    default: null,
  },
  body: {
    type: String,
    required: false,
    default: null,
  },
  backTo: {
    type: Object,
    required: false,
    default: null,
  },
  backText: {
    type: String,
    required: false,
    default: null,
  },
});
</script>

<template>
  <EmptyPage
    :heading="heading ?? $t('notFound.title')"
    :body="body ?? $t('notFound.body')"
    skin="warning"
  >
    <RouterLink v-if="backTo" :to="backTo" class="pkt-link">
      <pkt-icon class="pkt-link__icon" name="chevron-left" />
      {{ backText ?? $t('notFound.linkText') }}
    </RouterLink>
  </EmptyPage>
</template>
