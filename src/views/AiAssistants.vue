<script setup>
/**
 * AI assistants (MCP): the connection address, personal tokens and the
 * assistants connected with Microsoft sign-in. Assistants act as the signed-in
 * person, with exactly their rights.
 */
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useHead } from '@unhead/vue';
import { useToast } from 'vue-toast-notification';
import { request } from '@/backend/client';
import { dateShort } from '@/util/format';
import '@oslokommune/punkt-elements/dist/pkt-alert.js';
import { BtnDelete, BtnSave, FormSection } from '@/components/generic/form';

const i18n = useI18n();
const toast = useToast();

useHead({ title: () => i18n.t('ai.title') });

const mcpUrl = `${window.location.origin}/mcp`;

const tokens = ref([]);
const assistants = ref([]);
const isLoading = ref(false);
const newToken = ref(null);
const form = ref({ name: '', expiresInDays: 90 });

const expiryOptions = [30, 90, 180, 365].map((days) => ({
  value: days,
  label: i18n.t('ai.tokens.days', { days }),
}));

const formatDate = (value) => (value ? dateShort(new Date(value)) : '–');

async function load() {
  const data = await request('/tokens', { method: 'GET' });
  tokens.value = data.tokens;
  assistants.value = data.assistants;
}

onMounted(load);

async function createToken() {
  isLoading.value = true;
  try {
    const created = await request('/tokens', {
      body: { name: form.value.name, expiresInDays: Number(form.value.expiresInDays) },
    });
    newToken.value = created;
    form.value = { name: '', expiresInDays: 90 };
    await load();
  } catch {
    toast.error(i18n.t('ai.tokens.createError'));
  } finally {
    isLoading.value = false;
  }
}

async function revoke(path) {
  isLoading.value = true;
  try {
    await request(path, { method: 'DELETE' });
    toast.success(i18n.t('ai.revoked'));
    await load();
  } catch {
    toast.error(i18n.t('toaster.error.save'));
  } finally {
    isLoading.value = false;
  }
}
</script>

<template>
  <PageLayout breakpoint="tablet-big" class="ai-page">
    <h1 class="pkt-txt-24-medium mb-size-16">{{ $t('ai.title') }}</h1>
    <p class="mb-size-24">{{ $t('ai.intro') }}</p>

    <pkt-alert skin="info" class="mb-size-32">
      <div>{{ $t('ai.rights') }}</div>
    </pkt-alert>

    <section class="mb-size-40">
      <h2 class="pkt-txt-20-medium mb-size-16">{{ $t('ai.connect.heading') }}</h2>
      <FormComponent
        name="mcpUrl"
        :label="$t('ai.connect.url')"
        :show-optional-tag="false"
        :copy-button="true"
        :value="mcpUrl"
        :readonly="true"
      />
      <ol class="ai-page__steps">
        <li>{{ $t('ai.connect.oauth') }}</li>
        <li>{{ $t('ai.connect.token') }}</li>
      </ol>
    </section>

    <section class="mb-size-40">
      <h2 class="pkt-txt-20-medium mb-size-8">{{ $t('ai.tokens.heading') }}</h2>
      <p class="mb-size-16">{{ $t('ai.tokens.help') }}</p>

      <pkt-alert v-if="newToken" skin="warning" class="mb-size-24">
        <div>
          <p class="mb-size-8">{{ $t('ai.tokens.showOnce', { name: newToken.name }) }}</p>
          <FormComponent
            name="newToken"
            :label="$t('ai.tokens.token')"
            :show-optional-tag="false"
            :copy-button="true"
            :value="newToken.token"
            :readonly="true"
          />
          <pkt-button size="small" skin="tertiary" @click="newToken = null">
            <span>{{ $t('ai.tokens.done') }}</span>
          </pkt-button>
        </div>
      </pkt-alert>

      <FormSection class="ai-page__form">
        <FormComponent
          v-model="form.name"
          input-type="input"
          name="tokenName"
          :label="$t('ai.tokens.name')"
          :placeholder="$t('ai.tokens.namePlaceholder')"
          rules="required|max:80"
        />
        <FormComponent
          v-model="form.expiresInDays"
          input-type="custom-select"
          name="expiresInDays"
          :label="$t('ai.tokens.expires')"
          :options="expiryOptions"
          :can-clear="false"
          rules="required"
        />
        <template #actions="{ submit, disabled }">
          <BtnSave
            :text="$t('ai.tokens.create')"
            variant="label-only"
            :disabled="disabled || isLoading"
            @click="submit(createToken)"
          />
        </template>
      </FormSection>

      <ul v-if="tokens.length" class="ai-list">
        <li v-for="t in tokens" :key="t.id" class="ai-list__row">
          <div class="ai-list__text">
            <span class="pkt-txt-16-medium">{{ t.name }}</span>
            <span class="ai-list__meta pkt-txt-14">
              {{
                $t('ai.tokens.meta', {
                  created: formatDate(t.created),
                  used: formatDate(t.lastUsed),
                  expires: formatDate(t.expires),
                })
              }}
            </span>
          </div>
          <BtnDelete
            size="small"
            :text="$t('ai.revoke')"
            :confirm-help="$t('ai.tokens.revokeHelp')"
            :disabled="isLoading"
            @confirm="revoke(`/tokens/${t.id}`)"
          />
        </li>
      </ul>
      <p v-else class="ai-list__empty pkt-txt-14">{{ $t('ai.tokens.empty') }}</p>
    </section>

    <section>
      <h2 class="pkt-txt-20-medium mb-size-8">{{ $t('ai.assistants.heading') }}</h2>
      <ul v-if="assistants.length" class="ai-list">
        <li v-for="a in assistants" :key="a.clientId" class="ai-list__row">
          <div class="ai-list__text">
            <span class="pkt-txt-16-medium">{{ a.name }}</span>
            <span class="ai-list__meta pkt-txt-14">
              {{
                $t('ai.assistants.meta', {
                  created: formatDate(a.created),
                  used: formatDate(a.lastUsed),
                })
              }}
            </span>
          </div>
          <BtnDelete
            size="small"
            :text="$t('ai.disconnect')"
            :confirm-help="$t('ai.assistants.disconnectHelp')"
            :disabled="isLoading"
            @confirm="revoke(`/tokens/assistants/${encodeURIComponent(a.clientId)}`)"
          />
        </li>
      </ul>
      <p v-else class="ai-list__empty pkt-txt-14">{{ $t('ai.assistants.empty') }}</p>
    </section>
  </PageLayout>
</template>

<style lang="scss" scoped>
.ai-page {
  padding: 2rem;

  &__steps {
    margin: 1rem 0 0;
    padding-left: 1.25rem;

    li {
      margin-bottom: 0.5rem;
      line-height: 1.5;
    }
  }

  &__form {
    margin-bottom: 1.5rem;
  }
}

.ai-list {
  margin: 0;
  padding: 0;
  list-style: none;

  &__row {
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 0;
    border-bottom: 1px solid var(--color-grayscale-10);
  }

  &__text {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  &__meta,
  &__empty {
    color: var(--color-grayscale-60);
  }
}
</style>
