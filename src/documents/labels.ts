import type {
  LineEnding,
  TextDocument,
  TextEncoding,
} from '../services/filesApi';
import type { CommandError, ErrorKind } from '../services/tauri';
import { MAX_EDITABLE_MIB } from './limits';

export const NOT_TEXT_NOTICE =
  'El contenido no es texto UTF-8 ni UTF-16 con marca BOM: se ofrece como binario.';
export const TOO_LARGE_NOTICE = `Supera el tamaño máximo del editor (${MAX_EDITABLE_MIB} MiB): se ofrece como binario con hexadecimal.`;

export const READ_ONLY_NOTICE =
  'El archivo es de solo lectura (por ejemplo, tiene svn:needs-lock) y no se puede guardar. Tus cambios siguen en el editor.';
export const BLOCKED_IMAGE_LABEL = 'Imagen bloqueada';
export const MISSING_IMAGE_LABEL = 'Imagen no encontrada';
export const LINK_INERT_LABEL = 'Enlace desactivado en la vista previa';
export const IMAGE_FAILED_NOTICE =
  'No se pudo mostrar la imagen: el archivo no es una imagen válida o está dañado. Se ofrece como binario.';
export const PDF_FAILURE_NOTICES = {
  password:
    'El PDF está protegido con contraseña y no se puede abrir aquí. Se ofrece como binario.',
  damaged:
    'No se pudo leer el PDF: está dañado o no es un PDF válido. Se ofrece como binario.',
} as const;
export const MODIFIED_LABEL = 'Modificado';
export const SAVED_LABEL = 'Guardado';

const SAVE_ERROR_NOTICES: Partial<Record<ErrorKind, string>> = {
  file_locked:
    'El archivo está en uso por otro programa. Ciérralo y vuelve a intentarlo; tus cambios siguen en el editor.',
  working_copy_busy:
    'La copia de trabajo está ocupada con otra operación de Subversion (actualizar, confirmar…). Espera a que termine y vuelve a intentarlo; tus cambios siguen en el editor.',
  too_large: `El contenido supera el tamaño máximo del editor (${MAX_EDITABLE_MIB} MiB) y no se puede guardar.`,
  not_text: 'El archivo ya no es texto y no se puede guardar desde el editor.',
  cloud_only:
    'El archivo está solo en la nube: descárgalo antes de guardar. Tus cambios siguen en el editor.',
};

export function describeSaveError(error: CommandError): string {
  const known = SAVE_ERROR_NOTICES[error.kind];
  return known ?? `No se pudo guardar: ${error.message}`;
}

export const ENCODING_LABELS: Record<TextEncoding, string> = {
  utf8: 'UTF-8',
  utf16_le: 'UTF-16 LE',
  utf16_be: 'UTF-16 BE',
};

export const EOL_LABELS: Record<LineEnding, string> = {
  lf: 'LF',
  crlf: 'CRLF',
};

export interface DocumentFacts {
  encoding: string;
  bom: string;
  eol: string;
  mixedEolNotice: string | null;
}

export type DescribedDocument = Pick<
  TextDocument,
  'encoding' | 'has_bom' | 'eol' | 'eol_mixed'
>;

export function describeDocument(document: DescribedDocument): DocumentFacts {
  const eol = EOL_LABELS[document.eol];
  return {
    encoding: ENCODING_LABELS[document.encoding],
    bom: document.has_bom ? 'con BOM' : 'sin BOM',
    eol,
    mixedEolNotice: document.eol_mixed
      ? `Fin de línea mixto: predomina ${eol}.`
      : null,
  };
}
