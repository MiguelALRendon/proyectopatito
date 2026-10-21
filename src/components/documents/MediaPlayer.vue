<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  SEEK_STEP_SECONDS,
  VOLUME_STEP,
  describeDimensions,
  failureOfError,
  formatClock,
  isRecognized,
  mediaKeyAction,
  seekTarget,
  stepVolume,
  type MediaFailure,
  type MediaKeyAction,
} from '../../documents/media';
import { fileUrl, type FileProbe } from '../../services/filesApi';
import { formatSize } from '../../utils/entryDisplay';
import { fileNameOf } from '../../utils/folderPaths';
import AppIcon from '../icons/AppIcon.vue';
import MediaCard from './MediaCard.vue';
import ViewerFrame from './ViewerFrame.vue';

const SEEK_RESOLUTION = 0.1;
const VOLUME_MAX = 1;
const KEYS_HINT =
  'Espacio reproduce o pausa, las flechas buscan y cambian el volumen, M silencia';

const props = defineProps<{ path: string; probe: FileProbe }>();

const media = ref<HTMLMediaElement | null>(null);
const stage = ref<HTMLElement | null>(null);
const duration = ref(Number.NaN);
const currentTime = ref(0);
const volume = ref(VOLUME_MAX);
const isPlaying = ref(false);
const isMuted = ref(false);
const isFullscreen = ref(false);
const dimensions = ref<string | null>(null);
const runtimeFailure = ref<MediaFailure | null>(null);

const isVideo = computed(() => props.probe.kind === 'video');
const fileName = computed(() => fileNameOf(props.path));
const source = computed(() => fileUrl(props.path));
const kindLabel = computed(() => (isVideo.value ? 'vídeo' : 'audio'));
const stageLabel = computed(() => {
  const fullscreen = isVideo.value ? ', F pantalla completa' : '';
  return `Reproductor de ${kindLabel.value}: ${fileName.value}. ${KEYS_HINT}${fullscreen}`;
});
const failure = computed<MediaFailure | null>(() => {
  if (runtimeFailure.value) return runtimeFailure.value;
  const probe = document.createElement(isVideo.value ? 'video' : 'audio');
  return isRecognized(probe, props.probe.mime) ? null : 'unrecognized';
});
const canSeek = computed(() => Number.isFinite(duration.value));
const positionText = computed(
  () => `${formatClock(currentTime.value)} de ${formatClock(duration.value)}`,
);
const statusText = computed(() =>
  [props.probe.mime, formatSize(props.probe.len), dimensions.value]
    .filter(Boolean)
    .join(' · '),
);

function onLoadedMetadata() {
  const element = media.value as HTMLMediaElement;
  duration.value = element.duration;
  if (element instanceof HTMLVideoElement) {
    dimensions.value = describeDimensions(
      element.videoWidth,
      element.videoHeight,
    );
  }
}

function onTimeUpdate() {
  currentTime.value = media.value?.currentTime ?? 0;
}

function onVolumeChange() {
  volume.value = media.value?.volume ?? volume.value;
  isMuted.value = media.value?.muted ?? false;
}

function onError() {
  runtimeFailure.value = failureOfError(media.value?.error?.code);
}

function toggle() {
  const element = media.value;
  if (!element) return;
  if (element.paused) void element.play().catch(() => undefined);
  else element.pause();
}

function seekBy(delta: number) {
  const element = media.value;
  if (!element || !canSeek.value) return;
  element.currentTime = seekTarget(
    element.currentTime,
    delta,
    element.duration,
  );
}

function onSeekInput(event: Event) {
  const element = media.value;
  if (!element) return;
  element.currentTime = Number((event.target as HTMLInputElement).value);
}

function setVolume(next: number) {
  const element = media.value;
  if (!element) return;
  element.volume = next;
  if (next > 0) element.muted = false;
}

function volumeBy(delta: number) {
  setVolume(stepVolume(media.value?.volume ?? volume.value, delta));
}

function onVolumeInput(event: Event) {
  setVolume(Number((event.target as HTMLInputElement).value));
}

function toggleMute() {
  const element = media.value;
  if (element) element.muted = !element.muted;
}

function toggleFullscreen() {
  if (!isVideo.value || !stage.value) return;
  if (document.fullscreenElement) void document.exitFullscreen();
  else void stage.value.requestFullscreen?.();
}

const ACTIONS: Record<MediaKeyAction, () => void> = {
  toggle,
  back: () => seekBy(-SEEK_STEP_SECONDS),
  forward: () => seekBy(SEEK_STEP_SECONDS),
  louder: () => volumeBy(VOLUME_STEP),
  quieter: () => volumeBy(-VOLUME_STEP),
  mute: toggleMute,
  fullscreen: toggleFullscreen,
};

