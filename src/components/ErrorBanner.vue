<script setup lang="ts">
import { computed } from 'vue';
import type { CommandError } from '../services/tauri';
import { errorGuidance } from '../utils/svnLabels';

const props = defineProps<{ error: CommandError }>();

const guidance = computed(() => errorGuidance(props.error.kind));
</script>

<template>
  <div class="banner banner--error" role="alert">
    <strong>{{ error.message }}</strong>
    <span v-if="guidance">{{ guidance }}</span>
    <slot />
  </div>
</template>
