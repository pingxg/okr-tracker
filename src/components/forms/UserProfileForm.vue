<script setup>
import { computed, ref, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { FormSection, BtnSave } from '@/components/generic/form';

const i18n = useI18n();

const props = defineProps({
  user: {
    type: Object,
    required: true,
  },
  loading: {
    type: Boolean,
    required: false,
    default: false,
  },
});

defineEmits(['save']);

const formData = ref(null);

const languageOptions = computed(() =>
  Object.keys(i18n.messages.value).map((language) => ({
    language,
    label: i18n.t(`languages.${language}`),
  }))
);

watchEffect(() => {
  const { displayName, preferences } = props.user;
  const { lang } = preferences;
  formData.value = {
    displayName,
    lang,
  };
});
</script>

<template>
  <FormSection>
    <FormComponent
      v-model="formData.displayName"
      name="name"
      :label="$t('fields.name')"
      rules="required"
    />

    <FormComponent
      v-model="formData.lang"
      input-type="custom-select"
      name="language"
      :label="$t('user.language')"
      rules="required"
      value-prop="language"
      label-prop="label"
      :options="languageOptions"
      :can-clear="false"
      append-to-body
    />

    <template #actions="{ submit, disabled }">
      <BtnSave
        :disabled="disabled || loading"
        @click="submit(() => $emit('save', formData))"
      />
    </template>
  </FormSection>
</template>