function onKeydown(event: KeyboardEvent) {
  const action = mediaKeyAction(event.key);
  if (!action || event.ctrlKey || event.altKey || event.metaKey) return;
  event.preventDefault();
  ACTIONS[action]();
}

function syncFullscreen() {
  isFullscreen.value = document.fullscreenElement === stage.value;
}

function release() {
  const element = media.value;
  if (!element) return;
  element.pause();
  element.removeAttribute('src');
  element.load();
}

watch(
  () => props.path,
  () => {
    release();
    runtimeFailure.value = null;
    duration.value = Number.NaN;
    currentTime.value = 0;
    dimensions.value = null;
    isPlaying.value = false;
  },
);
document.addEventListener('fullscreenchange', syncFullscreen);
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', syncFullscreen);
  release();
});
</script>

<template>
  <MediaCard
    v-if="failure"
    :path="path"
    :probe="probe"
    :reason="failure"
    :duration="duration"
    :dimensions="dimensions"
  />
  <ViewerFrame
    v-else
    :title="fileName"
    :label="`Reproductor de ${kindLabel}`"
    :actions-label="`Acciones del reproductor de ${kindLabel}`"
  >
    <template #actions>
      <button
        v-if="isVideo"
        type="button"
        class="btn btn--pill"
        :aria-pressed="isFullscreen"
        aria-label="Pantalla completa"
        title="Pantalla completa (F)"
        @click="toggleFullscreen"
      >
        <AppIcon name="expand" />
      </button>
    </template>
    <div
      ref="stage"
      class="media-player__stage"
      :class="{ 'media-player__stage--audio': !isVideo }"
      tabindex="0"
      role="group"
      :aria-label="stageLabel"
      @keydown="onKeydown"
    >
      <component
        :is="isVideo ? 'video' : 'audio'"
        :key="path"
        ref="media"
        class="media-player__element"
        :src="source"
        preload="metadata"
        @loadedmetadata="onLoadedMetadata"
        @timeupdate="onTimeUpdate"
        @play="isPlaying = true"
        @pause="isPlaying = false"
        @ended="isPlaying = false"
        @volumechange="onVolumeChange"
        @error="onError"
      ></component>
      <AppIcon v-if="!isVideo" name="document" class="media-player__icon" />
    </div>
    <template #status>
      <div class="media-player__controls" role="group" aria-label="Controles">
        <button
          type="button"
          class="btn btn--pill"
          :aria-label="isPlaying ? 'Pausar' : 'Reproducir'"
          :title="isPlaying ? 'Pausar (Espacio)' : 'Reproducir (Espacio)'"
          @click="toggle"
        >
          <AppIcon :name="isPlaying ? 'pause' : 'play'" />
        </button>
        <input
          class="media-player__seek"
          type="range"
          min="0"
          :max="canSeek ? duration : 0"
          :step="SEEK_RESOLUTION"
          :value="currentTime"
          :disabled="!canSeek"
          aria-label="Posición"
          :aria-valuetext="positionText"
          @input="onSeekInput"
        />
        <span class="media-player__time">{{ positionText }}</span>
        <button
          type="button"
          class="btn btn--pill"
          :aria-pressed="isMuted"
          :aria-label="isMuted ? 'Activar sonido' : 'Silenciar'"
          :title="isMuted ? 'Activar sonido (M)' : 'Silenciar (M)'"
          @click="toggleMute"
        >
          <AppIcon :name="isMuted ? 'volume-off' : 'volume'" />
        </button>
        <input
          class="media-player__volume"
          type="range"
          min="0"
          :max="VOLUME_MAX"
          :step="VOLUME_STEP"
          :value="isMuted ? 0 : volume"
          aria-label="Volumen"
          @input="onVolumeInput"
        />
        <span class="media-player__facts">{{ statusText }}</span>
      </div>
    </template>
  </ViewerFrame>
</template>

<style scoped>
.media-player__stage {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-block-size: 0;
  min-inline-size: 0;
  background-color: var(--color-bg-elevated);
}

.media-player__stage--audio {
  flex-direction: column;
  gap: var(--space-md);
}

.media-player__element {
  max-inline-size: 100%;
  max-block-size: 100%;
}

audio.media-player__element {
  display: none;
}

.media-player__icon {
  inline-size: var(--size-icon-card);
  block-size: var(--size-icon-card);
  color: var(--color-primary);
}

.media-player__controls {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
}

.media-player__seek {
  flex: 1;
  min-inline-size: var(--size-media-seek-min);
}

.media-player__volume {
  inline-size: var(--size-media-volume);
}

.media-player__time {
  font-variant-numeric: tabular-nums;
}

.media-player__facts {
  margin-inline-start: auto;
  color: var(--color-text-muted);
}
</style>
