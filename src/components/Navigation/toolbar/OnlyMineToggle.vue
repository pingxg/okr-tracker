<script setup>
import { onlyMine } from '@/composables/onlyMine';
import { NavMenu, NavMenuItem } from '../navbar';
</script>

<template>
  <NavMenu class="only-mine-menu" toggles>
    <NavMenuItem
      v-tooltip="$t('onlyMine.tooltip')"
      icon="user"
      :text="$t('onlyMine.label')"
      :active="onlyMine"
      role="menuitemcheckbox"
      :aria="{ label: $t('onlyMine.tooltip'), checked: onlyMine }"
      @click="onlyMine = !onlyMine"
    />
  </NavMenu>
</template>
