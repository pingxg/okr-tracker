<script setup>
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/store/auth';
import { setLanguage } from '@/locale/i18n';

const i18n = useI18n();
const authStore = useAuthStore();

// Short labels shown in the header; each language is named in itself.
const LANGUAGES = [
  { code: 'zh-CN', label: '中文' },
  { code: 'en-US', label: 'EN' },
];

async function choose(code) {
  if (code === i18n.locale.value) {
    return;
  }
  setLanguage(code);
  // Signed-in users keep the choice on all their devices.
  if (authStore.isLoggedIn) {
    authStore.language = code;
  }
}
</script>

<template>
  <div class="language-switch" role="group" :aria-label="$t('user.language')">
    <template v-for="(language, index) in LANGUAGES" :key="language.code">
      <span v-if="index > 0" class="language-switch__sep" aria-hidden="true">/</span>
      <button
        type="button"
        :lang="language.code"
        :class="[
          'language-switch__option',
          { 'language-switch__option--active': language.code === i18n.locale.value },
        ]"
        :aria-pressed="language.code === i18n.locale.value"
        @click="choose(language.code)"
      >
        {{ language.label }}
      </button>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.language-switch {
  display: flex;
  gap: 0.25rem;
  align-items: center;
  height: 100%;
  padding: 0 1rem;

  &__sep {
    color: var(--pkt-color-grays-gray-400);
  }

  &__option {
    padding: 0.25rem 0.375rem;
    font: inherit;
    color: var(--pkt-color-grays-gray-600);
    cursor: pointer;
    background: none;
    border: 0;
    border-radius: 0.25rem;

    &:hover {
      color: var(--pkt-color-brand-dark-blue-1000);
      text-decoration: underline;
    }

    &:focus-visible {
      outline: 2px solid var(--pkt-color-border-states-focus);
      outline-offset: 1px;
    }

    &--active {
      font-weight: 500;
      color: var(--pkt-color-brand-dark-blue-1000);
      cursor: default;

      &:hover {
        text-decoration: none;
      }
    }
  }
}
</style>
