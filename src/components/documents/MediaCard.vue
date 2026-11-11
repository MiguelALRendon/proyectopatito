<script setup lang="ts">
import { computed } from 'vue';
import { MEDIA_FAILURE_NOTICES } from '../../documents/labels';
import { formatClock, type MediaFailure } from '../../documents/media';
import type { FileProbe } from '../../services/filesApi';
import BinaryCard from './BinaryCard.vue';

const DURATION_LABEL = 'Duración';
const DIMENSIONS_LABEL = 'Dimensiones';

const props = defineProps<{
  path: string;
  probe: FileProbe;
  reason: MediaFailure;
  duration: number;
  dimensions: string | null;
}>();

const facts = computed(() => {
  const known: [string, string][] = [];
  if (Number.isFinite(props.duration)) {
    known.push([DURATION_LABEL, formatClock(props.duration)]);
  }
  if (props.dimensions) known.push([DIMENSIONS_LABEL, props.dimensions]);
  return known;
});
</script>

<template>
  <BinaryCard
    :path="path"
    :probe="probe"
    :notice="MEDIA_FAILURE_NOTICES[reason]"
    :extra-facts="facts"
  />
</template>
