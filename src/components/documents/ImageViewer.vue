<script setup lang="ts">
import { computed, ref } from 'vue';
import { IMAGE_FAILED_NOTICE } from '../../documents/labels';
import { isVectorImage } from '../../documents/imageFormats';
import { fileUrl, type FileProbe } from '../../services/filesApi';
import { formatSize } from '../../utils/entryDisplay';
import { fileNameOf } from '../../utils/folderPaths';
import BinaryCard from './BinaryCard.vue';
import TextEditor from './TextEditor.vue';
import ViewerFrame from './ViewerFrame.vue';

type Fit = 'fit' | 'actual';

const props = defineProps<{ path: string; probe: FileProbe }>();
const emit = defineEmits<{ reprobe: [] }>();

const fit = ref<Fit>('fit');
const hasFailed = ref(false);
const naturalSize = ref<string | null>(null);
const isCodeVisible = ref(false);
const hasOpenedCode = ref(false);
const reloads = ref(0);

const fileName = computed(() => fileNameOf(props.path));
const isVector = computed(() => isVectorImage(props.probe));
const imageUrl = computed(() => {
  const url = fileUrl(props.path);
  return reloads.value > 0 ? `${url}?v=${reloads.value}` : url;
});
const statusText = computed(() =>
  [naturalSize.value, props.probe.mime, formatSize(props.probe.len)]
    .filter(Boolean)
    .join(' · '),
);

async function onLoad(event: Event) {
  const image = event.target as HTMLImageElement;
  naturalSize.value = image.naturalWidth
    ? `${image.naturalWidth} × ${image.naturalHeight} px`
    : null;
  try {
    await image.decode?.();
  } catch {
    hasFailed.value = true;
  }
}

function showCode() {
  hasOpenedCode.value = true;
  isCodeVisible.value = true;
}

function showImage() {
  isCodeVisible.value = false;
  reloads.value += 1;
}
</script>

<template>
  <BinaryCard
    v-if="hasFailed"
    :path="path"
    :probe="probe"
    :notice="IMAGE_FAILED_NOTICE"
  />
  <section v-else class="image-viewer" :aria-label="`Imagen ${fileName}`">
    <ViewerFrame
      v-show="!isCodeVisible"
      :title="fileName"
      label="Visor de imagen"
      actions-label="Acciones del visor de imagen"
    >
      <template #actions>
        <button
          type="button"
          class="btn btn--pill"
          :aria-pressed="fit === 'fit'"
          @click="fit = 'fit'"
        >
          Ajustar a la ventana
        </button>
        <button
          type="button"
          class="btn btn--pill"
          :aria-pressed="fit === 'actual'"
          @click="fit = 'actual'"
        >
          100 %
        </button>
        <button
          v-if="isVector"
          type="button"
          class="btn btn--pill"
          @click="showCode"
        >
          Ver código
        </button>
      </template>
      <div
        class="image-viewer__stage"
        role="region"
        :aria-label="`Vista de ${fileName}`"
        tabindex="0"
      >
        <img
          :key="imageUrl"
          class="image-viewer__image"
          :class="[
            `image-viewer__image--${fit}`,
            { 'image-viewer__image--vector': isVector },
          ]"
          :src="imageUrl"
          :alt="`Vista de ${fileName}`"
          @load="onLoad"
          @error="hasFailed = true"
        />
      </div>
      <template #status>
        <span role="status">{{ statusText }}</span>
      </template>
    </ViewerFrame>
    <div v-if="hasOpenedCode" v-show="isCodeVisible" class="image-viewer__code">
      <div class="image-viewer__back">
        <button type="button" class="btn btn--pill" @click="showImage">
          Ver imagen
        </button>
      </div>
      <TextEditor :path="path" :probe="probe" @reprobe="emit('reprobe')" />
    </div>
  </section>
</template>

<style scoped>
.image-viewer,
.image-viewer__code {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  block-size: 100%;
  min-block-size: 0;
}

.image-viewer > :first-child {
  flex: 1;
}

.image-viewer__back {
  display: flex;
  flex: none;
  justify-content: flex-end;
}

.image-viewer__stage {
  display: flex;
  flex: 1;
  min-block-size: 0;
  min-inline-size: 0;
  overflow: auto;
  background-image: conic-gradient(
    var(--color-bg-elevated) 25%,
    var(--color-bg) 0 50%,
    var(--color-bg-elevated) 0 75%,
    var(--color-bg) 0
  );
  background-size: calc(var(--size-checker) * 2) calc(var(--size-checker) * 2);
}

.image-viewer__image {
  margin: auto;
}

.image-viewer__image--fit {
  max-block-size: 100%;
  max-inline-size: 100%;
  object-fit: contain;
}

.image-viewer__image--fit.image-viewer__image--vector {
  block-size: 100%;
  inline-size: 100%;
}

.image-viewer__image--actual {
  max-block-size: none;
  max-inline-size: none;
}
</style>
