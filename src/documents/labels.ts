import type {
  LineEnding,
  TextDocument,
  TextEncoding,
} from '../services/filesApi';
import type { CommandError, ErrorKind } from '../services/tauri';
import { MAX_EDITABLE_MIB, MAX_OFFICE_MIB } from './limits';

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
export const OFFICE_FAILURE_NOTICES = {
  unsupported:
    'Este equipo no puede abrir documentos de Office dentro de la aplicación: falta una función de Microsoft Edge WebView2. Actualiza WebView2 y vuelve a intentarlo. Se ofrece como binario.',
  tooLarge: `El documento supera el tamaño máximo para abrirlo aquí (${MAX_OFFICE_MIB} MiB). Se ofrece como binario.`,
  timeout:
    'El visor de documentos tardó demasiado en responder. El archivo no se ha modificado. Se ofrece como binario.',
  boot: 'No se pudo iniciar el visor de documentos de Office. El archivo no se ha modificado. Se ofrece como binario.',
  damaged:
    'No se pudo abrir el documento: está dañado o su formato no es compatible. El archivo no se ha modificado. Se ofrece como binario.',
  unreadable: 'No se pudo leer el archivo del disco. Se ofrece como binario.',
} as const;
export const OFFICE_BLOCKED_NOTICE =
  'Esa acción no está disponible en el visor: los archivos solo se abren desde el explorador.';
export const OFFICE_MACROS_NOTICE =
  'El documento contiene macros: no se ejecutan en esta aplicación.';
export const MEDIA_FAILURE_NOTICES = {
  unrecognized:
    'Este WebView no reconoce el formato del archivo, así que no se puede reproducir aquí.',
  unsupported:
    'El formato o el códec del archivo no es compatible con el reproductor.',
  decode:
    'El archivo está dañado o su contenido no se pudo decodificar a mitad de la reproducción.',
  network: 'No se pudo leer el archivo del disco mientras se reproducía.',
  aborted: 'Se interrumpió la carga del archivo.',
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
  office_too_large: `El documento superó el tamaño máximo de Office (${MAX_OFFICE_MIB} MiB) y no se puede guardar. Tus cambios siguen en el editor.`,
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

export const ARCHIVE_LISTING_TEXT = 'Leyendo el archivo comprimido…';
export const ARCHIVE_FAILURE_PREFIX = 'No se pudo leer el archivo comprimido';
export const ARCHIVE_ENCRYPTED_NOTICE =
  'El archivo contiene entradas cifradas: se pueden ver sus nombres, pero no se puede extraer (la aplicación no pide contraseñas).';
export const ARCHIVE_TRUNCATED_NOTICE =
  'Hay más entradas de las que se muestran; la extracción incluye todas.';
export const ARCHIVE_ONEDRIVE_NOTICE =
  'La carpeta está dentro de OneDrive: una extracción grande puede disparar una sincronización masiva. Considera extraer fuera de OneDrive.';
export const ARCHIVE_SKIP_NOTICE =
  'Se omitirán las entradas marcadas: enlaces, archivos especiales y nombres no seguros.';

export const SAVING_NOTE =
  ' Un guardado sigue en curso y puede no completarse.';
