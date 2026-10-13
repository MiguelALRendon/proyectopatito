<script setup lang="ts">
import { computed } from 'vue';
import type { StatusReport } from '../services/tauri';
import { itemLabel } from '../utils/svnLabels';

const props = defineProps<{ report: StatusReport }>();

const hasProps = computed(() =>
  props.report.entries.some((entry) => entry.props !== 'none'),
);
</script>

<template>
  <p v-if="report.entries.length === 0" class="status-table__empty">
    Sin cambios en la copia de trabajo.
  </p>
  <div
    v-else
    class="status-table__scroll"
    role="region"
    aria-label="Estado de la copia de trabajo"
    tabindex="0"
  >
    <table class="status-table">
      <caption class="status-table__caption">
        Estado de la copia de trabajo
      </caption>
      <thead>
        <tr>
          <th scope="col">Ruta</th>
          <th scope="col">Estado</th>
          <th v-if="hasProps" scope="col">Propiedades</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="entry in report.entries" :key="entry.path">
          <td class="status-table__path">{{ entry.path }}</td>
          <td>
            <span
              class="status-table__badge"
              :class="`status-table__badge--${itemLabel(entry.item).tone}`"
            >
              {{ itemLabel(entry.item).label }}
            </span>
          </td>
          <td v-if="hasProps">
            <span
              v-if="entry.props !== 'none'"
              class="status-table__badge"
              :class="`status-table__badge--${itemLabel(entry.props).tone}`"
            >
              {{ itemLabel(entry.props).label }}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.status-table__scroll {
  overflow-x: auto;
}

.status-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}

.status-table__caption {
  margin-bottom: var(--space-sm);
  text-align: left;
  font-weight: var(--font-weight-bold);
}

.status-table th,
.status-table td {
  padding: var(--space-sm);
  border-bottom: var(--border-width-sm) solid var(--color-border);
}

.status-table__path {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-sm);
  overflow-wrap: anywhere;
}

.status-table__empty {
  margin: 0;
  color: var(--color-text-muted);
}

.status-table__badge {
  display: inline-block;
  padding: var(--space-xs) var(--space-sm);
  border: var(--border-width-sm) solid var(--color-border);
  border-radius: var(--radius-sm);
  background-color: var(--color-bg-elevated);
  font-size: var(--font-size-sm);
}

.status-table__badge--success {
  border-color: var(--color-success);
}

.status-table__badge--warning {
  border-color: var(--color-conflict-marker);
}

.status-table__badge--danger {
  border-color: var(--color-error);
}
</style>
