<script setup lang="ts">
import { computed } from 'vue';
import { MISSING_IMAGE_LABEL } from '../../documents/labels';
import {
  imagePlaceholder,
  renderMarkdown,
} from '../../documents/markdown/render';

const props = defineProps<{ source: string; baseDirectory: string }>();

const html = computed(() => renderMarkdown(props.source, props.baseDirectory));

function blockLinks(event: Event) {
  const isInsideLink =
    event.target instanceof Element && event.target.closest('a');
  if (isInsideLink) event.preventDefault();
}

function replaceBrokenImage(event: Event) {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  image.replaceWith(imagePlaceholder(image, MISSING_IMAGE_LABEL));
}
</script>

<template>
  <article
    class="markdown-preview"
    role="region"
    aria-label="Vista previa de Markdown"
    tabindex="0"
    @click="blockLinks"
    @auxclick="blockLinks"
    @error.capture="replaceBrokenImage"
    v-html="html"
  ></article>
</template>

<style scoped>
.markdown-preview {
  box-sizing: border-box;
  block-size: 100%;
  padding: var(--space-md);
  overflow: auto;
  border-radius: var(--radius-lg);
  background-color: var(--color-bg);
  box-shadow: var(--shadow-clay);
  color: var(--color-text);
  font-family: var(--font-family-base);
  font-size: var(--font-size-base);
  overflow-wrap: anywhere;
}

.markdown-preview :deep(h1) {
  margin: var(--space-lg) 0 var(--space-sm);
  font-size: var(--font-size-xl);
}

.markdown-preview :deep(h2) {
  margin: var(--space-md) 0 var(--space-sm);
  font-size: var(--font-size-lg);
}

.markdown-preview :deep(h3),
.markdown-preview :deep(h4),
.markdown-preview :deep(h5),
.markdown-preview :deep(h6) {
  margin: var(--space-md) 0 var(--space-xs);
  font-size: var(--font-size-base);
}

.markdown-preview :deep(:is(h1, h2, h3, h4, h5, h6):first-child) {
  margin-block-start: 0;
}

.markdown-preview :deep(img) {
  max-inline-size: 100%;
  block-size: auto;
}

.markdown-preview :deep(a) {
  color: var(--color-primary);
  text-decoration: underline;
  cursor: default;
}

.markdown-preview :deep(code) {
  padding: 0 var(--space-xs);
  border-radius: var(--radius-sm);
  background-color: var(--color-bg-elevated);
  font-family: var(--font-family-mono);
}

.markdown-preview :deep(pre) {
  padding: var(--space-sm);
  overflow-x: auto;
  border-radius: var(--radius-sm);
  background-color: var(--color-bg-elevated);
}

.markdown-preview :deep(pre code) {
  padding: 0;
}

.markdown-preview :deep(blockquote) {
  margin: var(--space-sm) 0;
  padding-inline-start: var(--space-sm);
  border-inline-start: var(--border-width-lg) solid var(--color-border);
  color: var(--color-text-muted);
}

.markdown-preview :deep(ul),
.markdown-preview :deep(ol) {
  padding-inline-start: var(--space-lg);
}

.markdown-preview :deep(table) {
  border: var(--border-width-sm) solid var(--color-border);
  border-collapse: collapse;
}

.markdown-preview :deep(th),
.markdown-preview :deep(td) {
  padding: var(--space-xs) var(--space-sm);
  border: var(--border-width-sm) solid var(--color-border);
}

.markdown-preview :deep(th) {
  background-color: var(--color-bg-elevated);
}

.markdown-preview :deep(hr) {
  border: none;
  border-block-start: var(--border-width-sm) solid var(--color-border);
}

.markdown-preview :deep(.markdown-preview__blocked) {
  display: inline-block;
  padding: var(--space-xs) var(--space-sm);
  border: var(--border-width-sm) dashed var(--color-border);
  border-radius: var(--radius-sm);
  background-color: var(--color-bg-elevated);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
</style>
