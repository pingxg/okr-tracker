<script setup>
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useHead } from '@unhead/vue';
import '@oslokommune/punkt-elements/dist/pkt-button.js';
import '@oslokommune/punkt-elements/dist/pkt-loader.js';
import '@oslokommune/punkt-elements/dist/pkt-alert.js';
import { loginProviderMS } from '@/config/backend';
import { useAuthStore } from '@/store/auth';
import BuildingsGraphic from '@/components/graphics/BuildingsGraphic.vue';

const i18n = useI18n();

useHead({ title: () => i18n.t('login.login') });

const authStore = useAuthStore();
const { isAuthenticating, authenticationProviders, authenticationError } =
  storeToRefs(authStore);
const { signInWithProvider } = authStore;

// Microsoft 365 is the only way to sign in.
const microsoftEnabled = computed(() =>
  authenticationProviders.value.includes('microsoft')
);

const authenticationErrorMessage = computed(() => {
  switch (authenticationError.value) {
    case 1:
      return i18n.t('login.error.notRegistered');
    case 2:
      return i18n.t('login.error.providerError');
    case 5:
      return i18n.t('login.error.userAbort');
    case 7:
      return i18n.t('login.error.notAllowed');
    default:
      return null;
  }
});
</script>

<template>
  <PageLayout breakpoint="phablet">
    <h1 class="title-1">{{ $t('login.login') }}</h1>

    <div v-if="isAuthenticating && authenticationError === null" class="login__loading">
      <pkt-loader :message="$t('login.loading')" size="large" variant="blue" inline />
    </div>

    <pkt-alert v-else-if="authenticationError" skin="error" closeAlert class="mb-size-32">
      <div>{{ authenticationErrorMessage }}</div>
    </pkt-alert>

    <div
      v-if="!isAuthenticating || authenticationError !== null"
      class="login__providers"
    >
      <pkt-button
        v-if="microsoftEnabled"
        full-width
        size="small"
        @click="signInWithProvider(loginProviderMS)"
      >
        <span>{{ $t('login.microsoft') }}</span>
      </pkt-button>

      <pkt-alert v-else skin="warning">
        <div>{{ $t('login.error.notConfigured') }}</div>
      </pkt-alert>
    </div>

    <template #footer>
      <BuildingsGraphic skin="dim" />
    </template>
  </PageLayout>
</template>

<style lang="scss" scoped>
@use '@oslokommune/punkt-css/dist/scss/abstracts/mixins/breakpoints' as *;

.page {
  background-color: var(--pkt-color-background-subtle);

  @include bp('tablet-up') {
    :deep(.page__main) {
      padding: 1.5rem;
      background: var(--pkt-color-background-default);
    }
  }
}

.login__providers {
  display: flex;
  flex-direction: column;
  gap: 0.5rem 0.5rem;
  margin-top: 2rem;
}

.login__loading {
  text-align: center;
}
</style>
