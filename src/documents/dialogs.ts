import { choose } from '../composables/useChoice';
import type { LineEnding } from '../services/filesApi';
import { EOL_LABELS } from './labels';

export type ConflictChoice = 'reload' | 'overwrite';
export type CloseChoice = 'save' | 'discard';

const CANCEL = 'cancel';
const CLOSE_ANYWAY = 'close-anyway';

function pickedOrNull<T extends string>(
  answer: T | typeof CANCEL | null,
): T | null {
  return answer === CANCEL ? null : answer;
}

export function pluralTabs(count: number): string {
  return count === 1 ? '1 pestaña tiene' : `${count} pestañas tienen`;
}

export async function askConflict(
  fileName: string,
): Promise<ConflictChoice | null> {
  const answer = await choose<ConflictChoice | typeof CANCEL>({
    title: 'El archivo cambió en el disco',
    message: `«${fileName}» se modificó fuera de la aplicación desde que lo abriste. Recargar descarta lo que escribiste aquí; Sobrescribir guarda tu versión encima de la que hay ahora en el disco y los cambios externos se pierden.`,
    options: [
      { value: CANCEL, label: 'Cancelar' },
      { value: 'reload', label: 'Recargar (descarta mis cambios)' },
      {
        value: 'overwrite',
        label: 'Sobrescribir (pisa los cambios externos)',
        tone: 'danger',
      },
    ],
  });
  return pickedOrNull(answer);
}

export async function askLineEnding(
  fileName: string,
  dominant: LineEnding,
): Promise<LineEnding | null> {
  const other: LineEnding = dominant === 'lf' ? 'crlf' : 'lf';
  const answer = await choose<LineEnding | typeof CANCEL>({
    title: 'Fin de línea mixto',
    message: `«${fileName}» mezcla finales de línea LF y CRLF (predomina ${EOL_LABELS[dominant]}). Al guardar se unificarán todos, lo que puede ensuciar el diff de SVN. ¿Con cuál quieres guardarlo?`,
    options: [
      { value: CANCEL, label: 'Cancelar' },
      { value: other, label: `Usar ${EOL_LABELS[other]}` },
      {
        value: dominant,
        label: `Conservar el dominante (${EOL_LABELS[dominant]})`,
        tone: 'primary',
      },
    ],
  });
  return pickedOrNull(answer);
}

export async function askWindowClose(
  dirtyCount: number,
): Promise<CloseChoice | null> {
  const answer = await choose<CloseChoice | typeof CANCEL>({
    title: 'Cambios sin guardar',
    message: `${pluralTabs(dirtyCount)} cambios sin guardar. Si cierras la ventana sin guardarlos, se perderán.`,
    options: [
      { value: CANCEL, label: 'Cancelar' },
      { value: 'discard', label: 'Cerrar sin guardar', tone: 'danger' },
      { value: 'save', label: 'Guardar y cerrar', tone: 'primary' },
    ],
  });
  return pickedOrNull(answer);
}

export async function askCloseAnyway(): Promise<boolean> {
  const answer = await choose<typeof CLOSE_ANYWAY | typeof CANCEL>({
    title: 'No se pudo comprobar si hay cambios sin guardar',
    message:
      'Falló la comprobación de los documentos abiertos. Si cierras de todos modos, lo que no esté guardado se perderá.',
    options: [
      { value: CANCEL, label: 'Cancelar' },
      { value: CLOSE_ANYWAY, label: 'Cerrar de todos modos', tone: 'danger' },
    ],
  });
  return answer === CLOSE_ANYWAY;
}
